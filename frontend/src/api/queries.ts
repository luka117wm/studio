// Запросы к бэкенду через TanStack Query: ключи и пути `/api` — только здесь, типы ответов — только `@/types/*`.
// Данные API живут в кэше запросов, не в Zustand (решение 6 устава M3). Свежесть держат мутации и поток SSE
// (`live.ts`), опроса по таймеру нет.
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import type { BatchEstimate, BatchResult, BatchSummary } from '@/types/batch'
import type { BatchCreate } from '@/types/batch_request'
import type { BridgeSettings } from '@/types/bridge'
import type {
  AnchorSetState,
  AnchorsEstimate,
  AppearanceCopy,
  CanonNeeded,
  CanonSummary,
  CharacterDoc,
  PeriodAnswerResult,
  PeriodDoc,
  PeriodPrompt,
  StyleDoc,
} from '@/types/canon'
import type { ChannelProfile, FormatPreview } from '@/types/channel'
import type { CostSummary } from '@/types/cost'
import type { Director } from '@/types/director'
import type { EpisodeCreate, EpisodeListItem, EpisodePatch } from '@/types/episode'
import type { Idea, IdeaCreate, IdeaPatch, IdeasAnswerResult, IdeasPrompt } from '@/types/idea'
import type { Job, JobEventData, JobList } from '@/types/job'
import type {
  EffectivePlan,
  EpisodeCanon,
  PlanAnswerResult,
  PlanCheck,
  PlanEstimate,
  PlanParts,
  PlanPrompt,
  ShotPrompt,
  SimilarityReport,
} from '@/types/plan'
import type { StageCatalog } from '@/types/provider'
import type { ReferenceCreate, ReferenceEpisodeCreate, ReferencePrompt, ReferenceVideo } from '@/types/reference'
import type { EpisodeBrief, ImportResult, Project, ShotImages } from '@/types/project'
import type { RedrawBody } from '@/types/shot'
import type { RedrawEstimate } from '@/types/shot_redraw'
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
  /** Префикс сводок расходов: конец любого джоба перезапрашивает их — платный джоб списал деньги */
  cost: ['cost'] as const,
  costSummary: (channel: ChannelId) => ['cost', 'summary', channel] as const,
  slots: ['slots'] as const,
  format: (channel: ChannelId) => ['formats', channel] as const,
  jobs: ['jobs'] as const,
  /** Джоб целиком, с payload и result (`GET /api/jobs/{id}`): снимок `qk.jobs` их не несёт */
  job: (id: string) => ['job', id] as const,
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
  /** Предпросмотр запроса кадра; `stamp` — как у сметы: правка кадра перезапрашивает план, а с ним и промпт */
  shotPrompt: (id: string, shotId: string, stamp: number) => ['projects', id, 'plan', 'prompt', shotId, stamp] as const,
  /** Смета пачки «Сгенерировать N кадров» — под префиксом выпуска: запись project.json перезапрашивает и её;
   *  это же префикс смет пачки выбранных кадров (`generateEstimateOf`) */
  generateEstimate: (id: string) => ['projects', id, 'generate', 'estimate'] as const,
  generateEstimateOf: (id: string, query: { shots: string; model: string; redraw: boolean }) =>
    ['projects', id, 'generate', 'estimate', query] as const,
  /** Цена и вариант перерисовки кадра моделью — под префиксом выпуска */
  redrawEstimate: (id: string, shotId: string, model: string) => ['projects', id, 'shots', shotId, 'redraw', model] as const,
  /** Каталог моделей этапа с ценой единицы (`GET /api/providers/catalog/{stage}`) — меняется только с конфигом */
  catalog: (stage: string) => ['catalog', stage] as const,
  /** Сводка пачки: ответ постановки, паузы и отмены и событие `batch.updated` кладут её сюда целиком */
  batch: (id: string) => ['batches', id] as const,
  /** Префикс канона канала: публикация и конец джоба опорных перезапрашивают всё под ним */
  canon: (channel: string) => ['canon', channel] as const,
  canonSummary: (channel: string) => ['canon', channel, 'summary'] as const,
  canonNeeded: (channel: string) => ['canon', channel, 'needed'] as const,
  /** Канон выпуска — под префиксом канона канала: публикация и конец джоба листа перезапрашивают его; `version` —
   *  текущая версия плана, новая версия (перевод, импорт) — новый ключ */
  episodeCanon: (channel: string, id: string, version: string) => ['canon', channel, 'episode', id, version] as const,
  /** Документ слоя (`style`, `periods/<id>`, `characters/<id>`): `head` — черновик, а без него последняя версия;
   *  `vNNN` — версия как есть */
  canonDoc: (channel: string, path: string, version: string | null) => ['canon', channel, ...path.split('/'), version ?? 'head'] as const,
  /** Префикс наборов опорных канала (листы обликов, кадры стиля, сметы) — по ходу джоба опорных */
  canonAnchors: (channel: string) => ['canon', channel, 'anchors'] as const,
  styleAnchors: (channel: string) => ['canon', channel, 'anchors', 'style'] as const,
  anchorsEstimate: (channel: string) => ['canon', channel, 'anchors', 'estimate'] as const,
  appearanceAnchors: (channel: string, appearance: string) => ['canon', channel, 'anchors', appearance] as const,
  appearanceEstimate: (channel: string, appearance: string) => ['canon', channel, 'anchors', appearance, 'estimate'] as const,
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

