// Лист сценария на моке плана «Пиратов» по артборду 3: разделы, номера, VO, правое поле, правка VO с автосохранением.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderApp } from '../../../app/__tests__/harness'
import { autosaver } from '../../../app/autosave'
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
    .map(([url, init]) => ({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) as unknown }))

async function sheet() {
  const app = renderApp('/episodes/pirate/script')
  const root = await screen.findByRole('article', { name: 'Лист сценария' }, { timeout: 3000 })
  return { ...app, root }
}

const row = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-shot="${id}"]`)!
const vo = (root: HTMLElement, id: string) => within(root).getByRole('textbox', { name: `VO кадра ${id}` }) as HTMLTextAreaElement

describe('лист', () => {
  test('шапка, разделы, номера, VO и правое поле; убранных кадров нет', async () => {
    const { root } = await sheet()
    expect(within(root).getByRole('heading', { level: 2 }).textContent).toBe('Cursus — Every Rank on a Pirate Ship')
    expect(within(root).getByText('v003 · 1716–1726')).toBeTruthy()
    expect(within(root).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Cold open',
      'Rank 1: Powder monkey',
      'Rank 2: Landsman',
      'Rank 5: Quartermaster',
    ])
    const ids = [...root.querySelectorAll('[data-shot]')].map((el) => el.getAttribute('data-shot'))
    expect(ids).toEqual(['s001', 's002', 's003', 's004', 's005', 's006', 's061', 's062'])
    expect(vo(root, 's001').value).toBe(
      'You are eleven years old, and the first thing you learn on this ship is where the gunpowder lives.',
    )

    const first = within(row(root, 's001'))
    expect(first.getByText('наезд 1.08×')).toBeTruthy()
    expect(first.getByText('анимация')).toBeTruthy()
    expect(first.getByText('2 SFX')).toBeTruthy()
    expect(first.getByRole('img', { name: 'Статус: готов' })).toBeTruthy()
    expect(within(row(root, 's004')).getByText('панорама →')).toBeTruthy()
    expect(within(row(root, 's061')).queryByText(/SFX/)).toBeNull()
  })

  test('кадр stale — warning-глиф, причины в Tooltip', async () => {
    const { root } = await sheet()
    const glyph = within(row(root, 's006')).getByRole('img', { name: 'Статус: проверить' })
    ;(glyph.parentElement as HTMLElement).focus()
    expect((await screen.findByRole('tooltip')).textContent).toBe('Промпт: добавлено „knee-deep water“')
  })
})

describe('правка VO', () => {
  test('ввод — один PATCH с одним полем через 800 мс, «Сохранено», пометка «правка»', async () => {
    const { root, stub } = await sheet()
    await userEvent.type(vo(root, 's001'), ' Really.')
    expect(patches(stub.fetch)).toHaveLength(0)
    await waitFor(() => expect(patches(stub.fetch)).toHaveLength(1), { timeout: 3000 })
    expect(patches(stub.fetch)[0]).toEqual({
      url: '/api/projects/pirate',
      body: {
        shots: {
          s001: {
            user_override: {
              vo: 'You are eleven years old, and the first thing you learn on this ship is where the gunpowder lives. Really.',
            },
          },
        },
      },
    })
    expect(await screen.findByText(/Сохранено/, {}, { timeout: 3000 })).toBeTruthy()
    expect(await within(row(root, 's001')).findByText('правка')).toBeTruthy()
  })

  test('пустой VO — подпись под полем, запись не уходит', async () => {
    const { root, stub } = await sheet()
    await userEvent.clear(vo(root, 's002'))
    expect(within(row(root, 's002')).getByText('VO не может быть пустым')).toBeTruthy()
    expect(vo(root, 's002').getAttribute('aria-invalid')).toBe('true')
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(patches(stub.fetch)).toHaveLength(0)
  })

  test('«Вернуть из плана» — текст версии сразу, на бэкенд — null', async () => {
    const { root, stub } = await sheet()
    expect(vo(root, 's004').value).toBe('Twelve cartridges a trip, and every gun crew above you counts the seconds you are late.')
    const reset = within(row(root, 's004')).getByRole('button', { name: 'Вернуть из плана' })
    // Значение из плана — из файла версии; кнопка возвращает его, пока запись идёт
    await waitFor(() => {
      reset.focus()
      expect(screen.getByRole('tooltip').textContent).toBe('В плане: Twelve cartridges a trip. Every gun crew counts the seconds.')
    })
    await userEvent.click(reset)
    expect(vo(root, 's004').value).toBe('Twelve cartridges a trip. Every gun crew counts the seconds.')
    await waitFor(() => expect(patches(stub.fetch)).toHaveLength(1), { timeout: 3000 })
    expect(patches(stub.fetch)[0]?.body).toEqual({ shots: { s004: { user_override: { vo: null } } } })
    await waitFor(() => expect(within(row(root, 's004')).queryByText('правка')).toBeNull(), { timeout: 3000 })
  })
})
