/* Доска экрана «Выпуски»: колонка карточки, строка «что сейчас», прогресс, длительность, слот, поиск и счётчик.
   Чистые функции — таблица случаев в `__tests__/board.test.ts`. Колонка — не поле бэкенда, а функция стадии и статуса
   (`docs/episodes.md`, «Стадия и статус»); тексты и цвета — по артборду 1, цвета только токенами. */
import type { EpisodeListItem } from '@/types/episode'
import { formatEpisodeDuration, formatSlotDate } from '../../app/format'
import { jobKindLabel } from '../../app/labels'

export type ColumnId = 'idea' | 'script' | 'generate' | 'edit' | 'ready' | 'published'

export interface Column {
  id: ColumnId
  label: string
  /** Метка 3×12 у заголовка колонки */
  markClass: string
}

export const COLUMNS: readonly Column[] = [
  { id: 'idea', label: 'Идея', markClass: 'bg-queued' },
  { id: 'script', label: 'Сценарий', markClass: 'bg-track-subtitles' },
  { id: 'generate', label: 'Генерация', markClass: 'bg-track-shots' },
  { id: 'edit', label: 'Монтаж', markClass: 'bg-track-voice' },
  { id: 'ready', label: 'Готов к публикации', markClass: 'bg-accent' },
  { id: 'published', label: 'Опубликован', markClass: 'bg-published' },
]

type Stage = EpisodeListItem['stage']
type EpisodeStatus = EpisodeListItem['status']

/** Колонка доски. `published` — при любой стадии; экспорт в работе — ещё «Монтаж», готовый рендер и стадия
 *  публикации — «Готов к публикации». */
export function boardColumn({ stage, status }: { stage: Stage; status: EpisodeStatus }): ColumnId {
  if (status === 'published') return 'published'
  switch (stage) {
    case 'idea':
      return 'idea'
    case 'script':
      return 'script'
    case 'generate':
      return 'generate'
    case 'edit':
      return 'edit'
    case 'export':
      return status === 'ready' ? 'ready' : 'edit'
    case 'publish':
      return 'ready'
  }
}

export const columnLabel = (id: ColumnId): string => COLUMNS.find((c) => c.id === id)?.label ?? id

// --- строка «что сейчас» -----------------------------------------------------------------------

export type MetaTone = 'failed' | 'warning' | 'generating' | 'muted'

export const TONE_CLASS: Record<MetaTone, string> = {
  failed: 'text-failed-text',
  warning: 'text-warning',
  generating: 'text-generating',
  muted: 'text-muted',
}

export interface CardContext {
  /** Цель сценария в словах: целевые минуты пресета × слов в минуту; пресет не загружен — null */
  targetWords: number | null
  /** Остаток идущего джоба в секундах — только по его наблюдаемому прогрессу, иначе null */
  etaSeconds: number | null
}

export interface CardMeta {
  text: string
  tone: MetaTone
}

const runningJob = (item: EpisodeListItem) => (item.summary.job?.status === 'running' ? item.summary.job : null)

export function cardMeta(item: EpisodeListItem, context: CardContext): CardMeta {
  const { summary } = item
  const job = runningJob(item)
  if (job) {
    const eta = context.etaSeconds === null ? '' : `, ~${Math.max(1, Math.round(context.etaSeconds / 60))} мин`
    const text =
      job.kind === 'images' && summary.shots_total > 0
        ? shotsText(item)
        : job.kind === 'script'
          ? scriptText(summary.vo_words, context.targetWords)
          : `${jobKindLabel(job.kind)} ${Math.round(job.progress * 100)}%`
    return { text: text + eta, tone: 'generating' }
  }

  const tone = STATUS_TONE[item.status]
  if (item.status === 'failed') {
    const failed = summary.shots_failed
    return { text: failed > 0 ? `${failed} ${failedShots(failed)}` : 'Стадия не удалась, нужен повтор', tone }
  }
  switch (boardColumn(item)) {
    case 'published':
      return { text: 'Опубликован', tone }
    case 'ready':
      return { text: 'Готов к загрузке', tone }
    case 'idea':
      return { text: 'Идея', tone }
    case 'script':
      return { text: scriptText(summary.vo_words, context.targetWords), tone }
    default:
      return { text: summary.shots_total > 0 ? shotsText(item) : 'В плане нет кадров', tone }
  }
}

/** Тон строки «что сейчас» по статусу выпуска — он же у заметки слота без риска (`slotText.ts`) */
export const STATUS_TONE: Record<EpisodeStatus, MetaTone> = {
  queued: 'muted',
  generating: 'generating',
  warning: 'warning',
  ready: 'muted',
  failed: 'failed',
  published: 'muted',
}

const shotsText = ({ summary }: EpisodeListItem) => `Кадры ${summary.shots_done} из ${summary.shots_total}`

