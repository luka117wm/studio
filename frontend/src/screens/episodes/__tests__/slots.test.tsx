import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Slot } from '@/types/slot'
import { stubApi } from '../../../api/__tests__/fakes'
import { renderApp } from '../../../app/__tests__/harness'
import { episodes, slots } from '../../../mocks/api'
import { useUiStore } from '../../../store/uiStore'
import { slotNote, slotRiskLine, weekdayShort, windowMonths } from '../slotText'

const INITIAL = { channel: 'all' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [] }

beforeEach(() => useUiStore.setState(INITIAL))
// Сначала размонтировать, потом снять фейки (L-024)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const strip = () => screen.getByRole('region', { name: 'Слоты публикации' })
/** Первый рендер полосы в оболочке под параллельной нагрузкой бывает дольше секунды (L-025) */
const cell = (name: string) => within(strip()).findByRole('listitem', { name }, { timeout: 3000 })
const cells = () => within(strip()).getAllByRole('listitem')
/** Запросы `PUT` к бэкенду: путь и тело */
const puts = (fetch: ReturnType<typeof vi.fn>) =>
  fetch.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    .map(([url, init]) => ({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) as unknown }))
const findToast = (text: string) =>
  waitFor(() => {
    const toast = screen.getAllByRole('status').find((el) => el.textContent?.startsWith(text))
    expect(toast).toBeTruthy()
    return toast!
  })

describe('тексты слота', () => {
  test('заметка ячейки — из состояния, кода риска и сводки, цвет — риск, иначе статус', () => {
    const notes = slots.map((slot) => slotNote(slot, episodes.find((e) => e.id === slot.episode_id)))
    expect(notes).toEqual([
      { text: 'Опубликован', tone: 'muted' },
      { text: 'Опубликован', tone: 'muted' },
      null,
      { text: 'Готов к загрузке', tone: 'muted' },
      { text: 'Экспорт не запускался', tone: 'warning' },
      { text: 'Кадры 78 / 104', tone: 'generating' },
      { text: 'Сценарий не готов', tone: 'generating' },
      { text: '12 кадров не удались', tone: 'failed' },
      { text: 'Сценарий не готов', tone: 'muted' },
      null,
      null,
    ])
  })

  test('риск в день слота — код бэкенда, а не стадия; выпуск в прошлом слоте — «Слот пропущен»', () => {
    const samurai = episodes.find((e) => e.id === 'samurai')!
    const today: Slot = { ...slots[3]!, episode_id: 'samurai', channel: 'cursus', risk: { level: 'failed', reason: 'script_not_ready' } }
    expect(slotNote(today, samurai)).toEqual({ text: 'Сценарий не готов', tone: 'failed' })
    const missed: Slot = { ...slots[2]!, episode_id: 'samurai', channel: 'cursus' }
    expect(slotNote(missed, samurai)).toEqual({ text: 'Слот пропущен', tone: 'muted' })
  })

  test('месяц окна по датам: один месяц, стык месяцев, стык лет', () => {
    expect(windowMonths(slots)).toBe('сентябрь 2026')
    const at = (date: string): Slot => ({ ...slots[0]!, date })
    expect(windowMonths([at('2026-09-24'), at('2026-10-14')])).toBe('сентябрь — октябрь 2026')
    expect(windowMonths([at('2026-12-25'), at('2027-01-14')])).toBe('декабрь 2026 — январь 2027')
    expect(windowMonths([])).toBeNull()
    expect([1, 5, 7].map(weekdayShort)).toEqual(['пн', 'пт', 'вс'])
  })

  test('статус-строка — ближайший слот с риском тем же текстом, что в ячейке', () => {
    expect(slotRiskLine(slots, episodes)).toEqual({
      text: 'Следующий слот 13 сентября, Pirate Ship: экспорт не запускался',
      level: 'warning',
    })
    const todayRisk = slots.map((s) => (s.state === 'today' ? { ...s, risk: { level: 'failed' as const, reason: 'not_exported' as const } } : s))
    expect(slotRiskLine(todayRisk, episodes)?.text).toBe('Сегодняшний слот, Medieval Peasant 1347: экспорт не запускался')
    expect(slotRiskLine(slots.map((s) => ({ ...s, risk: null })), episodes)).toBeNull()
  })
})

