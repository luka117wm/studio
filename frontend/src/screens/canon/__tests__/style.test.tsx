// Экран 12, слой «Стиль», на моках API: группы и поля, автосохранение черновика одним PUT, публикация версии,
// старая версия — только чтение, сравнение по полям, кадры стиля с ценой и отказом бюджета, клавиши ⌘⇧1…⌘⇧3.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { JobEventData } from '@/types/job'
import type { Style } from '@/types/canon'
import { FakeEventSource, stubApi } from '../../../api/__tests__/fakes'
import { renderApp } from '../../../app/__tests__/harness'
import { autosaver } from '../../../app/autosave'
import { formatClock } from '../../../app/format'
import { setPlatform } from '../../../app/keyboard'
import { CURSUS_STYLE, NOW, createMockApi } from '../../../mocks/api'
import { useUiStore } from '../../../store/uiStore'

const INITIAL = { channel: 'cursus' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [], save: { kind: 'idle' as const } }

beforeEach(() => {
  useUiStore.setState(INITIAL)
  setPlatform('other')
})
// Сначала размонтировать, потом снять фейки (L-024)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  autosaver.reset()
})

type Call = [string, RequestInit | undefined]
const calls = (fetch: ReturnType<typeof vi.fn>, method: string, path?: string) =>
  (fetch.mock.calls as Call[])
    .filter(([url, init]) => (init?.method ?? 'GET') === method && (!path || String(url).startsWith(path)))
    .map(([url, init]) => ({ url: String(url), body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined }))

async function openCanon(path = '/canon', stub = stubApi()) {
  const app = renderApp(path, { stub })
  const form = await screen.findByRole('form', { name: 'Стиль канала' }, { timeout: 3000 })
  return { ...app, form }
}

const versionMenu = () => screen.getByRole('button', { name: /текущая|Черновик|только чтение/ })

