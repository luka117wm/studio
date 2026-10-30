// Живые обновления кэша: снимок → поток с курсора, замена строки джоба, порог перезапроса выпуска, сводка пачки и
// плитки экрана 4, переподключение.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { BatchSummary } from '@/types/batch'
import type { JobEventData } from '@/types/job'
import { createQueryClient } from '../queryClient'
import { ApiError } from '../client'
import { SUMMARY_THROTTLE_MS, applyJobEvent, startLive } from '../live'
import { qk, type LiveJobs } from '../queries'
import { FakeEventSource, stubApi, stubEventSource } from './fakes'

const job = (fields: Partial<JobEventData> = {}): JobEventData => ({
  job_id: 'job-monastery-images',
  kind: 'images',
  status: 'running',
  progress: 0.8,
  message: '83 из 104',
  attempts: 1,
  cancel_requested: false,
  episode_id: 'monastery',
  batch_id: 'batch-monastery',
  channel: null,
  error: null,
  ...fields,
})

beforeEach(() => stubEventSource())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function started() {
  const stub = stubApi()
  const client = createQueryClient({ retryDelay: 0 })
  const stop = startLive(client)
  await vi.waitFor(() => expect(FakeEventSource.active()).toHaveLength(1))
  const source = FakeEventSource.last()
  source.open()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const keys = () => invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey ?? 'all'))
  return { stub, client, stop, source, invalidate, keys }
}

const EPISODE = JSON.stringify(qk.episode('monastery'))
const LISTS = JSON.stringify(qk.episodeLists)
const SLOTS = JSON.stringify(qk.slots)
const COST = JSON.stringify(qk.cost)

describe('строка джоба', () => {
  test('событие заменяет строку целиком, новый джоб — в конец, курсор растёт', () => {
    const snapshot: LiveJobs = { items: [job({ progress: 0.5, message: 'старое' }), job({ job_id: 'other' })], lastEventId: 10 }
    const replaced = applyJobEvent(snapshot, { type: 'job.progress', id: 11, data: job() })
    expect(replaced.items[0]).toEqual(job())
    expect(replaced.items[1]?.job_id).toBe('other')
    expect(replaced.lastEventId).toBe(11)

    const appended = applyJobEvent(replaced, { type: 'job.queued', id: 12, data: job({ job_id: 'new', status: 'queued' }) })
    expect(appended.items.map((j) => j.job_id)).toEqual(['job-monastery-images', 'other', 'new'])
    expect(applyJobEvent(undefined, { type: 'job.queued', id: 3, data: job() })).toEqual({ items: [job()], lastEventId: 3 })
  })
})