describe('полоса', () => {
  test('одиннадцать ячеек артборда: опубликованные, пропущен, сегодня, риск warning и fail, пустые', async () => {
    renderApp('/episodes')
    await cell('13 сентября')
    expect(cells().map((c) => [c.getAttribute('aria-label'), c.dataset.state, c.dataset.risk ?? null])).toEqual([
      ['5 сентября', 'published', null],
      ['7 сентября', 'published', null],
      ['9 сентября', 'missed', null],
      ['11 сентября', 'today', null],
      ['13 сентября', 'filled', 'warning'],
      ['15 сентября', 'filled', null],
      ['17 сентября', 'filled', null],
      ['19 сентября', 'filled', 'failed'],
      ['21 сентября', 'filled', null],
      ['23 сентября', 'empty', null],
      ['25 сентября', 'empty', null],
    ])
    expect(within(strip()).getByText('сентябрь 2026')).toBeTruthy()

    const today = await cell('11 сентября')
    expect(today.className).toContain('border-accent')
    expect(today.className).toContain('shadow-[inset_2px_0_0_var(--accent)]')
    expect(within(today).getByText('11').className).toContain('text-accent')
    expect(within(today).getByText('пт')).toBeTruthy()
    expect(within(today).getByText('Medieval Peasant 1347')).toBeTruthy()
    expect(within(today).getByText('Готов к загрузке')).toBeTruthy()

    const pirate = await cell('13 сентября')
    expect(pirate.className).toContain('border-warning')
    expect(within(pirate).getByText('Экспорт не запускался').className).toContain('text-warning')
    const sweep = await cell('19 сентября')
    expect(sweep.className).toContain('border-failed')
    expect(within(sweep).getByText('12 кадров не удались').className).toContain('text-failed-text')
    expect(within(sweep).getByRole('img', { name: 'Ошибка' })).toBeTruthy()
    expect(within(await cell('15 сентября')).getByText('Кадры 78 / 104').className).toContain('text-generating')
    expect(within(await cell('17 сентября')).getByText('Сценарий не готов')).toBeTruthy()

    const viking = await cell('5 сентября')
    expect(within(viking).getByText('Опубликован')).toBeTruthy()
    expect(within(viking).getByRole('img', { name: 'Опубликован' })).toBeTruthy()
    expect((await cell('9 сентября')).textContent).toContain('Слот пропущен')
    expect(within(await cell('9 сентября')).queryByRole('button')).toBeNull()

    expect(within(await cell('23 сентября')).getByRole('button', { name: 'Назначить выпуск на 23 сентября' })).toBeTruthy()
    expect(within(pirate).getByRole('button', { name: 'Слот 13 сентября: Pirate Ship' })).toBeTruthy()
  })

  test('фильтр Otto приглушает слоты Cursus, пустые и слоты Otto — как были', async () => {
    renderApp('/episodes')
    await cell('13 сентября')
    expect(cells().filter((c) => c.dataset.dimmed)).toHaveLength(0)
    const filter = screen.getByRole('radiogroup', { name: 'Фильтр канала' })
    await userEvent.click(within(filter).getByRole('radio', { name: 'Otto' }))
    const dimmed = cells()
      .filter((c) => c.dataset.dimmed === 'true')
      .map((c) => c.getAttribute('aria-label'))
    expect(dimmed).toEqual(['13 сентября', '15 сентября', '17 сентября', '21 сентября'])
    expect((await cell('13 сентября')).className).toContain('opacity-40')
    expect((await cell('19 сентября')).className).not.toContain('opacity-40')
  })

  test('назначение из меню пустого слота: PUT, ячейка с выпуском, тост «Назначено на 23 сентября»', async () => {
    const { stub } = renderApp('/episodes')
    await userEvent.click(within(await cell('23 сентября')).getByRole('button', { name: 'Назначить выпуск на 23 сентября' }))
    const menu = screen.getByRole('menu', { name: 'Назначить выпуск на 23 сентября' })
    // «Все каналы»: выпуски без слота обоих каналов, с именем канала
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Ottoman Janissary Corps, Cursus'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Ottoman Janissary Corps, Cursus' }))

    expect(puts(stub.fetch)).toEqual([{ url: '/api/episodes/janissary/slot', body: { date: '2026-09-23' } }])
    await findToast('Назначено на 23 сентября')
    await waitFor(async () => expect((await cell('23 сентября')).dataset.state).toBe('filled'))
    expect(within(await cell('23 сентября')).getByText('Janissary Corps')).toBeTruthy()
    expect(within(await cell('23 сентября')).getByText('Сценарий не готов')).toBeTruthy()
  })

  test('в канале без выпусков без слота меню говорит об этом', async () => {
    useUiStore.setState({ channel: 'otto' })
    renderApp('/episodes')
    await userEvent.click(within(await cell('23 сентября')).getByRole('button', { name: 'Назначить выпуск на 23 сентября' }))
    const item = within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Выпусков без слота нет' })
    expect(item.hasAttribute('disabled')).toBe(true)
  })

  test('409 — ячейка сразу с выпуском, после отказа — тост с текстом бэкенда и откат', async () => {
    const stub = stubApi()
    const passthrough = stub.fetch.getMockImplementation() as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const refusal = 'Слот 23 сентября занят выпуском «Новый выпуск» (o11); снимите его со слота или выберите другой.'
    stub.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'PUT') return passthrough(input, init)
      await gate
      return new Response(JSON.stringify({ detail: refusal }), { status: 409, headers: { 'Content-Type': 'application/json' } })
    })
    renderApp('/episodes', { stub })
    await userEvent.click(within(await cell('23 сентября')).getByRole('button', { name: 'Назначить выпуск на 23 сентября' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Ottoman Janissary Corps, Cursus' }))

    // Оптимистично: выпуск в ячейке до ответа
    await waitFor(async () => expect(within(await cell('23 сентября')).getByText('Janissary Corps')).toBeTruthy())
    release()
    const toast = await findToast(refusal)
    expect(toast.dataset.status).toBe('failed')
    await waitFor(async () => expect((await cell('23 сентября')).dataset.state).toBe('empty'))
    expect(within(await cell('23 сентября')).getByRole('button', { name: 'Назначить выпуск на 23 сентября' })).toBeTruthy()
    expect(within(await cell('23 сентября')).queryByText('Janissary Corps')).toBeNull()
  })

  test('снятие со слота: «Снять со слота» → PUT с null, ячейка пуста, тост «Снято со слота»', async () => {
    const { stub } = renderApp('/episodes')
    await userEvent.click(within(await cell('21 сентября')).getByRole('button', { name: 'Слот 21 сентября: Venetian Arsenal' }))
    const menu = screen.getByRole('menu', { name: 'Слот 21 сентября: Venetian Arsenal' })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Открыть выпуск', 'Снять со слота'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Снять со слота' }))
    expect(puts(stub.fetch)).toEqual([{ url: '/api/episodes/arsenal/slot', body: { date: null } }])
    await findToast('Снято со слота')
    await waitFor(async () => expect((await cell('21 сентября')).dataset.state).toBe('empty'))
  })

  test('у опубликованного слота только «Открыть выпуск»; открытие переключает канал и ведёт на этап', async () => {
    renderApp('/episodes')
    await userEvent.click(within(await cell('5 сентября')).getByRole('button', { name: 'Слот 5 сентября: Viking Winter' }))
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Открыть выпуск'])
    await userEvent.keyboard('{Escape}')

    await userEvent.click(within(await cell('13 сентября')).getByRole('button', { name: 'Слот 13 сентября: Pirate Ship' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Открыть выпуск' }))
    expect(window.location.pathname).toBe('/episodes/pirate/edit')
    expect(useUiStore.getState()).toMatchObject({ channel: 'cursus', episodeId: 'pirate' })
  })

  test('клавиатура: Tab по ячейкам с действием, меню — стрелками', async () => {
    renderApp('/episodes')
    const first = within(await cell('5 сентября')).getByRole('button')
    first.focus()
    await userEvent.tab()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Слот 7 сентября: Aztec Market Day')
    // Пропущенный пустой слот действия не имеет и в порядок Tab не входит
    await userEvent.tab()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Слот 11 сентября: Medieval Peasant 1347')

    const assign = within(await cell('23 сентября')).getByRole('button', { name: 'Назначить выпуск на 23 сентября' })
    assign.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement?.textContent).toBe('Ottoman Janissary Corps, Cursus')
  })
})
