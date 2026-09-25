// @vitest-environment node
// Подписка на /api/events на фейковом EventSource: разбор событий, курсор, переподключение, отписка.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { JobEventData } from '@/types/job'
import { RECONNECT_MIN_MS, subscribe, type JobEvent, type StreamState } from '../sse'

type Listener = (event: MessageEvent<string>) => void

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly url: string
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  private listeners = new Map<string, Listener[]>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  static last(): FakeEventSource {
    const source = FakeEventSource.instances.at(-1)
    if (!source) throw new Error('no EventSource')
    return source
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close() {
    this.readyState = 2
  }

  open() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }

  /** Обрыв: `closed` — EventSource сдался (бэкенд лежал при подключении), иначе браузер переподключается сам */
  fail(closed: boolean) {
    this.readyState = closed ? 2 : 0
    this.onerror?.(new Event('error'))
  }

  emit(type: string, data: unknown, id?: number) {
    const text = typeof data === 'string' ? data : JSON.stringify(data)
    const event = new MessageEvent(type, { data: text, lastEventId: id === undefined ? '' : String(id) })
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

const job = (status: JobEventData['status'], progress = 0): JobEventData => ({
  job_id: 'j1',
  kind: 'sleep_job',
  status,
  progress,
  message: null,
  attempts: 1,
  cancel_requested: false,
  episode_id: null,
  batch_id: null,
  error: null,
})

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('subscribe', () => {
  test('события job.* с id и данными; heartbeat, повтор и битые — мимо', () => {
    const events: JobEvent[] = []
    const stop = subscribe((event) => events.push(event))
    const source = FakeEventSource.last()
    expect(source.url).toBe('/api/events')
    source.open()
    source.emit('job.started', job('running'), 41)
    source.emit('heartbeat', { ts: '2026-09-25T10:00:00+00:00' })
    source.emit('job.progress', job('running', 0.5), 42)
    source.emit('job.progress', job('running', 0.5), 42) // стык снимка и потока
    source.emit('job.done', '{not json', 43)
    source.emit('job.done', job('done', 1), 44)
    expect(events.map((e) => [e.type, e.id, e.data.status, e.data.progress])).toEqual([
      ['job.started', 41, 'running', 0],
      ['job.progress', 42, 'running', 0.5],
      ['job.done', 44, 'done', 1],
    ])
    stop()
  })

  test('курсор из снимка — в первом подключении', () => {
    const stop = subscribe(() => {}, { lastEventId: 5 })
    expect(FakeEventSource.last().url).toBe('/api/events?last_event_id=5')
    stop()
  })

  test('закрытый поток — новое подключение с последним id, паузы растут и сбрасываются', () => {
    const states: StreamState[] = []
    const stop = subscribe(() => {}, { onState: (state) => states.push(state) })
    const first = FakeEventSource.last()
    first.open()
    first.emit('job.queued', job('queued'), 7)
    first.fail(true)
    expect(first.readyState).toBe(2)
    vi.advanceTimersByTime(RECONNECT_MIN_MS - 1)
    expect(FakeEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    const second = FakeEventSource.last()
    expect(second.url).toBe('/api/events?last_event_id=7')

    second.fail(true) // бэкенд ещё лежит: пауза удвоилась
    vi.advanceTimersByTime(RECONNECT_MIN_MS * 2 - 1)
    expect(FakeEventSource.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    const third = FakeEventSource.last()
    third.open() // поднялся — пауза снова минимальная
    third.fail(true)
    vi.advanceTimersByTime(RECONNECT_MIN_MS)
    expect(FakeEventSource.instances).toHaveLength(4)

    expect(states.slice(0, 6)).toEqual([
      'connecting',
      'open',
      'reconnecting',
      'connecting',
      'reconnecting',
      'connecting',
    ])
    stop()
  })

  test('обрыв, пока браузер переподключается сам, — без нового EventSource', () => {
    const states: StreamState[] = []
    const stop = subscribe(() => {}, { onState: (state) => states.push(state) })
    FakeEventSource.last().fail(false)
    vi.advanceTimersByTime(60_000)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(states).toEqual(['connecting', 'reconnecting'])
    stop()
  })

  test('отписка закрывает поток и отменяет переподключение', () => {
    const events: JobEvent[] = []
    const states: StreamState[] = []
    const stop = subscribe((event) => events.push(event), { onState: (state) => states.push(state) })
    const source = FakeEventSource.last()
    source.fail(true)
    stop()
    vi.advanceTimersByTime(60_000)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(source.readyState).toBe(2)
    expect(states.at(-1)).toBe('closed')
    source.emit('job.done', job('done', 1), 9)
    expect(events).toEqual([])
  })
})
