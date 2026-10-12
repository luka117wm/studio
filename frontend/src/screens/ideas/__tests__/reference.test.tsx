// Вкладка «Референс» экрана 2 на моках артборда: карта структуры, метрики, приёмы, ввод субтитров, мост разбора,
// выпуск по референсу с режимом, сходство на вкладке и в правой панели экрана 3.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SimilarityReport } from '@/types/plan'
import { stubApi } from '../../../api/__tests__/fakes'
import { renderApp } from '../../../app/__tests__/harness'
import { createMockApi, type MockApi } from '../../../mocks/api'
import { useUiStore } from '../../../store/uiStore'

const INITIAL = { channel: 'cursus' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [] }
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  useUiStore.setState(INITIAL)
  writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
// Сначала размонтировать, потом снять фейки (L-024)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'clipboard')
})

async function open(api: MockApi = createMockApi(), path = '/ideas?tab=reference') {
  const app = renderApp(path, { stub: stubApi(api) })
  const map = await screen.findByRole('region', { name: 'Карта структуры' }, { timeout: 3000 })
  const input = screen.getByRole('complementary', { name: 'Ввод референса' })
  // Референсы канала загружены: слева форма или сохранённый референс
  await waitFor(() => expect(input.querySelector('form, [aria-label="Субтитры референса"]')).not.toBeNull(), { timeout: 3000 })
  return { ...app, map, input }
}

const posts = (fetch: ReturnType<typeof vi.fn>, path: string) =>
  fetch.mock.calls
    .filter(([url, init]) => String(url).startsWith(path) && (init as RequestInit | undefined)?.method === 'POST')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body ?? 'null')) as unknown)
const toasts = () => useUiStore.getState().toasts.map((t) => t.message)
const statusBar = () => document.querySelector('footer[role="status"]')?.textContent ?? ''

/** Выпуск «Пиратов» сделан по референсу артборда: у мока у него есть план — сходство 3 % */
function pirateByReference(api: MockApi): MockApi {
  const patch = { brief: { reference_id: 'ref0001', reference_mode: 'structure_clone' } }
  expect(api.handle('PATCH', '/api/projects/pirate', patch).status).toBe(200)
  return api
}

