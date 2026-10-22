/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/plan.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:edb039e213378924f5314413c2ea68b803b9f543d307994ea11deeacb8d1c991
 */
/**
 * Лист опорных портретов облика для версии персонажа: выбрано ракурсов из шести (M5.4).
 */
export interface AnchorSheet {
  status: 'missing' | 'partial' | 'ready' | 'outdated'
  chosen: number
  total: number
}

export interface AnimateSpec {
  recommended: boolean
  reason: string | null
  prompt: string | null
  seconds: number
}

export interface ApprovalProblem {
  check: 'stage' | 'plan' | 'vo' | 'prompt' | 'similarity' | 'canon'
  shot_id: string | null
  message: string
  canon?: CanonTarget | null
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
  task: 'plan' | 'ideas' | 'reference' | 'canon_period'
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

export interface CanonProblem {
  kind: 'style' | 'period' | 'appearance'
  id: string
  issue: 'unpublished' | 'unresolved' | 'no_sheet' | 'sheet_incomplete' | 'sheet_outdated'
  message: string
}

/**
 * Что не готово в каноне выпуска: сущность и вид проблемы.
 */
export interface CanonTarget {
  kind: 'style' | 'period' | 'appearance'
  id: string
  issue: 'unpublished' | 'unresolved' | 'no_sheet' | 'sheet_incomplete' | 'sheet_outdated'
}

/**
 * Цена вызова: оценка до постановки или факт после. Строку для кнопки собирает фронт.
 */
export interface Cost {
  stage: string
  provider: string
  model: string
  lines: CostLine[]
  usd_micro: number
  stale_pricing: boolean
}

export interface CostLine {
  unit: 'image' | 'char' | 'second' | 'token_in' | 'token_out' | 'search'
  quantity: number
  variant: string | null
  usd_micro: number
}

/**
 * Референс, который не поместился в лимит модели.
 */
export interface DroppedRef {
  kind: 'anchor' | 'style_frame'
  owner: string
  slot: string
  label: string
  file: string
  sha256: string
  reason: string
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

export interface EpisodeAppearanceItem {
  id: string
  ref: string
  pinned: string | null
  latest: string | null
  status: 'missing' | 'draft_only' | 'ready' | 'outdated'
  resolved: boolean
  draft: boolean
  shots: number
  sheet: AnchorSheet
}

/**
 * Канон выпуска для экрана 3 (`GET /api/projects/{id}/canon`).
 */
export interface EpisodeCanon {
  plan_version: string
  ready: boolean
  updatable: boolean
  style: EpisodeCanonItem
  periods: EpisodeCanonItem[]
  appearances: EpisodeAppearanceItem[]
  problems: CanonProblem[]
}

/**
 * Стиль, эпоха или облик из `canon_ref` плана.
 */
export interface EpisodeCanonItem {
  id: string
  ref: string
  pinned: string | null
  latest: string | null
  status: 'missing' | 'draft_only' | 'ready' | 'outdated'
  resolved: boolean
  draft: boolean
  shots: number
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

/**
 * Что мешает рисовать кадр: текст с id кадра и, у проблемы канона, — её адресат.
 */
export interface PromptProblem {
  message: string
  canon?: CanonTarget | null
}

/**
 * Референс кадра: выбранный ракурс листа облика или опорный кадр стиля.
 */
export interface PromptRef {
  kind: 'anchor' | 'style_frame'
  owner: string
  slot: string
  label: string
  file: string
  sha256: string
}

/**
 * Секция промпта и откуда она: версия канона (`style/v003`, `periods/…/v002`,
 * `characters/…/v004#…`) или сам кадр (`shot`).
 */
export interface PromptSection {
  kind: 'style' | 'period' | 'appearance' | 'action' | 'shot_size'
  source: string
  label: string
  text: string
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
 * Запрос картинки кадра до траты денег: `GET /api/projects/{id}/shots/{shot_id}/prompt`.
 */
export interface ShotPrompt {
  shot_id: string
  sections: PromptSection[]
  text: string
  negative: string
  refs: PromptRef[]
  dropped: DroppedRef[]
  seed: number
  aspect_ratio: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9'
  model: string
  cost: Cost
  usd: Money
  input_hash: string | null
  problems: PromptProblem[]
  warnings: string[]
}

/**
 * Тело 409 «кадр не поставлен»: что случилось и что сделать. У `shot_problems` — проблемы
 * сборщика с адресатами канона, у `shot_busy` — джоб, который уже рисует кадр.
 */
export interface ShotRefusal {
  code: 'plan_not_approved' | 'shot_problems' | 'shot_busy'
  message: string
  problems: PromptProblem[]
  job_id: string | null
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
