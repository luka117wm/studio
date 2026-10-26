// «Сравнение версий» экрана 4 на моках артборда 4 (M6.9): V на s061 — три карточки с моделью, seed, временем, ценой и
// соответствием канону, выбрана вторая; «Выбрать версию 1» — `choose`, тост, рамка и плитка сетки; адрес
// `?view=compare&shot=` переживает перезагрузку, Esc — сетка с фокусом на кадре; кнопка заголовка — последний под
// фокусом или первый выбранный; «Добавить версию» — цена моделью выбранной версии, карточка «в очереди» → «рисуется» →
// картинка по SSE, выбор не меняется (E-1); анахронизмы списком, «Устарела» у выбранной; слова сходства лица.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { FaceCheck } from '@/types/project'
import { stubApi } from '../../../api/__tests__/fakes'
import { renderApp } from '../../../app/__tests__/harness'
import { autosaver } from '../../../app/autosave'
import { formatClock } from '../../../app/format'
import { setPlatform } from '../../../app/keyboard'
import type { MockApi } from '../../../mocks/api'
import { useUiStore } from '../../../store/uiStore'
import { faceWord, formatCreated, pendingCards, versionCards } from '../versions'
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
const posts = (fetch: ReturnType<typeof vi.fn>, path: string) =>
  (fetch.mock.calls as Call[])
    .filter(([url, init]) => init?.method === 'POST' && String(url) === path)
    .map(([, init]) => JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)

const toasts = () => useUiStore.getState().toasts.map((t) => t.message)
const tileButton = (shot: string) => screen.getByRole('button', { name: `Выбрать ${shot}` })
const versions = (shot = 's061') => screen.getByRole('list', { name: `Версии кадра ${shot}` })
const card = (n: number, total = 3, shot = 's061') => within(versions(shot)).getByRole('listitem', { name: new RegExp(`^версия ${n} из ${total}`) })
const labels = (shot = 's061') => within(versions(shot)).getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))
/** Значение строки карточки: «Модель», «Seed», «Создана», «Цена», «Соответствие канону», «Анахронизмы» */
const row = (item: HTMLElement, term: string) => within(item).getByText(term, { selector: 'dt' }).nextElementSibling?.textContent
const addVersion = () => screen.getByRole('button', { name: /^Добавить версию/ })

/** Экран 4 сразу в режиме сравнения — как перезагрузка страницы с этим адресом */
async function openCompare(api: MockApi, shot = 's061') {
  const stub = stubApi(api)
  const app = renderApp(`/episodes/pirate/generate?view=compare&shot=${shot}`, { stub })
  await screen.findByRole('heading', { name: `Версии кадра ${shot}` }, { timeout: 3000 })
  return { ...app, api }
}

