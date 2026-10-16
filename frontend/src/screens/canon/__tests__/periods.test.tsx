// Экран 12, слой «Периоды», на моках API: список эпох 280 и карточка, чипы одной записью черновика, запреты всегда
// раскрыты, публикация без запретов — отказ с текстом бэкенда, мост эпохи (промпт в буфер, ответ в черновик,
// «Дополнить запреты» без повторов), «Нужно каналу» → скелет, «Новый период» с близкой эпохи.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Period } from '@/types/canon'
import { stubApi } from '../../../api/__tests__/fakes'
import { renderApp } from '../../../app/__tests__/harness'
import { autosaver } from '../../../app/autosave'
import { setPlatform } from '../../../app/keyboard'
import { CURSUS_PERIODS, STYLE_TOKEN } from '../../../mocks/api'
import { useUiStore } from '../../../store/uiStore'

const INITIAL = { channel: 'cursus' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [], save: { kind: 'idle' as const } }

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  useUiStore.setState(INITIAL)
  setPlatform('other')
  writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
// Сначала размонтировать, потом снять фейки (L-024)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  autosaver.reset()
  Reflect.deleteProperty(navigator, 'clipboard')
})

type Call = [string, RequestInit | undefined]
const calls = (fetch: ReturnType<typeof vi.fn>, method: string, path?: string) =>
  (fetch.mock.calls as Call[])
    .filter(([url, init]) => (init?.method ?? 'GET') === method && (!path || String(url).startsWith(path)))
    .map(([url, init]) => ({ url: String(url), body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined }))

async function openPeriods(search = '', stub = stubApi()) {
  const app = renderApp(`/canon?layer=periods${search}`, { stub })
  const form = await screen.findByRole('form', { name: 'Эпоха' }, { timeout: 3000 })
  return { ...app, form }
}

const list = () => screen.getByRole('list', { name: 'Эпохи канала' })
const chips = (form: HTMLElement, name: string) =>
  within(within(form).getByRole('list', { name }))
    .queryAllByRole('listitem')
    .filter((li) => !li.querySelector('input'))
    .map((li) => li.textContent)

async function paste(root: HTMLElement, text: string) {
  await userEvent.click(within(root).getByRole('textbox', { name: 'Ответ из чата' }))
  await userEvent.paste(text)
  await userEvent.click(within(root).getByRole('button', { name: 'Применить вставку' }))
}

const CARIBBEAN = CURSUS_PERIODS['caribbean-1716']!.versions[0]!.data

