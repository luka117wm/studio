/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/project.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:4b05e45b411c05c23d07d3623441c9f0e151003eaa51ce4b5216640eb489d79d
 */
export interface AnimateOverride {
  recommended?: boolean | null
  reason?: string | null
  prompt?: string | null
  seconds?: number | null
}

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
  source: 'bridge' | 'manual' | 'api'
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

export interface ImageOverride {
  prompt?: string | null
  shot_size?: ('establishing' | 'action' | 'reaction' | 'detail') | null
}

export interface ImportResult {
  version: string
  created: boolean
  added: number
  changed: number
  removed: number
  changes: ShotChange[]
}

export interface MotionOverride {
  type?:
    | (
        | 'push_in'
        | 'pull_out'
        | 'pan_left'
        | 'pan_right'
        | 'tilt_up'
        | 'tilt_down'
        | 'static'
        | 'drift'
      )
    | null
  strength?: number | null
  ease?: ('linear' | 'in_out_sine' | 'in_out_cubic' | 'in_cubic' | 'out_cubic') | null
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
  approved_version?: string | null
  approved_at?: string | null
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

export interface SfxSpec {
  prompt: string
  offset: number
  duration: number
  gain_db: number
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

/**
 * Ручные правки полей кадра поверх плана. `sfx` заменяется целиком.
 */
export interface ShotOverride {
  vo?: string | null
  image?: ImageOverride | null
  motion?: MotionOverride | null
  transition_in?: TransitionOverride | null
  animate?: AnimateOverride | null
  sfx?: SfxSpec[] | null
}

export interface ShotState {
  status: 'todo' | 'queued' | 'generating' | 'done' | 'failed' | 'stale' | 'removed'
  duration_locked: boolean
  prompt_locked: boolean
  user_override: ShotOverride | null
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

export interface TransitionOverride {
  type?: ('cut' | 'crossfade' | 'dip') | null
  duration?: number | null
}
