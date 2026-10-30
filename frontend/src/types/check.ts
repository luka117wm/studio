/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/check.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:e21531ef02ce2387d76e38b47d288ddff8ff9e111fd877c3d37b44aa27f13e19
 */
/**
 * Смета перепроверки до клика (M6.10): «Перепроверить выбранные (N, ~$X)» и цена вопроса в
 * подписи выключателя — `GET /api/projects/{id}/check/estimate?shots=`.
 */
export interface CheckEstimate {
  vlm: boolean
  question: Money | null
  count: number
  total: Money
  shots: CheckEstimateShot[]
  skipped: SkippedCheck[]
}

export interface CheckEstimateShot {
  shot_id: string
  face: boolean
  usd: Money
}

/**
 * Деньги в ответе API: по `usd_micro` считать, `usd` показывать.
 */
export interface Money {
  usd_micro: number
  usd: string
}

/**
 * Кадр, который перепроверка не поставит, и почему — текст отказа `POST …/check`.
 */
export interface SkippedCheck {
  shot_id: string
  reason: string
}
