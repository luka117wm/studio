// Экран 12, лист опорных портретов облика на моках API: открытие с карточки и по адресу, Esc и «←», шесть ракурсов с
// миниатюрами 320, выбор и отбраковка одной записью, перегенерация ракурса с ценой и тостом, сборка листа по фейковому
// SSE (прогресс на ракурсе и общий, сбой кандидата, «Отменить»), устаревание целиком и по одежде, отказ бюджета.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Character } from '@/types/canon'
import type { JobEventData } from '@/types/job'
import { FakeEventSource, stubApi } from '../../../api/__tests__/fakes'
import { renderApp } from '../../../app/__tests__/harness'
import { autosaver } from '../../../app/autosave'
import { setPlatform } from '../../../app/keyboard'
import { createMockApi, mockCandidate, type MockApi } from '../../../mocks/api'
import { useUiStore } from '../../../store/uiStore'

const INITIAL = { channel: 'cursus' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [], save: { kind: 'idle' as const } }

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

type Call = [string, RequestInit | undefined]
const calls = (fetch: ReturnType<typeof vi.fn>, method: string, path?: string) =>
  (fetch.mock.calls as Call[])
    .filter(([url, init]) => (init?.method ?? 'GET') === method && (!path || String(url).startsWith(path)))
    .map(([url, init]) => ({ url: String(url), body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined }))

const toasts = () => useUiStore.getState().toasts.map((t) => t.message)
const BASE = '/api/canon/cursus/appearances'
const ANGLES = ['Фас', 'Три четверти', 'Профиль', 'В полный рост', 'В действии', 'Деталь']

async function openSheet(appearance: string, api: MockApi = createMockApi()) {
  const stub = stubApi(api)
  const character = appearance.split('@')[0]!
  const app = renderApp(`/canon?layer=characters&character=${character}&sheet=${encodeURIComponent(appearance)}`, { stub })
  const sheet = await screen.findByRole('dialog', { name: /^Лист опорных портретов/ }, { timeout: 3000 })
  await within(sheet).findByRole('region', { name: 'Фас' }, { timeout: 3000 })
  return { ...app, sheet, api }
}

const angle = (sheet: HTMLElement, label: string) => within(sheet).getByRole('region', { name: label })
const candidates = (sheet: HTMLElement, label: string) => within(angle(sheet, label)).getByRole('list', { name: `Кандидаты: ${label}` })
const idsOf = (api: MockApi, appearance: string, slot: string) => api.canon.sheets.cursus.get(appearance)!.candidates.filter((c) => c.slot === slot).map((c) => c.id)

const event = (job_id: string, kind: string, status: JobEventData['status'], progress: number, message: string | null): JobEventData => ({
  job_id,
  kind,
  status,
  progress,
  message,
  attempts: 1,
  cancel_requested: false,
  episode_id: null,
  batch_id: null,
  channel: 'cursus',
  error: null,
})

/** Поток SSE приложения открыт: события джобов листа идут через него */
function stream() {
  const source = FakeEventSource.last()
  act(() => source.open())
  let id = 1200
  return (type: 'job.progress' | 'job.done' | 'job.cancelled', data: JobEventData) => {
    id += 1
    act(() => source.emit(type, data, id))
  }
}

