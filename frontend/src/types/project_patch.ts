/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/project_patch.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:e88db237a19287a6af27e6f7d78979715740ba6cb6e3bedd758f97731357bd6b
 */
export interface AnimateOverride {
  recommended?: boolean | null
  reason?: string | null
  prompt?: string | null
  seconds?: number | null
}

/**
 * Заявка выпуска — вход промпта плана (устав M4, решение 5). Заполняется на экране 3 или
 * из идеи / референса. Что вернул чат — `director.brief`, это другая модель.
 */
export interface EpisodeBrief {
  idea?: string
  angle?: string
  hook_promise?: string
  notes?: string
  sources?: Source[]
  idea_id?: string | null
  reference_id?: string | null
  reference_mode?: 'none' | 'structure_clone' | 'own_version'
}

export interface ImageOverride {
  prompt?: string | null
  shot_size?: ('establishing' | 'action' | 'reaction' | 'detail') | null
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

/**
 * Тело `PATCH /api/projects/{id}`: только то, что правит человек. Остальное в project.json
 * пишет пайплайн (импорт плана, генерация, выравнивание, учёт расходов).
 */
export interface ProjectPatch {
  brief?: EpisodeBrief | null
  shots?: {
    [k: string]: ShotPatch
  }
}

export interface SfxSpec {
  prompt: string
  offset?: number
  duration: number
  gain_db: number
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

/**
 * Правка состояния кадра в PATCH. Поле не прислано — не меняется (мёрдж идёт по сырому
 * телу); `null` в правке поля — сброс этой правки, `user_override: null` — сброс всех.
 */
export interface ShotPatch {
  duration_locked?: boolean
  prompt_locked?: boolean
  user_override?: ShotOverride | null
}

export interface Source {
  title: string
  url: string
}

export interface TransitionOverride {
  type?: ('cut' | 'crossfade' | 'dip') | null
  duration?: number | null
}
