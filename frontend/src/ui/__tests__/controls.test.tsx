import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { Checkbox } from '../Checkbox'
import { Chip } from '../Chip'
import { Radio } from '../Radio'
import { SegmentedControl } from '../SegmentedControl'
import { Slider } from '../Slider'
import { Toggle } from '../Toggle'

describe('SegmentedControl', () => {
  function Harness() {
    const [value, setValue] = useState<'a' | 'b' | 'c'>('a')
    return (
      <SegmentedControl
        ariaLabel="Вид"
        value={value}
        onChange={setValue}
        options={[
          { value: 'a', label: 'Сетка' },
          { value: 'b', label: 'Список' },
          { value: 'c', label: 'Лист' },
        ]}
      />
    )
  }

  test('радиогруппа, стрелки переключают с заворотом', async () => {
    render(<Harness />)
    const group = screen.getByRole('radiogroup', { name: 'Вид' })
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true')
    radios[0]?.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(radios[1]?.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radios[1])
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(radios[2]?.getAttribute('aria-checked')).toBe('true')
    await userEvent.click(screen.getByRole('radio', { name: 'Сетка' }))
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true')
    expect(group).toBeTruthy()
  })
})

describe('Slider', () => {
  function Harness(props: { defaultValue?: number; input?: boolean }) {
    const [value, setValue] = useState(10)
    return (
      <>
        <Slider
          ariaLabel="Сила"
          value={value}
          onChange={setValue}
          min={3}
          max={25}
          step={1}
          defaultValue={props.defaultValue}
          spread={[5, 12]}
          input={props.input ? { unit: '%' } : undefined}
        />
        <output>{value}</output>
      </>
    )
  }

  test('←→ шаг, Shift ×10 с ограничением, Home/End', async () => {
    render(<Harness />)
    const thumb = screen.getByRole('slider', { name: 'Сила' })
    expect(thumb.getAttribute('aria-valuenow')).toBe('10')
    thumb.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('status').textContent).toBe('11')
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    expect(screen.getByRole('status').textContent).toBe('21')
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    expect(screen.getByRole('status').textContent).toBe('25')
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('status').textContent).toBe('3')
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('status').textContent).toBe('25')
  })

  test('⌥-клик возвращает к дефолту, засечка дефолта есть', () => {
    render(<Harness defaultValue={8} />)
    expect(screen.getByTestId('slider-default-tick')).toBeTruthy()
    const thumb = screen.getByRole('slider', { name: 'Сила' })
    const rail = thumb.parentElement!
    fireEvent.pointerDown(rail, { altKey: true, button: 0, clientX: 0 })
    expect(screen.getByRole('status').textContent).toBe('8')
  })

  test('числовое поле в одной строке связано со значением', async () => {
    render(<Harness input />)
    const input = screen.getByRole('textbox', { name: 'Сила, число' })
    expect((input as HTMLInputElement).value).toBe('10')
    await userEvent.clear(input)
    await userEvent.type(input, '20')
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('20')
  })
})

describe('Toggle', () => {
  test('switch с видимой подписью', async () => {
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange} label="Не подгонять под голос" />)
    const toggle = screen.getByRole('switch', { name: 'Не подгонять под голос' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  test('switch с aria-label', () => {
    render(<Toggle checked onChange={() => {}} ariaLabel="Субтитры" />)
    expect(screen.getByRole('switch', { name: 'Субтитры' }).getAttribute('aria-checked')).toBe('true')
  })
})

describe('Checkbox / Radio', () => {
  test('checkbox: клик и indeterminate', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<Checkbox checked={false} onChange={onChange} label="Все кадры" />)
    const box = screen.getByRole('checkbox', { name: 'Все кадры' }) as HTMLInputElement
    await userEvent.click(box)
    expect(onChange).toHaveBeenCalledWith(true)
    rerender(<Checkbox checked="indeterminate" onChange={onChange} label="Все кадры" />)
    expect(box.indeterminate).toBe(true)
    expect(box.checked).toBe(false)
  })

  test('radio: группа по name, выбор отдаёт value', async () => {
    const onChange = vi.fn()
    render(
      <>
        <Radio name="mode" value="api" checked onChange={onChange} label="API" />
        <Radio name="mode" value="bridge" checked={false} onChange={onChange} label="Мост через чат" />
      </>,
    )
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    await userEvent.click(screen.getByRole('radio', { name: 'Мост через чат' }))
    expect(onChange).toHaveBeenCalledWith('bridge')
  })
})

describe('Chip', () => {
  test('filter — aria-pressed, tag — кнопка удаления с именем, add — кнопка', async () => {
    const onToggle = vi.fn()
    const onRemove = vi.fn()
    const onAdd = vi.fn()
    render(
      <>
        <Chip variant="filter" label="Только failed" selected onToggle={onToggle} />
        <Chip variant="tag" label="caribbean-1716" onRemove={onRemove} />
        <Chip variant="add" label="Период" onClick={onAdd} />
      </>,
    )
    const filter = screen.getByRole('button', { name: 'Только failed' })
    expect(filter.getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(filter)
    expect(onToggle).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Удалить caribbean-1716' }))
    expect(onRemove).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Период' }))
    expect(onAdd).toHaveBeenCalled()
  })
})
