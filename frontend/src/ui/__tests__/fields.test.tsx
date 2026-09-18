import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { Input } from '../Input'
import { NumberInput } from '../NumberInput'
import { Textarea } from '../Textarea'

describe('Input', () => {
  test('onChange получает значение, ошибка связывается через aria', async () => {
    const onChange = vi.fn()
    render(<Input value="" onChange={onChange} ariaLabel="Название" error="Пусто" />)
    const input = screen.getByRole('textbox', { name: 'Название' })
    await userEvent.type(input, 'a')
    expect(onChange).toHaveBeenCalledWith('a')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Пусто')
  })

  test('без ошибки нет aria-invalid; disabled', () => {
    render(<Input value="x" onChange={() => {}} ariaLabel="Поле" disabled />)
    const input = screen.getByRole('textbox', { name: 'Поле' })
    expect(input.hasAttribute('aria-invalid')).toBe(false)
    expect(input.hasAttribute('disabled')).toBe(true)
  })
})

describe('Textarea', () => {
  test('обычный и prompt-вариант', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<Textarea value="" onChange={onChange} ariaLabel="Промпт" />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Промпт' }), 'b')
    expect(onChange).toHaveBeenCalledWith('b')
    rerender(<Textarea value="" onChange={onChange} ariaLabel="Промпт" variant="prompt" error="Стиль в промпте" />)
    const area = screen.getByRole('textbox', { name: 'Промпт' })
    expect(area.className).toContain('font-script')
    expect(area.getAttribute('aria-invalid')).toBe('true')
  })
})

function Controlled(props: { min?: number; max?: number; step?: number; unit?: string; initial?: number }) {
  const [value, setValue] = useState(props.initial ?? 5)
  return (
    <>
      <NumberInput value={value} onChange={setValue} min={props.min} max={props.max} step={props.step} unit={props.unit} ariaLabel="Сила" />
      <output>{value}</output>
    </>
  )
}

describe('NumberInput', () => {
  test('ввод числа уходит наружу, blur выравнивает по min/max', async () => {
    render(<Controlled min={0} max={25} />)
    const input = screen.getByRole('textbox', { name: 'Сила' })
    await userEvent.clear(input)
    await userEvent.type(input, '12')
    expect((screen.getByRole('status')).textContent).toContain('12')
    await userEvent.clear(input)
    await userEvent.type(input, '99')
    await userEvent.tab()
    expect((screen.getByRole('status')).textContent).toContain('25')
    expect((input as HTMLInputElement).value).toBe('25')
  })

  test('стрелки шагают, с Shift ×10', async () => {
    render(<Controlled min={0} max={100} step={1} initial={5} />)
    const input = screen.getByRole('textbox', { name: 'Сила' })
    input.focus()
    await userEvent.keyboard('{ArrowUp}')
    expect((screen.getByRole('status')).textContent).toContain('6')
    await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}')
    expect((screen.getByRole('status')).textContent).toContain('16')
    await userEvent.keyboard('{ArrowDown}')
    expect((screen.getByRole('status')).textContent).toContain('15')
  })

  test('дробный шаг без хвоста float, суффикс единицы', async () => {
    render(<Controlled min={0} max={1} step={0.1} initial={0.2} unit="с" />)
    screen.getByRole('textbox', { name: 'Сила' }).focus()
    await userEvent.keyboard('{ArrowUp}')
    expect((screen.getByRole('status')).textContent).toContain('0.3')
    expect(screen.getByText('с')).toBeTruthy()
  })
})
