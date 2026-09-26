/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/episode.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:d0b31aa7b597161416d739bccaa922b3c17bffc40dc4459cc3ddd734f82b3b98
 */
export interface Episode {
  id: string
  channel: 'cursus' | 'otto'
  title: string
  short_title: string | null
  origin: 'backlog' | 'reference' | 'blank'
  stage: 'idea' | 'script' | 'generate' | 'edit' | 'export' | 'publish'
  status: 'queued' | 'generating' | 'warning' | 'ready' | 'failed' | 'published'
  slot_date: string | null
  created_at: string
  updated_at: string
}

export interface EpisodeCreate {
  channel: 'cursus' | 'otto'
  id?: string | null
  title?: string
  short_title?: string | null
  origin?: 'backlog' | 'reference' | 'blank'
}

/**
 * Джоб, который сейчас занят выпуском.
 */
export interface EpisodeJob {
  kind: string
  status: 'queued' | 'running'
  progress: number
  message: string | null
}

export interface EpisodeListItem {
  id: string
  channel: 'cursus' | 'otto'
  title: string
  short_title: string | null
  origin: 'backlog' | 'reference' | 'blank'
  stage: 'idea' | 'script' | 'generate' | 'edit' | 'export' | 'publish'
  status: 'queued' | 'generating' | 'warning' | 'ready' | 'failed' | 'published'
  slot_date: string | null
  created_at: string
  updated_at: string
  summary: EpisodeSummary
}

/**
 * Переименование. Поля нет в теле — не меняется; `short_title: null` — сбросить.
 */
export interface EpisodePatch {
  title?: string
  short_title?: string | null
}

export interface EpisodeSummary {
  shots_total: number
  shots_done: number
  shots_failed: number
  shots_stale: number
  shots_generating: number
  vo_words: number
  duration_s: number | null
  duration_source: ('voice' | 'estimate' | 'target') | null
  spent_usd_micro: number
  job: EpisodeJob | null
}
