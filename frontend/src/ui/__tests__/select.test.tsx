import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'
import { Select } from '../Select'

const options = [
  { value: 'push_in', label: 'Наезд' },
  { value: 'pull_out', label: 'Отъезд' },
  { value: 'pan', label: 'Панорама', disabled: true },
  { value: 'static', label: 'Статика' },
]

function Harness() {
  const [value, setValue] = useState<string | null>('pull_out')
  return (
    <>
      <button type="button">Снаружи</button>
      <Select options={options} value={value} onChange={setValue} ariaLabel="Движение" />
      <output>{value}</output>
    </>
  )
}

describe('Select', () => {
  test('открывается по клику, выбор мышью закрывает', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('combobox', { name: 'Движение' })
    expect((trigger).textContent).toContain('Отъезд')
    await userEvent.click(trigger)
    const list = screen.getByRole('listbox')
    expect(screen.getByRole('option', { name: 'Отъезд' }).getAttribute('aria-selected')).toBe('true')
    await userEvent.click(screen.getByRole('option', { name: 'Статика' }))
    expect(document.body.contains(list)).toBe(false)
    expect((screen.getByRole('status')).textContent).toContain('static')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  test('клавиатура: ↓ открывает, ↓ пропускает disabled, Enter выбирает, Esc закрывает', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('combobox', { name: 'Движение' })
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeTruthy()
    // активен выбранный «Отъезд» (index 1); ↓ перескакивает disabled «Панорама» на «Статика»
    await userEvent.keyboard('{ArrowDown}')
    expect(trigger.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Статика' }).id)
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect((screen.getByRole('status')).textContent).toContain('static')
    expect(document.activeElement).toBe(trigger)

    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  test('клик вне закрывает без выбора', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Движение' }))
    expect(screen.getByRole('listbox')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Снаружи' }))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect((screen.getByRole('status')).textContent).toContain('pull_out')
  })

  test('плейсхолдер и ошибка', () => {
    render(<Select options={options} value={null} onChange={() => {}} ariaLabel="Голос" placeholder="Выберите голос" error="Нужен голос" />)
    const trigger = screen.getByRole('combobox', { name: 'Голос' })
    expect((trigger).textContent).toContain('Выберите голос')
    expect(trigger.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Нужен голос')).toBeTruthy()
  })
})
