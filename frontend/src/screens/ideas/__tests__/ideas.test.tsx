// Экран 2 «Идеи», вкладка «Тренды», на моках артборда: семена, мост идей с отчётом, карточки «Идей из чата»,
// «В бэклог», «Начать выпуск», бэклог по оценке с «Убрать / Вернуть», «Все каналы», статус-строка.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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

async function open(path = '/ideas', api: MockApi = createMockApi()) {
  const app = renderApp(path, { stub: stubApi(api) })
  const backlog = await screen.findByRole('region', { name: 'Бэклог идей' }, { timeout: 3000 })
  await within(backlog).findAllByRole('article', {}, { timeout: 3000 })
  return {
    ...app,
    backlog,
    seeds: screen.getByRole('complementary', { name: 'Семена ниши' }),
    chat: screen.getByRole('complementary', { name: 'Идеи из чата' }),
  }
}

const calls = (fetch: ReturnType<typeof vi.fn>, method: string, path: string) =>
  fetch.mock.calls
    .filter(([url, init]) => String(url).startsWith(path) && ((init as RequestInit | undefined)?.method ?? 'GET') === method)
    .map(([, init]) => JSON.parse(String((init as RequestInit).body ?? 'null')) as unknown)

const titles = (root: HTMLElement) => within(root).queryAllByRole('article').map((a) => a.getAttribute('aria-label'))
const toasts = () => useUiStore.getState().toasts.map((t) => t.message)

describe('семена ниши', () => {
  test('чипы канала; Enter добавляет, × убирает — сразу PATCH профиля', async () => {
    const { seeds, stub } = await open()
    const list = within(seeds).getByRole('list', { name: 'Семена ниши' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'every rank',
      'medieval life',
      'pirates',
      'ancient jobs',
      'monasteries',
      'Семя',
    ])

    await userEvent.click(within(seeds).getByRole('button', { name: 'Семя' }))
    await userEvent.type(within(seeds).getByRole('textbox', { name: 'Новое семя' }), '  guilds {Enter}')
    expect(await within(list).findByText('guilds')).toBeTruthy()
    expect(calls(stub.fetch, 'PATCH', '/api/channels/cursus').at(-1)).toEqual({
      seeds: ['every rank', 'medieval life', 'pirates', 'ancient jobs', 'monasteries', 'guilds'],
    })

    await userEvent.click(within(list).getByRole('button', { name: 'Удалить pirates' }))
    await waitFor(() => expect(within(list).queryByText('pirates')).toBeNull())
    expect(calls(stub.fetch, 'PATCH', '/api/channels/cursus').at(-1)).toEqual({
      seeds: ['every rank', 'medieval life', 'ancient jobs', 'monasteries', 'guilds'],
    })
    expect(toasts()).toEqual([])
  })

  test('повтор — подпись под полем без запроса; Esc закрывает поле', async () => {
    const { seeds, stub } = await open()
    await userEvent.click(within(seeds).getByRole('button', { name: 'Семя' }))
    const field = within(seeds).getByRole('textbox', { name: 'Новое семя' })
    await userEvent.type(field, 'Pirates{Enter}')
    expect(within(seeds).getByText('Семя «pirates» уже есть — повтор не нужен.')).toBeTruthy()
    expect(calls(stub.fetch, 'PATCH', '/api/channels/cursus')).toEqual([])
    await userEvent.keyboard('{Escape}')
    expect(within(seeds).queryByRole('textbox')).toBeNull()
  })

  test('20 семян — «Семя» выключено с подписью', async () => {
    const api = createMockApi()
    const twenty = Array.from({ length: 20 }, (_, i) => `topic ${i + 1}`)
    expect(api.handle('PATCH', '/api/channels/cursus', { seeds: twenty }).status).toBe(200)
    const { seeds } = await open('/ideas', api)
    expect(within(seeds).getByRole('button', { name: 'Семя' }).hasAttribute('disabled')).toBe(true)
    expect(within(seeds).getByText('Семян 20 — больше нельзя: уберите лишнее, чтобы добавить новое.')).toBeTruthy()
  })
})

