// Поток событий джобов `GET /api/events` (docs/jobs.md, «Поток SSE»).
// На обрыве браузер переподключается сам и шлёт Last-Event-ID. Но закрытый EventSource (бэкенд
// лежал при подключении, ответ не 200) больше не пытается — тогда новый EventSource с
// `?last_event_id=` последнего события, паузы 1, 2, 4 … 30 с. Heartbeat держит соединение и не
// сдвигает курсор; повтор события на стыке снимка и потока отбрасывается по id.
import type { JobEventData } from '@/types/job'

export const EVENTS_URL = '/api/events'
export const JOB_EVENT_TYPES = [
  'job.queued',
  'job.started',
  'job.progress',
  'job.done',
  'job.failed',
  'job.cancelled',
] as const
export type JobEventType = (typeof JOB_EVENT_TYPES)[number]

export interface JobEvent {
  type: JobEventType
  /** id строки журнала `job_events` — курсор для догона */
  id: number
  /** Полное состояние джоба без payload и result: клиент заменяет его целиком */
  data: JobEventData
}

export type StreamState = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface SubscribeOptions {
  /** Курсор из снимка `GET /api/jobs` → `last_event_id`: догон без пропусков */
  lastEventId?: number | null
  onState?: (state: StreamState) => void
}

export const RECONNECT_MIN_MS = 1_000
export const RECONNECT_MAX_MS = 30_000
const CLOSED = 2 // EventSource.CLOSED

/** Подписка на события джобов. Возвращает отписку: закрывает поток и отменяет переподключение. */
export function subscribe(
  onEvent: (event: JobEvent) => void,
  options: SubscribeOptions = {},
): () => void {
  const { onState } = options
  let cursor = options.lastEventId ?? null
  let source: EventSource | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let delay = RECONNECT_MIN_MS
  let stopped = false

  const handle = (type: JobEventType, event: MessageEvent<string>) => {
    if (stopped) return // событие, уже стоявшее в очереди браузера, после отписки не доставляем
    const id = Number(event.lastEventId)
    if (!Number.isInteger(id) || id <= 0) return
    if (cursor !== null && id <= cursor) return
    let data: JobEventData
    try {
      data = JSON.parse(event.data) as JobEventData
    } catch {
      return // битое событие не роняет подписку; следующее состояние джоба придёт целиком
    }
    cursor = id
    onEvent({ type, id, data })
  }

  const reconnect = () => {
    source?.close()
    source = null
    onState?.('reconnecting')
    timer = setTimeout(() => {
      timer = null
      connect()
    }, delay)
    delay = Math.min(delay * 2, RECONNECT_MAX_MS)
  }

  const connect = () => {
    if (stopped) return
    const url = cursor === null ? EVENTS_URL : `${EVENTS_URL}?last_event_id=${cursor}`
    const current = new EventSource(url)
    source = current
    onState?.('connecting')
    current.onopen = () => {
      delay = RECONNECT_MIN_MS
      onState?.('open')
    }
    current.onerror = () => {
      if (stopped || source !== current) return
      if (current.readyState === CLOSED) reconnect()
      else onState?.('reconnecting') // браузер переподключается сам и шлёт Last-Event-ID
    }
    for (const type of JOB_EVENT_TYPES) {
      current.addEventListener(type, (event) => handle(type, event))
    }
  }

  connect()
  return () => {
    if (stopped) return
    stopped = true
    if (timer !== null) clearTimeout(timer)
    source?.close()
    source = null
    onState?.('closed')
  }
}