/** Канон выпуска (M5.2, docs/project_schema.md, «Канон выпуска»): прибитые версии, статусы, листы и проблемы, с
 *  которыми откажет «Утвердить план». Без плана (`version` null) не запрашивается. */
export function useEpisodeCanon(channel: ChannelId, id: string, version: string | null) {
  return useQuery({
    queryKey: qk.episodeCanon(channel, id, version ?? ''),
    queryFn: ({ signal }) => api.get<EpisodeCanon | null>(`/projects/${segment(id)}/canon`, { signal }),
    enabled: version !== null,
  })
}

/** Итоговый запрос кадра (M5.5, docs/prompt_assembly.md): собирает бэкенд, экран только показывает (принцип 13).
 *  `shotId` null — предпросмотр закрыт, запроса нет. */
export function useShotPrompt(id: string, shotId: string | null, planStamp: number) {
  return useQuery({
    queryKey: qk.shotPrompt(id, shotId ?? '', planStamp),
    queryFn: ({ signal }) => api.get<ShotPrompt>(`/projects/${segment(id)}/shots/${segment(shotId ?? '')}/prompt`, { signal }),
    enabled: shotId !== null,
  })
}

// --- кадры выпуска (экран 4, docs/generation.md) ---------------------------------------------------

/** Вид джоба кадра: его события двигают плитки экрана 4 */
export const SHOT_JOB = 'shot_image'

/** Миниатюра версии кадра, webp 160 или 320; адрес версии неизменяем — браузер кэширует его навсегда */
export function shotThumb(id: string, shotId: string, version: number, width: 160 | 320 = 320): string {
  return `/api/projects/${segment(id)}/shots/${segment(shotId)}/images/${version}/thumb?w=${width}`
}

/** Картинка версии как есть (png, jpg или webp — как отдала модель) */
export function shotFile(id: string, shotId: string, version: number): string {
  return `/api/projects/${segment(id)}/shots/${segment(shotId)}/images/${version}/file`
}

/** Пачка выпуска — последняя, у которой есть джоб кадра в снимке джобов (`qk.jobs`: снимок и поток SSE).
 *  Эндпоинта «пачка выпуска» нет, снимок держит 200 последних джобов. */
export function latestBatchId(items: readonly JobEventData[], episodeId: string): string | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const job = items[i]!
    if (job.episode_id === episodeId && job.kind === SHOT_JOB && job.batch_id !== null) return job.batch_id
  }
  return null
}