describe('слой «Стиль»', () => {
  test('группы и поля артборда; палитра — образцы из данных; шапка — уровень канала', async () => {
    const { form } = await openCanon()
    const groups = within(form)
      .getAllByRole('region')
      .map((g) => g.getAttribute('aria-label'))
    expect(groups).toEqual(['Рендер и материал', 'Оптика', 'Свет', 'Палитра', 'Зерно и композиция', 'Глобальный negative'])
    expect(within(form).getByRole('textbox', { name: 'Свет: Направление' })).toHaveProperty(
      'value',
      'From the side and above, 30–45°; backlight only in the closing shots of a section',
    )
    expect(within(form).getByRole('textbox', { name: 'Оптика: Фокусное' })).toHaveProperty('value', '35 mm for wide and medium shots; 85 mm for the rank portrait')

    const swatches = within(within(form).getByRole('list', { name: 'Образцы палитры' })).getAllByRole('listitem')
    expect(swatches).toHaveLength(5)
    // Цвет образца — данные канона в style, не класс интерфейса
    const sample = swatches[4]!.firstElementChild as HTMLElement
    expect(sample.style.background).toBe('rgb(142, 59, 46)')
    const accent = CURSUS_STYLE[2]!.data.palette.swatches[4]!
    expect(within(swatches[4]!).getByRole('textbox', { name: 'Образец 5: цвет' })).toHaveProperty('value', accent.hex)
    expect(within(within(form).getByRole('list', { name: 'Глобальный negative' })).getAllByRole('listitem')).toHaveLength(13) // 12 запретов и поле

    const banner = screen.getByRole('banner', { name: 'Верхняя панель' })
    expect(within(banner).getByText('Канон')).toBeTruthy()
    expect(within(banner).getByText('уровень канала, не выпуска')).toBeTruthy()
    expect(within(banner).queryByText('Выпуск не открыт')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Канон', level: 1 })).toBeTruthy()
    expect(versionMenu().textContent).toContain('v003 · текущая')
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Стиль v003 · текущая версия'))
    expect(screen.getByRole('status').textContent).toContain('правка не задевает выпуски, пока их не перевели на новую версию')
    expect(screen.getByRole('complementary', { name: 'Опорные кадры стиля' }).className).toContain('w-shell-anchors')
  })

  test('правка пишется в черновик одним PUT после паузы; шапка — «Черновик из v003» и «Сохранено»', async () => {
    const { form, stub } = await openCanon()
    const field = within(form).getByRole('textbox', { name: 'Свет: Направление' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Top light')
    await waitFor(() => expect(calls(stub.fetch, 'PUT')).toHaveLength(1), { timeout: 3000 })
    const put = calls(stub.fetch, 'PUT')[0]!
    expect(put.url).toBe('/api/canon/cursus/style/draft')
    const body = put.body as Style
    expect(body.light.direction).toBe('Top light')
    expect(body.render).toBe('Film photograph of the 1970s, printed from the negative; no digital cleanness')
    expect(stub.api.canon.styles.cursus.draft?.based_on).toBe('v003')
    await waitFor(() => expect(versionMenu().textContent).toContain('Черновик из v003'))
    expect(screen.getByText(`Сохранено ${formatClock(NOW)}`)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Опубликовать v004' })).toBeTruthy()
  })

  test('кириллица в поле промпта — подсказка у поля; неполный hex в черновик не пишется', async () => {
    const { form, stub } = await openCanon()
    await userEvent.type(within(form).getByRole('textbox', { name: 'Рендер и материал: Материал' }), ', дерево')
    expect(within(form).getAllByText(/Пишите по-английски/).length).toBeGreaterThan(0)
    const hex = within(form).getByRole('textbox', { name: 'Образец 1: цвет' })
    await userEvent.clear(hex)
    await userEvent.type(hex, '#12')
    expect(within(form).getByText('Нужен код #RRGGBB')).toBeTruthy()
    await waitFor(() => expect(calls(stub.fetch, 'PUT')).toHaveLength(1), { timeout: 3000 })
    const saved = calls(stub.fetch, 'PUT')[0]!.body as Style
    expect(saved.palette.swatches[0]!.hex).toBe(CURSUS_STYLE[2]!.data.palette.swatches[0]!.hex)
  })

  test('«Опубликовать v004» — подтверждение со списком изменений, новая версия в истории, кадры стиля устарели', async () => {
    const { form, stub } = await openCanon()
    const field = within(form).getByRole('textbox', { name: 'Свет: Направление' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Top light')
    await userEvent.click(await screen.findByRole('button', { name: 'Опубликовать v004' }, { timeout: 3000 }))
    const dialog = screen.getByRole('dialog', { name: 'Опубликовать v004' })
    const changes = await within(dialog).findByRole('list', { name: 'Изменения к прошлой версии' })
    expect(within(changes).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Направление светаTop light'])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Опубликовать v004' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stub.api.canon.styles.cursus.versions.map((v) => v.info.version)).toEqual(['v001', 'v002', 'v003', 'v004'])
    expect(stub.api.canon.styles.cursus.draft).toBeNull()
    expect(calls(stub.fetch, 'PUT')).toHaveLength(1) // черновик записан до публикации, второй записи нет
    await waitFor(() => expect(versionMenu().textContent).toContain('v004 · текущая'))
    expect(screen.getByText(/Опубликована v004/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'История' }))
    const history = screen.getByRole('region', { name: 'История версий' })
    expect(within(history).getAllByRole('listitem')[0]?.textContent).toMatch(/^v004.*из v003.*текущая/)
    const panel = screen.getByRole('complementary', { name: 'Опорные кадры стиля' })
    await waitFor(() => expect(within(panel).getByText('Кадры стиля устарели: в v004 изменились light.direction — пересоберите их.')).toBeTruthy())
  })

  test('отказ публикации 409 — все нарушения построчно, черновик остаётся', async () => {
    const api = createMockApi()
    const { form } = await openCanon('/canon', stubApi(api))
    await userEvent.clear(within(form).getByRole('textbox', { name: 'Рендер и материал: Рендер' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Опубликовать v004' }, { timeout: 3000 }))
    const dialog = screen.getByRole('dialog', { name: 'Опубликовать v004' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Опубликовать v004' }))
    const problems = await within(dialog).findByRole('list', { name: 'Что мешает опубликовать' })
    expect(problems.textContent).toContain('Стиль без рендера не публикуется')
    expect(api.canon.styles.cursus.versions).toHaveLength(3)
    expect(api.canon.styles.cursus.draft?.data.render).toBe('')
  })

  test('старая версия — только чтение; «Создать v004 из v002» начинает черновик из неё', async () => {
    const { stub } = await openCanon()
    await userEvent.click(versionMenu())
    await userEvent.click(screen.getByRole('menuitem', { name: /^v002/ }))
    const note = await screen.findByRole('note', { name: 'Только чтение' })
    expect(note.textContent).toContain('Версия v002 — только чтение')
    const readOnly = await screen.findByRole('form', { name: 'Стиль канала' })
    await waitFor(() => expect(within(readOnly).getByLabelText('Рендер и материал: Рендер').textContent).toBe('Film photograph of the 1980s, clean print'))
    expect(within(readOnly).queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Опубликовать/ })).toBeNull()

    await userEvent.click(within(note).getByRole('button', { name: 'Создать v004 из v002' }))
    await waitFor(() => expect(screen.queryByRole('note', { name: 'Только чтение' })).toBeNull())
    expect(calls(stub.fetch, 'POST', '/api/canon/cursus/style/draft').map((c) => c.url)).toEqual(['/api/canon/cursus/style/draft?from=v002'])
    expect(versionMenu().textContent).toContain('Черновик из v002')
    const form = screen.getByRole('form', { name: 'Стиль канала' })
    expect(within(form).getByRole('textbox', { name: 'Рендер и материал: Рендер' })).toHaveProperty('value', 'Film photograph of the 1980s, clean print')
  })

  test('«Сравнить с v002» — построчно было → стало, изменённые поля помечены', async () => {
    await openCanon()
    await userEvent.click(screen.getByRole('button', { name: 'Сравнить с v002' }))
    const diff = await screen.findByRole('region', { name: 'Сравнение версий' })
    expect(within(diff).getByText('Сравнение v002 и v003 · текущая')).toBeTruthy()
    expect(within(diff).getByText('8 полей из 14 изменены')).toBeTruthy()
    const row = (label: string) => within(diff).getByRole('rowheader', { name: label }).closest('tr')!
    expect(row('Рендер').hasAttribute('data-changed')).toBe(true)
    expect(row('Рендер').textContent).toContain('Film photograph of the 1980s, clean print')
    expect(row('Контраст света').hasAttribute('data-changed')).toBe(true)
    expect(row('Композиция').hasAttribute('data-changed')).toBe(false)
    expect(row('Глобальный negative').textContent).toContain('добавлены «HDR glow», «symmetrical faces»')
    await userEvent.click(within(diff).getByRole('button', { name: 'Закрыть сравнение' }))
    expect(screen.getByRole('form', { name: 'Стиль канала' })).toBeTruthy()
  })
})

describe('опорные кадры стиля', () => {
  test('сетка шести шаблонов; «Пересобрать (6, ~$0.80)» ставит джоб в выбранной эпохе, прогресс — из SSE', async () => {
    const { stub } = await openCanon()
    const panel = screen.getByRole('complementary', { name: 'Опорные кадры стиля' })
    expect(await within(panel).findByText('6 кадров, версия v003')).toBeTruthy()
    const frames = within(await within(panel).findByRole('list', { name: 'Кадры стиля' })).getAllByRole('listitem')
    expect(frames.map((f) => f.textContent)).toEqual(['01Общий план', '02Портрет', '03Деталь', '04Толпа', '05Ночь', '06Силуэт'])
    expect(within(panel).getByRole('combobox', { name: 'Эпоха кадров стиля' }).textContent).toContain('Карибы, 1716')

    const rebuild = await within(panel).findByRole('button', { name: 'Пересобрать (6, ~$0.80)' })
    await userEvent.click(rebuild)
    await waitFor(() => expect(calls(stub.fetch, 'POST', '/api/canon/cursus/style/anchors')).toHaveLength(1))
    expect(calls(stub.fetch, 'POST', '/api/canon/cursus/style/anchors')[0]?.body).toEqual({ period: 'caribbean-1716' })
    const progress = await within(panel).findByLabelText('Сборка кадров стиля')
    expect(progress.textContent).toContain('В очереди')

    // Поток SSE ведёт джоб уровня канала: прогресс в панели, конец — канон канала заново
    const source = FakeEventSource.last()
    act(() => source.open())
    const event = (status: JobEventData['status'], progress: number, message: string | null): JobEventData => ({
      job_id: 'job-style-anchors-1',
      kind: 'style_anchors',
      status,
      progress,
      message,
      attempts: 1,
      cancel_requested: false,
      episode_id: null,
      batch_id: null,
      channel: 'cursus',
      error: null,
    })
    act(() => source.emit('job.progress', event('running', 0.5, '3 из 6'), 1201))
    await waitFor(() => expect(within(panel).getByLabelText('Сборка кадров стиля').textContent).toContain('3 из 6'))
    expect(within(panel).getByLabelText('Сборка кадров стиля').textContent).toContain('50%')
    const before = stub.fetch.mock.calls.length
    act(() => source.emit('job.done', event('done', 1, '6 из 6'), 1202))
    await waitFor(() => expect(within(panel).queryByLabelText('Сборка кадров стиля')).toBeNull())
    await waitFor(() =>
      expect(stub.fetch.mock.calls.slice(before).map(([url]) => String(url))).toEqual(expect.arrayContaining(['/api/canon/cursus/style/anchors'])),
    )
  })

  test('отказ бюджета канала — текстом до очереди, джоба нет', async () => {
    const api = createMockApi()
    api.canon.monthlyLimit.cursus = 62_000_000
    await openCanon('/canon', stubApi(api))
    const panel = screen.getByRole('complementary', { name: 'Опорные кадры стиля' })
    await userEvent.click(await within(panel).findByRole('button', { name: 'Пересобрать (6, ~$0.80)' }))
    const alert = await within(panel).findByRole('alert')
    expect(alert.textContent).toBe('Месячный лимит $62: потрачено $61.40, операция — $0.80, не хватает $0.20; поднять лимит можно в настройках канала.')
    expect(within(panel).queryByLabelText('Сборка кадров стиля')).toBeNull()
  })
})

describe('слои, каналы, пустые состояния', () => {
  test('⌘⇧2 и ⌘⇧3 переключают слой, ⌘⇧1 возвращает стиль', async () => {
    await openCanon()
    // Слой другой — заголовок экрана монтируется заново: радиогруппу ищем после переключения
    const layer = (name: string) => within(screen.getByRole('radiogroup', { name: 'Слой канона' })).getByRole('radio', { name })
    await userEvent.keyboard('{Control>}{Shift>}2{/Shift}{/Control}')
    await waitFor(() => expect(layer('Периоды').getAttribute('aria-checked')).toBe('true'))
    expect(await screen.findByRole('form', { name: 'Эпоха' })).toBeTruthy()
    expect(window.location.search).toBe('?layer=periods')
    await userEvent.keyboard('{Control>}{Shift>}3{/Shift}{/Control}')
    expect(await screen.findByRole('form', { name: 'Персонаж' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: 'Персонажи канала' })).toBeTruthy()
    await userEvent.keyboard('{Control>}{Shift>}1{/Shift}{/Control}')
    expect(await screen.findByRole('form', { name: 'Стиль канала' })).toBeTruthy()
    expect(window.location.search).toBe('')
  })

  test('у канала без стиля — «Задайте стиль канала»; «Создать стиль канала» открывает пустой черновик', async () => {
    useUiStore.setState({ channel: 'otto' })
    const stub = stubApi()
    renderApp('/canon', { stub })
    const create = await screen.findByRole('button', { name: 'Создать стиль канала' }, { timeout: 3000 })
    expect(screen.getByText('Задайте стиль канала')).toBeTruthy()
    expect(create.textContent).not.toContain('$') // стиль пишет человек — бесплатно
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Канон канала не создан'))
    expect(calls(stub.fetch, 'GET', '/api/canon/otto/style')).toEqual([]) // по сводке стиля нет — шапку не просим
    await userEvent.click(create)
    const form = await screen.findByRole('form', { name: 'Стиль канала' })
    expect(within(form).getByRole('textbox', { name: 'Рендер и материал: Рендер' })).toHaveProperty('value', '')
    expect(calls(stub.fetch, 'PUT').map((c) => c.url)).toEqual(['/api/canon/otto/style/draft'])
    expect(versionMenu().textContent).toContain('Черновик')
    expect(screen.getByText('Кадров стиля пока нет')).toBeTruthy()
  })

  test('«Все каналы» — выберите канал', async () => {
    useUiStore.setState({ channel: 'all' })
    renderApp('/canon')
    expect(await screen.findByText('Выберите канал', {}, { timeout: 3000 })).toBeTruthy()
    await userEvent.click(await screen.findByRole('button', { name: 'Cursus' }))
    expect(await screen.findByRole('form', { name: 'Стиль канала' }, { timeout: 3000 })).toBeTruthy()
  })
})