describe('слой «Периоды»', () => {
  test('список: название, годы, регион, запреты, выпуски; без запретов — нельзя использовать; карточка и статус-строка', async () => {
    const { form } = await openPeriods()
    const rows = within(list()).getAllByRole('button')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Карибы, 1716'),
      expect.stringContaining('Англия, 1347'),
      expect.stringContaining('Венеция, 1560'),
    ])
    expect(rows[0]!.textContent).toContain('1716–1726')
    expect(rows[0]!.textContent).toContain('14 запретов · Caribbean Sea, Nassau')
    expect(rows[0]!.textContent).toContain('3 выпуска')
    expect(rows[0]!.getAttribute('aria-current')).toBe('true')
    expect(rows[2]!.textContent).toContain('нельзя использовать: нет запретов')
    expect(within(rows[2]!).getByRole('img', { name: 'Нельзя использовать' }).getAttribute('data-status')).toBe('failed')
    expect(screen.getByRole('complementary', { name: 'Периоды' }).className).toContain('w-shell-library')

    expect(within(form).getByRole('heading', { name: 'Карибы, 1716' })).toBeTruthy()
    expect(within(form).getByText('1716–1726 · Caribbean Sea, Nassau · 3 выпуска')).toBeTruthy()
    const groups = within(form)
      .getAllByRole('region')
      .map((g) => g.getAttribute('aria-label'))
    expect(groups).toEqual([
      'Эпоха через чат',
      'Эпоха: подпись и годы',
      'Сдвиг палитры',
      'Материалы',
      'Источники света',
      'Архитектура',
      'Одежда',
      'Предметы',
      'Не должно появляться в кадре',
    ])
    // Запреты — всегда раскрыты: все 14 чипов на виду, никакой свёрнутой секции
    expect(chips(form, 'Не должно появляться в кадре')).toEqual(CARIBBEAN.forbidden)
    expect(within(form).queryByText(/Похоже на повтор/)).toBeNull()
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Карибы, 1716 · 14 запретов'))
  })

  // По тесту на запись черновика: две записи подряд — два дебаунса автосохранения, под нагрузкой дольше 5 с
  test('чип добавляется одной записью черновика; повтор без учёта регистра не добавляется', async () => {
    const { form, stub } = await openPeriods()
    const add = within(form).getByRole('textbox', { name: 'Эпоха: Материалы: добавить' })
    await userEvent.type(add, 'Copper{Enter}')
    await userEvent.type(add, 'OAK{Enter}')
    expect(within(form).getByText('«OAK» уже есть в списке.')).toBeTruthy()
    await waitFor(() => expect(calls(stub.fetch, 'PUT')).toHaveLength(1), { timeout: 3000 })
    const first = calls(stub.fetch, 'PUT')[0]!
    expect(first.url).toBe('/api/canon/cursus/periods/caribbean-1716/draft')
    expect((first.body as Period).materials).toEqual([...CARIBBEAN.materials, 'Copper'])
    expect((first.body as Period).forbidden).toEqual(CARIBBEAN.forbidden)
  })

  test('чип убирается одной записью черновика; черновик от v001 — «Опубликовать v002»', async () => {
    const { form, stub } = await openPeriods()
    await userEvent.click(within(form).getByRole('button', { name: 'Удалить hemp' }))
    await waitFor(() => expect(calls(stub.fetch, 'PUT')).toHaveLength(1), { timeout: 3000 })
    expect((calls(stub.fetch, 'PUT')[0]!.body as Period).materials).toEqual(CARIBBEAN.materials.filter((m) => m !== 'hemp'))
    expect(stub.api.canon.periods.cursus.get('caribbean-1716')!.draft?.based_on).toBe('v001')
    expect(await screen.findByRole('button', { name: 'Опубликовать v002' })).toBeTruthy()
  })

  test('похожие запреты подсвечены: слова одной позиции входят в другую', async () => {
    const { form } = await openPeriods()
    await userEvent.type(within(form).getByRole('textbox', { name: 'Не должно появляться в кадре: добавить анахронизм' }), 'plastic buttons{Enter}')
    expect(within(form).getByText(/Похоже на повтор: «plastic» и «plastic buttons»/)).toBeTruthy()
  })

  test('эпоха без запретов: красный блок, «Опубликовать» отказывает текстом бэкенда, черновик остаётся', async () => {
    const { form, stub } = await openPeriods('&period=venice-1560')
    expect(within(form).getByRole('heading', { name: 'Венеция, 1560' })).toBeTruthy()
    expect(within(form).getByRole('alert').textContent).toContain('Период нельзя использовать: заполните список')
    expect(within(form).getByText('список пуст')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Венеция, 1560 · запреты не заполнены'))

    await userEvent.click(screen.getByRole('button', { name: 'Опубликовать v001' }))
    const dialog = screen.getByRole('dialog', { name: 'Опубликовать v001' })
    expect(dialog.textContent).toContain('Факты эпохи проверяет человек')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Опубликовать v001' }))
    const problems = await within(dialog).findByRole('list', { name: 'Что мешает опубликовать' })
    expect(within(problems).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Эпоха без запретов не публикуется — добавьте хотя бы один анахронизм.'])
    const venice = stub.api.canon.periods.cursus.get('venice-1560')!
    expect(venice.versions).toEqual([])
    expect(venice.draft).not.toBeNull()
  })
})

