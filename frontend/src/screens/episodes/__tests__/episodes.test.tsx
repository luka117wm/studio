import { act, cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { EpisodeListItem } from '@/types/episode'
import { stubApi } from '../../../api/__tests__/fakes'
import { qk } from '../../../api/queries'
import { renderApp } from '../../../app/__tests__/harness'
import { useUiStore } from '../../../store/uiStore'

const INITIAL = { channel: 'all' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [] }

beforeEach(() => useUiStore.setState(INITIAL))
// Сначала размонтировать, потом снять фейки (L-024)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const board = () => screen.getByRole('region', { name: 'Доска выпусков' })
const column = (name: string) => within(board()).getByRole('region', { name })
/** Карточки колонки — ссылки с именем «название, колонка»; «Из бэклога идей» имени-метки не имеет */
const cards = (name: string) =>
  within(column(name))
    .queryAllByRole('link')
    .map((link) => link.getAttribute('aria-label'))
    .filter((label): label is string => label !== null)
/** Ролевой запрос по всей оболочке под параллельной нагрузкой бывает дольше секунды по умолчанию */
const card = (name: string) => screen.findByRole('link', { name }, { timeout: 3000 })
const allCards = () => within(board()).queryAllByRole('link').filter((link) => link.hasAttribute('aria-label'))

describe('доска', () => {
  test('девять выпусков по колонкам, как в артборде, и счётчик «9 всего, 2 опубликовано»', async () => {
    renderApp('/episodes')
    await card('Pirate Ship: Powder Monkey to Captain, Монтаж')
    expect(cards('Идея')).toEqual(['Venetian Arsenal: every rank, Идея', 'Ottoman Janissary Corps, Идея'])
    expect(cards('Сценарий')).toEqual(['Samurai Household: every rank, Сценарий'])
    expect(cards('Генерация')).toEqual([
      'Medieval Monastery: Oblate to Abbot, Генерация',
      'A Day as a Victorian Chimney Sweep, Генерация',
    ])
    expect(cards('Монтаж')).toEqual(['Pirate Ship: Powder Monkey to Captain, Монтаж'])
    expect(cards('Готов к публикации')).toEqual(['24 Hours as a Medieval Peasant, 1347, Готов к публикации'])
    expect(cards('Опубликован')).toEqual(['A Viking Winter, Опубликован', 'Market Day in the Aztec Empire, Опубликован'])
    expect(screen.getByText('9 всего, 2 опубликовано')).toBeTruthy()
    expect(within(column('Идея')).getByRole('link', { name: 'Из бэклога идей' }).getAttribute('href')).toBe('/ideas')
  })

  test('карточка: канал, длительность, строка «что сейчас», прогресс, расход, слот', async () => {
    renderApp('/episodes')
    const monastery = await card('Medieval Monastery: Oblate to Abbot, Генерация')
    expect(monastery.textContent).toContain('Cursus')
    expect(monastery.textContent).toContain('21:10')
    expect(monastery.textContent).toContain('Кадры 78 из 104')
    expect(monastery.textContent).toContain('$2.71')
    expect(monastery.textContent).toContain('15 сент')
    const bar = within(monastery).getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('75')
    expect(bar.dataset.fill).toBe('generating')

    const sweep = await card('A Day as a Victorian Chimney Sweep, Генерация')
    expect(within(sweep).getByText('12 кадров не удались').className).toContain('text-failed-text')
    expect(within(sweep).getByRole('img', { name: 'Ошибка' })).toBeTruthy()

    const samurai = await card('Samurai Household: every rank, Сценарий')
    // Цель — пресет Cursus: 20 мин × 150 слов/мин
    expect(await within(samurai).findByText('Сценарий 2 140 / ~3 000 слов')).toBeTruthy()
    expect(samurai.textContent).toContain('~18:00')

    const janissary = await card('Ottoman Janissary Corps, Идея')
    expect(janissary.textContent).toContain('слот не назначен')
    const viking = await card('A Viking Winter, Опубликован')
    // «Опубликован» — свой цвет status-published (handoff), а не ready
    expect(within(viking).getByRole('img', { name: 'Опубликован' }).firstElementChild?.className).toContain('bg-published')
  })

  test('поиск «monastery» оставляет одну карточку и счётчик «1 из 9»', async () => {
    renderApp('/episodes')
    await card('Pirate Ship: Powder Monkey to Captain, Монтаж')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск по выпускам' }), 'monastery')
    expect(allCards().map((link) => link.getAttribute('aria-label'))).toEqual([
      'Medieval Monastery: Oblate to Abbot, Генерация',
    ])
    expect(screen.getByText('1 из 9')).toBeTruthy()
  })

  test('фильтр Otto прячет карточки Cursus: одно состояние с переключателем канала', async () => {
    renderApp('/episodes')
    await card('Pirate Ship: Powder Monkey to Captain, Монтаж')
    const filter = screen.getByRole('radiogroup', { name: 'Фильтр канала' })
    await userEvent.click(within(filter).getByRole('radio', { name: 'Otto' }))
    expect(useUiStore.getState().channel).toBe('otto')
    expect(screen.queryByRole('link', { name: 'Pirate Ship: Powder Monkey to Captain, Монтаж' })).toBeNull()
    expect(allCards()).toHaveLength(4)
    expect(screen.getByText('4 из 9')).toBeTruthy()
  })

  test('клик по карточке открывает выпуск на его этапе и переключает канал', async () => {
    useUiStore.setState({ channel: 'all' })
    renderApp('/episodes')
    await userEvent.click(await card('Pirate Ship: Powder Monkey to Captain, Монтаж'))
    expect(window.location.pathname).toBe('/episodes/pirate/edit')
    expect(useUiStore.getState()).toMatchObject({ channel: 'cursus', episodeId: 'pirate' })
  })

  test('Enter по карточке — то же; идея ведёт в бэклог идей, канал — канал выпуска', async () => {
    useUiStore.setState({ channel: 'all' })
    renderApp('/episodes')
    const arsenal = await card('Venetian Arsenal: every rank, Идея')
    arsenal.focus()
    await userEvent.keyboard('{Enter}')
    expect(window.location.pathname).toBe('/ideas')
    expect(useUiStore.getState()).toMatchObject({ channel: 'cursus', episodeId: 'arsenal' })
  })
})

describe('живые данные', () => {
  test('новый выпуск появляется в «Сценарии» после инвалидации списка, без перезагрузки', async () => {
    const { stub, client } = renderApp('/episodes')
    await card('Pirate Ship: Powder Monkey to Captain, Монтаж')
    const created: EpisodeListItem = {
      ...structuredClone(stub.api.episodes.find((e) => e.id === 'janissary')!),
      id: 'c11',
      title: 'Новый выпуск',
      short_title: null,
      origin: 'blank',
      stage: 'script',
      slot_date: '2026-09-23',
    }
    created.summary.duration_s = null
    created.summary.duration_source = null
    stub.api.episodes.push(created)
    await act(() => client.invalidateQueries({ queryKey: qk.episodeLists }))
    expect(await card('Новый выпуск, Сценарий')).toBeTruthy()
    expect(screen.getByText('10 всего, 2 опубликовано')).toBeTruthy()
  })

  test('идущий джоб на выпуске — штриховка и процент на карточке', async () => {
    const { stub, client } = renderApp('/episodes')
    await card('Venetian Arsenal: every rank, Идея')
    stub.api.episodes.find((e) => e.id === 'arsenal')!.summary.job = {
      kind: 'sleep_job',
      status: 'running',
      progress: 0.4,
      message: null,
    }
    await act(() => client.invalidateQueries({ queryKey: qk.episodeLists }))
    const arsenal = await card('Venetian Arsenal: every rank, Идея')
    expect(await within(arsenal).findByText('Проверочный джоб 40%')).toBeTruthy()
    const bar = within(arsenal).getByRole('progressbar')
    expect(bar.dataset.fill).toBe('generating')
    expect(bar.getAttribute('aria-valuenow')).toBe('40')
  })
})

describe('состояния экрана', () => {
  test('загрузка — скелетоны карточек в колонках', async () => {
    const stub = stubApi()
    const passthrough = stub.fetch.getMockImplementation() as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    stub.fetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith('/api/episodes') ? new Promise(() => {}) : passthrough(input, init),
    )
    renderApp('/episodes', { stub })
    const busy = within(board()).getByRole('region', { name: 'Идея' }).closest('[aria-busy]')
    expect(busy?.getAttribute('aria-busy')).toBe('true')
    expect(allCards()).toHaveLength(0)
    expect(within(board()).getAllByRole('heading', { level: 2 })).toHaveLength(6)
  })

  test('нет выпусков — «Выпусков пока нет» с единственной primary «Новый выпуск»', async () => {
    const stub = stubApi()
    stub.api.episodes.splice(0)
    renderApp('/episodes', { stub })
    expect(await screen.findByRole('heading', { name: 'Выпусков пока нет' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Новый выпуск' })).toHaveLength(1)
  })

  test('ошибка — текст бэкенда в зоне доски', async () => {
    const stub = stubApi()
    const handle = stub.api.handle
    stub.api.handle = (method, url, body) =>
      url.startsWith('/api/episodes')
        ? { status: 500, body: { detail: 'Не удалось прочитать выпуски: база занята. Повторите через минуту.' } }
        : handle(method, url, body)
    renderApp('/episodes', { stub })
    const alert = await within(board()).findByRole('alert')
    expect(alert.textContent).toBe('Не удалось прочитать выпуски: база занята. Повторите через минуту.')
  })

  test('поиск без результатов — «Ничего не найдено по «…»» и «Сбросить поиск»', async () => {
    renderApp('/episodes')
    await card('Pirate Ship: Powder Monkey to Captain, Монтаж')
    const search = screen.getByRole('searchbox', { name: 'Поиск по выпускам' })
    await userEvent.type(search, 'atlantis')
    expect(screen.getByRole('heading', { name: 'Ничего не найдено по «atlantis»' })).toBeTruthy()
    expect(screen.getByText('0 из 9')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Сбросить поиск' }))
    expect((search as HTMLInputElement).value).toBe('')
    expect(allCards()).toHaveLength(9)
  })
})