/** Сводка пачки выпуска: `null` — пачек не было, `undefined` — ещё грузится (снимок джобов или сама сводка) */
export function useEpisodeBatch(episodeId: string): { data: BatchSummary | null | undefined; error: Error | null } {
  const items = useJobs().data?.items
  const batchId = items ? latestBatchId(items, episodeId) : null
  const batch = useQuery({
    queryKey: qk.batch(batchId ?? ''),
    queryFn: ({ signal }) => api.get<BatchSummary>(`/batches/${segment(batchId ?? '')}`, { signal }),
    enabled: batchId !== null,
  })
  if (!items) return { data: undefined, error: null }
  return { data: batchId === null ? null : batch.data, error: batch.error }
}

/** Смета пачки до клика: кадры без картинки и `stale`, цена кадра модели по умолчанию. До утверждения бэкенд
 *  ответил бы 409 — не запрашивается. */
export function useGenerateEstimate(id: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.generateEstimate(id),
    queryFn: ({ signal }) => api.get<BatchEstimate>(`/projects/${segment(id)}/generate/estimate`, { signal }),
    enabled,
  })
}

/** Каталог моделей этапа: сегменты модели и цена единицы в подсказке (`docs/providers.md`, «API») */
export function useCatalog(stage: string) {
  return useQuery({
    queryKey: qk.catalog(stage),
    queryFn: ({ signal }) => api.get<StageCatalog>(`/providers/catalog/${segment(stage)}`, { signal }),
    staleTime: Infinity,
  })
}

/** Смета пачки выбранных кадров следующим вариантом (`redraw: true`) выбранной моделью; ничего не выбрано — нет
 *  запроса. Пока идёт новая смета, видна прежняя. */
export function useRedrawBatchEstimate(id: string, shots: readonly string[], model: string | null) {
  const query = { shots: shots.join(','), model: model ?? '', redraw: true }
  return useQuery({
    queryKey: qk.generateEstimateOf(id, query),
    queryFn: ({ signal }) => api.get<BatchEstimate>(`/projects/${segment(id)}/generate/estimate`, { signal, query }),
    enabled: shots.length > 0 && model !== null,
    placeholderData: keepPreviousData,
  })
}

/** Какой вариант и почём нарисует «Перерисовать» кадра этой моделью; `enabled` — подсказка или диалог открыты */
export function useRedrawEstimate(id: string, shotId: string, model: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.redrawEstimate(id, shotId, model ?? ''),
    queryFn: ({ signal }) =>
      api.get<RedrawEstimate>(`/projects/${segment(id)}/shots/${segment(shotId)}/redraw/estimate`, { signal, query: { model: model ?? undefined } }),
    enabled: enabled && model !== null,
  })
}

/** «Перерисовать» и «С правкой…» (`POST …/redraw`): джоб следующего варианта. С `prompt` бэкенд сначала проверяет
 *  правку (стоп-лист — 422 в форме PATCH, ничего не пишет), затем бюджет — 409. */
export function useRedraw(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ shotId, ...body }: RedrawBody & { shotId: string }) =>
      api.post<Job>(`/projects/${segment(id)}/shots/${segment(shotId)}/redraw`, body),
    onSuccess: (job, { shotId, prompt }) => {
      rememberJob(client, job)
      refreshShots(client, id)
      // Следующий вариант сдвинулся, а правка действия видна на листе и в диалоге
      void client.invalidateQueries({ queryKey: ['projects', id, 'shots', shotId] })
      if (prompt !== undefined && prompt !== null) void client.invalidateQueries({ queryKey: qk.plan(id), exact: true })
    },
  })
}

/** «Выбрать версию N» (`POST …/images/{version}/choose`): выбранная идёт в монтаж, кадр `done`. Ответ (`ShotImages`)
 *  сразу кладётся в project.json кэша — рамка и плитка переезжают без ожидания перезапроса; статус выпуска (пометки
 *  проверок — у выбранной) приходит перезапросом выпуска. */
