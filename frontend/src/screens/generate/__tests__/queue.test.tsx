// Полоса очередей экрана 4 на моках пачки артборда 4: «Кадры: 78 из 104», остаток, смета, «параллельно 3 запроса»,
// ошибки, прогресс из двух частей; пауза и продолжение шлют свои запросы и переживают перезагрузку; отмена — только
// через подтверждение; событие SSE `batch.updated` двигает полосу без перезапроса сводки; голос — заглушка M7.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { BatchSummary } from '@/types/batch'
import { autosaver } from '../../../app/autosave'
import { setPlatform } from '../../../app/keyboard'
import { GEN_BATCH } from '../../../mocks/api'
import { useUiStore } from '../../../store/uiStore'
import { INITIAL, artboardApi, calls, openGenerate, stream, strip } from './harness'

beforeEach(() => {
  useUiStore.setState(INITIAL)
  setPlatform('other')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  autosaver.reset()
})

const toasts = () => useUiStore.getState().toasts.map((t) => t.message)
const BATCH = `/api/batches/${GEN_BATCH}`

async function openStrip(api = artboardApi()) {
  const app = await openGenerate(api)
  await within(strip()).findByText('Кадры: 78 из 104', undefined, { timeout: 3000 })
  return app
}

describe('полоса очередей', () => {
  test('пачка артборда: готово, остаток, смета, параллельно, ошибки; прогресс — готово белым и рисуется штриховкой', async () => {
    await openStrip()
    const track = strip()
    expect(within(track).getByText('осталось ~9 мин').className).toContain('text-generating')
    expect(track.textContent).toContain('$5.23 из $6.97 по смете')
    expect(within(track).getByText('параллельно 3 запроса')).toBeTruthy()
    expect(within(track).getByText('2 ошибки').className).toContain('text-failed-text')
    const bar = within(track).getByRole('progressbar', { name: 'Кадры пачки' })
    expect(bar.getAttribute('aria-valuenow')).toBe('75')
    const done = bar.querySelector<HTMLElement>('[data-part="done"]')!
    const running = bar.querySelector<HTMLElement>('[data-part="running"]')!
    expect(done.style.width).toBe('75%')
    expect(done.className).toContain('bg-ink')
    expect(parseFloat(running.style.width)).toBeCloseTo((3 / 104) * 100, 5)
    expect(running.className).toContain('animate-[ui-hatch')
    expect(within(track).getAllByRole('img')[0]!.dataset.status).toBe('generating')
    expect(within(track).getByText('Голос — модуль M7')).toBeTruthy()
  })

  test('пауза → POST pause, «на паузе» и треугольник; после перезагрузки — то же; «Продолжить» → resume', async () => {
    const api = artboardApi()
    const { stub, unmount } = await openStrip(api)
    await userEvent.click(within(strip()).getByRole('button', { name: 'Пауза' }))
    expect(calls(stub.fetch, 'POST', `${BATCH}/pause`)).toHaveLength(1)
    const paused = await within(strip()).findByText('на паузе')
    expect(paused.className).toContain('text-warning')
    expect(within(strip()).getAllByRole('img')[0]!.dataset.status).toBe('warning')
    expect(strip().querySelector('[data-part="running"]')!.className).toContain('bg-warning')
    expect(toasts()).toContain('Очередь на паузе')

    // Перезагрузка страницы: тот же бэкенд (мок), свой кэш — пауза пришла из сводки пачки
    unmount()
    cleanup()
    const again = await openStrip(api)
    expect(within(strip()).getByText('на паузе')).toBeTruthy()
    await userEvent.click(within(strip()).getByRole('button', { name: 'Продолжить' }))
    expect(calls(again.stub.fetch, 'POST', `${BATCH}/resume`)).toHaveLength(1)
    await within(strip()).findByText('осталось ~9 мин')
    expect(toasts()).toContain('Очередь продолжена')
  })

  test('отмена — только через подтверждение: «Не отменять» ничего не шлёт; «Отменить очередь» — кадры очереди к своему статусу', async () => {
    const { stub } = await openStrip()
    await userEvent.click(within(strip()).getByRole('button', { name: 'Отменить очередь' }))
    let dialog = screen.getByRole('dialog', { name: 'Отменить очередь' })
    expect(dialog.textContent).toContain('Кадры из очереди (21) не будут нарисованы. Начатые кадры дорисуются (3).')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Не отменять' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls(stub.fetch, 'POST', `${BATCH}/cancel`)).toEqual([])

    await userEvent.click(within(strip()).getByRole('button', { name: 'Отменить очередь' }))
    dialog = screen.getByRole('dialog', { name: 'Отменить очередь' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отменить очередь' }))
    expect(calls(stub.fetch, 'POST', `${BATCH}/cancel`)).toHaveLength(1)
    await within(strip()).findByText('отменена, начатые дорисовываются')
    expect(within(strip()).queryByRole('button', { name: 'Пауза' })).toBeNull()
    expect(within(strip()).queryByRole('button', { name: 'Отменить очередь' })).toBeNull()
    expect(within(strip()).getByText('2 ошибки, отменено 21')).toBeTruthy()
    expect(toasts()).toContain('Очередь отменена, начатые кадры дорисуются')
    // Кадры из очереди — снова без работы; начатые дорисовываются
    await waitFor(() => expect(screen.getByRole('listitem', { name: 's084, не нарисован' })).toBeTruthy())
    expect(screen.getByRole('listitem', { name: 's081, рисуется' })).toBeTruthy()
  })

  test('batch.updated по SSE двигает полосу без перезапроса сводки', async () => {
    const { stub } = await openStrip()
    const emit = stream()
    const before = calls(stub.fetch, 'GET', BATCH).length
    const summary: BatchSummary = {
      id: GEN_BATCH,
      episode_id: 'pirate',
      kind: 'shot_image',
      model: 'nb2',
      created_at: '2026-09-11T09:00:00+00:00',
      paused: false,
      cancelled: false,
      retry_of: null,
      jobs: { total: 104, queued: 20, running: 2, done: 80, failed: 2, cancelled: 0 },
      finished: false,
      estimate: { usd_micro: 6_968_000, usd: '$6.97' },
      spent: { usd_micro: 5_360_000, usd: '$5.36' },
      eta_s: 480,
    }
    emit('batch.updated', summary)
    await within(strip()).findByText('Кадры: 80 из 104')
    expect(within(strip()).getByText('осталось ~8 мин')).toBeTruthy()
    expect(within(strip()).getByText('параллельно 2 запроса')).toBeTruthy()
    expect(strip().textContent).toContain('$5.36 из $6.97 по смете')
    expect(calls(stub.fetch, 'GET', BATCH)).toHaveLength(before)

    emit('batch.updated', { ...summary, jobs: { ...summary.jobs, queued: 0, running: 0, done: 102 }, finished: true, eta_s: null })
    await within(strip()).findByText('Кадры: 102 из 104')
    expect(within(strip()).getByText('готово')).toBeTruthy()
    expect(within(strip()).queryByRole('button', { name: 'Пауза' })).toBeNull()
    // Пачка кончилась с ошибками — глиф предупреждения
    expect(within(strip()).getAllByRole('img')[0]!.dataset.status).toBe('warning')
  })
})
