/* Поток SSE в e2e, которым управляет тест: `EventSource` страницы — фейк, события джобов шлёт `emitJob` (формат —
   docs/jobs.md, «Поток SSE»). Нужен там, где экран ждёт прогресса джоба — лист опорных портретов; остальным e2e хватает
   пустого потока из `./api`. Переподключений нет: обрыв потока `live.ts` встречает перезапросом всех данных экрана, а
   heartbeat не даёт сторожу `sse.ts` (35 с тишины) счесть поток мёртвым. */
import type { Page } from '@playwright/test'
import type { JobEventData } from '../src/types/job'

type JobEventType = 'job.queued' | 'job.started' | 'job.progress' | 'job.done' | 'job.failed' | 'job.cancelled'

/** Подменить `EventSource` до загрузки приложения; id событий — выше курсора снимка джобов моков (1200) */
export async function installFakeEvents(page: Page) {
  await page.addInitScript(() => {
    type Listener = (event: MessageEvent<string>) => void
    const sources: FakeEventSource[] = []
    let nextId = 100_000

    class FakeEventSource {
      readonly url: string
      readyState = 0
      onopen: ((event: Event) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      private readonly listeners = new Map<string, Listener[]>()

      constructor(url: string | URL) {
        this.url = String(url)
        sources.push(this)
        setTimeout(() => {
          if (this.readyState !== 0) return
          this.readyState = 1
          this.onopen?.(new Event('open'))
        }, 0)
      }

      addEventListener(type: string, listener: Listener) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
      }

      removeEventListener(type: string, listener: Listener) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener))
      }

      close() {
        this.readyState = 2
      }

      dispatch(type: string, data: string, id: string) {
        if (this.readyState !== 1) return
        const event = new MessageEvent(type, { data, lastEventId: id })
        for (const listener of this.listeners.get(type) ?? []) listener(event)
      }
    }

    setInterval(() => {
      for (const source of sources) source.dispatch('heartbeat', '', '')
    }, 10_000)
    Object.assign(window, {
      EventSource: FakeEventSource,
      __studioEvents: {
        emit(type: string, data: unknown) {
          nextId += 1
          for (const source of sources) source.dispatch(type, JSON.stringify(data), String(nextId))
        },
      },
    })
  })
}

/** Событие джоба в открытый поток страницы */
export async function emitJob(page: Page, type: JobEventType, data: JobEventData) {
  await page.evaluate(
    ([eventType, payload]) => (window as unknown as { __studioEvents: { emit: (t: string, d: unknown) => void } }).__studioEvents.emit(eventType, payload),
    [type, data] as const,
  )
}

/** Состояние джоба уровня канала (опорные) в форме события */
export const channelJob = (
  job_id: string,
  kind: string,
  status: JobEventData['status'],
  progress: number,
  message: string | null,
): JobEventData => ({
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