describe('мост эпохи и «Нужно каналу»', () => {
  test('«Нужно каналу» → скелет; пустой черновик — главное действие «Скопировать промпт эпохи»; ответ заполняет пустое, расхождения — списком', async () => {
    const { stub } = await openPeriods()
    const needed = screen.getByRole('complementary', { name: 'Нужно каналу' })
    const items = await within(needed).findAllByRole('listitem', {}, { timeout: 3000 })
    const edo = items.find((li) => li.textContent?.startsWith('edo-1650'))!
    expect(edo.textContent).toContain('64 кадра в 1 выпуске')
    expect(edo.textContent).toContain('Samurai Household: every rank')
    const venice = items.find((li) => li.textContent?.startsWith('venice-1560'))!
    expect(within(venice).getByRole('button', { name: 'Открыть' })).toBeTruthy() // черновик уже начат

    await userEvent.click(within(edo).getByRole('button', { name: 'Создать' }))
    await waitFor(() => expect(window.location.search).toBe('?layer=periods&period=edo-1650'))
    expect(calls(stub.fetch, 'POST', '/api/canon/cursus/needed/periods/edo-1650')).toHaveLength(1)
    const form = await screen.findByRole('form', { name: 'Эпоха' })
    await within(form).findByRole('heading', { name: 'edo-1650' })
    const bridge = within(form).getByRole('region', { name: 'Эпоха через чат' })
    expect(within(bridge).getByText('Эпоха пуста')).toBeTruthy()
    expect(within(bridge).getByText(/Один обмен — один чат/)).toBeTruthy()
    const copy = within(bridge).getByRole('button', { name: 'Скопировать промпт эпохи' })
    expect(copy.className).toContain('bg-accent') // главное действие экрана
    expect(screen.getByRole('button', { name: 'Опубликовать v001' }).className).not.toContain('bg-accent')

    // Подпись человека — до ответа: она остаётся, предложение чата — в «Чат предложил иначе»
    await userEvent.type(within(form).getByRole('textbox', { name: 'Подпись эпохи' }), 'Эдо, 1650')
    await userEvent.click(copy)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(String(writeText.mock.calls[0]![0])).toContain('"edo-1650"')
    expect(calls(stub.fetch, 'POST', '/api/canon/cursus/periods/edo-1650/prompt?mode=draft')).toHaveLength(1)
    expect(calls(stub.fetch, 'PUT', '/api/canon/cursus/periods/edo-1650/draft')).toHaveLength(1) // промпт видит черновик

    const answer = {
      label: 'Япония, 1650',
      region: 'Edo, Tokugawa Japan',
      years: { from: 1650, to: 1670 },
      palette_shift: ['indigo cotton', 'lacquer black'],
      materials: ['cypress wood', 'washi paper'],
      light_sources: ['paper lantern', 'charcoal brazier'],
      architecture: ['samurai residence', 'castle town street'],
      clothing: ['kosode', 'hakama'],
      props: ['katana', 'tobacco pipe'],
      forbidden: ['firearms drill in western style', 'glass windows', 'chairs', 'western shoes', 'printed newspapers', 'potatoes', 'rickshaw', 'kerosene lamp', 'photographs', 'umbrella with steel ribs'],
    }
    await paste(bridge, `Here is the period:\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``)
    const conflicts = await within(bridge).findByRole('list', { name: 'Чат предложил иначе' })
    expect(conflicts.textContent).toContain('Подпись')
    expect(conflicts.textContent).toContain('Эдо, 1650 — чат: Япония, 1650')
    const draft = stub.api.canon.periods.cursus.get('edo-1650')!.draft!.data
    expect(draft.label).toBe('Эдо, 1650')
    expect(draft.materials).toEqual(answer.materials)
    expect(draft.forbidden).toHaveLength(10)
    await waitFor(() => expect(chips(form, 'Эпоха: Материалы')).toEqual(answer.materials))
    expect(await screen.findByText(/Черновик эпохи: заполнено 9 полей, чат предложил иначе для 1/)).toBeTruthy()
    // Мост пишет только эпоху: стиль и персонажи не тронуты
    expect(calls(stub.fetch, 'PUT').every((c) => c.url.startsWith('/api/canon/cursus/periods/'))).toBe(true)
  })

  test('стилевой токен в ответе — отказ по-русски, черновик не меняется', async () => {
    const { form, stub } = await openPeriods('&period=venice-1560')
    const bridge = within(form).getByRole('region', { name: 'Эпоха через чат' })
    await userEvent.click(within(bridge).getByRole('button', { name: 'Вставить ответ' }))
    const before = structuredClone(stub.api.canon.periods.cursus.get('venice-1560')!.draft!.data)
    await paste(bridge, JSON.stringify({ materials: [`oak, ${STYLE_TOKEN}`] }))
    const alert = await within(bridge).findByRole('alert')
    expect(alert.textContent).toContain('стилевой токен')
    expect(stub.api.canon.periods.cursus.get('venice-1560')!.draft!.data).toEqual(before)
  })

  test('«Дополнить запреты»: промпт запретов, новые — в конец без повторов, «Добавлено N, повторов M»', async () => {
    const { form, stub } = await openPeriods()
    const block = within(form).getByRole('region', { name: 'Не должно появляться в кадре' })
    await userEvent.click(within(block).getByRole('button', { name: 'Дополнить запреты' }))
    const bridge = within(block).getByRole('group', { name: 'Дополнить запреты через чат' })
    await userEvent.click(within(bridge).getByRole('button', { name: 'Скопировать промпт запретов' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(calls(stub.fetch, 'POST', '/api/canon/cursus/periods/caribbean-1716/prompt?mode=forbidden')).toHaveLength(1)

    await paste(bridge, JSON.stringify({ forbidden: ['Plastic.', 'tin cans', 'the wristwatch', 'glass eye'] }))
    expect(await within(bridge).findByText('Добавлено 2, повторов 2.')).toBeTruthy()
    expect(within(bridge).getByRole('list', { name: 'Предупреждения' }).textContent).toContain('«Plastic.», «the wristwatch»')
    await waitFor(() => expect(chips(form, 'Не должно появляться в кадре')).toEqual([...CARIBBEAN.forbidden, 'tin cans', 'glass eye']))
    expect(stub.api.canon.periods.cursus.get('caribbean-1716')!.draft!.data.forbidden).toHaveLength(16)
  })

  test('«Новый период» с близкой эпохи: списки и запреты переносятся, подпись, регион и годы — заново', async () => {
    const { stub } = await openPeriods('&period=england-1347')
    await userEvent.click(screen.getByRole('button', { name: 'Новый период' }))
    const dialog = screen.getByRole('dialog', { name: 'Новый период' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'id эпохи' }), 'England_1347')
    expect(within(dialog).getByText(/Только строчные латинские буквы/)).toBeTruthy()
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'id эпохи' }))
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'id эпохи' }), 'england-1347')
    expect(within(dialog).getByText('Эпоха england-1347 уже есть — откройте её в списке.')).toBeTruthy()
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'id эпохи' }))
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'id эпохи' }), 'france-1360')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Подпись новой эпохи' }), 'Франция, 1360-е')
    expect(within(dialog).getByRole('combobox', { name: 'Начать с эпохи' }).textContent).toContain('Англия, 1347')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать черновик' }))

    await waitFor(() => expect(window.location.search).toBe('?layer=periods&period=france-1360'))
    const england = CURSUS_PERIODS['england-1347']!.versions[0]!.data
    const body = calls(stub.fetch, 'PUT', '/api/canon/cursus/periods/france-1360/draft')[0]!.body as Period
    expect(body).toEqual({ ...england, id: 'france-1360', label: 'Франция, 1360-е', region: '', years: null })
    const form = await screen.findByRole('form', { name: 'Эпоха' })
    expect(await within(form).findByRole('heading', { name: 'Франция, 1360-е' })).toBeTruthy()
  })
})
