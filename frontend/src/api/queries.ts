// Запросы к бэкенду через TanStack Query: ключи и пути `/api` — только здесь, типы ответов — только `@/types/*`.
// Данные API живут в кэше запросов, не в Zustand (решение 6 устава M3). Свежесть держат мутации и поток SSE
// (`live.ts`), опроса по таймеру нет.
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import type { BridgeSettings } from '@/types/bridge'
import type { ChannelProfile, FormatPreview } from '@/types/channel'
import type { CostSummary } from '@/types/cost'
import type { Director } from '@/types/director'
import type { EpisodeCreate, EpisodeListItem, EpisodePatch } from '@/types/episode'
import type { Idea, IdeaCreate, IdeaPatch, IdeasAnswerResult, IdeasPrompt } from '@/types/idea'
import type { Job, JobEventData, JobList } from '@/types/job'
import type {
  EffectivePlan,
  PlanAnswerResult,
  PlanCheck,
  PlanEstimate,
  PlanParts,
  PlanPrompt,
  SimilarityReport,
} from '@/types/plan'
import type { ReferenceCreate, ReferenceEpisodeCreate, ReferencePrompt, ReferenceVideo } from '@/types/reference'
import type { EpisodeBrief, ImportResult, Project } from '@/types/project'
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
  bridgeSettings: ['bridge', 'settings'] as const,
  /** Идеи канала всех статусов: экран делит их на бэклог, убранные и «Идеи из чата» */
  ideas: (channel: ChannelId) => ['ideas', channel] as const,
  /** Референсы канала с разбором и метриками (docs/research.md, «Референс») */
  references: (channel: ChannelId) => ['references', channel] as const,
  project: (id: string) => ['projects', id] as const,
  /** Действующий план и набор частей моста выпуска */
  plan: (id: string) => ['projects', id, 'plan'] as const,
  planParts: (id: string) => ['projects', id, 'plan', 'parts'] as const,
  /** Смета плана; `stamp` — время ответа плана: перезапрос плана после любой правки тянет новую смету */
  estimate: (id: string, stamp: number) => ['projects', id, 'plan', 'estimate', stamp] as const,
  /** Сходство VO плана с референсом; `stamp` — как у сметы, `'list'` — без привязки к экрану плана */
  similarity: (id: string, stamp: number | 'list') => ['projects', id, 'plan', 'similarity', stamp] as const,
  /** Файл версии плана как есть — неизменяемый */
  directorVersion: (id: string, version: string) => ['projects', id, 'director', version] as const,
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

/** Идеи канала, все статусы, новые первыми (docs/research.md); сортировку бэклога делает экран */
export function useIdeas(channel: ChannelId | null) {
  return useQuery({
    queryKey: qk.ideas(channel ?? 'cursus'),
    queryFn: ({ signal }) => api.get<Idea[]>('/ideas', { signal, query: { channel } }),
    enabled: channel !== null,
  })
}

/** Референсы канала, новые первыми: с разбором и метриками — их считает бэкенд, фронт только раскладывает */
export function useReferences(channel: ChannelId) {
  return useQuery({
    queryKey: qk.references(channel),
    queryFn: ({ signal }) => api.get<ReferenceVideo[]>('/references', { signal, query: { channel } }),
  })
}

/** Один референс (заявка выпуска на экране 3): пока грузится — из списка канала, если он уже есть */
export function useReference(id: string | null) {
  const client = useQueryClient()
  return useQuery<ReferenceVideo>({
    queryKey: ['references', 'one', id ?? ''] as const,
    queryFn: ({ signal }) => api.get<ReferenceVideo>(`/references/${segment(id ?? '')}`, { signal }),
    enabled: id !== null,
    placeholderData: () => {
      for (const [, list] of client.getQueriesData<ReferenceVideo[]>({ queryKey: ['references'] })) {
        const found = Array.isArray(list) ? list.find((r) => r.id === id) : undefined
        if (found) return found
      }
      return undefined
    },
  })
}

/** Сходство VO действующего плана с референсом выпуска (принцип 11). `planStamp` — время ответа плана: правка
 *  кадра перезапрашивает план, а с ним и сходство; `'list'` — для списка выпусков на вкладке «Референс» */
