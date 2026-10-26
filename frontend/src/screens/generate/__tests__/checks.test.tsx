// Проверки на экране 4 на моках артборда 4 (M6.10): пометки на плитках (лицо s012, s028, s044, анахронизм s019, у
// `no_face` пометки нет) и в статус-строке; «Подозрительные» — четыре кадра по возрастанию сходства, плитка ведёт в
// сравнение версий и обратно; выключатель — PATCH профиля, цена вопроса из сметы, «проверено раньше»; «Перепроверить»
// выбранные — число и сумма из сметы, POST `check` по кадрам, конец перепроверки по SSE снимает пометку; пометки
// ничего не блокируют.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { EffectivePlan } from '@/types/plan'
import type { Project } from '@/types/project'
import { autosaver } from '../../../app/autosave'
import { setPlatform } from '../../../app/keyboard'
import { useUiStore } from '../../../store/uiStore'
import { marksOf, suspects } from '../checks'
import { gridSections, statusNote } from '../grid'
import { INITIAL, artboardApi, calls, openGenerate, shotEvent, stream } from './harness'

beforeEach(() => {
  useUiStore.setState(INITIAL)
  setPlatform('other')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  autosaver.reset()
})

type Call = [string, RequestInit | undefined]
const bodies = (fetch: ReturnType<typeof vi.fn>, method: string, path: string) =>
  (fetch.mock.calls as Call[])
    .filter(([url, init]) => init?.method === method && String(url) === path)
    .map(([, init]) => JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)

const toasts = () => useUiStore.getState().toasts.map((t) => t.message)
const tile = (shot: string) => screen.getByRole('listitem', { name: new RegExp(`^${shot}, `) })
const tileButton = (shot: string) => screen.getByRole('button', { name: `Выбрать ${shot}` })
const warnings = (shot: string) =>
  within(tile(shot))
    .queryAllByRole('img')
    .filter((glyph) => glyph.getAttribute('data-status') === 'warning')
    .map((glyph) => glyph.getAttribute('aria-label'))
const checks = () => screen.getByRole('region', { name: 'Проверка' })
const recheck = () => within(checks()).getByRole('button', { name: /^Перепроверить/ })
const statusBar = () => document.querySelector('footer[role="status"]') as HTMLElement
/** Блок «Проверка» встаёт после канона выпуска */
const checksReady = () => screen.findByRole('region', { name: 'Проверка' }, { timeout: 3000 })

async function shiftClick(user: ReturnType<typeof userEvent.setup>, element: HTMLElement) {
  await user.keyboard('{Shift>}')
  await user.click(element)
  await user.keyboard('{/Shift}')
}

