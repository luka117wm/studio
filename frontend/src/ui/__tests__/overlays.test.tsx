import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Settings } from 'lucide-react'
import { useRef, useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { Button } from '../Button'
import { DropdownMenu } from '../DropdownMenu'
import { Popover } from '../Popover'
import { Tooltip } from '../Tooltip'

describe('Tooltip', () => {
  test('открывается по фокусу сразу и связывается через aria-describedby; Esc закрывает', async () => {
    render(
      <Tooltip content="Сохранить (⌘S)">
        <button type="button">Сохранить</button>
      </Tooltip>,
    )
    const button = screen.getByRole('button', { name: 'Сохранить' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    await userEvent.tab()
    expect(document.activeElement).toBe(button)
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toBe('Сохранить (⌘S)')
    expect(button.getAttribute('aria-describedby')).toBe(tip.id)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).toBeNull()
    await userEvent.tab()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  test('по наведению — с задержкой, уход закрывает', async () => {
    render(
      <Tooltip content="Подсказка" delayMs={150}>
        <button type="button">Кнопка</button>
      </Tooltip>,
    )
    await userEvent.hover(screen.getByRole('button'))
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(await screen.findByRole('tooltip')).toBeTruthy()
    await userEvent.unhover(screen.getByRole('button'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

function PopoverHarness() {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button">Снаружи</button>
      <span ref={anchorRef}>
        <Button onClick={() => setOpen(true)}>Фильтры</Button>
      </span>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} ariaLabel="Фильтры">
        <button type="button">Применить</button>
      </Popover>
    </>
  )
}

describe('Popover', () => {
  test('фокус внутрь, Esc закрывает и возвращает фокус', async () => {
    render(<PopoverHarness />)
    const trigger = screen.getByRole('button', { name: 'Фильтры' })
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Фильтры' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Применить' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  test('клик вне закрывает', async () => {
    render(<PopoverHarness />)
    await userEvent.click(screen.getByRole('button', { name: 'Фильтры' }))
    await userEvent.click(screen.getByRole('button', { name: 'Снаружи' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('DropdownMenu', () => {
  const items = (onSelect: (id: string) => void) => [
    { id: 'redo', label: 'Перерисовать', keys: ['R'], onSelect: () => onSelect('redo') },
    { id: 'sep', separator: true as const },
    { id: 'lock', label: 'Заблокировать', disabled: true, onSelect: () => onSelect('lock') },
    { id: 'delete', label: 'Удалить', danger: true, onSelect: () => onSelect('delete') },
  ]

  test('клик открывает, стрелки ходят по пунктам, Enter выбирает и возвращает фокус', async () => {
    const onSelect = vi.fn()
    render(
      <>
        <button type="button">Снаружи</button>
        <DropdownMenu label="Действия" items={items(onSelect)} />
      </>,
    )
    const trigger = screen.getByRole('button', { name: 'Действия' })
    await userEvent.click(trigger)
    const menu = screen.getByRole('menu', { name: 'Действия' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const [redo, del] = screen.getAllByRole('menuitem').filter((el) => !el.hasAttribute('disabled'))
    expect(document.activeElement).toBe(redo)
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(del)
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(redo)
    await userEvent.keyboard('{End}')
    expect(document.activeElement).toBe(del)
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('delete')
    expect(document.body.contains(menu)).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  test('Esc закрывает с возвратом фокуса, клик вне закрывает', async () => {
    render(
      <>
        <button type="button">Снаружи</button>
        <DropdownMenu label="Ещё" trigger="icon" icon={Settings} items={items(() => {})} />
      </>,
    )
    const trigger = screen.getByRole('button', { name: 'Ещё' })
    expect(trigger.getAttribute('title')).toBe('Ещё')
    trigger.focus()
    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement?.textContent).toBe('Удалить')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await userEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Снаружи' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
