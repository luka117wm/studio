import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Toast } from '../Toast'
import { ToastStack } from '../ToastStack'

const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, message: `Тост ${id}` }))

describe('ToastStack', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('показывает три, остальное — «и ещё N»', () => {
    render(<ToastStack toasts={items} onDismiss={() => {}} />)
    expect(screen.getAllByRole('status')).toHaveLength(3)
    expect(screen.getByText('и ещё 2')).toBeTruthy()
  })

  test('автоскрытие через 4 с', () => {
    const onDismiss = vi.fn()
    render(<ToastStack toasts={items.slice(0, 1)} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(3999))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledWith('a')
  })

  test('пустой стек ничего не рендерит', () => {
    const { container } = render(<ToastStack toasts={[]} onDismiss={() => {}} />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('Toast', () => {
  test('действие внутри вызывает обработчик и закрывает', async () => {
    const onClick = vi.fn()
    const onDismiss = vi.fn()
    render(<Toast item={{ id: 'x', message: 'Перерисовано', status: 'ready', action: { label: 'Отменить', onClick } }} onDismiss={onDismiss} />)
    expect(screen.getByRole('status').getAttribute('data-status')).toBe('ready')
    await userEvent.click(screen.getByRole('button', { name: 'Отменить' }))
    expect(onClick).toHaveBeenCalled()
    expect(onDismiss).toHaveBeenCalledWith('x')
  })
})