describe('startLive', () => {
  test('снимок GET /api/jobs, затем поток с его курсора; события пишут кэш джобов', async () => {
    const { stub, client, source, stop } = await started()
    expect(stub.fetch.mock.calls.map(([url]) => String(url))).toEqual(['/api/jobs'])
    expect(source.url).toBe('/api/events?last_event_id=1200')

    source.emit('job.progress', job(), 1201)
    expect(client.getQueryData<LiveJobs>(qk.jobs)?.items[0]).toEqual(job())
    stop()
  })

  test('прогресс перезапрашивает выпуск не чаще раза в секунду; хвост окна не теряется', async () => {
    const { source, keys, stop } = await started()
    vi.useFakeTimers()
    source.emit('job.progress', job({ progress: 0.8 }), 1201)
    expect(keys()).toEqual([EPISODE, LISTS]) // первое — сразу
    for (let id = 1202; id < 1210; id += 1) source.emit('job.progress', job({ progress: id / 2000 }), id)
    expect(keys()).toHaveLength(2) // внутри окна — только отметка

    vi.advanceTimersByTime(SUMMARY_THROTTLE_MS)
    expect(keys()).toEqual([EPISODE, LISTS, EPISODE, LISTS]) // хвост окна
    vi.advanceTimersByTime(SUMMARY_THROTTLE_MS * 3)
    expect(keys()).toHaveLength(4) // тишина — тишина
    stop()
  })

  test('конечное событие — сразу, мимо порога, вместе со слотами', async () => {
    const { source, keys, stop } = await started()
    vi.useFakeTimers()
    source.emit('job.progress', job(), 1201)
    source.emit('job.done', job({ status: 'done', progress: 1 }), 1202)
    expect(keys()).toEqual([EPISODE, LISTS, COST, EPISODE, LISTS, SLOTS])
    vi.advanceTimersByTime(SUMMARY_THROTTLE_MS)
    expect(keys()).toHaveLength(6) // окно закрыто конечным событием
    stop()
  })

  test('джоб канала: прогресс — наборы опорных канала с порогом, конец — канон канала сразу', async () => {
    const { source, keys, stop } = await started()
    vi.useFakeTimers()
    const anchors = (fields: Partial<JobEventData>) => job({ job_id: 'job-sheet', kind: 'anchor_sheet', episode_id: null, batch_id: null, channel: 'cursus', ...fields })
    const ANCHORS = JSON.stringify(qk.canonAnchors('cursus'))
    source.emit('job.started', anchors({ progress: 0 }), 1201)
    expect(keys()).toEqual([]) // старт — не прогресс: рисовать ещё нечего
    source.emit('job.progress', anchors({ progress: 0.25 }), 1202)
    source.emit('job.progress', anchors({ progress: 0.5 }), 1203)
    expect(keys()).toEqual([ANCHORS]) // второй — внутри окна
    vi.advanceTimersByTime(SUMMARY_THROTTLE_MS)
    expect(keys()).toEqual([ANCHORS, ANCHORS])
    source.emit('job.done', anchors({ status: 'done', progress: 1 }), 1204)
    expect(keys()).toEqual([ANCHORS, ANCHORS, COST, JSON.stringify(qk.canon('cursus'))]) // списано — расход месяца заново
    vi.advanceTimersByTime(SUMMARY_THROTTLE_MS * 3)
    expect(keys()).toHaveLength(4) // окно закрыто конечным событием
    stop()
  })

  test('batch.updated — сводка пачки в кэш как есть, без перезапросов', async () => {
    const { client, source, keys, stop } = await started()
    const summary = { id: 'b1', episode_id: 'pirate', paused: true } as BatchSummary
    source.emit('batch.updated', summary, 1201)
    expect(client.getQueryData(qk.batch('b1'))).toEqual(summary)
    expect(keys()).toEqual([])
    expect(client.getQueryData<LiveJobs>(qk.jobs)?.items).toHaveLength(1) // снимок джобов не тронут
    stop()
  })

  test('джоб кадра: старт и конец перезапрашивают project.json выпуска (точно) и смету пачки, с порогом', async () => {
    const { source, invalidate, stop } = await started()
    vi.useFakeTimers()
    const shot = (fields: Partial<JobEventData>) => job({ job_id: 'job-s1', kind: 'shot_image', episode_id: 'pirate', batch_id: 'b1', ...fields })
    const project = () => invalidate.mock.calls.filter(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(qk.project('pirate')))
    const estimate = () => invalidate.mock.calls.filter(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(qk.generateEstimate('pirate')))
    source.emit('job.started', shot({ progress: 0 }), 1201)
    expect(project()).toEqual([[{ queryKey: qk.project('pirate'), exact: true }]])
    expect(estimate()).toHaveLength(1)
    source.emit('job.progress', shot({ progress: 0.5 }), 1202) // прогресс кадра плиток не меняет
    source.emit('job.done', shot({ status: 'done', progress: 1 }), 1203)
    source.emit('job.done', shot({ job_id: 'job-s2', status: 'done', progress: 1 }), 1204)
    expect(project()).toHaveLength(1) // внутри окна — только отметка
    vi.advanceTimersByTime(SUMMARY_THROTTLE_MS)
    expect(project()).toHaveLength(2) // хвост окна
    vi.advanceTimersByTime(SUMMARY_THROTTLE_MS * 3)
    expect(project()).toHaveLength(2)
    stop()
  })

  test('джоб без выпуска кэш выпусков не трогает', async () => {
    const { source, keys, stop } = await started()
    source.emit('job.done', job({ episode_id: null, status: 'done' }), 1201)
    expect(keys()).toEqual([COST])
    stop()
  })

  test('обрыв потока — проверочный перезапрос экрана; открытие — перезапрос всего', async () => {
    const { client, source, keys, stop } = await started()
    const refetch = vi.spyOn(client, 'refetchQueries')
    source.fail(false)
    source.fail(true) // и ещё попытки переподключения — проверка одна
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(refetch).toHaveBeenCalledWith({ type: 'active' })
    expect(keys()).toEqual([])
    await vi.waitFor(() => expect(FakeEventSource.active()).toHaveLength(1), { timeout: 3000 })
    FakeEventSource.last().open()
    expect(keys()).toEqual([JSON.stringify('all')])
    stop()
  })

  test('бэкенд вернулся, пока висел экран ошибки, — запросы сбрасываются, экран ошибки снимается сам', async () => {
    const { client, source, stop } = await started()
    const noAnswer = () => Promise.reject(new ApiError(0, 'нет ответа'))
    await expect(client.fetchQuery({ queryKey: qk.slots, queryFn: noAnswer, retry: false })).rejects.toThrow()
    const reset = vi.spyOn(client, 'resetQueries')
    source.fail(false)
    source.open()
    expect(reset).toHaveBeenCalledTimes(1)
    stop()
  })

  test('снимок не пришёл — поток без курсора; открылся — запросы сброшены, экран ошибки снят', async () => {
    const stub = stubApi()
    stub.setDown(true)
    const client = createQueryClient({ retryDelay: 0 })
    const stop = startLive(client)
    await vi.waitFor(() => expect(FakeEventSource.active()).toHaveLength(1))
    const source = FakeEventSource.last()
    expect(source.url).toBe('/api/events')
    const reset = vi.spyOn(client, 'resetQueries')
    stub.setDown(false)
    source.open()
    expect(reset).toHaveBeenCalledTimes(1)
    stop()
  })

  test('остановка до прихода снимка — подписки нет; после — поток закрыт', async () => {
    stubApi()
    const early = startLive(createQueryClient({ retryDelay: 0 }))
    early()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(FakeEventSource.instances).toHaveLength(0)

    const { source, stop } = await started()
    stop()
    expect(source.readyState).toBe(2)
    expect(FakeEventSource.active()).toHaveLength(0)
  })
})
