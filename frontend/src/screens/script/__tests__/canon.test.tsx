// Канон выпуска на экране 3 (M5.10) на моках: секция «Канон выпуска» со статусами и ссылками на экран 12, перевод на
// новые версии через подтверждение, предпросмотр итогового промпта кадра с источниками и с проблемами канона, отказ
// «Утвердить план» по канону со ссылками, строка канона в статус-строке.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { EffectivePlan } from '@/types/plan'
import { renderApp } from '../../../app/__tests__/harness'
import { autosaver } from '../../../app/autosave'
import { stubApi } from '../../../api/__tests__/fakes'
import { createMockApi, mockEpisodeCanon, type CanonTweak, type MockApi } from '../../../mocks/api'
import { useUiStore } from '../../../store/uiStore'
import { canonNote } from '../canonLinks'

const INITIAL = { channel: 'cursus' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [], statusNote: null }

beforeEach(() => useUiStore.setState(INITIAL))
// Сначала размонтировать, потом снять фейки (L-024)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  autosaver.reset()
})

/** Мок, где у «Пиратов» канон выпуска отличается от «всё готово»; стадия «Сценарий» — утверждать можно */
function withCanon(tweaks: Record<string, CanonTweak> = {}): MockApi {
  const api = createMockApi()
  api.episodes.find((e) => e.id === 'pirate')!.stage = 'script'
  api.canon.episodes.set('pirate', tweaks)
  return api
}

async function open(api: MockApi, path = '/episodes/pirate/script') {
  const app = renderApp(path, { stub: stubApi(api) })
  const side = await screen.findByRole('complementary', { name: 'Источник плана' }, { timeout: 3000 })
  const section = await within(side).findByRole('region', { name: 'Канон выпуска' }, { timeout: 3000 })
  await within(section).findByRole('list', { name: 'Версии канона' }, { timeout: 3000 })
  return { ...app, side, section }
}

/** Адрес ссылки разобранным: путь и параметры (`@` в адресе закодирован) */
function target(link: HTMLElement) {
  const url = new URL(link.getAttribute('href')!, 'http://studio.local')
  return { path: url.pathname, params: Object.fromEntries(url.searchParams) }
}

