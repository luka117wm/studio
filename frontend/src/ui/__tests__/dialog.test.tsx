import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'
import { Button } from '../Button'
import { Dialog } from '../Dialog'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Открыть</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Утвердить план"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Отмена</Button>
            <Button variant="primary" price={1.61} onClick={() => setOpen(false)}>
              Сгенерировать 24 кадра
            </Button>
          </>
        }
      >
        <p>Текст</p>
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  test('открытие ставит фокус внутрь, Tab не выходит за пределы, Shift+Tab идёт по кольцу', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Открыть' }))
    const dialog = screen.getByRole('dialog', { name: 'Утвердить план' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const close = screen.getByRole('button', { name: 'Закрыть' })
    expect(document.activeElement).toBe(close)

    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Отмена' }))
    await userEvent.tab()
    expect(document.activeElement?.textContent).toContain('Сгенерировать 24 кадра')
    await userEvent.tab()
    expect(document.activeElement).toBe(close)
    await userEvent.tab({ shift: true })
    expect(document.activeElement?.textContent).toContain('Сгенерировать 24 кадра')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  test('xl и note', () => {
    render(
      <Dialog open onClose={() => {}} title="Горячие клавиши" note="монтаж" size="xl">
        <p>Текст</p>
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Горячие клавиши' })
    expect(dialog.className).toContain('w-250')
    expect(dialog.textContent).toContain('монтаж')
  })

  test('Escape закрывает, фокус возвращается на триггер', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Открыть' })
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  test('клик по скриму закрывает, клик внутри — нет', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Открыть' }))
    await userEvent.click(screen.getByText('Текст'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    await userEvent.click(screen.getByRole('dialog').parentElement!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
