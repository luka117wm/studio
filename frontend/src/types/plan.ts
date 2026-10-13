/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/plan.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:0a549f88feb48e0cb6ff3ea6592b09da9c99a2c496b40a2a73845764c41d734d
 */
export interface AnimateSpec {
  recommended: boolean
  reason: string | null
  prompt: string | null
  seconds: number
}

export interface ApprovalProblem {
  check: 'stage' | 'plan' | 'vo' | 'prompt' | 'similarity'
  shot_id: string | null
  message: string
}

/**
 * Тело 409 «Утвердить план» (`detail`): сводка для пользователя и проблемы по кадрам.
 */
export interface ApprovalRefusal {
  code: 'plan_not_ready'
  message: string
  problems: ApprovalProblem[]
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
 * Уровень бюджета после выпуска: лимит, занятое до него, доля сметы, остаток.
 */
export interface BudgetOutlook {
  level: 'month' | 'episode' | 'animation'
  limit: Money
  committed: Money
  estimate: Money
  remaining: Money
  exceeded: boolean
  message: string
}

export interface CostLine {
  unit: 'image' | 'char' | 'second' | 'token_in' | 'token_out' | 'search'
  quantity: number
  variant: string | null
  usd_micro: number
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

/**
 * Строка сметы плана для экрана: что, сколько и почём.
 */
export interface EstimateLine {
  title: string
  label: string
  usd: Money
  cost: StageCost
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

/**
 * Деньги в ответе API: по `usd_micro` считать, `usd` показывать.
 */
export interface Money {
  usd_micro: number
  usd: string
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
 * Смета действующего плана: `GET /api/projects/{id}/estimate`.
 */
export interface PlanEstimate {
  version: string
  plan_source: 'bridge' | 'api'
  lines: EstimateLine[]
  total: Money
  budgets: BudgetOutlook[]
  warnings: string[]
  stale_pricing: boolean
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

/**
 * Сходство VO плана с текстом референса (принцип 11): доля n-грамм плана, найденных в
 * субтитрах.
 */
export interface Similarity {
  ratio: number
  threshold: number
  ngram: number
  ok: boolean
  matched: number
  total: number
  phrases: string[]
}

/**
 * `GET /api/projects/{id}/similarity`: сходство или почему его нет (нет плана, выпуск не по
 * референсу).
 */
export interface SimilarityReport {
  similarity: Similarity | null
  reason: string | null
}

/**
 * Цена этапа в смете. Этап через мост через чат — $0 без строк единиц и с `via: bridge`;
 * у платного этапа поля нет.
 */
export interface StageCost {
  stage: string
  provider: string
  model: string
  lines: CostLine[]
  usd_micro: number
  stale_pricing: boolean
  via?: 'bridge' | null
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
