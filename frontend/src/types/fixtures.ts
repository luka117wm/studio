/* Временные типы фикстур оболочки (M1.3). Заменяются генерацией из Pydantic на M2
   (`pnpm typegen`), поэтому полей здесь ровно столько, сколько показывает оболочка. */

export type ChannelId = 'cursus' | 'otto'

export interface Channel {
  id: ChannelId
  name: string
  /** Буква на квадратном аватаре переключателя */
  initial: string
  /** Формат роликов: every_rank — рассказчик 18–25 мин, host — ведущий-персонаж 6–10 мин */
  format: 'every_rank' | 'host'
  /** Расход месяца и месячный бюджет, USD */
  spentUsd: number
  monthlyBudgetUsd: number
  /** Квота ElevenLabs, символы */
  voiceQuota: { usedChars: number; limitChars: number }
}

export type StageId = 'idea' | 'script' | 'generate' | 'edit' | 'export' | 'publish'

export type StageState = 'todo' | 'active' | 'done' | 'error'

/** Стадия выпуска на доске и статус карточки (форма + цвет) */
export type EpisodeBoardStage = 'idea' | 'script' | 'generate' | 'edit' | 'ready' | 'published'
export type EpisodeStatus = 'queued' | 'generating' | 'ready' | 'warning' | 'failed' | 'published'

export interface Episode {
  id: string
  channel: ChannelId
  title: string
  /** Короткое имя для слота календаря */
  shortTitle: string
  boardStage: EpisodeBoardStage
  status: EpisodeStatus
  /** Таймкод длительности; «~» — оценка по сценарию */
  duration: string
  shots: number
  words: number
  /** Строка карточки: что сейчас с выпуском */
  meta: string
  /** Прогресс стадии 0–1 */
  progress: number
  spentUsd: number
  /** Слот публикации, текст как в макете; null — не назначен */
  slot: string | null
  /** Состояние шести этапов рельса */
  stages: Record<StageId, StageState>
  period?: { id: string; label: string }
  appearances?: string[]
}

export interface Slot {
  day: string
  weekday: string
  episodeId?: string
  today?: boolean
  missed?: boolean
  empty?: boolean
}

/** Текст статус-строки: что происходит сейчас и предупреждение */
export interface StatusLine {
  process: string | null
  note: string
  /** Время последнего сохранения для индикатора в шапке */
  savedAt: string
}