describe('вход, карточки, выход', () => {
  test('V на s061 — три карточки по артборду, выбрана вторая; адрес с видом и кадром; полосы выбора нет', async () => {
    const user = userEvent.setup()
    await openGenerate(artboardApi())
    tileButton('s061').focus()
    await user.keyboard('v')
    await screen.findByRole('heading', { name: 'Версии кадра s061' })
    expect(window.location.search).toBe('?view=compare&shot=s061')
    expect(within(screen.getByRole('heading', { name: 'Версии кадра s061' }).parentElement!).getByText('Boatswain')).toBeTruthy()
    expect(screen.getByLabelText('Действие кадра').textContent).toBe('carries a leather cartridge case down the gun deck')
    expect(screen.getByText('сравнение версий кадра')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Выбор кадров' })).toBeNull()

    // Новые справа, у выбранной — рамка accent и «Выбрана» неактивной кнопкой
    expect(labels()).toEqual(['версия 1 из 3', 'версия 2 из 3, выбрана', 'версия 3 из 3'])
    expect(card(2).className).toContain('border-accent')
    expect(within(card(2)).getByRole('button', { name: 'Выбрана' })).toHaveProperty('disabled', true)
    expect(within(card(1)).getByRole('button', { name: 'Выбрать версию 1' })).toHaveProperty('disabled', false)

    expect(row(card(1), 'Модель')).toBe('Nano Banana 2')
    expect(row(card(1), 'Seed')).toEqual('418 902')
    expect(row(card(1), 'Создана')).toBe(formatCreated('2026-09-11T08:41:00+00:00'))
    expect(row(card(1), 'Цена')).toBe('$0.07')
    expect(row(card(1), 'Соответствие канону')).toBe('среднее')
    expect(row(card(2), 'Соответствие канону')).toBe('высокое')
    expect(within(card(2)).getByRole('img', { name: 'Сходство лица: высокое' }).getAttribute('data-status')).toBe('ready')
    expect(row(card(3), 'Модель')).toBe('Nano Banana Pro')
    expect(row(card(3), 'Цена')).toBe('$0.13')
    expect(within(card(1)).queryByText('Анахронизмы')).toBeNull()

    // Картинка — миниатюра 320, по клику — файл версии
    const link = within(card(1)).getByRole('link', { name: 'Открыть картинку: версия 1 из 3' })
    expect(link.getAttribute('href')).toBe('/api/projects/pirate/shots/s061/images/1/file')
    expect(link.querySelector('img')?.getAttribute('src')).toBe('/api/projects/pirate/shots/s061/images/1/thumb?w=320')
    expect(screen.getByText('Выбранная версия идёт в монтаж. Остальные остаются в истории кадра и доступны в любой момент.')).toBeTruthy()
  })

  test('«Выбрать версию 1» — choose, тост, рамка на версии 1; в сетке у s061 новая миниатюра и точка выбранной', async () => {
    const user = userEvent.setup()
    const { stub } = await openCompare(artboardApi())
    await user.click(within(card(1)).getByRole('button', { name: 'Выбрать версию 1' }))
    await waitFor(() => expect(toasts()).toContain('Выбрана версия 1, остальные в истории кадра'))
    expect(calls(stub.fetch, 'POST', '/api/projects/pirate/shots/s061/images/1/choose')).toHaveLength(1)
    await waitFor(() => expect(labels()).toEqual(['версия 1 из 3, выбрана', 'версия 2 из 3', 'версия 3 из 3']))
    expect(card(1).className).toContain('border-accent')
    expect(within(card(2)).getByRole('button', { name: 'Выбрать версию 2' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'К сетке кадров' }))
    const tile = await screen.findByRole('listitem', { name: 's061, готов' })
    expect(within(tile).getByRole('img', { name: 'Версия 1 из 3, выбрана' }).className).toContain('bg-accent')
    expect(tile.querySelector('img')?.getAttribute('src')).toBe('/api/projects/pirate/shots/s061/images/1/thumb?w=320')
    await waitFor(() => expect(document.activeElement).toBe(tileButton('s061')))
  })

  test('перезагрузка с ?view=compare&shot=s061 — тот же вид; Esc — сетка без параметров, фокус на s061', async () => {
    const user = userEvent.setup()
    await openCompare(artboardApi())
    expect(labels()).toHaveLength(3)
    await user.keyboard('{Escape}')
    await screen.findByRole('region', { name: 'Cold open' })
    expect(window.location.search).toBe('')
    await waitFor(() => expect(document.activeElement).toBe(tileButton('s061')))
    // V с плитки — снова сравнение, V в сравнении — назад
    await user.keyboard('v')
    await screen.findByRole('heading', { name: 'Версии кадра s061' })
    await user.keyboard('v')
    await screen.findByRole('region', { name: 'Cold open' })
  })

  test('кнопка заголовка — последний кадр под фокусом или первый выбранный; без кадра недоступна', async () => {
    const user = userEvent.setup()
    await openGenerate(artboardApi())
    expect(screen.getByRole('button', { name: 'Сравнить версии кадра' })).toHaveProperty('disabled', true)
    await user.keyboard('{Control>}a{/Control}')
    await user.click(screen.getByRole('button', { name: 'Сравнить версии кадра' }))
    await screen.findByRole('heading', { name: 'Версии кадра s001' })
    // Сходство s001 в моках — 0.62, от порога 0.47 + 0.10 — «высокое»
    expect(row(card(1, 1, 's001'), 'Соответствие канону')).toBe('высокое')
    await user.click(screen.getByRole('button', { name: 'К сетке кадров' }))

    await screen.findByRole('region', { name: 'Cold open' })
    await user.click(tileButton('s040'))
    await user.click(screen.getByRole('button', { name: 'Сравнить версии кадра' }))
    await screen.findByRole('heading', { name: 'Версии кадра s040' })
  })

  test('кадра из адреса нет в плане — объяснение и путь к сетке', async () => {
    const user = userEvent.setup()
    renderApp('/episodes/pirate/generate?view=compare&shot=s999', { stub: stubApi(artboardApi()) })
    await screen.findByText('Кадра s999 нет в плане', undefined, { timeout: 3000 })
    await user.click(screen.getAllByRole('button', { name: 'К сетке кадров' })[0]!)
    await screen.findByRole('region', { name: 'Cold open' })
  })
})

describe('добавить версию и пометки', () => {
  test('«Добавить версию» — цена моделью выбранной версии; «в очереди» → «рисуется» → картинка по SSE, выбор прежний', async () => {
    const user = userEvent.setup()
    const api = artboardApi()
    const { stub } = await openCompare(api)
    const emit = stream()
    await waitFor(() => expect(addVersion().textContent).toBe('Добавить версию (~$0.07)'))
    const estimate = calls(stub.fetch, 'GET', '/api/projects/pirate/shots/s061/redraw/estimate').at(-1)!
    expect(new URL(estimate, 'http://x').searchParams.get('model')).toBe('nb2')

    await user.click(addVersion())
    expect(posts(stub.fetch, '/api/projects/pirate/shots/s061/redraw')).toEqual([{ model: 'nb2' }])
    await within(versions()).findByRole('listitem', { name: 'новая версия, в очереди' })
    const job = api.generation.jobs.find((item) => item.id.startsWith('job-redraw-') && item.payload.shot_id === 's061')!
    emit('job.started', shotEvent('s061', 'running', { job_id: job.id, batch_id: null }))
    await within(versions()).findByRole('listitem', { name: 'новая версия, рисуется' })

    api.generation.drawShot('pirate', 's061')
    emit('job.done', shotEvent('s061', 'done', { job_id: job.id, batch_id: null }))
    await within(versions()).findByRole('listitem', { name: 'версия 4 из 4' }, { timeout: 3000 })
    expect(within(versions()).queryByRole('listitem', { name: /^новая версия/ })).toBeNull()
    // У готового кадра новая версия — вариант на выбор (E-1)
    expect(labels()).toEqual(['версия 1 из 4', 'версия 2 из 4, выбрана', 'версия 3 из 4', 'версия 4 из 4'])
    expect(row(card(4, 4), 'Модель')).toBe('Nano Banana 2')
    await waitFor(() => expect(toasts()).toContain('Добавлена версия 4 кадра s061, списано $0.07'))
  })

  test('анахронизмы — списком у версии; устаревший кадр — «Устарела» с причиной на выбранной карточке', async () => {
    const api = artboardApi()
    const project = api.projects.get('pirate')!
    const v3 = project.assets['img-s061-v3']!
    v3.checks = {
      ...v3.checks,
      anachronism: { status: 'suspect', found: ['wristwatches', 'zippers'], period: 'periods/caribbean-1716/v001', usd_micro: 163, checked_at: '2026-09-11T09:25:00+00:00' },
    }
    project.shots.s061 = { ...project.shots.s061!, status: 'stale', stale_reasons: ['Промпт изменён вручную'] }
    await openCompare(api)
    expect(row(card(3), 'Анахронизмы')).toBe('wristwatches, zippers')
    expect(within(card(2)).getByText('Устарела: Промпт изменён вручную')).toBeTruthy()
    expect(within(card(1)).queryByText(/^Устарела/)).toBeNull()
  })
})

describe('versions.ts', () => {
  const face = (fields: Partial<FaceCheck>, scores: (number | null)[] = []): FaceCheck => ({
    status: 'ok',
    appearances: scores.map((score, i) => ({ id: `you@rank-${i}`, status: score === null ? 'skipped' : score < 0.47 ? 'low' : 'ok', score, reason: score === null ? 'нет фаса' : null })),
    faces: scores.length,
    threshold: 0.47,
    checked_at: '2026-10-25T16:29:57+00:00',
    ...fields,
  })

  test('сходство лица словами: запас 0.10 над порогом, худший облик, тёплый — только low', () => {
    expect(faceWord(face({}, [0.71]))).toMatchObject({ word: 'высокое', status: 'ready', detail: 'you@rank-0 — 0.71' })
    expect(faceWord(face({}, [0.57]))).toMatchObject({ word: 'высокое', status: 'ready' })
    expect(faceWord(face({}, [0.53]))).toMatchObject({ word: 'среднее', status: null })
    expect(faceWord(face({}, [0.77, 0.52]))).toMatchObject({ word: 'среднее', detail: 'you@rank-0 — 0.77; you@rank-1 — 0.52' })
    expect(faceWord(face({ status: 'low' }, [0.71, 0.35]))).toMatchObject({ word: 'низкое', status: 'warning' })
    expect(faceWord(face({ status: 'no_face' }))).toMatchObject({ word: 'лицо не найдено', status: null })
    expect(faceWord(face({ status: 'skipped', reason: 'Нет весов проверки лица' }))).toEqual({ word: 'не проверено', status: null, detail: 'Нет весов проверки лица' })
    expect(faceWord(null)).toMatchObject({ word: 'не проверено' })
    // Без порога «среднее» не из чего считать
    expect(faceWord(face({ threshold: null }, [0.5]))).toMatchObject({ word: 'высокое' })
  })

  test('карточки «рисуется»: свой джоб — до версии его варианта; сбой снимает; пачка без своих — одна', () => {
    const cards = versionCards(artboardApi().projects.get('pirate'), 's061')
    expect(cards.map((c) => c.variant)).toEqual([1, 2, 3])
    const tracked = [{ jobId: 'j4', variant: 4 }]
    const state = (status: 'queued' | 'running' | 'done' | 'failed') => [shotEvent('s061', status, { job_id: 'j4' })]
    expect(pendingCards(tracked, state('queued'), cards, 'queued')).toEqual([{ key: 'j4', label: 'в очереди' }])
    expect(pendingCards(tracked, state('running'), cards, 'generating')).toEqual([{ key: 'j4', label: 'рисуется' }])
    // Конец пришёл, project.json ещё нет — штриховка стоит
    expect(pendingCards(tracked, state('done'), cards, 'done')).toEqual([{ key: 'j4', label: 'рисуется' }])
    expect(pendingCards(tracked, state('done'), [...cards, { ...cards[0]!, version: 4, variant: 4 }], 'done')).toEqual([])
    expect(pendingCards(tracked, state('failed'), cards, 'failed')).toEqual([])
    expect(pendingCards([], [], cards, 'generating')).toEqual([{ key: 'shot', label: 'рисуется' }])
    expect(pendingCards([], [], cards, 'done')).toEqual([])
  })

  test('«Создана»: сегодня — время, раньше — с датой', () => {
    const now = new Date('2026-10-26T12:00:00')
    expect(formatCreated('2026-10-26T09:41:00', now)).toBe('09:41')
    expect(formatCreated('2026-09-11T11:41:00', now)).toBe(`11 сент ${formatClock('2026-09-11T11:41:00')}`)
  })
})
