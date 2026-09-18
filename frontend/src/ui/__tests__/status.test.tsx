import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { StatusBadge } from '../StatusBadge'
import { StatusGlyph } from '../StatusGlyph'
import { STATUSES, statusLabel } from '../status'

describe('StatusGlyph / StatusBadge', () => {
  test.each(STATUSES)('глиф %s — role img с именем статуса', (status) => {
    render(<StatusGlyph status={status} />)
    const glyph = screen.getByRole('img', { name: statusLabel[status] })
    expect(glyph.getAttribute('data-status')).toBe(status)
    expect(glyph.firstElementChild).toBeTruthy()
  })

  test('бейдж: подпись по умолчанию и своя', () => {
    const { rerender } = render(<StatusBadge status="failed" />)
    expect(screen.getByText('Ошибка')).toBeTruthy()
    rerender(<StatusBadge status="generating" label="Генерирую 14 из 24" />)
    expect(screen.getByText('Генерирую 14 из 24')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Генерируется' })).toBeTruthy()
  })
})