export function useSimilarity(id: string | null, planStamp: number | 'list' = 'list') {
  return useQuery({
    queryKey: qk.similarity(id ?? '', planStamp),
    queryFn: ({ signal }) => api.get<SimilarityReport>(`/projects/${segment(id ?? '')}/similarity`, { signal }),
    enabled: id !== null,
    placeholderData: keepPreviousData,
  })
}

/** Выпуски канала по этому референсу: `origin: reference` и `brief.reference_id` в project.json. Отдельного
 *  списка на бэкенде нет — таких выпусков единицы, project.json читается по каждому */
export function useReferenceEpisodes(channel: ChannelId, referenceId: string | null) {
  const episodes = useEpisodes(channel)
  const candidates = (episodes.data ?? []).filter((e) => e.origin === 'reference')
  const projects = useQueries({
    queries: candidates.map((episode) => ({
      queryKey: qk.project(episode.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<Project>(`/projects/${segment(episode.id)}`, { signal }),
      enabled: referenceId !== null,
    })),
  })
  return candidates.filter((_, i) => referenceId !== null && projects[i]?.data?.brief?.reference_id === referenceId)
}

/** Источник плана и доступность Claude API — для сегментов «Claude API / Мост через чат» */
export function useBridgeSettings() {
  return useQuery({
    queryKey: qk.bridgeSettings,
    queryFn: ({ signal }) => api.get<BridgeSettings>('/bridge/settings', { signal }),
    staleTime: Infinity,
  })
}

/** project.json выпуска: здесь — ради заявки (`brief`) */
export function useProject(id: string) {
  return useQuery({
    queryKey: qk.project(id),
    queryFn: ({ signal }) => api.get<Project>(`/projects/${segment(id)}`, { signal }),
  })
}

/** Действующий план: версия плюс ручные правки (M4.3); `null` — план ещё не импортирован */
export function usePlan(id: string) {
  return useQuery({
    queryKey: qk.plan(id),
    queryFn: ({ signal }) => api.get<EffectivePlan | null>(`/projects/${segment(id)}/plan`, { signal }),
  })
}

/** Версия плана как файл, без правок: «значение из плана» у поправленного поля и возврат к нему.
 *  Действующий план на фронте не считается — он приходит готовым (`usePlan`). */
export function useDirectorVersion(id: string, version: string | null) {
  return useQuery({
    queryKey: qk.directorVersion(id, version ?? ''),
    queryFn: ({ signal }) => api.get<Director>(`/projects/${segment(id)}/director/${segment(version ?? '')}`, { signal }),
    enabled: version !== null,
    staleTime: Infinity,
  })
}

/** Набор частей моста: сколько частей, какие приняты, какая следующая, последний обмен */
export function usePlanParts(id: string) {
  return useQuery({
    queryKey: qk.planParts(id),
    queryFn: ({ signal }) => api.get<PlanParts>(`/projects/${segment(id)}/plan/parts`, { signal }),
  })
}

/** Смета действующего плана до клика «Утвердить» (M4.6): строки, итог, остаток бюджетов. Ключ — по времени ответа
 *  плана (`planStamp`, `dataUpdatedAt`): правка кадра перезапрашивает план, а с ним и смету; пока идёт новый запрос,
 *  видна прежняя. Без плана (`planStamp` 0) не запрашивается — бэкенд ответил бы 409. */
export function useEstimate(id: string, planStamp: number) {
  return useQuery({
    queryKey: qk.estimate(id, planStamp),
    queryFn: ({ signal }) => api.get<PlanEstimate>(`/projects/${segment(id)}/estimate`, { signal }),
    enabled: planStamp > 0,
    placeholderData: keepPreviousData,
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
    channel: job.channel,
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
    onSuccess: (episode, body) => {
      storeEpisode(client, episode, true)
      // Выпуск из идеи: идея стала «взята в выпуск»
      if (body.idea_id) void client.invalidateQueries({ queryKey: qk.ideas(episode.channel) })
    },
  })
}

/** Идея руками — сразу в бэклог */
export function useCreateIdea(channel: ChannelId) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: Omit<IdeaCreate, 'channel'>) => api.post<Idea>('/ideas', { ...body, channel }),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.ideas(channel) }),
  })
}

