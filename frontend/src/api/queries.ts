// Запросы к бэкенду через TanStack Query: ключи и пути `/api` — только здесь, типы ответов — только `@/types/*`.
// Данные API живут в кэше запросов, не в Zustand (решение 6 устава M3). Свежесть держат мутации и поток SSE
// (`live.ts`), опроса по таймеру нет.
import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import type { ChannelProfile, FormatPreview } from '@/types/channel'
import type { CostSummary } from '@/types/cost'
import type { EpisodeCreate, EpisodeListItem, EpisodePatch } from '@/types/episode'
import type { Job, JobEventData, JobList } from '@/types/job'
import type { Slot, SlotAssign } from '@/types/slot'
import { ApiError, api } from './client'

export type ChannelId = EpisodeListItem['channel']
/** Канал или режим просмотра «Все каналы» (решение 4 устава M3) */
export type ChannelScope = ChannelId | 'all'

/** Снимок джобов в кэше: строки в форме события SSE — событие заменяет строку целиком */
export interface LiveJobs {
  items: JobEventData[]
  /** Курсор журнала событий на момент снимка — с него подписка догоняет поток без пропусков */
  lastEventId: number
}

export const qk = {
  channels: ['channels'] as const,
  /** Префикс всех запросов выпусков: список и отдельные */
  episodes: ['episodes'] as const,
  episodeLists: ['episodes', 'list'] as const,
  episodeList: (scope: ChannelScope) => ['episodes', 'list', scope] as const,
  episode: (id: string) => ['episodes', 'one', id] as const,
  costSummary: (channel: ChannelId) => ['cost', 'summary', channel] as const,
  slots: ['slots'] as const,
  format: (channel: ChannelId) => ['formats', channel] as const,
  jobs: ['jobs'] as const,
}

const segment = (id: string) => encodeURIComponent(id)

// --- чтение ------------------------------------------------------------------------------------

export function useChannels() {
  return useQuery({
    queryKey: qk.channels,
    queryFn: ({ signal }) => api.get<ChannelProfile[]>('/channels', { signal }),
    staleTime: Infinity,
  })
}

/** Название канала для подписей; в режиме «Все каналы» — «Все каналы» */
export function useChannelName(scope: ChannelScope): string {
  const channels = useChannels()
  if (scope === 'all') return 'Все каналы'
  return channels.data?.find((c) => c.id === scope)?.name ?? scope
}

/** `'all'` — оба канала: запрос без параметра `channel` */
export function useEpisodes(scope: ChannelScope) {
  return useQuery({
    queryKey: qk.episodeList(scope),
    queryFn: ({ signal }) =>
      api.get<EpisodeListItem[]>('/episodes', { signal, query: { channel: scope === 'all' ? undefined : scope } }),
  })
}

/** Пока выпуск грузится, показывается его строка из уже загруженного списка — без мигания шапки */
export function useEpisode(id: string | null) {
  const client = useQueryClient()
  return useQuery<EpisodeListItem>({
    queryKey: qk.episode(id ?? ''),
    queryFn: ({ signal }) => api.get<EpisodeListItem>(`/episodes/${segment(id ?? '')}`, { signal }),
    enabled: id !== null,
    placeholderData: () => (id === null ? undefined : findInLists(client, id)),
  })
}

function findInLists(client: QueryClient, id: string): EpisodeListItem | undefined {
  for (const [, list] of client.getQueriesData<EpisodeListItem[]>({ queryKey: qk.episodeLists })) {
    const found = list?.find((episode) => episode.id === id)
    if (found) return found
  }
  return undefined
}

export function useCostSummary(channel: ChannelId) {
  return useQuery(costSummaryQuery(channel))
}

const costSummaryQuery = (channel: ChannelId) => ({
  queryKey: qk.costSummary(channel),
  queryFn: ({ signal }: { signal: AbortSignal }) => api.get<CostSummary>('/cost/summary', { signal, query: { channel } }),
})

/** Расход месяца по каналам области: один канал или оба в «Все каналы» */
export function useCostSummaries(scope: ChannelScope) {
  const channels = useChannels()
  const ids: ChannelId[] = scope === 'all' ? (channels.data ?? []).map((c) => c.id) : [scope]
  return useQueries({
    queries: ids.map(costSummaryQuery),
    combine: (results) => ({
      data: results.every((r) => r.data !== undefined) ? results.map((r) => r.data as CostSummary) : undefined,
      error: results.find((r) => r.error)?.error ?? channels.error ?? null,
      isPending: channels.isPending || results.some((r) => r.isPending),
    }),
  })
}