export function useChooseVersion(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ shotId, version }: { shotId: string; version: number }) =>
      api.post<ShotImages>(`/projects/${segment(id)}/shots/${segment(shotId)}/images/${version}/choose`),
    onSuccess: (images) => {
      client.setQueryData<Project>(qk.project(id), (project) => {
        const state = project?.shots[images.shot_id]
        if (!project || !state) return project
        const chosen = { ...state, image_version: images.image_version, status: images.status, stale_reasons: [], error: null }
        return { ...project, shots: { ...project.shots, [images.shot_id]: chosen } }
      })
      refreshShots(client, id)
    },
  })
}

/** Пачка известна снимку джобов сразу после постановки, не дожидаясь потока: строка её первого джоба */
async function trackBatch(client: QueryClient, batchId: string) {
  const list = await api.get<JobList>('/jobs', { query: { batch: batchId, limit: 1 } })
  for (const job of list.items) rememberJob(client, job)
}

/** После записи кадров выпуска: project.json (статусы, версии), смета пачки, выпуск и его строка в списках */
function refreshShots(client: QueryClient, id: string) {
  void client.invalidateQueries({ queryKey: qk.project(id), exact: true })
  void client.invalidateQueries({ queryKey: qk.generateEstimate(id) })
  void client.invalidateQueries({ queryKey: qk.episode(id) })
  void client.invalidateQueries({ queryKey: qk.episodeLists })
}

const settledJobs = (summary: BatchSummary) => summary.jobs.done + summary.jobs.failed + summary.jobs.cancelled

/** Сводка из ответа записи не затирает более позднюю из потока: событие конца джоба могло прийти раньше ответа */
function storeBatch(client: QueryClient, summary: BatchSummary) {
  client.setQueryData<BatchSummary>(qk.batch(summary.id), (current) =>
    current && settledJobs(current) > settledJobs(summary) ? current : summary,
  )
}

/** «Сгенерировать N кадров» — пачка из кадров без картинки и `stale` (`POST …/generate`, тело пустое);
 *  «Перерисовать выбранные» — `{shots, model, redraw: true}`. Отказ — 409 с текстом: бюджет суммой
 *  (`BudgetRefusal`), рисовать нечего, кадры заняты (`BatchRefusal`) */
export function useGenerate(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: BatchCreate) => api.post<BatchResult>(`/projects/${segment(id)}/generate`, body),
    onSuccess: (result) => {
      storeBatch(client, result.batch)
      void trackBatch(client, result.batch.id).catch(() => {}) // поток SSE всё равно принесёт джобы пачки
      refreshShots(client, id)
    },
  })
}

export type BatchAction = 'pause' | 'resume' | 'cancel'

/** Пауза, продолжение, отмена пачки — ответ сводкой. Отмена возвращает кадры из очереди к их статусу. */
export function useBatchAction(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ batchId, action }: { batchId: string; action: BatchAction }) =>
      api.post<BatchSummary>(`/batches/${segment(batchId)}/${action}`),
    onSuccess: (summary, { action }) => {
      storeBatch(client, summary)
      if (action === 'cancel') refreshShots(client, id)
    },
  })
}

/** «Перевести на новые версии» (M5.2): новая версия плана `manual` с последними версиями канона, затронутые кадры —
 *  `stale` с причиной. Меняются план, project.json, стадия выпуска (`generate` → `script`) и его счётчики. */
export function useUpdateEpisodeCanon(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<ImportResult>(`/projects/${segment(id)}/canon/update`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.project(id) })
      void client.invalidateQueries({ queryKey: qk.episode(id) })
      void client.invalidateQueries({ queryKey: qk.episodeLists })
    },
  })
}

// --- канон канала (экран 12, docs/canon_schema.md) ------------------------------------------------

const canonPath = (channel: ChannelId, rest = '') => `/canon/${segment(channel)}${rest}`

/** Сводка канона: версии стиля, эпохи и персонажи с черновиками и счётчиками */
export function useCanonSummary(channel: ChannelId) {
  return useQuery({
    queryKey: qk.canonSummary(channel),
    queryFn: ({ signal }) => api.get<CanonSummary>(canonPath(channel), { signal }),
  })
}

/** Слой канона по пути: `style`, `periods/<эпоха>`, `characters/<персонаж>` (docs/canon_schema.md, «API») */
export type CanonPath = 'style' | `periods/${string}` | `characters/${string}`

