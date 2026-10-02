/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/project.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:ffefe2bdadb110fd53cd59d8fe166d1e63b471548d76ef72bbf0f942a06a1fbb
 */
export interface Asset {
  id: string
  shot_id: string | null
  kind: 'image' | 'voice' | 'animation' | 'sfx' | 'music' | 'thumbnail' | 'render'
  version: number
  path: string
  hash: string
  status: 'ok' | 'stale' | 'failed'
}

/**
 * Строка индекса версий плана: хэш для дедупа повторного импорта и итог мёрджа.
 */
export interface DirectorVersionInfo {
  version: string
  hash: string
  imported_at: string
  parts: number
  shots: number
  added: number
  changed: number
  removed: number
}

/**
 * Заявка выпуска — вход промпта плана (устав M4, решение 5). Заполняется на экране 3 или
 * из идеи / референса. Что вернул чат — `director.brief`, это другая модель.
 */
export interface EpisodeBrief {
  idea: string
  angle: string
  hook_promise: string
  notes: string
  sources: Source[]
  idea_id: string | null
  reference_id: string | null
  reference_mode: 'none' | 'structure_clone' | 'own_version'
}

export interface ImportResult {
  version: string
  created: boolean
  added: number
  changed: number
  removed: number
  changes: ShotChange[]
}

export interface Project {
  schema: 'studio.project/1'
  episode_id: string
  channel: 'cursus' | 'otto'
  brief: EpisodeBrief | null
  director_version: string | null
  director_versions: {
    [k: string]: DirectorVersionInfo
  }
  shots: {
    [k: string]: ShotState
  }
  assets: {
    [k: string]: Asset
  }
  timings: {
    [k: string]: Timing
  }
  cost: {
    [k: string]: number
  }
  updated_at: string
}

/**
 * Строка таблицы расхождений (ConflictBar, экран 10).
 */
export interface ShotChange {
  shot_id: string
  section: string | null
  kind: 'added' | 'changed' | 'removed'
  change: string
  fields: string[]
  stale: boolean
  drawn_at: string | null
  price: number | null
}

export interface ShotState {
  status: 'todo' | 'queued' | 'generating' | 'done' | 'failed' | 'stale' | 'removed'
  duration_locked: boolean
  prompt_locked: boolean
  user_override: {
    [k: string]: unknown
  } | null
  stale_reasons: string[]
}

export interface Source {
  title: string
  url: string
}

export interface Timing {
  shot_id: string
  start: number
  duration: number
  source: 'voice' | 'locked' | 'estimate'
}