export function useSlots() {
  return useQuery({
    queryKey: qk.slots,
    queryFn: ({ signal }) => api.get<Slot[]>('/slots', { signal }),
  })
}

export function useFormat(channel: ChannelId) {
  return useQuery({
    queryKey: qk.format(channel),
    queryFn: ({ signal }) => api.get<FormatPreview>('/formats', { signal, query: { channel } }),
  })
}

export function toJobState(job: Job): JobEventData {
  return {
    job_id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    message: job.message,
    attempts: job.attempts,
    cancel_requested: job.cancel_requested,
    episode_id: job.episode_id,
    batch_id: job.batch_id,
    error: job.error,
  }
}

export async function fetchJobs(signal?: AbortSignal): Promise<LiveJobs> {
  const list = await api.get<JobList>('/jobs', { signal })
  return { items: list.items.map(toJobState), lastEventId: list.last_event_id }
}

/** Джобы обновляет только поток SSE (`live.ts`) — повторный запрос снимка им не нужен */
export function useJobs() {
  return useQuery({ queryKey: qk.jobs, queryFn: ({ signal }) => fetchJobs(signal), staleTime: Infinity })
}

// --- мутации -----------------------------------------------------------------------------------

/** Ответ записи — выпуск целиком: кладём его в кэш сразу, списки и слоты перезапрашиваем */
function storeEpisode(client: QueryClient, episode: EpisodeListItem, slotsChanged: boolean) {
  client.setQueryData(qk.episode(episode.id), episode)
  void client.invalidateQueries({ queryKey: qk.episodeLists })
  if (slotsChanged) void client.invalidateQueries({ queryKey: qk.slots })
}

export function useCreateEpisode() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: EpisodeCreate) => api.post<EpisodeListItem>('/episodes', body),
    onSuccess: (episode) => storeEpisode(client, episode, true),
  })
}

export function usePatchEpisode(id: string) {
  const client = useQueryClient()
  return useMutation({
    // keepalive: запись автосохранения при закрытии вкладки долетает до бэкенда
    mutationFn: (body: EpisodePatch) =>
      api.patch<EpisodeListItem>(`/episodes/${segment(id)}`, body, { keepalive: true }),
    onSuccess: (episode) => storeEpisode(client, episode, false),
  })
}

export function useSetSlot(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: SlotAssign) => api.put<EpisodeListItem>(`/episodes/${segment(id)}/slot`, body),
    onSuccess: (episode) => storeEpisode(client, episode, true),
  })
}

/** Название выпуска в кэше сразу, до ответа сервера: и сам выпуск, и его строка в списках. Идущие запросы этих
 *  данных отменяются — иначе ответ, взятый до переименования, вернул бы старое название. */
export function renameInCache(client: QueryClient, id: string, title: string): void {
  void client.cancelQueries({ queryKey: qk.episode(id) })
  void client.cancelQueries({ queryKey: qk.episodeLists })
  client.setQueryData<EpisodeListItem>(qk.episode(id), (episode) => episode && { ...episode, title })
  client.setQueriesData<EpisodeListItem[]>({ queryKey: qk.episodeLists }, (list) =>
    list?.map((episode) => (episode.id === id ? { ...episode, title } : episode)),
  )
}

// --- доступность бэкенда -----------------------------------------------------------------------

/** Сеть недоступна: ответа не было вовсе (`ApiError.status === 0`), а не 4xx/5xx */
export const isNetworkError = (error: unknown): boolean => error instanceof ApiError && error.status === 0

export function isBackendDown(client: QueryClient): boolean {
  return client
    .getQueryCache()
    .getAll()
    .some((query) => query.state.status === 'error' && isNetworkError(query.state.error))
}

/** Бэкенд недоступен: хотя бы один запрос упал без ответа. Держится, пока «Повторить» не сбросит запросы —
 *  иначе экран, размонтированный заглушкой ошибки, снова смонтировался бы и снова упал. */
export function useBackendDown(): boolean {
  const client = useQueryClient()
  return useSyncExternalStore(
    (onChange) => client.getQueryCache().subscribe(onChange),
    () => isBackendDown(client),
  )
}
