// Живые обновления: одна подписка SSE на приложение (docs/jobs.md, «Поток SSE»). Снимок `GET /api/jobs` даёт
// курсор, поток догоняет с него без пропусков. Событие джоба заменяет его строку в кэше целиком; выпуск джоба
// перезапрашивается: прогресс — не чаще раза в секунду на выпуск, конечное событие — сразу.
// Поток — ещё и датчик бэкенда: обрыв → проверочный перезапрос экрана (лёг — экран «Бэкенд недоступен»),
// поток снова открыт → всё перезапрашивается, а экран ошибки снимается сам. Джоб уровня канала (опорные): прогресс
// перезапрашивает наборы опорных канала с тем же порогом — новые кандидаты видны по ходу сборки (M5.9), конец —
// канон этого канала (M5.7). Конец любого джоба перезапрашивает сводки расходов: шапка показывает расход месяца.
// Экран 4 (M6.7): сводка пачки из `batch.updated` кладётся в кэш как есть, без перезапроса; переход джоба кадра
// перезапрашивает project.json выпуска (статусы и версии плиток) и смету пачки — с тем же порогом.
import type { QueryClient } from '@tanstack/react-query'
import type { JobEventData } from '@/types/job'
import { CHECK_JOB, SHOT_JOB, fetchJobs, isBackendDown, qk, type LiveJobs } from './queries'
import { BATCH_EVENT, subscribe as subscribeSse, type JobEvent, type JobEventType, type StreamEvent, type StreamState } from './sse'

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
  // Выпуск или канал → окно порога: пока окно открыто, прогресс только помечает, что перезапрос нужен в конце окна
  const windows = new Map<string, { timer: ReturnType<typeof setTimeout>; pending: boolean }>()
  // Поток переподключился (бэкенд мог перезапуститься) или снимка не было — перезапросить всё при открытии
  let resync = false

  const refreshEpisode = (episodeId: string) => {
    void client.invalidateQueries({ queryKey: qk.episode(episodeId) })
    void client.invalidateQueries({ queryKey: qk.episodeLists })
  }

  const throttled = (key: string, refresh: () => void) => {
    const open = windows.get(key)
    if (open) {
      open.pending = true
      return
    }
    refresh()
    const entry = {
      pending: false,
      timer: setTimeout(() => {
        windows.delete(key)
        if (entry.pending) throttled(key, refresh)
      }, SUMMARY_THROTTLE_MS),
    }
    windows.set(key, entry)
  }

  const closeWindow = (key: string) => {
    const open = windows.get(key)
    if (open) clearTimeout(open.timer)
    windows.delete(key)
  }

  const refreshShots = (episodeId: string) => {
    void client.invalidateQueries({ queryKey: qk.project(episodeId), exact: true })
    void client.invalidateQueries({ queryKey: qk.generateEstimate(episodeId) })
    void client.invalidateQueries({ queryKey: qk.checkEstimates(episodeId) })
  }

  const onEvent = (event: StreamEvent) => {
    if (event.type === BATCH_EVENT) {
      client.setQueryData(qk.batch(event.data.id), event.data)
      return
    }
    client.setQueryData<LiveJobs>(qk.jobs, (jobs) => applyJobEvent(jobs, event))
    const final = FINAL.has(event.type)
    // Конец джоба: платный списал деньги — расход месяца в шапке заново (найдено вживую в M5.9)
    if (final) void client.invalidateQueries({ queryKey: qk.cost })
    // Джоб уровня канала (опорные): по ходу — наборы опорных канала, по концу — канон канала заново, там его картинки
    // и устаревание
    const channel = event.data.channel
    if (channel !== null) {
      const key = `canon:${channel}`
      if (final) {
        closeWindow(key)
        void client.invalidateQueries({ queryKey: qk.canon(channel) })
      } else if (event.type === 'job.progress') {
        throttled(key, () => void client.invalidateQueries({ queryKey: qk.canonAnchors(channel) }))
      }
    }
    const episodeId = event.data.episode_id
    if (episodeId === null) return
    // Джоб кадра сменил статус (поставлен, начал, кончил): плитки читают project.json. Сотня концов подряд — один
    // перезапрос в секунду, хвост окна не теряется. Конец перепроверки (M6.10) записал пометки выбранной версии
    const shotsChanged = event.data.kind === SHOT_JOB ? event.type !== 'job.progress' : event.data.kind === CHECK_JOB && final
    if (shotsChanged) throttled(`shots:${episodeId}`, () => refreshShots(episodeId))
    const key = `episode:${episodeId}`
    if (!final) {
      throttled(key, () => refreshEpisode(episodeId))
      return
    }
    closeWindow(key)
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