describe('разобранный референс', () => {
  test('карта из 10 сегментов: узкие — подпись в Tooltip, шкала 0…22:41', async () => {
    const { map } = await open()
    const segments = within(map).getByRole('list', { name: 'Сегменты' })
    const items = within(segments).getAllByRole('listitem')
    expect(items).toHaveLength(10)
    expect(items.map((i) => i.getAttribute('aria-label'))[2]).toBe('Ранг 1, длительность 2:48')
    expect(within(items[2]!).getByText('Ранг 1')).toBeTruthy()
    // Хук 0:22 из 22:41 — узкий: подписи в ячейке нет, только фокусируемая область с Tooltip
    expect(items[0]!.dataset.narrow).toBe('true')
    expect(within(items[0]!).queryByText('Хук')).toBeNull()
    within(items[0]!).getByRole('generic', { name: 'Хук, длительность 0:22' }).focus()
    expect(await screen.findByRole('tooltip')).toHaveProperty('textContent', 'Хук, длительность 0:22')
    expect(items.filter((i) => i.dataset.narrow).map((i) => i.getAttribute('aria-label'))).toEqual([
      'Хук, длительность 0:22',
      'Обещание, длительность 0:43',
      'Крючок, длительность 0:26',
      'Крючок, длительность 0:31',
    ])
    const scale = within(map).getByLabelText('Шкала времени')
    expect([...scale.children].map((c) => c.textContent)).toEqual(['0:00', '5:40', '11:21', '17:01', '22:41'])
  })

  test('метрики — подписи по артборду, числа бэкенда; приёмы с номерами и счётом', async () => {
    const { map } = await open()
    const metrics = within(map).getByLabelText('Метрики референса')
    const cards = [...metrics.children].map((card) => [...card.children].map((c) => c.textContent))
    expect(cards).toEqual([
      ['Темп', '148слов/мин', 'Как у Cursus: 150 слов/мин'],
      ['Плотность фактов', '3,0на минуту', 'Держится до 16-й минуты'],
      ['Сегментов', '10из них 5 рангов', '2 крючка удержания: 3:53 и 11:09'],
    ])
    expect(within(map).queryByText('Средняя длина кадра')).toBeNull()
    const techniques = within(map).getByRole('region', { name: 'Приёмы подачи' })
    const rows = within(techniques).getAllByRole('listitem').map((li) => li.textContent)
    expect(rows[0]).toBe('01Ранг называется голосом и повторяется в конце блока10 раз')
    expect(rows).toHaveLength(4)
  })

  test('шапка — когда разобран; статус-строка — длительность и сегменты; превью вместо текста', async () => {
    const { input } = await open()
    expect(screen.getByText('Референс разобран 11 сентября, 11:54')).toBeTruthy()
    await waitFor(() =>
      expect(statusBar()).toContain('Референс: 22:41, 10 сегментов; текст референса в сценарий не переносится'),
    )
    const saved = within(input).getByRole('region', { name: 'Субтитры референса' })
    expect(within(saved).getByText('412 реплик, 22:41')).toBeTruthy()
    expect(within(input).getByRole('button', { name: 'Скопировать промпт разбора' })).toBeTruthy()
  })

  test('«Своя версия этой темы» — выпуск с режимом, экран 3 с заметкой о референсе, тост', async () => {
    const { map, stub } = await open()
    await userEvent.click(within(map).getByRole('button', { name: 'Своя версия этой темы' }))
    await waitFor(() => expect(window.location.pathname).toBe('/episodes/c11/script'))
    expect(posts(stub.fetch, '/api/references/ref0001/episodes')).toEqual([{ mode: 'own_version' }])
    expect(toasts()).toContain('Выпуск создан: Cursus, слот 23 сентября')

    const note = await screen.findByLabelText('Референс выпуска', {}, { timeout: 3000 })
    expect(note.textContent).toContain('По референсу «Every Rank on a Roman Warship»: своя версия темы.')
    expect(within(note).getByRole('link', { name: 'Открыть референс' }).getAttribute('href')).toBe('/ideas?tab=reference&ref=ref0001')
    expect(screen.getByDisplayValue('How rank, pay and danger were split on a Roman war galley')).toBeTruthy()
    const similarity = await screen.findByRole('region', { name: 'Сходство с референсом' })
    expect(await within(similarity).findByText('Плана ещё нет — сравнивать нечего.')).toBeTruthy()
  })

  test('«Новая тема по этой структуре» — режим structure_clone, идея пустая', async () => {
    const { map, stub } = await open()
    await userEvent.click(within(map).getByRole('button', { name: 'Новая тема по этой структуре' }))
    await waitFor(() => expect(window.location.pathname).toBe('/episodes/c11/script'))
    expect(posts(stub.fetch, '/api/references/ref0001/episodes')).toEqual([{ mode: 'structure_clone' }])
    const note = await screen.findByLabelText('Референс выпуска', {}, { timeout: 3000 })
    expect(note.textContent).toContain('новая тема по структуре')
  })
})