/** Документ слоя: черновик или версия; у всех слоёв одна форма */
export type CanonDocOf<P extends CanonPath> = P extends 'style' ? StyleDoc : P extends `periods/${string}` ? PeriodDoc : CharacterDoc
export type CanonDataOf<P extends CanonPath> = CanonDocOf<P>['data']

const docPath = (path: CanonPath) =>
  path
    .split('/')
    .map((part) => segment(part))
    .join('/')

/** Документ слоя. `version: null` — шапка: черновик, а без него последняя версия; сущности нет вовсе (404) — `null`.
 *  Версия неизменяема — повторно не запрашивается. */
export function useCanonDoc<P extends CanonPath>(channel: ChannelId, path: P, version: string | null, enabled = true) {
  return useQuery({
    enabled,
    queryKey: qk.canonDoc(channel, path, version),
    queryFn: async ({ signal }) => {
      try {
        return await api.get<CanonDocOf<P>>(canonPath(channel, `/${docPath(path)}`), { signal, query: { version } })
      } catch (error) {
        if (version === null && error instanceof ApiError && error.status === 404) return null
        throw error
      }
    },
    staleTime: version === null ? 0 : Infinity,
  })
}

/** Черновик слоя целиком (автосохранение, ключ `canon:<канал>:<путь>`): ответ — документ черновика в шапку */
export function useSaveCanonDraft<P extends CanonPath>(channel: ChannelId, path: P) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (data: CanonDataOf<P>) => api.put<CanonDocOf<P>>(canonPath(channel, `/${docPath(path)}/draft`), data, { keepalive: true }),
    onSuccess: (doc) => {
      client.setQueryData(qk.canonDoc(channel, path, null), doc)
      void client.invalidateQueries({ queryKey: qk.canonSummary(channel) })
      void client.invalidateQueries({ queryKey: qk.canonNeeded(channel) })
    },
  })
}

/** Новая сущность слоя («Новый период», «Дублировать период», «Новый персонаж»): черновик по пути, которого ещё нет.
 *  Путь известен только в момент записи — id набирает человек, поэтому он в аргументах, а не в хуке. */
export function useCreateCanonDraft(channel: ChannelId) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ path, data }: { path: `periods/${string}` | `characters/${string}`; data: CanonDataOf<`periods/${string}`> | CanonDataOf<`characters/${string}`> }) =>
      api.put<PeriodDoc | CharacterDoc>(canonPath(channel, `/${docPath(path)}/draft`), data),
    onSuccess: (doc, { path }) => {
      client.setQueryData(qk.canonDoc(channel, path, null), doc)
      void client.invalidateQueries({ queryKey: qk.canonSummary(channel) })
      void client.invalidateQueries({ queryKey: qk.canonNeeded(channel) })
    },
  })
}

/** «Создать vN из vM»: черновик из версии; черновик уже есть — 409 с текстом бэкенда */
export function useCanonDraftFrom<P extends CanonPath>(channel: ChannelId, path: P) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (from: string) => api.post<CanonDocOf<P>>(canonPath(channel, `/${docPath(path)}/draft`), undefined, { query: { from } }),
    onSuccess: (doc) => {
      client.setQueryData(qk.canonDoc(channel, path, null), doc)
      void client.invalidateQueries({ queryKey: qk.canonSummary(channel) })
    },
  })
}

/** «Сбросить черновик»: версии не трогаются, шапка — снова последняя версия (или сущности больше нет) */
export function useDiscardCanonDraft(channel: ChannelId, path: CanonPath) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete(canonPath(channel, `/${docPath(path)}/draft`)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.canonDoc(channel, path, null) })
      void client.invalidateQueries({ queryKey: qk.canonSummary(channel) })
      void client.invalidateQueries({ queryKey: qk.canonNeeded(channel) })
    },
  })
}

