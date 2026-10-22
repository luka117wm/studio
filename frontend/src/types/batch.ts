/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/batch.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:762efe17bb2f9699e5b133d216c09c2a036344a5d4c89025d06aa55ea5cfaabd
 */
/**
 * Смета пачки до клика: «Сгенерировать N кадров (~$X)» — `GET …/generate/estimate`.
 */
export interface BatchEstimate {
  model: string
  model_id: string
  count: number
  unit: Money
  total: Money
  shots: EstimateShot[]
  skipped: SkippedShot[]
}

/**
 * Тело 409 «пачка не поставлена» (кроме бюджета — у него `BudgetRefusal`).
 */
export interface BatchRefusal {
  code: 'plan_not_approved' | 'nothing_to_draw' | 'shots_busy'
  message: string
  skipped: SkippedShot[]
  shots: string[]
  batch_id: string | null
}

/**
 * Ответ постановки: сводка новой пачки, пропущенные кадры и предупреждения.
 */
export interface BatchResult {
  batch: BatchSummary
  skipped: SkippedShot[]
  warnings: string[]
}

/**
 * Сводка пачки (M6.3): `GET /api/batches/{id}` и `data` события `batch.updated`.
 */
export interface BatchSummary {
  id: string
  episode_id: string
  kind: string
  model: string
  created_at: string
  paused: boolean
  cancelled: boolean
  retry_of: string | null
  jobs: JobSummary
  finished: boolean
  estimate: Money
  spent: Money
  eta_s: number | null
}

/**
 * Что не готово в каноне выпуска: сущность и вид проблемы.
 */
export interface CanonTarget {
  kind: 'style' | 'period' | 'appearance'
  id: string
  issue: 'unpublished' | 'unresolved' | 'no_sheet' | 'sheet_incomplete' | 'sheet_outdated'
}

export interface EstimateShot {
  shot_id: string
  variant: number
  usd: Money
}

/**
 * Счётчики по статусам — сводка пачки (`GET /api/jobs?batch=`).
 */
export interface JobSummary {
  total: number
  queued: number
  running: number
  done: number
  failed: number
  cancelled: number
}

/**
 * Деньги в ответе API: по `usd_micro` считать, `usd` показывать.
 */
export interface Money {
  usd_micro: number
  usd: string
}

/**
 * Что мешает рисовать кадр: текст с id кадра и, у проблемы канона, — её адресат.
 */
export interface PromptProblem {
  message: string
  canon?: CanonTarget | null
}

/**
 * Кадр, который пачка не ставит, и почему; у проблем сборщика — список с адресатами.
 */
export interface SkippedShot {
  shot_id: string
  reason: string
  problems: PromptProblem[]
}