describe('ввод и разбор', () => {
  test('нет референсов — ввод; не субтитры — ошибка под полем; сохранение — тост и мост', async () => {
    useUiStore.setState({ channel: 'otto' })
    const { map, input, stub } = await open()
    expect(within(map).getByText('Референса нет')).toBeTruthy()
    const form = within(input).getByRole('form', { name: 'Новый референс' })
    const field = within(form).getByRole('textbox', { name: 'Субтитры' })
    const save = within(form).getByRole('button', { name: 'Сохранить' })
    expect(save.hasAttribute('disabled')).toBe(true)

    await userEvent.type(field, 'just some words')
    await userEvent.click(save)
    expect(await within(form).findByText('Не похоже на субтитры: нет таймкодов. Вставьте SRT, VTT или расшифровку с YouTube.')).toBeTruthy()
    expect(field.getAttribute('aria-invalid')).toBe('true')

    await userEvent.clear(field)
    await userEvent.click(field)
    await userEvent.paste('0:00 You are seventeen\n0:11 and the navy hands you an oar')
    await userEvent.click(save)
    await waitFor(() => expect(toasts()).toContain('Референс сохранён: 0:11, 2 реплики'))
    expect(posts(stub.fetch, '/api/references').at(-1)).toMatchObject({ channel: 'otto', url: '' })
    expect(await within(input).findByRole('button', { name: 'Скопировать промпт разбора' })).toBeTruthy()
    expect(window.location.search).toContain('ref=ref0002')

    // До разбора — пояснение и выключенные действия с подсказкой
    expect(within(map).getByText('Разбора ещё нет')).toBeTruthy()
    expect(within(map).getByRole('button', { name: 'Своя версия этой темы' }).hasAttribute('disabled')).toBe(true)
    expect(within(map).getByText('Сначала разберите референс: скопируйте промпт разбора слева и вставьте ответ чата.')).toBeTruthy()
    expect(screen.getByText('Референс не разобран')).toBeTruthy()
  })

  test('промпт разбора в буфер; ответ чата — тост и карта', async () => {
    useUiStore.setState({ channel: 'otto' })
    const api = createMockApi()
    expect(api.handle('POST', '/api/references', { channel: 'otto', subtitles: '0:00 a\n1:00 b\n2:00 c' }).status).toBe(201)
    const { map, input } = await open(api)
    await userEvent.click(within(input).getByRole('button', { name: 'Скопировать промпт разбора' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(toasts()).toContain('Промпт разбора скопирован')

    const answer = {
      title: 'A Day in a Monastery',
      author: 'Sample',
      topic: 'One day of an oblate',
      segments: [
        { kind: 'hook', label: 'Opening', start: '00:00', facts: 0 },
        { kind: 'rank', label: 'Matins', start: '00:40', facts: 2 },
        { kind: 'finale', label: 'Ending', start: '01:30', facts: 0 },
      ],
      techniques: [{ text: 'Bells mark the hours', count: 3 }],
    }
    await userEvent.click(within(input).getByRole('textbox', { name: 'Ответ из чата' }))
    await userEvent.paste('Here it is:\n```json\n' + JSON.stringify(answer) + '\n```')
    await userEvent.click(within(input).getByRole('button', { name: 'Применить вставку' }))
    await waitFor(() => expect(toasts()).toContain('Референс разобран: 3 сегмента'))
    const segments = await within(map).findByRole('list', { name: 'Сегменты' })
    expect(within(segments).getAllByRole('listitem')).toHaveLength(3)
    expect(within(map).getByText('A Day in a Monastery — Sample, 2:00')).toBeTruthy()
  })

  test('несколько референсов — Select; «Новый референс» — форма, «Отмена» — обратно', async () => {
    const api = createMockApi()
    api.handle('POST', '/api/references', { channel: 'cursus', url: 'youtube.com/watch?v=two', subtitles: '0:00 a\n0:30 b' })
    const { input } = await open(api)
    const select = within(input).getByRole('combobox', { name: 'Референс канала' })
    expect(select.textContent).toContain('youtube.com/watch?v=two, 0:30')
    await userEvent.click(select)
    await userEvent.click(await screen.findByRole('option', { name: 'Every Rank on a Roman Warship — Gradus, 22:41' }))
    expect(window.location.search).toContain('ref=ref0001')
    await userEvent.click(within(input).getByRole('button', { name: 'Новый референс' }))
    expect(within(input).getByRole('form', { name: 'Новый референс' })).toBeTruthy()
    await userEvent.click(within(input).getByRole('button', { name: 'Отмена' }))
    expect(within(input).queryByRole('form')).toBeNull()
  })
})

describe('сходство', () => {
  test('на вкладке — выпуски по референсу; в статус-строке — доля', async () => {
    const { input } = await open(pirateByReference(createMockApi()))
    const plaque = within(input).getByRole('region', { name: 'Сходство с референсом' })
    expect(within(plaque).getByText('Текст референса не переносится в сценарий. Перед утверждением проверяется сходство.')).toBeTruthy()
    expect(await within(plaque).findByText('3 %', {}, { timeout: 3000 })).toBeTruthy()
    expect(within(plaque).getByText('норма, порог 10 %')).toBeTruthy()
    await waitFor(() => expect(statusBar()).toContain('Референс: 22:41, 10 сегментов, сходство 3 %'))
  })

  test('на экране 3 у выпуска по референсу — норма или warning с фразами', async () => {
    const api = pirateByReference(createMockApi())
    const handle = api.handle
    const report: SimilarityReport = {
      similarity: {
        ratio: 0.18,
        threshold: 0.1,
        ngram: 5,
        ok: false,
        matched: 18,
        total: 100,
        phrases: ['three hundred men pull together below deck'],
      },
      reason: null,
    }
    api.handle = (method, url, body) => (url.endsWith('/similarity') ? { status: 200, body: report } : handle(method, url, body))
    renderApp('/episodes/pirate/script', { stub: stubApi(api) })
    const panel = await screen.findByRole('region', { name: 'Сходство с референсом' }, { timeout: 3000 })
    expect(await within(panel).findByText('18 %')).toBeTruthy()
    expect(within(panel).getByText('выше порога 10 %').className).toContain('text-warning')
    expect(within(panel).getByRole('list', { name: 'Совпавшие фразы' }).textContent).toBe('«three hundred men pull together below deck»')
  })

  test('у выпуска не по референсу секции сходства нет', async () => {
    renderApp('/episodes/pirate/script')
    await screen.findByRole('region', { name: 'Смета по плану' }, { timeout: 3000 })
    expect(screen.queryByRole('region', { name: 'Сходство с референсом' })).toBeNull()
  })
})