/** «Опубликовать vN»: черновик → новая версия; от неё зависят сводка, шапка, «нужно каналу» и устаревание опорных */
export function usePublishCanon<P extends CanonPath>(channel: ChannelId, path: P) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<CanonDocOf<P>>(canonPath(channel, `/${docPath(path)}/publish`)),
    // Перезапрос ждём: тост «Опубликована vN» и закрытие диалога — уже со статусами листов против новой версии,
    // иначе карточка облика долю секунды показывала прежний «готов 6/6» (хвост M5.11)
    onSuccess: async (doc) => {
      client.setQueryData(qk.canonDoc(channel, path, null), doc)
      if (doc.version) client.setQueryData(qk.canonDoc(channel, path, doc.version), doc)
      await client.invalidateQueries({ queryKey: qk.canon(channel) })
    },
  })
}

/** «Нужно каналу»: эпохи и облики из планов выпусков без опубликованной версии */
export function useCanonNeeded(channel: ChannelId) {
  return useQuery({
    queryKey: qk.canonNeeded(channel),
    queryFn: ({ signal }) => api.get<CanonNeeded>(canonPath(channel, '/needed'), { signal }),
  })
}

/** «Создать» из «нужно каналу»: скелет-черновик эпохи или облик в черновике персонажа; отказ — 409 с текстом */
export function useCreateNeeded(channel: ChannelId) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, id }: { kind: 'periods' | 'appearances'; id: string }) =>
      api.post<PeriodDoc | CharacterDoc>(canonPath(channel, `/needed/${kind}/${segment(id)}`)),
    onSuccess: (doc, { kind }) => {
      const path: CanonPath = kind === 'periods' ? `periods/${doc.data.id}` : `characters/${doc.data.id}`
      client.setQueryData(qk.canonDoc(channel, path, null), doc)
      void client.invalidateQueries({ queryKey: qk.canonSummary(channel) })
      void client.invalidateQueries({ queryKey: qk.canonNeeded(channel) })
    },
  })
}

/** Промпт эпохи для чата (`draft` — черновик целиком, `forbidden` — «Дополнить запреты»); обмен `prompted` */
export function usePeriodPrompt(channel: ChannelId, periodId: string) {
  return useMutation({
    mutationFn: (mode: PeriodPrompt['mode']) =>
      api.post<PeriodPrompt>(canonPath(channel, `/periods/${segment(periodId)}/prompt`), undefined, { query: { mode } }),
  })
}

/** Ответ чата → черновик эпохи; неверный ответ — 422 `BridgeError`, на диске ничего */
export function useApplyPeriodAnswer(channel: ChannelId, periodId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ mode, text }: { mode: PeriodPrompt['mode']; text: string }) =>
      api.post<PeriodAnswerResult>(canonPath(channel, `/periods/${segment(periodId)}/answer`), { text }, { query: { mode }, timeoutMs: 60_000 }),
    onSuccess: (result) => {
      client.setQueryData(qk.canonDoc(channel, `periods/${periodId}`, null), result.doc)
      void client.invalidateQueries({ queryKey: qk.canonSummary(channel) })
      void client.invalidateQueries({ queryKey: qk.canonNeeded(channel) })
    },
  })
}

/** Лист опорных портретов облика: готовность 6/6, устаревание против последней версии, оплаченное */
export function useAppearanceAnchors(channel: ChannelId, appearanceId: string) {
  return useQuery({
    queryKey: qk.appearanceAnchors(channel, appearanceId),
    queryFn: ({ signal }) => api.get<AnchorSetState>(canonPath(channel, `/appearances/${segment(appearanceId)}/anchors`), { signal }),
  })
}

/** Листы нескольких обликов — те же запросы, что у карточек облика: сводка «N листов готово» */
export function useAppearanceSheets(channel: ChannelId, appearanceIds: string[]) {
  return useQueries({
    queries: appearanceIds.map((id) => ({
      queryKey: qk.appearanceAnchors(channel, id),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<AnchorSetState>(canonPath(channel, `/appearances/${segment(id)}/anchors`), { signal }),
    })),
  }).map((result) => result.data)
}

