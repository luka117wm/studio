// Шапка на моках API: переключатель канала, инлайн-переименование через автосохранение, индикатор сохранения.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { stubApi } from '../../api/__tests__/fakes'
import { createMockApi } from '../../mocks/api'
import { useUiStore } from '../../store/uiStore'
import { autosaver } from '../autosave'
import { formatClock } from '../format'
import { navigate } from '../navigation'
import { renderApp } from './harness'

const INITIAL = {
  channel: 'cursus' as const,
  episodeId: null,
  collapsed: { left: false, right: false },
  toasts: [],
  save: { kind: 'idle' as const },
}

const banner = () => screen.getByRole('banner', { name: 'Верхняя панель' })
const trigger = () => within(banner()).getByRole('button', { name: /^Канал:/ })
const patches = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')

beforeEach(() => {
  useUiStore.setState(INITIAL)
  autosaver.reset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('переключатель канала', () => {
  test('меню: три пункта с аватарами, выбранный отмечен; «Все каналы» → в сторе all', async () => {
    renderApp('/episodes')
    await userEvent.click(await within(banner()).findByRole('button', { name: 'Канал: Cursus' }))
    const menu = screen.getByRole('menu', { name: 'Канал' })
    const items = within(menu).getAllByRole('menuitemradio')
    expect(items.map((i) => i.textContent)).toEqual(['∗Все каналы', 'CCursus', "OOtto's Timeline"])
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(document.activeElement).toBe(items[1]) // фокус — на выбранном

    await userEvent.click(items[0]!)
    expect(useUiStore.getState().channel).toBe('all')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger().getAttribute('aria-label')).toBe('Канал: Все каналы')
    expect(trigger().textContent).toContain('∗')
  })

  test('клавиатура: ↓ открывает, стрелки ходят, Enter выбирает, Esc закрывает с фокусом на кнопке', async () => {
    renderApp('/episodes')
    const button = await within(banner()).findByRole('button', { name: 'Канал: Cursus' })
    button.focus()
    await userEvent.keyboard('{ArrowDown}')
    const menu = screen.getByRole('menu', { name: 'Канал' })
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement?.textContent).toContain("Otto's Timeline")
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement?.textContent).toContain('Все каналы') // по кругу
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(menu.isConnected).toBe(false)
    expect(document.activeElement).toBe(trigger())
    expect(useUiStore.getState().channel).toBe('cursus')

    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('{End}{Enter}')
    expect(useUiStore.getState().channel).toBe('otto')
    expect(document.activeElement).toBe(trigger())
  })

  test('другой канал при открытом выпуске закрывает выпуск и уводит к «Выпускам»; «Все каналы» — нет', async () => {
    renderApp('/episodes/pirate/edit')
    await screen.findByRole('navigation', { name: 'Этапы выпуска' })
    await userEvent.click(trigger())
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Все каналы/ }))
    expect(useUiStore.getState().episodeId).toBe('pirate')
    expect(window.location.pathname).toBe('/episodes/pirate/edit')

    await userEvent.click(trigger())
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Otto's Timeline/ }))
    expect(useUiStore.getState().channel).toBe('otto')
    expect(useUiStore.getState().episodeId).toBeNull()
    expect(window.location.pathname).toBe('/episodes')
  })
})

describe('переименование', () => {
  async function openTitle() {
    const view = renderApp('/episodes/pirate/edit')
    const title = await within(banner()).findByRole('button', { name: 'Pirate Ship: Powder Monkey to Captain' })
    return { ...view, title }
  }

  test('Enter — название сразу новое, через 800 мс PATCH, «Сохранено ЧЧ:ММ» по ответу сервера', async () => {
    const { title, stub } = await openTitle()
    expect(screen.queryByTestId('save-indicator')).toBeNull() // до первого сохранения — ничего
    await userEvent.click(title)
    const field = within(banner()).getByRole('textbox', { name: 'Название выпуска' })
    await userEvent.clear(field)
    await userEvent.type(field, '  Pirate Ship, final cut  {Enter}')
    expect(within(banner()).getByRole('button', { name: 'Pirate Ship, final cut' })).toBeTruthy()
    expect(screen.getByTestId('save-indicator').textContent).toContain('Сохраняю…')
    expect(patches(stub.fetch)).toHaveLength(0)

    await waitFor(() => expect(patches(stub.fetch)).toHaveLength(1), { timeout: 2000 })
    const [url, init] = patches(stub.fetch)[0] ?? []
    expect(url).toBe('/api/episodes/pirate')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ title: 'Pirate Ship, final cut' })
    expect((init as RequestInit).keepalive).toBe(true)
    await waitFor(() =>
      expect(screen.getByTestId('save-indicator').textContent).toBe(
        `Сохранено ${formatClock('2026-09-11T10:05:00+00:00')}`,
      ),
    )
  })

  test('Esc возвращает старое название, ничего не пишется', async () => {
    const { title, stub } = await openTitle()
    await userEvent.click(title)
    const field = within(banner()).getByRole('textbox', { name: 'Название выпуска' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Другое{Escape}')
    const restored = within(banner()).getByRole('button', { name: 'Pirate Ship: Powder Monkey to Captain' })
    expect(document.activeElement).toBe(restored)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(patches(stub.fetch)).toHaveLength(0)
    expect(useUiStore.getState().save).toEqual({ kind: 'idle' })
  })

  test('пустое название не сохраняется: подпись под полем, поле остаётся', async () => {
    const { title, stub } = await openTitle()
    await userEvent.click(title)
    const field = within(banner()).getByRole('textbox', { name: 'Название выпуска' })
    await userEvent.clear(field)
    await userEvent.type(field, '   {Enter}')
    expect(within(banner()).getByText('Название не может быть пустым — введите текст.')).toBeTruthy()
    expect(field.getAttribute('aria-invalid')).toBe('true')
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(patches(stub.fetch)).toHaveLength(0)
  })

  test('ошибка сервера — откат к прежнему названию, текст ошибки и «Повторить» в индикаторе', async () => {
    const api = createMockApi()
    const stub = stubApi({
      ...api,
      handle: (method, url, body) =>
        method === 'PATCH' ? { status: 409, body: { detail: 'Выпуск меняется в другой вкладке — обновите страницу.' } } : api.handle(method, url, body),
    })
    renderApp('/episodes/pirate/edit', { stub })
    const title = await within(banner()).findByRole('button', { name: 'Pirate Ship: Powder Monkey to Captain' })
    await userEvent.click(title)
    const field = within(banner()).getByRole('textbox', { name: 'Название выпуска' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Не сохранится{Enter}')
    expect(within(banner()).getByRole('button', { name: 'Не сохранится' })).toBeTruthy()

    await waitFor(() => expect(within(banner()).getByRole('button', { name: 'Pirate Ship: Powder Monkey to Captain' })).toBeTruthy(), {
      timeout: 2000,
    })
    const indicator = screen.getByTestId('save-indicator')
    expect(indicator.textContent).toContain('Выпуск меняется в другой вкладке — обновите страницу.')
    expect(within(indicator).getByRole('button', { name: 'Повторить' })).toBeTruthy()
  })

  test('смена маршрута до таймера — запись сразу', async () => {
    const { title, stub } = await openTitle()
    await userEvent.click(title)
    const field = within(banner()).getByRole('textbox', { name: 'Название выпуска' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Быстрый уход{Enter}')
    act(() => navigate('/episodes'))
    await waitFor(() => expect(patches(stub.fetch)).toHaveLength(1), { timeout: 300 })
  })
})