describe('идеи из чата', () => {
  test('карточки предложений: название, оценка, «почему», описание', async () => {
    const { chat } = await open()
    expect(titles(chat)).toEqual([
      'Every Rank in a Cathedral Build (Mortar Boy to Master Mason)',
      'Every Rank in a Medieval Monastery (Oblate to Abbot)',
    ])
    const monastery = within(chat).getByRole('article', { name: /Medieval Monastery/ })
    expect(within(monastery).getByText('81').className).toContain('text-accent')
    expect(within(monastery).getByText('Мало похожих роликов, сильный хук')).toBeTruthy()
    expect(within(monastery).getByText('Пять ступеней монастырской вертикали.')).toBeTruthy()
    expect(within(chat).getByText('74').className).toContain('text-ink')
  })

  test('промпт в буфер; ответ — тост «Добавлено 1 идея, пропущено 2» и причины; новая карточка сверху', async () => {
    const { chat, stub } = await open()
    await userEvent.click(within(chat).getByRole('button', { name: 'Скопировать промпт идей' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(String(writeText.mock.calls[0]?.[0])).toContain('Propose 6 new video ideas')
    expect(calls(stub.fetch, 'POST', '/api/ideas/prompt')).toEqual([{ channel: 'cursus' }])

    const answer = {
      ideas: [
        { title: 'Every Rank in a Mongol Tumen', hook_promise: 'x', summary: 'y' },
        { title: 'every rank in a roman legion', angle: 'a', hook_promise: 'h', summary: 's' },
        { title: 'Every Rank in a Byzantine Court', angle: 'Евнухи и логофеты', hook_promise: 'h', summary: 'Двор как лестница титулов.', score: 77, score_reason: 'Мало конкурентов' },
      ],
    }
    await userEvent.click(within(chat).getByRole('textbox', { name: 'Ответ из чата' }))
    await userEvent.paste('```json\n' + JSON.stringify(answer) + '\n```')
    await userEvent.click(within(chat).getByRole('button', { name: 'Применить вставку' }))

    await waitFor(() => expect(toasts()).toContain('Добавлено 1 идея, пропущено 2'))
    const report = within(chat).getByRole('list', { name: 'Предупреждения' })
    expect(within(report).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Идея 1 «Every Rank in a Mongol Tumen»: нет поля «angle»',
      'Идея 2: «every rank in a roman legion» — уже в бэклоге',
    ])
    await waitFor(() => expect(titles(chat)[0]).toBe('Every Rank in a Byzantine Court'))
  })

  test('идеи одного ответа — в порядке чата, ответ новее — выше', async () => {
    const { chat } = await open()
    const answer = {
      ideas: ['Alpha', 'Beta', 'Gamma'].map((name) => ({
        title: `Every Rank in ${name}`,
        angle: 'a',
        hook_promise: 'h',
        summary: 's',
      })),
    }
    await userEvent.click(within(chat).getByRole('textbox', { name: 'Ответ из чата' }))
    await userEvent.paste(JSON.stringify(answer))
    await userEvent.click(within(chat).getByRole('button', { name: 'Применить вставку' }))
    await waitFor(() =>
      expect(titles(chat)).toEqual([
        'Every Rank in Alpha',
        'Every Rank in Beta',
        'Every Rank in Gamma',
        'Every Rank in a Cathedral Build (Mortar Boy to Master Mason)',
        'Every Rank in a Medieval Monastery (Oblate to Abbot)',
      ]),
    )
  })

  test('ответ без единой принятой идеи — карточка ошибки с причинами', async () => {
    const { chat } = await open()
    await userEvent.click(within(chat).getByRole('textbox', { name: 'Ответ из чата' }))
    await userEvent.paste(JSON.stringify({ ideas: [{ title: '' }] }))
    await userEvent.click(within(chat).getByRole('button', { name: 'Применить вставку' }))
    const alert = await within(chat).findByRole('alert')
    expect(within(alert).getByText('Ни одна идея не принята: 1 пропущена.')).toBeTruthy()
  })

  test('«В бэклог» — карточка уходит в центр, счётчик в шапке растёт', async () => {
    const { chat, backlog } = await open()
    expect(screen.getByText('Бэклог: 7 идей')).toBeTruthy()
    const card = within(chat).getByRole('article', { name: /Medieval Monastery/ })
    await userEvent.click(within(card).getByRole('button', { name: 'В бэклог' }))
    await waitFor(() => expect(titles(chat)).toEqual(['Every Rank in a Cathedral Build (Mortar Boy to Master Mason)']))
    expect(titles(backlog)[0]).toBe('Every Rank in a Medieval Monastery (Oblate to Abbot)')
    expect(screen.getByText('Бэклог: 8 идей')).toBeTruthy()
  })

  test('«Начать выпуск» из предложения — в бэклог, выпуск с idea_id, экран 3 с заявкой и тост', async () => {
    const { chat, stub } = await open()
    const card = within(chat).getByRole('article', { name: /Cathedral Build/ })
    await userEvent.click(within(card).getByRole('button', { name: 'Начать выпуск' }))

    await waitFor(() => expect(window.location.pathname).toBe('/episodes/c11/script'))
    expect(calls(stub.fetch, 'PATCH', '/api/ideas/i0010')).toEqual([{ status: 'backlog' }])
    expect(calls(stub.fetch, 'POST', '/api/episodes')).toEqual([
      { channel: 'cursus', origin: 'backlog', idea_id: 'i0010', slot: 'next_free' },
    ])
    expect(toasts()).toContain('Выпуск создан: Cursus, слот 23 сентября')
    const brief = await screen.findByRole('region', { name: 'Заявка выпуска' }, { timeout: 3000 })
    expect(within(brief).getByDisplayValue('Every Rank in a Cathedral Build (Mortar Boy to Master Mason)')).toBeTruthy()
    expect(useUiStore.getState()).toMatchObject({ channel: 'cursus', episodeId: 'c11' })
  })
})

describe('бэклог', () => {
  test('по оценке, без оценки — в конце; источник и угол в строке', async () => {
    const { backlog } = await open()
    expect(titles(backlog)).toEqual([
      'Every Rank in a Roman Legion',
      'Every Rank in the Venetian Arsenal',
      'Every Rank in a Royal Kitchen',
      'Every Rank in a Spanish Treasure Fleet',
      'Every Rank in a Hanseatic Kontor',
      'Every Rank in a Coal Mine (1840)',
      'Every Rank in a Viking Longship',
    ])
    const legion = within(backlog).getByRole('article', { name: 'Every Rank in a Roman Legion' })
    expect(within(legion).getByText('вручную')).toBeTruthy()
    expect(within(legion).getByText('От новобранца-тирона до легата: восемь ступеней и одна лопата на всех.')).toBeTruthy()
    expect(within(within(backlog).getByRole('article', { name: 'Every Rank in a Viking Longship' })).getByText('—')).toBeTruthy()
  })

  test('«Убрать» → «Убранные» с «Вернуть»; «Вернуть» — обратно в бэклог', async () => {
    const { backlog, stub } = await open()
    const kontor = within(backlog).getByRole('article', { name: 'Every Rank in a Hanseatic Kontor' })
    await userEvent.click(within(kontor).getByRole('button', { name: 'Убрать' }))
    await waitFor(() => expect(titles(backlog)).not.toContain('Every Rank in a Hanseatic Kontor'))
    expect(calls(stub.fetch, 'PATCH', '/api/ideas/i0004')).toEqual([{ status: 'dropped' }])

    await userEvent.click(within(backlog).getByRole('radio', { name: 'Убранные 2' }))
    expect(titles(backlog)).toEqual(['Every Rank in a Hanseatic Kontor', 'Every Rank in a Lighthouse Service'])
    const back = within(backlog).getByRole('article', { name: 'Every Rank in a Hanseatic Kontor' })
    await userEvent.click(within(back).getByRole('button', { name: 'Вернуть' }))
    await waitFor(() => expect(titles(backlog)).toEqual(['Every Rank in a Lighthouse Service']))
    await userEvent.click(within(backlog).getByRole('radio', { name: 'Бэклог' }))
    expect(titles(backlog)).toContain('Every Rank in a Hanseatic Kontor')
  })

  test('«Начать выпуск» из бэклога — без PATCH статуса', async () => {
    const { backlog, stub } = await open()
    const arsenal = within(backlog).getByRole('article', { name: 'Every Rank in the Venetian Arsenal' })
    await userEvent.click(within(arsenal).getByRole('button', { name: 'Начать выпуск' }))
    await waitFor(() => expect(window.location.pathname).toBe('/episodes/c11/script'))
    expect(calls(stub.fetch, 'PATCH', '/api/ideas')).toEqual([])
  })
})

describe('экран', () => {
  test('статус-строка: идей в бэклоге и ближайший свободный слот', async () => {
    await open()
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Идей в бэклоге 7, слот 23 сентября свободен'),
    )
  })

  test('«Все каналы» — просьба выбрать канал; выбор Otto показывает его идеи', async () => {
    useUiStore.setState({ channel: 'all' })
    renderApp('/ideas')
    expect(await screen.findByText('Выберите канал', {}, { timeout: 3000 })).toBeTruthy()
    await userEvent.click(await screen.findByRole('button', { name: "Otto's Timeline" }))
    const backlog = await screen.findByRole('region', { name: 'Бэклог идей' })
    expect(await within(backlog).findByRole('article', { name: 'A Day in Pompeii Before the Eruption' })).toBeTruthy()
    expect(useUiStore.getState().channel).toBe('otto')
  })

  test('вкладка «Референс» в адресе — своя раскладка без семян и бэклога', async () => {
    await open()
    await userEvent.click(screen.getByRole('radio', { name: 'Референс' }))
    expect(window.location.search).toBe('?tab=reference')
    expect(await screen.findByRole('region', { name: 'Карта структуры' })).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'Семена ниши' })).toBeNull()
  })
})