/** Цена листа облика до клика — смета бэкенда по адресу облика, кэш не вычитается */
export function useAppearanceEstimate(channel: ChannelId, appearanceId: string) {
  return useQuery({
    queryKey: qk.appearanceEstimate(channel, appearanceId),
    queryFn: ({ signal }) => api.get<AnchorsEstimate>(canonPath(channel, `/appearances/${segment(appearanceId)}/anchors/estimate`), { signal }),
  })
}

/** «Скопировать облик в другой период»: новый облик в черновике персонажа, лица и телосложение — побайтово */
export function useCopyAppearance(channel: ChannelId, characterId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ source, ...body }: AppearanceCopy & { source: string }) =>
      api.post<CharacterDoc>(canonPath(channel, `/appearances/${segment(source)}/copy`), body),
    onSuccess: (doc) => {
      client.setQueryData(qk.canonDoc(channel, `characters/${characterId}`, null), doc)
      void client.invalidateQueries({ queryKey: qk.canonSummary(channel) })
    },
  })
}

/** Кадры стиля: выбор по шаблону и устаревание против последней версии стиля */
export function useStyleAnchors(channel: ChannelId, enabled: boolean) {
  return useQuery({
    queryKey: qk.styleAnchors(channel),
    queryFn: ({ signal }) => api.get<AnchorSetState>(canonPath(channel, '/style/anchors'), { signal }),
    enabled,
  })
}

/** Цена до клика «Пересобрать (6, ~$0.80)» — смета бэкенда, кэш не вычитается */
export function useAnchorsEstimate(channel: ChannelId, enabled: boolean) {
  return useQuery({
    queryKey: qk.anchorsEstimate(channel),
    queryFn: ({ signal }) => api.get<AnchorsEstimate>(canonPath(channel, '/style/anchors/estimate'), { signal }),
    enabled,
  })
}

/** «Пересобрать кадры стиля» в эпохе: джоб в снимок сразу, дальше его ведёт поток SSE. Отказ бюджета — 409
 *  `BudgetRefusal`, джоб не создаётся. */
export function useCollectStyleAnchors(channel: ChannelId) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (period: string) => api.post<Job>(canonPath(channel, '/style/anchors'), { period }),
    onSuccess: (job) => rememberJob(client, job),
  })
}

/** Джоб из ответа постановки или отмены — целиком в `qk.job`, в снимок — если его там ещё нет: событие потока
 *  могло прийти раньше ответа и новее его */
function rememberJob(client: QueryClient, job: Job) {
  client.setQueryData(qk.job(job.id), job)
  client.setQueryData<LiveJobs>(qk.jobs, (jobs) =>
    !jobs || jobs.items.some((item) => item.job_id === job.id) ? jobs : { ...jobs, items: [...jobs.items, toJobState(job)] },
  )
}

// --- лист опорных портретов облика (M5.9, docs/canon_schema.md, «API опорных») ---------------------

const anchorsPath = (channel: ChannelId, appearanceId: string, rest = '') => canonPath(channel, `/appearances/${segment(appearanceId)}/anchors${rest}`)

/** Миниатюра webp кандидата (принцип 12): сетки не грузят полноразмерные картинки. `target` — облик или `style` */
export function anchorThumb(channel: ChannelId, target: string, candidate: string, width: 160 | 320 = 320): string {
  return `/api${canonPath(channel, `/anchors/${segment(target)}/${segment(candidate)}/thumb`)}?w=${width}`
}

/** «Собрать лист»: джоб `anchor_sheet` — фасы, затем остальные ракурсы с фасом-референсом */
export function useCollectSheet(channel: ChannelId, appearanceId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<Job>(anchorsPath(channel, appearanceId)),
    onSuccess: (job) => rememberJob(client, job),
  })
}

/** «Перегенерировать ракурс»: джоб `anchor_angle`, новые кандидаты одного ракурса */
export function useRegenerateAngle(channel: ChannelId, appearanceId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (angle: string) => api.post<Job>(anchorsPath(channel, appearanceId, `/${segment(angle)}/regenerate`)),
    onSuccess: (job) => rememberJob(client, job),
  })
}