/** Правка идеи и смена статуса («В бэклог», «Убрать», «Вернуть»); неверный переход — 409 с текстом бэкенда */
export function usePatchIdea(channel: ChannelId) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: IdeaPatch }) => api.patch<Idea>(`/ideas/${segment(id)}`, patch),
    onSuccess: (idea) => {
      client.setQueryData<Idea[]>(qk.ideas(channel), (list) => list?.map((i) => (i.id === idea.id ? idea : i)))
      void client.invalidateQueries({ queryKey: qk.ideas(channel) })
    },
  })
}

/** Промпт идей канала для копирования; бэкенд открывает обмен моста `ideas` */
export function useIdeasPrompt(channel: ChannelId) {
  return useMutation({
    mutationFn: (count?: number) => api.post<IdeasPrompt>('/ideas/prompt', { channel, count }),
  })
}

/** Ответ чата → идеи `proposed`; пропущенные — в отчёте. Ни одной принятой — 422 `BridgeError` */
export function useApplyIdeasAnswer(channel: ChannelId) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (text: string) => api.post<IdeasAnswerResult>('/ideas/answer', { channel, text }, { timeoutMs: 60_000 }),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.ideas(channel) }),
  })
}

/** Семена ниши канала: ответ — профиль целиком, кладём его в список каналов */
export function usePatchChannelSeeds(channel: ChannelId) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (seeds: string[]) => api.patch<ChannelProfile>(`/channels/${segment(channel)}`, { seeds }),
    onSuccess: (profile) =>
      client.setQueryData<ChannelProfile[]>(qk.channels, (list) => list?.map((c) => (c.id === profile.id ? profile : c))),
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

/** Заявка целиком (автосохранение, ключ `brief:<id>`): ответ — project.json, кладём в кэш */
export function useSaveBrief(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (brief: EpisodeBrief) =>
      api.patch<Project>(`/projects/${segment(id)}`, { brief }, { keepalive: true }),
    onSuccess: (project) => client.setQueryData(qk.project(id), project),
  })
}

/** Промпт части `part` для копирования; бэкенд открывает обмен — последний прогон в наборе частей меняется */
export function usePlanPrompt(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (part: number) =>
      api.post<PlanPrompt>(`/projects/${segment(id)}/plan/prompt`, undefined, { query: { part } }),
    onSettled: () => void client.invalidateQueries({ queryKey: qk.planParts(id) }),
  })
}

/** Ответ чата: часть в набор или, после последней, новая версия плана — и стадия выпуска «Сценарий» */
export function useApplyPlanAnswer(id: string) {
  const client = useQueryClient()
  return useMutation({
    // Ответ на часть из 26 кадров проверяется дольше обычного запроса
    mutationFn: (text: string) =>
      api.post<PlanAnswerResult>(`/projects/${segment(id)}/plan/answer`, { text }, { timeoutMs: 60_000 }),
    onSettled: () => {
      // Отказ тоже меняет набор: последний обмен закрыт с ошибкой
      void client.invalidateQueries({ queryKey: qk.planParts(id) })
    },
    onSuccess: (result) => {
      if (result.import_result) {
        // Новая версия плана: план, счётчики выпуска и его стадия на доске
        void client.invalidateQueries({ queryKey: qk.plan(id) })
        void client.invalidateQueries({ queryKey: qk.episode(id) })
        void client.invalidateQueries({ queryKey: qk.episodeLists })
      }
    },
  })
}

/** Проверка плана из JSON-редактора без записи: те же правила, что у импорта; кэш не трогает */
export function useValidateDirector(id: string) {
  return useMutation({
    mutationFn: (plan: Record<string, unknown>) => api.post<PlanCheck>(`/projects/${segment(id)}/director/validate`, plan),
  })
}

/** «Сохранить как версию»: план из JSON — новая версия `source: manual` (или та же, если совпал хэш). Меняются
 *  project.json, действующий план, смета, стадия выпуска (`generate` → `script`) и его счётчики. */
export function useSaveDirectorVersion(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (plan: Record<string, unknown>) =>
      api.post<ImportResult>(`/projects/${segment(id)}/director`, plan, { query: { source: 'manual' }, timeoutMs: 60_000 }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.project(id) })
      void client.invalidateQueries({ queryKey: qk.episode(id) })
      void client.invalidateQueries({ queryKey: qk.episodeLists })
    },
  })
}

