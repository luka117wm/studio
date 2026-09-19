import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useUiStore } from '../../store/uiStore'
import { AppShell } from '../AppShell'
import { Providers } from '../providers'
import { routes } from '../routes'

const INITIAL = { channel: 'cursus' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [] }

function renderAt(path: string) {
  window.history.replaceState(null, '', path)
  return render(
    <Providers>
      <AppShell />
    </Providers>,
  )
}

/** Путь с параметрами для каждого экрана */
const pathFor = (pattern: string) => pattern.replace(':episodeId', 'pirate').replace(':shotId', 's004')

beforeEach(() => {
  useUiStore.setState(INITIAL)
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('маршруты', () => {
  test.each(routes)('$pattern открывается по прямому URL: заголовок вкладки «$title»', ({ pattern, title }) => {
    renderAt(pathFor(pattern))
    expect(document.title).toBe(`${title} — Studio`)
    expect(screen.getByRole('main')).toBeTruthy()
  })

  test('корень ведёт к выпускам', () => {
    renderAt('/')
    expect(window.location.pathname).toBe('/episodes')
    expect(document.title).toBe('Выпуски — Studio')
  })

  test('неизвестный путь — экран «Нет такого экрана» со ссылкой к выпускам', async () => {
    renderAt('/nope')
    expect(screen.getByRole('heading', { name: 'Нет такого экрана' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'К выпускам' }))
    expect(window.location.pathname).toBe('/episodes')
    expect(screen.getByRole('heading', { name: 'Выпуски' })).toBeTruthy()
  })

  test('неизвестный выпуск — «Выпуск не найден», рельса нет', () => {
    renderAt('/episodes/ghost/edit')
    expect(screen.getByRole('heading', { name: 'Выпуск не найден' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Этапы выпуска' })).toBeNull()
  })

  test('при загрузке нет ни одного обращения к сети', () => {
    for (const route of routes) {
      const { unmount } = renderAt(pathFor(route.pattern))
      unmount()
    }
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('оболочка', () => {
  test('открытие выпуска: рельс с активным этапом из URL, название в шапке, переход по рельсу', async () => {
    renderAt('/episodes/pirate/edit')
    expect(useUiStore.getState().episodeId).toBe('pirate')
    const rail = screen.getByRole('navigation', { name: 'Этапы выпуска' })
    const stages = within(rail).getAllByRole('link')
    expect(stages.map((s) => s.getAttribute('aria-label'))).toEqual(['Идея', 'Сценарий', 'Генерация', 'Монтаж', 'Экспорт', 'Публикация'])
    expect(within(rail).getByRole('link', { name: 'Монтаж' }).getAttribute('aria-current')).toBe('page')
    expect(within(rail).getByRole('link', { name: 'Экспорт' }).getAttribute('title')).toBe('Экспорт — не начат')
    expect(screen.getByRole('banner', { name: 'Верхняя панель' }).textContent).toContain('Every Rank on a Pirate Ship')

    await userEvent.click(within(rail).getByRole('link', { name: 'Экспорт' }))
    expect(window.location.pathname).toBe('/episodes/pirate/export')
    expect(document.title).toBe('Экспорт — Studio')
    expect(within(rail).getByRole('link', { name: 'Экспорт' }).getAttribute('aria-current')).toBe('page')
  })

  test('без выпуска: «Выпуск не открыт», рельса нет', () => {
    renderAt('/episodes')
    expect(screen.getByText('Выпуск не открыт')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Этапы выпуска' })).toBeNull()
  })

  test('переключение канала меняет контекст: расход, выпуск другого канала закрывается', async () => {
    renderAt('/episodes/pirate/script')
    const banner = screen.getByRole('banner', { name: 'Верхняя панель' })
    expect(banner.textContent).toContain('$61.40')
    await userEvent.click(within(banner).getByRole('combobox', { name: 'Канал' }))
    await userEvent.click(screen.getByRole('option', { name: "Otto's Timeline" }))
    expect(useUiStore.getState().channel).toBe('otto')
    expect(useUiStore.getState().episodeId).toBeNull()
    expect(window.location.pathname).toBe('/episodes')
    expect(banner.textContent).toContain('$23.15')
    expect(screen.getByText('Выпуск не открыт')).toBeTruthy()
  })

  test('панели монтажа: ширины из токенов, инспектор сворачивается и разворачивается', async () => {
    renderAt('/episodes/pirate/edit')
    const left = screen.getByRole('complementary', { name: 'Библиотека' })
    const right = screen.getByRole('complementary', { name: 'Инспектор' })
    const bottom = screen.getByRole('contentinfo', { name: 'Таймлайн' })
    expect(left.className).toContain('w-shell-library')
    expect(right.className).toContain('w-shell-inspector')
    expect(bottom.className).toContain('h-shell-timeline')
    expect(screen.getByRole('navigation', { name: 'Этапы выпуска' }).className).toContain('w-shell-stage-rail')

    await userEvent.click(within(right).getByRole('button', { name: /Свернуть: Инспектор/ }))
    expect(useUiStore.getState().collapsed.right).toBe(true)
    expect(right.getAttribute('data-collapsed')).toBe('true')
    expect(right.className).toContain('w-10')
    await userEvent.click(within(right).getByRole('button', { name: /Развернуть: Инспектор/ }))
    expect(right.hasAttribute('data-collapsed')).toBe(false)
    expect(right.className).toContain('w-shell-inspector')
  })

  test('статус-строка и тосты из стора', () => {
    renderAt('/episodes')
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Генерация кадров: Medieval Monastery, 78 из 104')
    expect(status.textContent).toContain('горячие клавиши')
    act(() => useUiStore.getState().pushToast({ id: 't1', message: 'Перерисовано', status: 'ready' }))
    expect(screen.getAllByRole('status').some((el) => el.textContent?.startsWith('Перерисовано'))).toBe(true)
  })
})