/** «Пересобрать устаревшие ракурсы»: один джоб `anchor_angle` на все устаревшие ракурсы листа */
export function useRegenerateStale(channel: ChannelId, appearanceId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<Job>(anchorsPath(channel, appearanceId, '/stale')),
    onSuccess: (job) => rememberJob(client, job),
  })
}

/** Выбор и отбраковка кандидата — одна запись; ответ — лист целиком: карточка облика видит его сразу */
function useSheetPick(channel: ChannelId, appearanceId: string, action: 'choose' | 'reject') {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ angle, candidate }: { angle: string; candidate: string }) =>
      api.post<AnchorSetState>(anchorsPath(channel, appearanceId, `/${segment(angle)}/${action}`), { candidate }),
    onSuccess: (state) => {
      client.setQueryData(qk.appearanceAnchors(channel, appearanceId), state)
      void client.invalidateQueries({ queryKey: qk.appearanceEstimate(channel, appearanceId) })
      void client.invalidateQueries({ queryKey: qk.canonSummary(channel) })
    },
  })
}

export const useChooseCandidate = (channel: ChannelId, appearanceId: string) => useSheetPick(channel, appearanceId, 'choose')
export const useRejectCandidate = (channel: ChannelId, appearanceId: string) => useSheetPick(channel, appearanceId, 'reject')

/** Заказ джоба опорных (`AnchorOrder`, docs/jobs.md): набор и кандидаты в порядке рисования */
export interface AnchorOrderPayload {
  target: string
  /** Версия персонажа облика, с которой рисует заказ */
  version: string
  items: { slot: string; label: string; n: number }[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export function anchorOrderOf(job: Job | undefined): AnchorOrderPayload | null {
  const payload = job?.payload
  if (!payload || typeof payload.target !== 'string' || !Array.isArray(payload.items)) return null
  const items = payload.items.filter(isRecord).map((item) => ({ slot: String(item.slot), label: String(item.label), n: Number(item.n) }))
  return { target: payload.target, version: String(payload.version), items }
}

/** Джобы листа облика: сборка и перегенерация ракурсов (кадры стиля — `style_anchors`) */
export const SHEET_KINDS: ReadonlySet<string> = new Set(['anchor_sheet', 'anchor_angle'])
export const ACTIVE_JOB: ReadonlySet<JobEventData['status']> = new Set(['queued', 'running'])

export interface SheetJob {
  state: JobEventData
  order: AnchorOrderPayload
}

/** Идущий джоб листа облика. Событие SSE набора не называет: набор — в payload джоба, его даёт `GET /api/jobs/{id}`
 *  (один запрос на джоб: payload не меняется) */
export function useSheetJob(channel: ChannelId, appearanceId: string): SheetJob | null {
  const items = useJobs().data?.items ?? []
  const active = items.filter((job) => job.channel === channel && SHEET_KINDS.has(job.kind) && ACTIVE_JOB.has(job.status))
  const details = useQueries({
    queries: active.map((job) => ({
      queryKey: qk.job(job.job_id),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<Job>(`/jobs/${segment(job.job_id)}`, { signal }),
      staleTime: Infinity,
    })),
  })
  const index = details.findIndex((detail) => anchorOrderOf(detail.data)?.target === appearanceId)
  const order = index === -1 ? null : anchorOrderOf(details[index]?.data)
  const state = index === -1 ? undefined : active[index]
  return order && state ? { state, order } : null
}

/** Джоб целиком заново — итог (`result`) после конечного события */
export function fetchJob(client: QueryClient, id: string): Promise<Job> {
  return client.fetchQuery({ queryKey: qk.job(id), queryFn: ({ signal }) => api.get<Job>(`/jobs/${segment(id)}`, { signal }), staleTime: 0 })
}

/** «Отменить»: `queued` — сразу `cancelled`, `running` — флаг, джоб остановится между кандидатами */
export function useCancelJob() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<Job>(`/jobs/${segment(id)}/cancel`),
    onSuccess: (job) => rememberJob(client, job),
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
