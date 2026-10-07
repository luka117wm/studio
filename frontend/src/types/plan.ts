/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/plan.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:2dff78f3a3f018dc6deca805d1bc8ecc2666ff8c278641e067fa30d553c06d57
 */
export interface AnimateSpec {
  recommended: boolean
  reason: string | null
  prompt: string | null
  seconds: number
}

/**
 * Одна ошибка внутри ответа: где (`shots[3].image.prompt`, `s012`) и что не так.
 */
export interface BridgeIssue {
  path: string
  message: string
}

export interface BridgeRun {
  id: string
  task: 'plan' | 'ideas' | 'reference'
  channel: 'cursus' | 'otto'
  episode_id: string | null
  target_id: string | null
  prompt_id: string
  prompt_version: number
  prompt_hash: string
  part: number
  parts_total: number
  status: 'prompted' | 'applied' | 'failed'
  errors: BridgeIssue[]
  created_at: string
  answered_at: string | null
}

/**
 * Действующий план для экрана 3: текущая версия плюс ручные правки.
 *
 * `shots` — кадры версии по таймлайну, затем убранные (`status: removed`) с содержимым из
 * последней версии, где они были (принцип 8).
 */
export interface EffectivePlan {
  version: string
  source: 'bridge' | 'manual' | 'api'
  approved_version: string | null
  meta: Meta
  sections: Section[]
  shots: PlanShot[]
  facts: Fact[]
}

export interface Fact {
  claim: string
  status: 'verified' | 'disputed' | 'not_found'
  source_url: string | null
  shot_id?: string | null
}

export interface ImageSpec {
  prompt: string
  period: string
  appearances: string[]
  shot_size: 'establishing' | 'action' | 'reaction' | 'detail'
}

export interface ImportResult {
  version: string
  created: boolean
  added: number
  changed: number
  removed: number
  changes: ShotChange[]
}

export interface Meta {
  channel: 'cursus' | 'otto'
  episode_id: string
  working_title: string
  format: 'every_rank' | 'host'
  language: string
  target_minutes: number
  part: number
  parts_total: number
}

export interface Motion {
  type:
    'push_in' | 'pull_out' | 'pan_left' | 'pan_right' | 'tilt_up' | 'tilt_down' | 'static' | 'drift'
  strength: number
  ease: 'linear' | 'in_out_sine' | 'in_out_cubic' | 'in_cubic' | 'out_cubic'
}

export interface PlanAnswer {
  text: string
}

/**
 * Часть принята: что дальше — следующая часть или итог импорта версии.
 */
export interface PlanAnswerResult {
  run_id: string
  part: number
  parts_total: number
  shots_in_part: number
  received: number[]
  next_part: number | null
  import_result: ImportResult | null
  warnings: string[]
}

/**
 * Проверка плана без записи: `errors` — строки, как у импорта; `items` — они же по кадрам.
 */
export interface PlanCheck {
  ok: boolean
  errors: string[]
  items: ValidationItem[]
}

/**
 * Состояние набора частей для панели моста на экране 3.
 */
export interface PlanParts {
  parts_total: number
  shots_per_part: number
  received: number[]
  next_part: number | null
  last_run: BridgeRun | null
}

/**
 * Промпт части для кнопки «Скопировать»; обмен открыт (`run_id`).
 */
export interface PlanPrompt {
  text: string
  prompt_id: string
  version: number
  run_id: string
  part: number
  parts_total: number
  first_shot: string
  last_shot: string
}

/**
 * Кадр действующего плана: поля версии с наложенной правкой и состояние из project.json.
 */
export interface PlanShot {
  id: string
  section: string
  vo: string
  image: ImageSpec
  motion: Motion
  transition_in: Transition
  animate: AnimateSpec
  sfx: SfxSpec[]
  overlay: null
  status: 'todo' | 'queued' | 'generating' | 'done' | 'failed' | 'stale' | 'removed'
  stale_reasons: string[]
  duration_locked: boolean
  prompt_locked: boolean
  overridden: (
    'vo' | 'image.prompt' | 'image.shot_size' | 'motion' | 'transition_in' | 'animate' | 'sfx'
  )[]
}

export interface Section {
  id: string
  title: string
  chapter: boolean
  vo_direction: string | null
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

export interface Transition {
  type: 'cut' | 'crossfade' | 'dip'
  duration: number
}

/**
 * Ошибка плана структурно: кадр (`null` — не про кадр), путь поля и строка из `errors`.
 */
export interface ValidationItem {
  shot_id: string | null
  path: string
  message: string
}