describe('лист опорных портретов', () => {
  test('открывается с карточки облика: шапка, шесть ракурсов, миниатюры 320; Esc и «←» закрывают', async () => {
    renderApp('/canon?layer=characters&character=you', { stub: stubApi() })
    const form = await screen.findByRole('form', { name: 'Персонаж' }, { timeout: 3000 })
    const title = 'You · пороховая обезьяна · 11 лет · Карибы 1716'
    const card = within(within(form).getByRole('list', { name: 'Облики персонажа' })).getByRole('button', { name: title })
    await waitFor(() => expect(card.querySelector('img')?.getAttribute('src')).toMatch(/\/anchors\/you%40powder-monkey-11\/front-1-[0-9a-f]{16}\/thumb\?w=320$/))

    await userEvent.click(card)
    const sheet = await screen.findByRole('dialog', { name: `Лист опорных портретов: ${title}` })
    expect(window.location.search).toContain('sheet=you%40powder-monkey-11')
    expect(window.location.search).toContain('appearance=you%40powder-monkey-11')
    expect(within(sheet).getByRole('heading', { level: 2 }).textContent).toBe('Лист опорных портретов')
    expect(await within(sheet).findByText('готов 6/6')).toBeTruthy()
    await waitFor(() => expect(within(sheet).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(ANGLES))
    expect(angle(sheet, 'Фас').textContent).toContain('лицо прямо, нейтральный свет')
    expect(within(sheet).getByText('Готово 6 из 6 ракурсов, выбрано по одному кандидату в каждом')).toBeTruthy()
    expect(within(sheet).getByText('Опорные портреты подаются в каждый кадр с этим персонажем — от них зависит, останется ли он собой.')).toBeTruthy()
    expect(await within(sheet).findByRole('button', { name: 'Собрать лист (6 ракурсов × 2 кандидата, ~$1.61)' })).toBeTruthy()

    // В сетке — только миниатюры 320 по id кандидата, полноразмерных файлов нет (принцип 12)
    const sources = [...sheet.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '')
    expect(sources).toHaveLength(12)
    expect(sources.every((src) => /^\/api\/canon\/cursus\/anchors\/you%40powder-monkey-11\/[a-z_]+-\d-[0-9a-f]{16}\/thumb\?w=320$/.test(src))).toBe(true)
    const front = within(candidates(sheet, 'Фас')).getAllByRole('button', { name: /^Фас, кандидат/ })
    expect(front.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false'])

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Лист опорных портретов/ })).toBeNull())
    expect(window.location.search).not.toContain('sheet=')
    expect(document.activeElement).toBe(card) // фокус — обратно на карточку
    expect(within(form).getByRole('region', { name: 'Облик you@powder-monkey-11' })).toBeTruthy()

    await userEvent.click(card)
    const again = await screen.findByRole('dialog', { name: `Лист опорных портретов: ${title}` })
    await userEvent.click(within(again).getByRole('button', { name: 'Назад к персонажу' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Лист опорных портретов/ })).toBeNull())
  })

  test('по адресу `?sheet=` — тот же лист после перезагрузки; выбор кандидата — одна запись, карточка видит его сразу', async () => {
    const api = createMockApi()
    const look = 'you@boatswain-34'
    const sheetState = api.canon.sheets.cursus.get(look)!
    for (const slot of ['full_body', 'in_action', 'detail']) sheetState.candidates.push(mockCandidate(look, 'v002', slot, 1), mockCandidate(look, 'v002', slot, 2))
    const { sheet, stub } = await openSheet(look, api)
    expect(await within(sheet).findByText('собран наполовину 3/6')).toBeTruthy()
    expect(within(sheet).getByText('Готово 3 из 6 ракурсов, выбрано по одному кандидату в каждом')).toBeTruthy()

    const second = idsOf(api, look, 'full_body')[1]!
    await userEvent.click(within(candidates(sheet, 'В полный рост')).getByRole('button', { name: 'В полный рост, кандидат 2' }))
    await waitFor(() => expect(within(candidates(sheet, 'В полный рост')).getByRole('button', { name: 'В полный рост, кандидат 2' }).getAttribute('aria-pressed')).toBe('true'))
    expect(calls(stub.fetch, 'POST', BASE)).toEqual([{ url: `${BASE}/you%40boatswain-34/anchors/full_body/choose`, body: { candidate: second } }])
    expect(api.canon.sheets.cursus.get(look)!.chosen.full_body).toBe(second)

    await userEvent.click(within(candidates(sheet, 'В действии')).getByRole('button', { name: 'В действии, кандидат 1' }))
    await userEvent.click(within(candidates(sheet, 'Деталь')).getByRole('button', { name: 'Деталь, кандидат 1' }))
    expect(await within(sheet).findByText('готов 6/6')).toBeTruthy()
    expect(calls(stub.fetch, 'POST', BASE)).toHaveLength(3)

    await userEvent.keyboard('{Escape}')
    const form = await screen.findByRole('form', { name: 'Персонаж' })
    const card = within(within(form).getByRole('list', { name: 'Облики персонажа' })).getByRole('button', { name: 'You · боцман · 34 года · Карибы 1716' })
    expect(card.textContent).toContain('готов 6/6')
    expect(card.querySelector('img')?.getAttribute('src')).toContain(`/anchors/you%40boatswain-34/${idsOf(api, look, 'front')[0]}/thumb?w=320`)
    await waitFor(() => expect(within(form).getByRole('region', { name: 'Облики' }).textContent).toContain('4 листа готово'))
  })

  test('отбраковка: кандидат уходит в «Отбракованные» и виден там, выбранного не отбраковать', async () => {
    const look = 'you@powder-monkey-11'
    const { sheet, stub, api } = await openSheet(look)
    const [first, second] = idsOf(api, look, 'profile')
    const list = candidates(sheet, 'Профиль')
    const chosen = within(within(list).getByRole('listitem', { name: 'Кандидат 1' })).getByRole('button', { name: 'Отбраковать' })
    expect((chosen as HTMLButtonElement).disabled).toBe(true)
    expect(chosen.getAttribute('title')).toBe('Выбранного не отбраковать — сначала выберите другого')

    await userEvent.click(within(within(list).getByRole('listitem', { name: 'Кандидат 2' })).getByRole('button', { name: 'Отбраковать' }))
    await waitFor(() => expect(within(candidates(sheet, 'Профиль')).queryByRole('listitem', { name: 'Кандидат 2' })).toBeNull())
    expect(calls(stub.fetch, 'POST', BASE)).toEqual([{ url: `${BASE}/you%40powder-monkey-11/anchors/profile/reject`, body: { candidate: second } }])
    expect(api.canon.sheets.cursus.get(look)!.candidates.find((c) => c.id === second)?.status).toBe('rejected')
    expect(api.canon.sheets.cursus.get(look)!.chosen.profile).toBe(first)

    const toggle = within(angle(sheet, 'Профиль')).getByRole('button', { name: 'Отбракованные (1)' })
    await userEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const kept = within(angle(sheet, 'Профиль')).getByRole('listitem', { name: 'Кандидат 2, отбракован' })
    expect(kept.querySelector('img')?.getAttribute('src')).toBe(`/api/canon/cursus/anchors/you%40powder-monkey-11/${second}/thumb?w=320`)
  })

  test('перегенерация ракурса: цена до клика, на время джоба сборки недоступны, конец — тост со списанной суммой', async () => {
    const { sheet, stub } = await openSheet('you@powder-monkey-11')
    const regenerate = await within(angle(sheet, 'Профиль')).findByRole('button', { name: 'Перегенерировать ракурс (~$0.27)' })
    await userEvent.click(regenerate)
    await waitFor(() => expect(calls(stub.fetch, 'POST', BASE).map((c) => c.url)).toEqual([`${BASE}/you%40powder-monkey-11/anchors/profile/regenerate`]))
    const progress = await within(sheet).findByLabelText('Сборка листа')
    expect(progress.textContent).toContain('В очереди')
    await waitFor(() => expect((within(angle(sheet, 'Фас')).getByRole('button', { name: /^Перегенерировать ракурс/ }) as HTMLButtonElement).disabled).toBe(true))
    expect((within(sheet).getByRole('button', { name: /^Собрать лист/ }) as HTMLButtonElement).disabled).toBe(true)

    const emit = stream()
    emit('job.progress', event('job-anchor-angle-1', 'anchor_angle', 'running', 0.5, 'Кандидат 2 из 2 · Профиль, 4'))
    await waitFor(() => expect(angle(sheet, 'Профиль').textContent).toContain('Нарисовано 1 из 2'))
    expect(within(sheet).getByLabelText('Сборка листа').textContent).toContain('50%')
    emit('job.done', event('job-anchor-angle-1', 'anchor_angle', 'done', 1, 'Готово 2 из 2: сбоев 0'))
    await waitFor(() => expect(toasts()).toContain('Ракурс «профиль» перегенерирован, списано $0.27'))
    await waitFor(() => expect(within(sheet).queryByLabelText('Сборка листа')).toBeNull())
    // Новые кандидаты — в листе, номера следующие
    await waitFor(() => expect(within(candidates(sheet, 'Профиль')).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Кандидат 1', 'Кандидат 2', 'Кандидат 3', 'Кандидат 4']))
  })

  test('сборка листа по SSE: прогресс на ракурсе и общий, сбой кандидата с текстом, «Отменить» — отмена джоба', async () => {
    const look = 'you@quartermaster-41'
    const { sheet, stub, api } = await openSheet(look)
    expect(await within(sheet).findByText('не собран')).toBeTruthy()
    expect(within(sheet).getByText('Ни одного ракурса: кадры с этим обликом не генерируются')).toBeTruthy()
    expect(within(candidates(sheet, 'Фас')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['кандидат 1', 'кандидат 2'])

    await userEvent.click(await within(sheet).findByRole('button', { name: 'Собрать лист (6 ракурсов × 2 кандидата, ~$1.61)' }))
    await waitFor(() => expect(calls(stub.fetch, 'POST', BASE).map((c) => c.url)).toEqual([`${BASE}/you%40quartermaster-41/anchors`]))
    expect((await within(sheet).findByLabelText('Сборка листа')).textContent).toContain('В очереди')

    // Как у бэкенда: нарисованы три кандидата, третий фас не удался — остальные идут
    const drawn = api.canon.sheets.cursus.get(look)!
    const all = [...drawn.candidates]
    drawn.candidates = all.slice(0, 3)
    const refusal = 'Gemini не нарисовал картинку (IMAGE_SAFETY) — сработал фильтр безопасности.'
    drawn.candidates[2] = { ...drawn.candidates[2]!, status: 'failed', error: refusal }

    const emit = stream()
    emit('job.progress', event('job-anchor-sheet-1', 'anchor_sheet', 'running', 0.25, 'Кандидат 4 из 12 · Три четверти, 2'))
    await waitFor(() => expect(within(sheet).getByLabelText('Сборка листа').textContent).toContain('Кандидат 4 из 12 · Три четверти, 2'))
    expect(within(sheet).getByLabelText('Сборка листа').textContent).toContain('25%')
    expect(angle(sheet, 'Фас').textContent).toContain('Нарисовано 2 из 2')
    expect(angle(sheet, 'Три четверти').textContent).toContain('Нарисовано 1 из 2')
    expect(angle(sheet, 'Три четверти').getAttribute('data-status')).toBe('generating')
    await waitFor(() => expect(within(candidates(sheet, 'Три четверти')).getByRole('listitem', { name: 'Кандидат 1' }).textContent).toContain(refusal))
    expect(candidates(sheet, 'Три четверти').querySelector('[data-state="drawing"]')).toBeTruthy()
    expect(candidates(sheet, 'Профиль').querySelectorAll('[data-state="waiting"]')).toHaveLength(2)

    await userEvent.click(within(sheet).getByRole('button', { name: 'Отменить' }))
    await waitFor(() => expect(calls(stub.fetch, 'POST', '/api/jobs')).toEqual([{ url: '/api/jobs/job-anchor-sheet-1/cancel', body: undefined }]))
    emit('job.cancelled', event('job-anchor-sheet-1', 'anchor_sheet', 'cancelled', 0.25, 'Кандидат 4 из 12 · Три четверти, 2'))
    await waitFor(() => expect(toasts()).toContain('Сборка листа отменена, списано $1.61'))
    await waitFor(() => expect(within(sheet).queryByLabelText('Сборка листа')).toBeNull())
  })

  test('лист устарел целиком (другое лицо): баннер с причиной от бэкенда, «Пересобрать лист (6, ~$1.61)», тост', async () => {
    const { sheet, stub } = await openSheet('captain@caribbean-1716')
    const banner = await within(sheet).findByRole('note', { name: 'Лист устарел' })
    expect(banner.textContent).toContain('Лист устарел, пересоберите')
    expect(banner.textContent).toContain('Лист устарел: в v002 изменились nature.face — пересоберите лист.')
    expect(within(sheet).getByText('устарел 6/6')).toBeTruthy()
    expect(within(sheet).getAllByRole('region').map((r) => r.getAttribute('data-status'))).toEqual(Array(6).fill('warning'))

    await userEvent.click(await within(banner).findByRole('button', { name: 'Пересобрать лист (6, ~$1.61)' }))
    await waitFor(() => expect(calls(stub.fetch, 'POST', BASE).map((c) => c.url)).toEqual([`${BASE}/captain%40caribbean-1716/anchors`]))
    const emit = stream()
    emit('job.done', event('job-anchor-sheet-1', 'anchor_sheet', 'done', 1, 'Готово 12 из 12: сбоев 0'))
    await waitFor(() => expect(toasts()).toContain('Лист собран, списано $1.61'))
  })

  test('сменилась одежда: «Достаточно пересобрать…» и «Пересобрать 3 ракурса (~$0.80)» — один джоб на устаревшие', async () => {
    const api = createMockApi()
    const you = api.canon.characters.cursus.get('you')!
    const last = you.versions.at(-1)!.data
    const data: Character = {
      ...last,
      appearances: last.appearances.map((a) => (a.id === 'you@powder-monkey-11' ? { ...a, clothing: 'Canvas breeches, check shirt, barefoot' } : a)),
    }
    you.versions.push({ info: { version: 'v003', based_on: 'v002', published_at: '2026-10-01T09:00:00+00:00' }, data })

    const { sheet, stub } = await openSheet('you@powder-monkey-11', api)
    const banner = await within(sheet).findByRole('note', { name: 'Лист устарел' })
    expect(banner.textContent).toContain('Достаточно пересобрать: в полный рост, в действии, деталь')
    expect(banner.textContent).toContain('Устарели ракурсы «В полный рост», «В действии», «Деталь»: в v003 изменились clothing — перегенерируйте их.')
    expect(within(sheet).getAllByRole('region').map((r) => r.getAttribute('data-status'))).toEqual(['ready', 'ready', 'ready', 'warning', 'warning', 'warning'])

    await userEvent.click(await within(banner).findByRole('button', { name: 'Пересобрать 3 ракурса (~$0.80)' }))
    await waitFor(() => expect(calls(stub.fetch, 'POST', BASE).map((c) => c.url)).toEqual([`${BASE}/you%40powder-monkey-11/anchors/stale`]))
    const emit = stream()
    emit('job.done', event('job-anchor-angle-1', 'anchor_angle', 'done', 1, 'Готово 6 из 6: сбоев 0'))
    await waitFor(() => expect(toasts()).toContain('Ракурсы «в полный рост», «в действии», «деталь» перегенерированы, списано $0.80'))
  })

  test('отказ бюджета канала — текстом до очереди, джоба нет', async () => {
    const api = createMockApi()
    api.canon.monthlyLimit.cursus = 62_000_000
    const { sheet } = await openSheet('you@quartermaster-41', api)
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Собрать лист (6 ракурсов × 2 кандидата, ~$1.61)' }))
    const alert = await within(sheet).findByRole('alert')
    expect(alert.textContent).toBe('Месячный лимит $62: потрачено $61.40, операция — $1.61, не хватает $1.01; поднять лимит можно в настройках канала.')
    expect(within(sheet).queryByLabelText('Сборка листа')).toBeNull()
    expect(api.canon.jobs.size).toBe(0)
  })
})