function scriptText(words: number, target: number | null): string {
  if (words === 0) return 'Сценарий не начат'
  if (target === null) return `Сценарий ${formatCount(words)} ${plural(words, WORDS)}`
  return `Сценарий ${formatCount(words)} / ~${formatCount(target)} ${plural(target, WORDS)}`
}

const WORDS = ['слово', 'слова', 'слов'] as const
/** «кадр не удался», «кадра не удались», «кадров не удались» — после числа */
export const failedShots = (n: number) =>
  `${plural(n, ['кадр', 'кадра', 'кадров'])} не ${plural(n, ['удался', 'удались', 'удались'])}`

/** 1 кадр, 2 кадра, 5 кадров, 11 кадров, 21 кадр */
export function plural(n: number, [one, few, many]: readonly [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** 2140 → «2 140» (неразрывный пробел, как в артборде) */
export function formatCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

// --- прогресс, длительность, слот --------------------------------------------------------------

export type ProgressFill = 'generating' | 'failed' | 'warning' | 'queued' | 'ready'

export interface CardProgress {
  /** Доля стадии, 0…1 */
  value: number
  fill: ProgressFill
}

/** Доля стадии из сводки: кадры на генерации и монтаже, слова к цели на сценарии, 1 у готовых, 0 у идеи.
 *  Джоб другого вида (проверочный, рендер) — его собственный прогресс. Штриховка — пока идёт работа. */
export function cardProgress(item: EpisodeListItem, targetWords: number | null): CardProgress {
  const { summary } = item
  const job = runningJob(item)
  const fill: ProgressFill = job || item.status === 'generating' ? 'generating' : FILL[item.status]
  const column = boardColumn(item)
  let value: number
  if (column === 'ready' || column === 'published') value = 1
  else if (job && job.kind !== 'images' && job.kind !== 'script') value = job.progress
  else if (item.stage === 'idea') value = 0
  else if (item.stage === 'script') value = targetWords ? summary.vo_words / targetWords : 0
  else value = summary.shots_total > 0 ? summary.shots_done / summary.shots_total : 0
  return { value: Math.min(1, Math.max(0, value)), fill }
}

const FILL: Record<EpisodeStatus, ProgressFill> = {
  queued: 'queued',
  generating: 'generating',
  warning: 'warning',
  ready: 'ready',
  failed: 'failed',
  published: 'ready',
}

/** «19:48» по голосу, «~18:00» по оценке или цели плана, «—» без плана */
export const cardDuration = (item: EpisodeListItem): string => formatEpisodeDuration(item.summary) ?? '—'

export interface CardSlot {
  text: string
  today: boolean
}

export function cardSlot(item: EpisodeListItem, today: string): CardSlot {
  const date = item.slot_date
  if (date === null) return { text: 'слот не назначен', today: false }
  if (item.status === 'published') return { text: `вышел ${formatSlotDate(date)}`, today: false }
  if (date === today) return { text: `${formatSlotDate(date)}, сегодня`, today: true }
  return { text: formatSlotDate(date), today: false }
}

/** Сегодня по часам машины, `YYYY-MM-DD` — бэкенд и браузер на одном ноутбуке (решение 3 устава M3) */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

// --- оценка остатка ----------------------------------------------------------------------------

export interface ProgressSample {
  /** Время замера, мс */
  at: number
  /** 0…1 */
  progress: number
}

/** Меньше этого окна наблюдения скорость не оцениваем: два близких замера дают случайную цифру */
export const ETA_MIN_WINDOW_MS = 10_000

/** Остаток джоба по наблюдаемой скорости: сколько прогресса прошло с первого замера и за сколько. Времени старта в
 *  сводке нет, поэтому без движения прогресса или при коротком окне — null, а не выдуманная цифра. */
export function remainingSeconds(first: ProgressSample, current: ProgressSample): number | null {
  const done = current.progress - first.progress
  const elapsed = current.at - first.at
  if (done <= 0 || elapsed < ETA_MIN_WINDOW_MS || current.progress >= 1) return null
  return ((elapsed / done) * (1 - current.progress)) / 1000
}

// --- поиск и счётчик ---------------------------------------------------------------------------

/** По названию и короткому имени, без учёта регистра; пустой запрос — всё */
export function matchesQuery(item: EpisodeListItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return item.title.toLowerCase().includes(q) || (item.short_title?.toLowerCase().includes(q) ?? false)
}

/** «9 всего, 2 опубликовано»; с поиском или фильтром канала — «3 из 9» (видимые из всех) */
export function countLabel(visible: number, all: readonly EpisodeListItem[]): string {
  if (visible === all.length) {
    const published = all.filter((e) => e.status === 'published').length
    return `${all.length} всего, ${published} опубликовано`
  }
  return `${visible} из ${all.length}`
}