describe('пометки', () => {
  test('на плитках — треугольники с подписью и подсказкой; у no_face пометки нет; в статус-строке — счёт', async () => {
    await openGenerate(artboardApi())
    expect(warnings('s012')).toEqual(['Лицо не похоже на фас (0.21)'])
    expect(warnings('s019')).toEqual(['Анахронизм: wristwatches, zippers'])
    expect(tile('s012').getAttribute('title')).toBe('Лицо не похоже на фас (0.21)')
    expect(warnings('s003')).toEqual([])
    expect(warnings('s002')).toEqual([])
    await waitFor(() => expect(statusBar().textContent).toContain('Кадры 78 из 104, 2 кадра не удались: s047, s071; 3 кадра с непохожим лицом, 1 с анахронизмом'))
  })

  test('пометки ничего не блокируют: помеченный кадр выбирается и перерисовывается, кнопки от пометок не зависят', async () => {
    const user = userEvent.setup()
    await openGenerate(artboardApi())
    await user.click(tileButton('s012'))
    await shiftClick(user, tileButton('s013'))
    expect(tileButton('s012').getAttribute('aria-pressed')).toBe('true')
    const bar = screen.getByRole('region', { name: 'Выбор кадров' })
    await waitFor(() => expect(within(bar).getByRole('button', { name: /^Перерисовать выбранные \(2/ })).toHaveProperty('disabled', false))
    fireEvent.focus(tileButton('s019'))
    expect(within(screen.getByRole('group', { name: 'Действия кадра s019' })).getByRole('button', { name: 'Перерисовать' })).toHaveProperty('disabled', false)
  })
})

describe('«Подозрительные»', () => {
  test('четыре кадра по возрастанию сходства; плитка — сравнение версий; назад — в «Подозрительные» с фокусом', async () => {
    const user = userEvent.setup()
    await openGenerate(artboardApi())
    const view = screen.getByRole('radiogroup', { name: 'Вид экрана' })
    await user.click(within(view).getByRole('radio', { name: 'Подозрительные (4)' }))
    expect(window.location.search).toBe('?view=suspects')
    const first = await screen.findByRole('list', { name: 'Подозрительные: Смотреть первыми' })
    const items = within(first).getAllByRole('listitem')
    expect(items.map((item) => item.getAttribute('data-shot'))).toEqual(['s012', 's028', 's044', 's019'])
    expect(within(items[0]!).getByText('Лицо 0.21')).toBeTruthy()
    expect(within(items[3]!).getByText('Анахронизм: wristwatches, zippers')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Выбор кадров' })).toBeNull()

    await user.click(within(items[0]!).getByRole('button', { name: 'Версии кадра s012' }))
    await screen.findByRole('heading', { name: 'Версии кадра s012' })
    expect(new URLSearchParams(window.location.search).get('from')).toBe('suspects')
    expect(screen.getByRole('button', { name: 'К подозрительным' })).toBeTruthy()
    await user.keyboard('{Escape}')
    await screen.findByRole('list', { name: 'Подозрительные: Смотреть первыми' })
    expect(window.location.search).toBe('?view=suspects')
    await waitFor(() => expect(document.activeElement?.closest('[data-shot]')?.getAttribute('data-shot')).toBe('s012'))
  })
})

describe('выключатель и перепроверка', () => {
  test('выключатель — PATCH профиля, цена вопроса из сметы, тост; старые пометки — «проверено раньше»', async () => {
    const user = userEvent.setup()
    const { stub } = await openGenerate(artboardApi())
    await checksReady()
    const toggle = await within(checks()).findByRole('switch', { name: 'Анахронизмы через VLM (~$0.001 за кадр)' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(within(checks()).getByText('Только пометки, ничего не блокирует')).toBeTruthy()
    await user.click(toggle)
    expect(bodies(stub.fetch, 'PATCH', '/api/channels/cursus')).toEqual([{ checks: { anachronism: false } }])
    await waitFor(() => expect(toasts()).toContain('Проверка анахронизмов выключена: новые кадры не проверяются'))
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(warnings('s019')).toEqual(['Анахронизм: wristwatches, zippers — проверено раньше'])
  })

  test('«Перепроверить (2, ~$0.002)» для выбранных — POST check по кадрам; конец по SSE снимает пометку', async () => {
    const user = userEvent.setup()
    const api = artboardApi()
    const { stub } = await openGenerate(api)
    const emit = stream()
    await checksReady()
    expect(recheck()).toHaveProperty('disabled', true)
    expect(recheck().textContent).toBe('Перепроверить')
    expect(within(checks()).getByText('Перепроверяются кадры, выбранные в сетке — выберите их')).toBeTruthy()

    await user.click(tileButton('s012'))
    await shiftClick(user, tileButton('s013'))
    await waitFor(() => expect(recheck().textContent).toBe('Перепроверить (2, ~$0.002)'))
    expect(within(checks()).getByText('Выбранные в сетке: 2 кадра')).toBeTruthy()
    await user.click(recheck())
    expect(calls(stub.fetch, 'POST', '/api/projects/pirate/shots/').filter((url) => url.endsWith('/check'))).toEqual([
      '/api/projects/pirate/shots/s012/check',
      '/api/projects/pirate/shots/s013/check',
    ])
    await waitFor(() => expect(toasts()).toContain('Перепроверка в очереди: 2 кадра'))

    const job = api.generation.finishCheck('pirate', 's012', {
      face: { status: 'ok', appearances: [{ id: 'you@powder-monkey-11', status: 'ok', score: 0.7 }], faces: 1, threshold: 0.47, checked_at: '2026-09-11T10:00:00+00:00' },
    })!
    emit('job.done', shotEvent('s012', 'done', { job_id: job.id, batch_id: null, kind: 'shot_check' }))
    await waitFor(() => expect(warnings('s012')).toEqual([]), { timeout: 3000 })
    await waitFor(() => expect(statusBar().textContent).toContain('2 кадра с непохожим лицом, 1 с анахронизмом'))
  })

  test('кадр без картинки — в подсказке; без VLM перепроверка бесплатна — без цены', async () => {
    const user = userEvent.setup()
    const api = artboardApi()
    api.handle('PATCH', '/api/channels/cursus', { checks: { anachronism: false } })
    await openGenerate(api)
    await user.click(tileButton('s046'))
    await shiftClick(user, tileButton('s047'))
    await waitFor(() => expect(recheck().textContent).toBe('Перепроверить (1)'))
    expect(within(checks()).getByText('Не встанут: 1 кадр — У кадра s047 ещё нет картинок — сначала сгенерируйте кадр.')).toBeTruthy()
    expect(within(checks()).getByRole('switch', { name: 'Анахронизмы через VLM (~$0.001 за кадр)' }).getAttribute('aria-checked')).toBe('false')
  })
})

describe('checks.ts', () => {
  test('пометки выбранной версии: low — худшее сходство, suspect — найденное; no_face и off — не пометки', () => {
    const face = (status: 'ok' | 'low' | 'no_face', scores: (number | null)[]) => ({
      status,
      appearances: scores.map((score, i) => ({ id: `a${i}`, status: score === null ? ('no_face' as const) : score < 0.47 ? ('low' as const) : ('ok' as const), score })),
      faces: scores.length,
      threshold: 0.47,
      checked_at: '',
    })
    const asset = (checks: object) => ({ checks }) as Parameters<typeof marksOf>[0]
    expect(marksOf(asset({ face: face('low', [0.71, 0.33]) }))).toEqual({ face: { score: 0.33 }, found: [], score: 0.33 })
    expect(marksOf(asset({ face: face('ok', [0.62]) }))).toEqual({ face: null, found: [], score: 0.62 })
    expect(marksOf(asset({ face: face('no_face', [null]) }))).toEqual({ face: null, found: [], score: null })
    expect(marksOf(asset({ anachronism: { status: 'suspect', found: ['zipper'], checked_at: '' } })).found).toEqual(['zipper'])
    expect(marksOf(asset({ anachronism: { status: 'off', found: [], checked_at: '' } })).found).toEqual([])
    expect(marksOf(undefined)).toEqual({ face: null, found: [], score: null })
  })

  test('сортировка: меньше сходство — выше, без сходства — в конце по порядку плана; статус-строка без лиц', () => {
    const shots = ['s1', 's2', 's3', 's4']
    const plan = {
      sections: [{ id: 'r1', title: 'Раздел', chapter: true, vo_direction: null }],
      shots: shots.map((id) => ({ id, section: 'r1', status: 'done', stale_reasons: [] })),
    } as unknown as EffectivePlan
    const asset = (shot: string, checks: object) => ({ id: `img-${shot}-v1`, shot_id: shot, kind: 'image', version: 1, checks })
    const project = {
      shots: Object.fromEntries(shots.map((id) => [id, { status: 'done', image_version: 1, stale_reasons: [] }])),
      assets: {
        a1: asset('s1', { anachronism: { status: 'suspect', found: ['zipper'], checked_at: '' } }),
        a2: asset('s2', { anachronism: { status: 'suspect', found: ['plastic'], checked_at: '' } }),
        a3: asset('s3', { face: { status: 'low', appearances: [{ id: 'a', status: 'low', score: 0.4 }], faces: 1, checked_at: '' } }),
        a4: asset('s4', {}),
      },
    } as unknown as Project
    const sections = gridSections(plan, project)
    expect(suspects(sections).map((item) => item.shot.id)).toEqual(['s3', 's1', 's2'])
    expect(statusNote(sections)).toBe('Кадры 4 из 4, 1 кадр с непохожим лицом, 2 с анахронизмом')
    delete (project.assets as Record<string, unknown>).a3
    expect(statusNote(gridSections(plan, project))).toBe('Кадры 4 из 4, 2 кадра с анахронизмом')
  })
})
