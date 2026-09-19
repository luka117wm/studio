import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Film } from 'lucide-react'
import { describe, expect, test, vi } from 'vitest'
import { Divider } from '../Divider'
import { EmptyState } from '../EmptyState'
import { KeyHint } from '../KeyHint'
import { ProgressBar } from '../ProgressBar'
import { ScrollArea } from '../ScrollArea'
import { Skeleton } from '../Skeleton'

describe('EmptyState', () => {
  test('заголовок, объяснение, primary с ценой, secondary, подпись', async () => {
    const onPrimary = vi.fn()
    render(
      <EmptyState
        icon={Film}
        title="Кадров пока нет"
        description="Кадры появятся после утверждения плана."
        primary={{ label: 'Сгенерировать 24 кадра', price: 1.61, onClick: onPrimary }}
        secondary={{ label: 'Открыть план', onClick: () => {} }}
        hint="Бюджет выпуска: $4.00"
      />,
    )
    expect(screen.getByRole('heading', { name: 'Кадров пока нет' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Сгенерировать 24 кадра (~$1.61)' }))
    expect(onPrimary).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Открыть план' })).toBeTruthy()
    expect(screen.getByText('Бюджет выпуска: $4.00')).toBeTruthy()
  })
})

describe('ProgressBar', () => {
  test('значение в aria, null — неопределённый', () => {
    const { rerender } = render(<ProgressBar value={37.4} ariaLabel="Рендер" />)
    const bar = screen.getByRole('progressbar', { name: 'Рендер' })
    expect(bar.getAttribute('aria-valuenow')).toBe('37')
    rerender(<ProgressBar value={null} ariaLabel="Рендер" status="failed" />)
    expect(bar.hasAttribute('aria-valuenow')).toBe(false)
  })
})

describe('Skeleton / Divider / ScrollArea / KeyHint', () => {
  test('skeleton скрыт от AT, text рендерит строки', () => {
    const { container } = render(<Skeleton variant="text" lines={4} />)
    const root = container.firstElementChild!
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(root.children).toHaveLength(4)
  })

  test('divider — separator с ориентацией', () => {
    render(<Divider orientation="vertical" inset />)
    expect(screen.getByRole('separator').getAttribute('aria-orientation')).toBe('vertical')
  })

  test('scroll area с именем фокусируется', () => {
    render(
      <ScrollArea ariaLabel="Список кадров">
        <p>…</p>
      </ScrollArea>,
    )
    expect(screen.getByRole('region', { name: 'Список кадров' }).tabIndex).toBe(0)
  })

  test('key hint рендерит kbd на клавишу и подпись; md — 20px', () => {
    const { container, rerender } = render(<KeyHint keys={['⌘', 'K']} label="Поиск" />)
    expect(container.querySelectorAll('kbd')).toHaveLength(2)
    expect(container.textContent).toBe('⌘KПоиск')
    rerender(<KeyHint keys={['Esc']} size="md" />)
    expect(container.querySelector('kbd')?.className).toContain('h-5')
  })
})
