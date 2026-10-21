// Таблица плана на моке «Пиратов» (артборд 3): 11 колонок, клавиатура сетки, правка ячеек с автосохранением.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderApp } from '../../../app/__tests__/harness'
import { autosaver } from '../../../app/autosave'
import { STYLE_TOKEN } from '../../../mocks/api'
import { useUiStore } from '../../../store/uiStore'

const INITIAL = { channel: 'cursus' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [] }

beforeEach(() => useUiStore.setState(INITIAL))
// Сначала размонтировать, потом снять фейки (L-024)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  autosaver.reset()
})

const patches = (fetch: ReturnType<typeof vi.fn>) =>
  fetch.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as unknown)

async function table() {
  const app = renderApp('/episodes/pirate/script?mode=plan')
  const grid = await screen.findByRole('grid', { name: 'План кадров' }, { timeout: 3000 })
  await waitFor(() => expect(grid.querySelectorAll('[data-shot]')).toHaveLength(8), { timeout: 3000 })
  return { ...app, grid }
}

const row = (grid: HTMLElement, id: string) => grid.querySelector<HTMLElement>(`[data-shot="${id}"]`)!
const cell = (grid: HTMLElement, rowIndex: number, col: number) =>
  grid.querySelector<HTMLElement>(`[data-cell="${rowIndex}:${col}"]`)!

describe('таблица плана', () => {
  test('11 колонок артборда и строка кадра', async () => {
    const { grid } = await table()
    expect(within(grid).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      '№',
      'Раздел',
      'VO',
      'Промпт картинки',
      'Герои',
      'План',
      'Движение',
      'Переход',
      'Анимация',
      'SFX',
      'Статус',
    ])
    const cells = [...row(grid, 's002').children].map((el) => el.textContent)
    expect(cells).toEqual([
      's002',
      'Cold open',
      'Nobody asks your name. They ask if you can run a cartridge to the guns without tripping.',
      'Close view of a boy’s soot-marked hands gripping a canvas cartridge, cannon wheel behind',
      'Powder monkey',
      'деталь',
      'отъезд',
      'наплыв 6 к',
      'нет',
      '1',
      'готов',
    ])
    expect(within(row(grid, 's006')).getByText('проверить')).toBeTruthy()
  })

  test('клавиатура: ↑↓ строки, ←→ ячейки, Enter — правка, Esc — выход с фокусом на ячейке', async () => {
    const { grid } = await table()
    cell(grid, 0, 0).focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(cell(grid, 1, 0))
    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(cell(grid, 1, 1))
    expect(cell(grid, 1, 1).getAttribute('tabindex')).toBe('0')
    expect(cell(grid, 0, 0).getAttribute('tabindex')).toBe('-1')

    await userEvent.keyboard('{Enter}')
    const input = within(grid).getByRole('textbox', { name: 'Промпт кадра s002' })
    expect(document.activeElement).toBe(input)
    await userEvent.keyboard('{Escape}')
    expect(within(grid).queryByRole('textbox', { name: 'Промпт кадра s002' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(cell(grid, 1, 1)))
  })

  test('стилевой токен в промпте — ошибка бэкенда под ячейкой, значение остаётся', async () => {
    const { grid, stub } = await table()
    await userEvent.click(cell(grid, 2, 1))
    const input = within(grid).getByRole('textbox', { name: 'Промпт кадра s003' })
    await userEvent.clear(input)
    await userEvent.type(input, `runs along the deck, ${STYLE_TOKEN}{Enter}`)

    await waitFor(() => expect(patches(stub.fetch)).toHaveLength(1), { timeout: 3000 })
    expect(patches(stub.fetch)[0]).toEqual({
      shots: { s003: { user_override: { image: { prompt: `runs along the deck, ${STYLE_TOKEN}` } } } },
    })
    expect(
      await within(row(grid, 's003')).findByText(
        'кадр s003: в image.prompt стилевой токен «cinematic lighting» (lighting), ожидалось только действие, ' +
          'композиция и ракурс — стиль задаёт канон',
        {},
        { timeout: 3000 },
      ),
    ).toBeTruthy()
    expect(cell(grid, 2, 1).textContent).toBe(`runs along the deck, ${STYLE_TOKEN}`)
  })

  test('Select плана — PATCH image.shot_size; поправленная ячейка отмечена', async () => {
    const { grid, stub } = await table()
    await userEvent.click(cell(grid, 0, 3))
    await userEvent.click(within(grid).getByRole('combobox', { name: 'План кадра s001' }))
    await userEvent.click(screen.getByRole('option', { name: 'деталь' }))

    await waitFor(() => expect(patches(stub.fetch)).toHaveLength(1), { timeout: 3000 })
    expect(patches(stub.fetch)[0]).toEqual({ shots: { s001: { user_override: { image: { shot_size: 'detail' } } } } })
    await waitFor(() => expect(cell(grid, 0, 3).getAttribute('data-overridden')).toBe('true'), { timeout: 3000 })
    expect(cell(grid, 0, 3).textContent).toBe('деталь')
  })

  test('правка из плана отмечена, в Tooltip — значение версии', async () => {
    const { grid } = await table()
    const voCell = cell(grid, 3, 0)
    expect(voCell.getAttribute('data-overridden')).toBe('true')
    await waitFor(() => {
      cell(grid, 3, 0).focus()
      expect(screen.getByRole('tooltip').textContent).toBe('В плане: Twelve cartridges a trip. Every gun crew counts the seconds.')
    })
  })
})
