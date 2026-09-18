import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { useUiStore } from '../../store/uiStore'
import { AppShell } from '../AppShell'
import { formatKeys, isEditable, matches, parseCombo, register, resetRegistry, setPlatform } from '../keyboard'
import { Providers } from '../providers'

const INITIAL = { channel: 'cursus' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [], helpOpen: false }

function renderAt(path: string) {
  window.history.replaceState(null, '', path)
  return render(
    <Providers>
      <AppShell />
    </Providers>,
  )
}

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })

beforeEach(() => {
  useUiStore.setState(INITIAL)
  resetRegistry()
  setPlatform('other')
})
afterEach(() => resetRegistry())

describe('реестр', () => {
  test('Mod — Ctrl на Windows и ⌘ на Mac, цифры по code, «?» по key', () => {
    const mod1 = parseCombo('Mod+1')
    expect(matches(key({ ctrlKey: true, code: 'Digit1', key: '1' }), mod1)).toBe(true)
    expect(matches(key({ metaKey: true, code: 'Digit1', key: '1' }), mod1)).toBe(false)
    expect(matches(key({ ctrlKey: true, metaKey: true, code: 'Digit1', key: '1' }), mod1)).toBe(false)
    setPlatform('mac')
    expect(matches(key({ metaKey: true, code: 'Digit1', key: '1' }), mod1)).toBe(true)
    expect(matches(key({ altKey: true, code: 'Digit1', key: '¡' }), parseCombo('Alt+1'))).toBe(true)
    expect(matches(key({ code: 'KeyS', key: 'ы' }), parseCombo('S'))).toBe(true)
    expect(matches(key({ shiftKey: true, code: 'Slash', key: '?' }), parseCombo('?'))).toBe(true)
    expect(matches(key({ shiftKey: true, code: 'ArrowRight', key: 'ArrowRight' }), parseCombo('Shift+ArrowRight'))).toBe(true)
    expect(matches(key({ code: 'ArrowRight', key: 'ArrowRight' }), parseCombo('Shift+ArrowRight'))).toBe(false)
  })

  test('formatKeys по платформе', () => {
    expect(formatKeys('Mod+Shift+Z')).toEqual(['Ctrl', 'Shift', 'Z'])
    expect(formatKeys('Alt+3')).toEqual(['Alt', '3'])
    expect(formatKeys('Escape')).toEqual(['Esc'])
    setPlatform('mac')
    expect(formatKeys('Mod+1')).toEqual(['⌘', '1'])
    expect(formatKeys('Alt+1')).toEqual(['⌥', '1'])
    expect(formatKeys('Shift+ArrowLeft')).toEqual(['⇧', '←'])
  })

  test('браузерные сочетания не регистрируются', () => {
    const base = { scope: 'global' as const, group: 'x', description: 'x', handler: () => {} }
    expect(() => register({ ...base, id: 'a', keys: 'Mod+N' })).toThrow(/браузерное/)
    expect(() => register({ ...base, id: 'b', keys: 'Mod+W' })).toThrow()
    expect(() => register({ ...base, id: 'c', keys: 'Mod+Shift+T' })).toThrow()
    expect(() => register({ ...base, id: 'd', keys: 'Mod+E' })).not.toThrow()
  })

  test('isEditable: поля ввода, но не кнопки и чекбоксы', () => {
    const input = document.createElement('input')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    const button = document.createElement('button')
    const area = document.createElement('textarea')
    expect(isEditable(input)).toBe(true)
    expect(isEditable(area)).toBe(true)
    expect(isEditable(checkbox)).toBe(false)
    expect(isEditable(button)).toBe(false)
    expect(isEditable(null)).toBe(false)
  })
})