/** «Утвердить план» (M4.6): ответ — выпуск в стадии «Генерация». Рельс и доска берут стадию из кэша выпуска и
 *  списков, кнопка — `approved_version` из плана. Отказ 409 — `approvalRefusal(error)`. */
export function useApprovePlan(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<EpisodeListItem>(`/episodes/${segment(id)}/approve`),
    onSuccess: (episode) => {
      storeEpisode(client, episode, false)
      void client.invalidateQueries({ queryKey: qk.project(id) })
    },
  })
}

/** Референс канала из субтитров; «не похоже на субтитры» — 422 с текстом бэкенда */
export function useCreateReference(channel: ChannelId) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: Omit<ReferenceCreate, 'channel'>) => api.post<ReferenceVideo>('/references', { ...body, channel }),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.references(channel) }),
  })
}

/** Промпт разбора референса; бэкенд открывает обмен моста `reference` */
export function useReferencePrompt(id: string) {
  return useMutation({
    mutationFn: () => api.post<ReferencePrompt>(`/references/${segment(id)}/prompt`),
  })
}

/** Ответ чата → разбор референса; ошибка — 422 `BridgeError` с номерами сегментов */
export function useApplyReferenceAnswer(channel: ChannelId, id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (text: string) =>
      api.post<ReferenceVideo>(`/references/${segment(id)}/answer`, { text }, { timeoutMs: 60_000 }),
    onSuccess: (reference) => {
      client.setQueryData<ReferenceVideo[]>(qk.references(channel), (list) =>
        list?.map((r) => (r.id === reference.id ? reference : r)),
      )
      void client.invalidateQueries({ queryKey: ['references'] })
    },
  })
}

/** «Новая тема по этой структуре» / «Своя версия этой темы»: выпуск по референсу в ближайшем свободном слоте */
export function useCreateEpisodeFromReference(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (mode: ReferenceEpisodeCreate['mode']) =>
      api.post<EpisodeListItem>(`/references/${segment(id)}/episodes`, { mode }),
    onSuccess: (episode) => storeEpisode(client, episode, true),
  })
}

/** Назначение выпуска в слот (`date`) или снятие со слота (`date: null`) */
export interface SlotChange extends SlotAssign {
  id: string
  channel: ChannelId
}

/** Снимок кэша до оптимистичной записи — для отката */
type CacheSnapshot = [readonly unknown[], unknown][]

/** Оптимистично: ячейка и `slot_date` в кэше меняются до ответа, отказ (409, 422) возвращает снимок. Догадка
 *  о состоянии ячейки (пустой ↔ занят) живёт до перезапроса слотов — дальше состояние и риск снова от бэкенда. */
export function useSetSlot() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, date }: SlotChange) => api.put<EpisodeListItem>(`/episodes/${segment(id)}/slot`, { date }),
    onMutate: async (change): Promise<CacheSnapshot> => {
      const keys = [qk.slots, qk.episodeLists, qk.episode(change.id)]
      await Promise.all(keys.map((queryKey) => client.cancelQueries({ queryKey })))
      const snapshot = keys.flatMap((queryKey) => client.getQueriesData({ queryKey }))
      client.setQueryData<Slot[]>(qk.slots, (slots) => slots?.map((slot) => moveInSlot(slot, change)))
      client.setQueriesData<EpisodeListItem[]>({ queryKey: qk.episodeLists }, (list) =>
        list?.map((episode) => (episode.id === change.id ? { ...episode, slot_date: change.date } : episode)),
      )
      client.setQueryData<EpisodeListItem>(qk.episode(change.id), (episode) => episode && { ...episode, slot_date: change.date })
      return snapshot
    },
    onError: (_error, _change, snapshot) => {
      for (const [queryKey, data] of snapshot ?? []) client.setQueryData(queryKey, data)
    },
    onSuccess: (episode) => client.setQueryData(qk.episode(episode.id), episode),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.episodeLists })
      void client.invalidateQueries({ queryKey: qk.slots })
    },
  })
}

function moveInSlot(slot: Slot, { id, channel, date }: SlotChange): Slot {
  if (slot.date === date) {
    return { ...slot, episode_id: id, channel, state: slot.state === 'empty' ? 'filled' : slot.state, risk: null }
  }
  if (slot.episode_id === id) {
    return { ...slot, episode_id: null, channel: null, state: slot.state === 'filled' ? 'empty' : slot.state, risk: null }
  }
  return slot
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
