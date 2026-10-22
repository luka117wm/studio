/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/shot_redraw.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:f4e570fc52c518c3cebd8a97ea9dad97836dd5252919e30f9b35ea18c527f446
 */
/**
 * Деньги в ответе API: по `usd_micro` считать, `usd` показывать.
 */
export interface Money {
  usd_micro: number
  usd: string
}

/**
 * Цена перерисовки до клика: «Перерисовать (~$0.07)», «Добавить версию (~$0.07)».
 */
export interface RedrawEstimate {
  shot_id: string
  variant: number
  model: string
  model_id: string
  usd: Money
}
