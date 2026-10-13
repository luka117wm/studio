import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Toast } from '../Toast'
import { ToastStack } from '../ToastStack'

const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, message: `Тост ${id}` }))

describe('ToastStack', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('показывает три новых, старые — «и ещё N» над ними', () => {
    render(<ToastStack toasts={items} onDismiss={() => {}} />)
    expect(screen.getAllByRole('status').map((t) => t.textContent)).toEqual(['Тост cСкрыть', 'Тост dСкрыть', 'Тост eСкрыть'])
    const more = screen.getByText('и ещё 2')
    expect(more.compareDocumentPosition(screen.getAllByRole('status')[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('автоскрытие через 4 с', () => {
    const onDismiss = vi.fn()
    render(<ToastStack toasts={items.slice(0, 1)} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(3999))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledWith('a')
  })

  test('новый тост не продлевает соседний; повтор с тем же id — новые 4 с', () => {
    const onDismiss = vi.fn()
    const first = { id: 'a', message: 'Часть 1 из 2 принята' }
    const { rerender } = render(<ToastStack toasts={[first]} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(3000))
    const second = { id: 'b', message: 'План v001: +52 кадра' }
    rerender(<ToastStack toasts={[first, second]} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(1000))
    expect(onDismiss.mock.calls).toEqual([['a']])

    const again = { id: 'b', message: 'План v002: +52 кадра' }
    act(() => vi.advanceTimersByTime(2000))
    rerender(<ToastStack toasts={[again]} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(3999))
    expect(onDismiss.mock.calls).toEqual([['a']])
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss.mock.calls).toEqual([['a'], ['b']])
  })

  test('пустой стек ничего не рендерит', () => {
    const { container } = render(<ToastStack toasts={[]} onDismiss={() => {}} />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('Toast', () => {
  test('без действия — кнопка «Скрыть» закрывает', async () => {
    const onDismiss = vi.fn()
    render(<Toast item={{ id: 'y', message: 'Озвучено' }} onDismiss={onDismiss} />)
    await userEvent.click(screen.getByRole('button', { name: 'Скрыть' }))
    expect(onDismiss).toHaveBeenCalledWith('y')
  })

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
