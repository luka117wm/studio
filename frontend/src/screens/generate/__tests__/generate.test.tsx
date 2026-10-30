// Экран 4 на моках API: план не утверждён — объяснение со ссылкой на экран 3; утверждён без картинок —
// «Сгенерировать 104 кадра (~$6.97)» по смете бэкенда, постановка пачки, отказ бюджета текстом, пропущенные кадры;
// сетка «Пиратов» артборда 4 — 104 плитки в 8 разделах, шапка и строка экрана; канон выпуска; ⌥1 / ⌥3; «Голос» без
// действий.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { autosaver } from '../../../app/autosave'
import { setPlatform } from '../../../app/keyboard'
import { createMockApi } from '../../../mocks/api'
import { useUiStore } from '../../../store/uiStore'
import { INITIAL, artboardApi, calls, openGenerate, strip } from './harness'

beforeEach(() => {
  useUiStore.setState(INITIAL)
  setPlatform('other')
})
// Сначала размонтировать, потом снять фейки (L-024)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  autosaver.reset()
})

const toasts = () => useUiStore.getState().toasts.map((t) => t.message)
const statusBar = () => document.querySelector('footer[role="status"]')!
const tiles = () => within(screen.getByTestId('shot-grid')).getAllByRole('listitem')

describe('до первой пачки', () => {
  test('план не утверждён — объяснение и «Открыть сценарий», сметы и сетки нет', async () => {
    const { stub } = await openGenerate(createMockApi(), () => screen.findByRole('heading', { name: 'План не утверждён' }, { timeout: 3000 }))
    expect(screen.getByText(/Генерация начнётся после «Утвердить план»/)).toBeTruthy()
    expect(calls(stub.fetch, 'GET', '/api/projects/pirate/generate/estimate')).toEqual([])
    expect(screen.queryByTestId('shot-grid')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Открыть сценарий' }))
    expect(window.location.pathname).toBe('/episodes/pirate/script')
  })

  test('«Сгенерировать 104 кадра (~$6.97)» — цена из сметы; клик ставит пачку, сетка и полоса — её', async () => {
    const { stub, api } = await openGenerate(artboardApi(false), () =>
      screen.findByRole('button', { name: /^Сгенерировать/ }, { timeout: 3000 }),
    )
    const button = screen.getByRole('button', { name: /^Сгенерировать/ })
    expect(button.textContent).toBe('Сгенерировать 104 кадра (~$6.97)')
    expect(within(strip()).getByText('Кадры: очередь пуста')).toBeTruthy()

    await userEvent.click(button)
    expect(calls(stub.fetch, 'POST', '/api/projects/pirate/generate')).toHaveLength(1)
    await within(strip()).findByText('Кадры: 0 из 104', undefined, { timeout: 3000 })
    await waitFor(() => expect(tiles()).toHaveLength(104))
    expect(tiles().every((tile) => tile.dataset.status === 'queued')).toBe(true)
    expect(toasts()).toContain('В очереди 104 кадра')
    expect(api.generation.batches.size).toBe(1)
    // Незаконченная пачка — второй кнопки «Сгенерировать» в шапке нет
    expect(screen.queryByRole('button', { name: /^Сгенерировать/ })).toBeNull()
  })

  test('отказ бюджета — текст бэкенда под кнопкой, пачки и джобов нет', async () => {
    const api = artboardApi(false)
    api.canon.monthlyLimit.cursus = 65_000_000
    await openGenerate(api, () => screen.findByRole('button', { name: /^Сгенерировать/ }, { timeout: 3000 }))
    await userEvent.click(screen.getByRole('button', { name: /^Сгенерировать/ }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/^Месячный лимит \$65: потрачено .+, операция — \$6\.97/)
    expect(api.generation.batches.size).toBe(0)
    expect(api.generation.jobs).toHaveLength(0)
  })

  test('кадры, которые пачка пропустит, — число в кнопке без них и подпись с первой причиной', async () => {
    const api = artboardApi(false)
    const reason = 'у облика you@quartermaster-41 нет листа опорных портретов — соберите его на экране «Канон»'
    api.generation.skipped.push({ shot_id: 's062', reason, problems: [] })
    await openGenerate(api, () => screen.findByRole('button', { name: /^Сгенерировать/ }, { timeout: 3000 }))
    expect(screen.getByRole('button', { name: /^Сгенерировать/ }).textContent).toBe('Сгенерировать 103 кадра (~$6.90)')
    expect(screen.getByText(`Не встанут в очередь: 1 кадр — ${reason}`)).toBeTruthy()
  })
})

describe('сетка «Пиратов» артборда 4', () => {
  test('104 плитки в 8 разделах; шапка «104 кадра, 8 разделов»; строка экрана — готовые и сбои', async () => {
    await openGenerate(artboardApi())
    const sections = within(screen.getByTestId('shot-grid')).getAllByRole('region')
    expect(sections.map((section) => section.getAttribute('aria-label'))).toEqual([
      'Cold open',
      'Powder monkey',
      'Landsman',
      'Able seaman',
      'Boatswain',
      'Quartermaster',
      'Captain',
      'Outro',
    ])
    expect(tiles()).toHaveLength(104)
    expect(screen.getByText('104 кадра, 8 разделов')).toBeTruthy()
    await waitFor(() => expect(statusBar().textContent).toContain('Кадры 78 из 104, 2 кадра не удались: s047, s071'))
  })

  test('канон выпуска только для чтения: стиль и эпоха с версиями, облики с листами, «Открыть канон»', async () => {
    await openGenerate(artboardApi())
    const panel = screen.getByRole('complementary', { name: 'Канон выпуска' })
    expect(within(panel).getByText('только чтение')).toBeTruthy()
    const looks = await within(panel).findByRole('region', { name: 'Облики персонажей' }, { timeout: 3000 })
    const rows = within(looks).getAllByRole('listitem')
    expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual([
      'you@powder-monkey-11',
      'you@landsman-19',
      'you@able-seaman-23',
      'you@boatswain-34',
      'you@quartermaster-41',
    ])
    expect(within(rows[0]!).getByText('лист опорных портретов готов')).toBeTruthy()
    expect(within(rows[3]!).getByText('лист 3/6').className).toContain('text-warning')
    // Листа нет — пунктир warning вместо фаса и «лист не собран»
    expect(within(rows[4]!).getByText('лист не собран').className).toContain('text-warning')
    expect(rows[4]!.querySelector('.border-dashed')).not.toBeNull()
    await waitFor(() => expect(rows[0]!.querySelector('img')?.getAttribute('src')).toMatch(/\/anchors\/you%40powder-monkey-11\/.+\/thumb\?w=160$/))
    expect(within(panel).getByText('Стиль канала')).toBeTruthy()
    expect(within(panel).getByText('Период выпуска')).toBeTruthy()
    expect(within(panel).getByText('Правка облика меняет опорные портреты и требует перерисовки затронутых кадров.')).toBeTruthy()
    await userEvent.click(within(panel).getByRole('link', { name: 'Открыть канон' }))
    expect(window.location.pathname).toBe('/canon')
  })

  test('⌥1 и ⌥3 свёртывают канон и голос; у «Голоса» нет действий, кроме свёртки', async () => {
    await openGenerate(artboardApi())
    const voice = screen.getByRole('complementary', { name: 'Голос' })
    expect(within(voice).getByText('Голос — в модуле M7')).toBeTruthy()
    // Кнопки панели — только свёртка (и полоса узкого окна, скрытая стилем ниже 1280): действий голоса нет
    expect(within(voice).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Свернуть: Голос (Alt3)', 'Развернуть: Голос (Alt3)'])
    await userEvent.keyboard('{Alt>}1{/Alt}')
    expect(useUiStore.getState().collapsed.left).toBe(true)
    expect(screen.getByRole('complementary', { name: 'Канон выпуска' }).dataset.collapsed).toBe('true')
    await userEvent.keyboard('{Alt>}3{/Alt}')
    expect(useUiStore.getState().collapsed.right).toBe(true)
    expect(screen.getByRole('complementary', { name: 'Голос' }).dataset.collapsed).toBe('true')
  })
})