const rowOf = (section: HTMLElement, name: string) => within(section).getByRole('link', { name }).closest('li') as HTMLElement
const requests = (fetch: ReturnType<typeof vi.fn>, method: string, suffix: string) =>
  fetch.mock.calls.filter(([url, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === method && String(url).endsWith(suffix))

describe('секция «Канон выпуска»', () => {
  test('статусы версий и листов, каждая строка — ссылка на экран 12; строка канона в статус-строке', async () => {
    const { section } = await open(
      withCanon({
        'period:caribbean-1716': { latest: 'v002' },
        'appearance:you@landsman-16': { sheet: { status: 'partial', chosen: 3, total: 6 } },
        'appearance:gunner@gun-deck-30': { latest: null },
        'appearance:quartermaster@ship-40': { latest: null, draft: true },
      }),
    )
    expect(within(section).getByText('2 облика не опубликованы, 1 из 5 обликов без листа')).toBeTruthy()

    const style = rowOf(section, 'Стиль канала')
    expect(within(style).getByText('v003')).toBeTruthy()
    expect(within(style).getByText('готов')).toBeTruthy()
    expect(target(within(style).getByRole('link')).path).toBe('/canon')

    const period = rowOf(section, 'caribbean-1716')
    expect(within(period).getByText('v001')).toBeTruthy()
    expect(within(period).getByText('есть v002').className).toContain('text-warning')
    expect(target(within(period).getByRole('link'))).toEqual({ path: '/canon', params: { layer: 'periods', period: 'caribbean-1716' } })
    expect(within(rowOf(section, 'caribbean-1726')).getByText('готов')).toBeTruthy()

    const boy = rowOf(section, 'you@powder-monkey-11')
    expect(within(boy).getByRole('link', { name: 'лист 6/6' })).toBeTruthy()
    const landsman = rowOf(section, 'you@landsman-16')
    expect(target(within(landsman).getByRole('link', { name: 'you@landsman-16' }))).toEqual({
      path: '/canon',
      params: { layer: 'characters', character: 'you', appearance: 'you@landsman-16' },
    })
    const sheet = within(landsman).getByRole('link', { name: 'лист 3/6' })
    expect(sheet.className).toContain('text-warning')
    expect(target(sheet).params).toEqual({ layer: 'characters', character: 'you', appearance: 'you@landsman-16', sheet: 'you@landsman-16' })
    expect(within(rowOf(section, 'gunner@gun-deck-30')).getByText('нет версии').className).toContain('text-failed-text')
    expect(within(rowOf(section, 'quartermaster@ship-40')).getByText('только черновик')).toBeTruthy()
    // У облика без версии листа не смотрим
    expect(within(rowOf(section, 'gunner@gun-deck-30')).queryByText(/лист/)).toBeNull()

    await waitFor(() => expect(useUiStore.getState().statusNote).toBe('Канон: 2 облика не опубликованы, 1 из 5 обликов без листа'))
    expect(within(section).getByRole('button', { name: 'Перевести на новые версии' })).toBeTruthy()
  })

  test('выпуск без проблем канона — «готов», перевода нет, статус-строка пустая', async () => {
    const { section } = await open(withCanon())
    expect(within(section).getByText('готов', { selector: 'h2 + span' })).toBeTruthy()
    expect(within(section).queryByRole('button', { name: 'Перевести на новые версии' })).toBeNull()
    const rows = within(section).getAllByRole('listitem')
    expect(rows).toHaveLength(8) // стиль, 2 эпохи, 5 обликов
    expect(rows.slice(3).map((row) => within(row).getByRole('link', { name: /^лист/ }).textContent)).toEqual(Array(5).fill('лист 6/6'))
    expect(useUiStore.getState().statusNote).toBeNull()
  })
})

describe('перевести на новые версии', () => {
  test('подтверждение со списком и предупреждением, отмена ничего не шлёт; перевод — тост, кадры stale с причиной', async () => {
    const { section, stub } = await open(withCanon({ 'period:caribbean-1716': { latest: 'v002' } }))
    await userEvent.click(within(section).getByRole('button', { name: 'Перевести на новые версии' }))
    let dialog = await screen.findByRole('dialog', { name: 'Перевести на новые версии' })
    expect(within(dialog).getByRole('list', { name: 'Что сменится' }).textContent).toBe('эпоха caribbean-1716: v001 → v002, 6 кадров')
    expect(within(dialog).getByText('Затронутые кадры станут stale, картинки останутся.')).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(requests(stub.fetch, 'POST', '/canon/update')).toHaveLength(0)

    await userEvent.click(within(section).getByRole('button', { name: 'Перевести на новые версии' }))
    dialog = await screen.findByRole('dialog', { name: 'Перевести на новые версии' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Перевести' }))
    await waitFor(() => expect(useUiStore.getState().toasts.map((t) => t.message)).toContain('План v004 на новых версиях канона: 6 кадров stale'))
    expect(requests(stub.fetch, 'POST', '/api/projects/pirate/canon/update')).toHaveLength(1)
    expect(screen.queryByRole('dialog')).toBeNull()

    // Новая версия плана — новый канон: эпоха прибита к v002, переводить больше нечего
    const sheet = screen.getByRole('article', { name: 'Лист сценария' })
    await within(sheet).findByText('v004 · 1716–1726', undefined, { timeout: 3000 })
    await waitFor(() => expect(within(rowOf(section, 'caribbean-1716')).getByText('v002')).toBeTruthy())
    expect(within(section).queryByRole('button', { name: 'Перевести на новые версии' })).toBeNull()
    const glyph = within(sheet.querySelector<HTMLElement>('[data-shot="s001"]')!).getByRole('img', { name: 'Статус: проверить' })
    ;(glyph.parentElement as HTMLElement).focus()
    expect((await screen.findByRole('tooltip')).textContent).toBe('Эпоха caribbean-1716: periods/caribbean-1716/v001 → periods/caribbean-1716/v002')
    // Кадры другой эпохи не тронуты
    expect(within(sheet.querySelector<HTMLElement>('[data-shot="s061"]')!).getByRole('img', { name: 'Статус: готов' })).toBeTruthy()
  })
})

describe('предпросмотр промпта кадра', () => {
  test('с листа: секции с источниками, итоговый текст, negative, референсы, модель и цена — ответ бэкенда', async () => {
    const { stub } = await open(withCanon())
    await userEvent.click(screen.getByRole('button', { name: 'Итоговый промпт кадра s001' }))
    const dialog = await screen.findByRole('dialog', { name: 'Промпт кадра s001' })
    const sections = await within(dialog).findByRole('list', { name: 'Секции промпта' }, { timeout: 3000 })
    const items = within(sections).getAllByRole('listitem').map((li) => [...li.firstElementChild!.children].map((el) => el.textContent))
    expect(items).toEqual([
      ['Стиль канала', 'style/v003'],
      ['Эпоха: Карибы, 1716', 'periods/caribbean-1716/v001'],
      ['Облик: you@powder-monkey-11', 'characters/you/v002#powder-monkey-11'],
      ['Действие', 'кадр'],
      ['Крупность: establishing', 'кадр'],
    ])
    expect(within(sections).getByText(/^Action: A barefoot boy carries/)).toBeTruthy()
    expect(within(dialog).getByText('gemini-3.1-flash-image')).toBeTruthy()
    expect(within(dialog).getByText('~$0.07')).toBeTruthy()
    expect(within(dialog).getByText('16:9')).toBeTruthy()
    expect(within(within(dialog).getByRole('region', { name: 'Negative' })).getByText(/watermark/)).toBeTruthy()
    expect(within(within(dialog).getByRole('list', { name: 'Референсы' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '1you@powder-monkey-11 — фас',
      '2you@powder-monkey-11 — в полный рост',
      '3Кадр стиля — общий план',
      '4Кадр стиля — толпа',
    ])

    expect(within(dialog).queryByLabelText('Итоговый текст')).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Итоговый текст' }))
    expect(within(dialog).getByLabelText('Итоговый текст').textContent).toMatch(/^Rendering \(style reference images 3–4\):[\s\S]*\n\nShot size: wide establishing shot/)
    expect(requests(stub.fetch, 'GET', '/api/projects/pirate/shots/s001/prompt')).toHaveLength(1)
  })

  test('из таблицы: ячейка после промпта в клавиатурной сетке, Enter открывает, Esc возвращает фокус', async () => {
    await open(withCanon(), '/episodes/pirate/script?mode=plan')
    const grid = await screen.findByRole('grid', { name: 'План кадров' }, { timeout: 3000 })
    const cell = (row: number, col: number) => grid.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`)!
    cell(1, 1).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(cell(1, 2))
    expect(cell(1, 2).getAttribute('aria-label')).toBe('Итоговый промпт кадра s002')
    await userEvent.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Промпт кадра s002' })
    await within(dialog).findByRole('list', { name: 'Секции промпта' }, { timeout: 3000 })
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(cell(1, 2)))
  })

  test('проблемы канона — списком вместо промпта, со ссылками на экран 12', async () => {
    await open(
      withCanon({
        'period:caribbean-1716': { pinned: 'v009', latest: 'v002' },
        'appearance:you@powder-monkey-11': { sheet: { status: 'partial', chosen: 3, total: 6 } },
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Итоговый промпт кадра s001' }))
    const dialog = await screen.findByRole('dialog', { name: 'Промпт кадра s001' })
    const problems = await within(dialog).findByRole('list', { name: 'Проблемы канона' }, { timeout: 3000 })
    expect(within(dialog).queryByRole('list', { name: 'Секции промпта' })).toBeNull()
    expect(within(dialog).getByText('Запрос кадра не собран — рисовать его нельзя:')).toBeTruthy()
    const items = within(problems).getAllByRole('listitem')
    expect(items.map((li) => li.firstElementChild!.textContent)).toEqual([
      'кадр s001: эпоха periods/caribbean-1716/v009 не найдена в каноне cursus',
      'кадр s001: лист облика you@powder-monkey-11 3/6 — выберите недостающие ракурсы на экране «Канон»',
    ])
    expect(target(within(items[0]!).getByRole('link', { name: 'Эпоха caribbean-1716 на экране «Канон»' })).params).toEqual({
      layer: 'periods',
      period: 'caribbean-1716',
    })
    const sheet = within(items[1]!).getByRole('link', { name: 'Лист you@powder-monkey-11 на экране «Канон»' })
    expect(target(sheet).params.sheet).toBe('you@powder-monkey-11')
    await userEvent.click(sheet)
    await waitFor(() => expect(window.location.pathname).toBe('/canon'))
    expect(screen.queryByRole('dialog', { name: 'Промпт кадра s001' })).toBeNull()
  })
})

describe('отказ «Утвердить план» по канону', () => {
  test('сводка бэкенда и проблемы со ссылками на экран 12; без ссылки — у «ссылка не находит версию»; канон готов — утверждается', async () => {
    const api = withCanon({
      'period:caribbean-1726': { latest: null },
      'appearance:you@landsman-16': { sheet: { status: 'missing', chosen: 0, total: 6 } },
      'appearance:you@able-seaman-19': { latest: 'v002', resolved: false },
    })
    const { side } = await open(api)
    await userEvent.click(within(side).getByRole('button', { name: 'Утвердить план' }))
    const alert = await within(side).findByRole('alert')
    expect(
      within(alert).getByText(
        'Канон не готов: 1 эпоха не опубликована, 1 ссылка не находит версию, у 1 облика нет листа — экран «Канон» и «Перевести на новые версии».',
      ),
    ).toBeTruthy()
    const list = within(alert).getByRole('list', { name: 'Канон выпуска не готов' })
    const period = within(list).getByRole('link', { name: 'эпоха caribbean-1726 не опубликована — создайте и опубликуйте её на экране «Канон»' })
    expect(target(period).params).toEqual({ layer: 'periods', period: 'caribbean-1726' })
    const sheet = within(list).getByRole('link', { name: 'облик you@landsman-16: нет листа опорных портретов — соберите его на экране «Канон»' })
    expect(target(sheet).params.sheet).toBe('you@landsman-16')
    const unresolved = within(list).getByText(/^облик you@able-seaman-19: ссылка characters\/you\/v001#able-seaman-19 не находит/)
    expect(unresolved.closest('a')).toBeNull()
    expect(within(alert).queryByRole('list', { name: 'Кадры с проблемами' })).toBeNull()

    // Эпоху опубликовали, лист собрали, выпуск перевели — утверждение проходит
    api.canon.episodes.delete('pirate')
    await userEvent.click(within(side).getByRole('button', { name: 'Утвердить план' }))
    await waitFor(() => expect(useUiStore.getState().toasts.map((t) => t.message)).toContain('План v003 утверждён'))
    expect(within(side).queryByRole('list', { name: 'Канон выпуска не готов' })).toBeNull()
  })

  test('переход по ссылке отказа — на лист облика экрана 12', async () => {
    const { side } = await open(withCanon({ 'appearance:you@landsman-16': { sheet: { status: 'partial', chosen: 3, total: 6 } } }))
    await userEvent.click(within(side).getByRole('button', { name: 'Утвердить план' }))
    const alert = await within(side).findByRole('alert')
    await userEvent.click(within(alert).getByRole('link', { name: /^облик you@landsman-16: лист 3\/6/ }))
    await waitFor(() => expect(window.location.pathname).toBe('/canon'))
    expect(Object.fromEntries(new URLSearchParams(window.location.search))).toEqual({
      layer: 'characters',
      character: 'you',
      appearance: 'you@landsman-16',
      sheet: 'you@landsman-16',
    })
  })
})

describe('canonNote', () => {
  const plan = createMockApi().handle('GET', '/api/projects/pirate/plan').body as EffectivePlan

  test('канон готов или его нет — строки нет', () => {
    expect(canonNote(mockEpisodeCanon(plan))).toBeNull()
    expect(canonNote(null)).toBeNull()
    expect(canonNote(undefined)).toBeNull()
  })

  test('листы, публикация и ссылки — по проблемам бэкенда', () => {
    const sheets = mockEpisodeCanon(plan, {
      'appearance:you@landsman-16': { sheet: { status: 'partial', chosen: 3, total: 6 } },
      'appearance:you@able-seaman-19': { sheet: { status: 'outdated', chosen: 6, total: 6 } },
    })
    expect(canonNote(sheets)).toBe('Канон: 2 из 5 обликов без листа')
    const mixed = mockEpisodeCanon(plan, {
      style: { latest: null },
      'period:caribbean-1716': { latest: null, draft: true },
      'period:caribbean-1726': { latest: null },
      'appearance:gunner@gun-deck-30': { pinned: 'v001', latest: 'v002', resolved: false },
    })
    expect(canonNote(mixed)).toBe('Канон: стиль не опубликован, 2 эпохи не опубликованы, 1 ссылка не находит версию')
  })
})
