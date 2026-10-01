// Живые обновления: одна подписка SSE на приложение (docs/jobs.md, «Поток SSE»). Снимок `GET /api/jobs` даёт
// курсор, поток догоняет с него без пропусков. Событие джоба заменяет его строку в кэше целиком; выпуск джоба
// перезапрашивается: прогресс — не чаще раза в секунду на выпуск, конечное событие — сразу.
// Поток — ещё и датчик бэкенда: обрыв → проверочный перезапрос экрана (лёг — экран «Бэкенд недоступен»),
// поток снова открыт → всё перезапрашивается, а экран ошибки снимается сам.
import type { QueryClient } from '@tanstack/react-query'
import type { JobEventData } from '@/types/job'
import { fetchJobs, isBackendDown, qk, type LiveJobs } from './queries'
import { subscribe as subscribeSse, type JobEvent, type JobEventType, type StreamState } from './sse'

export const SUMMARY_THROTTLE_MS = 1_000
const FINAL: ReadonlySet<JobEventType> = new Set(['job.done', 'job.failed', 'job.cancelled'])

/** Строка джоба из события вместо прежней; новый джоб — в конец (порядок постановки, как в снимке) */
export function applyJobEvent(jobs: LiveJobs | undefined, event: JobEvent): LiveJobs {
  const items: JobEventData[] = jobs?.items ?? []
  const index = items.findIndex((job) => job.job_id === event.data.job_id)
  const next = index === -1 ? [...items, event.data] : items.map((job, i) => (i === index ? event.data : job))
  return { items: next, lastEventId: Math.max(jobs?.lastEventId ?? 0, event.id) }
}

export interface LiveOptions {
  /** Подписка на поток; в тестах — фейк */
  subscribe?: typeof subscribeSse
}

/** Запускает живые обновления кэша. Возвращает остановку: отписка, таймеры, отложенный старт не подпишется.
 *  StrictMode монтирует провайдер дважды — у первого запуска остановка срабатывает до подписки. */
export function startLive(client: QueryClient, options: LiveOptions = {}): () => void {
  const subscribe = options.subscribe ?? subscribeSse
  let stopped = false
  let unsubscribe: (() => void) | null = null
  // Выпуск → окно порога: пока окно открыто, прогресс только помечает, что перезапрос нужен в конце окна
  const windows = new Map<string, { timer: ReturnType<typeof setTimeout>; pending: boolean }>()
  // Поток переподключился (бэкенд мог перезапуститься) или снимка не было — перезапросить всё при открытии
  let resync = false

  const refreshEpisode = (episodeId: string) => {
    void client.invalidateQueries({ queryKey: qk.episode(episodeId) })
    void client.invalidateQueries({ queryKey: qk.episodeLists })
  }

  const throttled = (episodeId: string) => {
    const open = windows.get(episodeId)
    if (open) {
      open.pending = true
      return
    }
    refreshEpisode(episodeId)
    const entry = {
      pending: false,
      timer: setTimeout(() => {
        windows.delete(episodeId)
        if (entry.pending) throttled(episodeId)
      }, SUMMARY_THROTTLE_MS),
    }
    windows.set(episodeId, entry)
  }

  const onEvent = (event: JobEvent) => {
    client.setQueryData<LiveJobs>(qk.jobs, (jobs) => applyJobEvent(jobs, event))
    const episodeId = event.data.episode_id
    if (episodeId === null) return
    if (!FINAL.has(event.type)) {
      throttled(episodeId)
      return
    }
    const open = windows.get(episodeId)
    if (open) clearTimeout(open.timer)
    windows.delete(episodeId)
    refreshEpisode(episodeId)
    // Стадия и статус выпуска меняются по итогам джоба — риск слота тоже
    void client.invalidateQueries({ queryKey: qk.slots })
  }

  const onState = (state: StreamState) => {
    if (state === 'reconnecting' && !resync) {
      resync = true
      void client.refetchQueries({ type: 'active' })
    }
    if (state === 'open' && resync) {
      resync = false
      void (isBackendDown(client) ? client.resetQueries() : client.invalidateQueries())
    }
  }

  const start = async () => {
    let cursor: number | null = null
    try {
      const snapshot = await client.fetchQuery({ queryKey: qk.jobs, queryFn: ({ signal }) => fetchJobs(signal) })
      cursor = snapshot.lastEventId
    } catch {
      resync = true // бэкенд лежит: поток будет переподключаться, при открытии — снимок заново
    }
    if (stopped) return
    unsubscribe = subscribe(onEvent, { lastEventId: cursor, onState })
  }

  void start()
  return () => {
    stopped = true
    unsubscribe?.()
    unsubscribe = null
    for (const { timer } of windows.values()) clearTimeout(timer)
    windows.clear()
  }
}
