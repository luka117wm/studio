import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { register, resetRegistry } from '../../../app/keyboard'
import { Providers } from '../../../app/providers'
import { useUiStore } from '../../../store/uiStore'
import { StatesScreen } from '../index'
import { allDemos, productStates } from '../registry'

beforeEach(() => {
  useUiStore.setState({ channel: 'cursus', episodeId: null, collapsed: { left: false, right: false }, toasts: [], helpOpen: false })
  resetRegistry()
})
afterEach(() => {
  resetRegistry()
  vi.unstubAllEnvs()
})

describe('каталог состояний', () => {
  test.each(allDemos().map((d, i) => [`${d.component} #${i}`, d] as const))('демонстрация %s рендерится', (_name, demo) => {
    const { container } = render(<Providers>{demo.node}</Providers>)
    expect(container.innerHTML.length).toBeGreaterThan(0)
  })

  test.each(productStates.map((p) => [p.id, p] as const))('продуктовое состояние %s рендерится', (_id, state) => {
    const { container } = render(<Providers>{state.node}</Providers>)
    expect(container.innerHTML.length).toBeGreaterThan(0)
  })

  test('экран: вкладки всех групп, продукт и клавиатура; клавиатура — из реестра', async () => {
    register({ id: 'test-only', keys: 'Mod+E', scope: 'screen', group: 'Тестовая группа', description: 'Тестовое сочетание', handler: () => {} })
    render(
      <Providers>
        <StatesScreen params={{}} />
      </Providers>,
    )
    const tabs = screen.getByRole('tablist', { name: 'Разделы каталога' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Управление', 'Ввод', 'Слои', 'Обратная связь', 'Пустые состояния', 'Состояния ошибок', 'Продукт', 'Клавиатура',
    ])
    expect(screen.getByRole('heading', { name: 'Состояния' })).toBeTruthy()

    await userEvent.click(within(tabs).getByRole('tab', { name: 'Продукт' }))
    const product = screen.getByRole('tabpanel')
    expect(within(product).getByText('Лимит выпуска исчерпан: $20.00 из $20.00')).toBeTruthy()
    expect(within(product).getByText('Сети нет — платные этапы недоступны')).toBeTruthy()
    expect(within(product).getByRole('region', { name: 'Процесс' })).toBeTruthy()
    expect(within(product).getByRole('region', { name: 'Конфликт' })).toBeTruthy()

    await userEvent.click(within(tabs).getByRole('tab', { name: 'Клавиатура' }))
    const keyboard = screen.getByRole('tabpanel')
    expect(within(keyboard).getByText('Тестовое сочетание')).toBeTruthy()
    expect(within(keyboard).getByRole('region', { name: 'Тестовая группа' })).toBeTruthy()
  })

  test('маршрут /states отсутствует вне dev-сборки', async () => {
    vi.stubEnv('DEV', false)
    vi.resetModules()
    const prod = await import('../../../app/routes')
    expect(prod.matchRoute('/states')).toBeNull()
    expect(prod.routes.map((r) => r.screen)).not.toContain('states')
    vi.unstubAllEnvs()
    vi.resetModules()
    const dev = await import('../../../app/routes')
    expect(dev.matchRoute('/states')?.route.screen).toBe('states')
  })
})