describe('оболочка', () => {
  test('«?» открывает помощь, список — из реестра, «?» и Esc закрывают с возвратом фокуса', async () => {
    renderAt('/episodes/pirate/edit')
    const unregister = register({
      id: 'test-only',
      keys: 'Mod+E',
      scope: 'screen',
      group: 'Тестовая группа',
      description: 'Тестовое сочетание',
      handler: () => {},
    })
    register({ id: 'test-off', keys: 'Mod+D', scope: 'screen', group: 'Тестовая группа', description: 'Выключенное', when: () => false, handler: () => {} })
    const help = screen.getByRole('button', { name: 'Горячие клавиши (?)' })
    help.focus()
    await userEvent.keyboard('?')
    const dialog = screen.getByRole('dialog', { name: 'Горячие клавиши' })
    expect(within(dialog).getByText('Тестовое сочетание')).toBeTruthy()
    expect(within(dialog).queryByText('Выключенное')).toBeNull()
    expect(within(dialog).getByText('Монтаж')).toBeTruthy()
    expect(within(dialog).getByText(/Свернуть или развернуть: инспектор/)).toBeTruthy()
    expect(within(dialog).getByText('Закрыть верхний слой')).toBeTruthy()
    await userEvent.keyboard('?')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(help)

    await userEvent.click(help)
    expect(screen.getByRole('dialog')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    unregister()
  })

  test('в открытом диалоге глобальные сочетания не срабатывают', async () => {
    renderAt('/episodes/pirate/edit')
    act(() => useUiStore.getState().setHelpOpen(true))
    expect(screen.getByRole('dialog')).toBeTruthy()
    await userEvent.keyboard('{Control>}1{/Control}')
    expect(window.location.pathname).toBe('/episodes/pirate/edit')
    await userEvent.keyboard('{Alt>}3{/Alt}')
    expect(useUiStore.getState().collapsed.right).toBe(false)
  })

  test('в текстовом поле «?» игнорируется', async () => {
    renderAt('/episodes')
    const search = screen.getByRole('searchbox', { name: 'Поиск по выпускам' })
    await userEvent.type(search, 'a?')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((search as HTMLInputElement).value).toBe('a?')
  })

  test('⌘1…⌘6 переводят по этапам при открытом выпуске и молчат без него', async () => {
    renderAt('/episodes')
    await userEvent.keyboard('{Control>}2{/Control}')
    expect(window.location.pathname).toBe('/episodes')

    act(() => window.history.pushState(null, '', '/episodes/pirate/edit'))
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(screen.getByRole('navigation', { name: 'Этапы выпуска' })).toBeTruthy()
    await userEvent.keyboard('{Control>}2{/Control}')
    expect(window.location.pathname).toBe('/episodes/pirate/script')
    await userEvent.keyboard('{Control>}6{/Control}')
    expect(window.location.pathname).toBe('/episodes/pirate/publish')
    await userEvent.keyboard('{Control>}1{/Control}')
    expect(window.location.pathname).toBe('/ideas')
  })

  test('⌥3 сворачивает инспектор на монтаже и ничего не делает на «Выпусках»', async () => {
    const { unmount } = renderAt('/episodes')
    await userEvent.keyboard('{Alt>}3{/Alt}')
    expect(useUiStore.getState().collapsed.right).toBe(false)
    unmount()
    resetRegistry()

    renderAt('/episodes/pirate/edit')
    await userEvent.keyboard('{Alt>}3{/Alt}')
    expect(useUiStore.getState().collapsed.right).toBe(true)
    expect(screen.getByRole('complementary', { name: 'Инспектор' }).getAttribute('data-collapsed')).toBe('true')
    await userEvent.keyboard('{Alt>}1{/Alt}')
    expect(useUiStore.getState().collapsed.left).toBe(true)
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('библиотека')
    expect(status.textContent).toContain('инспектор')
  })

  test('skip-link первым в обходе и фокусирует рабочую область', async () => {
    renderAt('/episodes/pirate/edit')
    await userEvent.tab()
    const skip = screen.getByRole('link', { name: 'Перейти к рабочей области' })
    expect(document.activeElement).toBe(skip)
    await userEvent.keyboard('{Enter}')
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  test('Tab обходит зоны в визуальном порядке', async () => {
    renderAt('/episodes/pirate/edit')
    const zoneOf = (el: Element | null): string => {
      if (!el) return 'none'
      if (el.closest('a[href="#main"]')) return 'skip'
      if (el.closest('header[aria-label="Верхняя панель"]')) return 'topbar'
      if (el.closest('nav[aria-label="Этапы выпуска"]')) return 'rail'
      const zone = el.closest('[data-zone]')?.getAttribute('data-zone')
      if (zone) return zone
      if (el.closest('section[aria-label="Рабочая зона"]')) return 'center'
      if (el.closest('footer[role="status"]')) return 'status'
      return 'other'
    }
    const order: string[] = []
    for (let i = 0; i < 20; i += 1) {
      await userEvent.tab()
      const zone = zoneOf(document.activeElement)
      if (order[order.length - 1] !== zone) order.push(zone)
      if (zone === 'right') break
    }
    expect(order).toEqual(['skip', 'topbar', 'rail', 'left', 'center', 'right'])
  })
})
