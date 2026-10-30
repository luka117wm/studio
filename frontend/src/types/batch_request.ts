/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/batch_request.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:1e74f1e73edaef535e730c1aafe218a27e0519c8ee56043525cc2c9735e872dd
 */
/**
 * Тело `POST …/generate`: кадры (нет — без картинки и `stale`), модель (ключ каталога
 * `images` или ID модели; нет — профиль по умолчанию), `redraw` — новый вариант и у готовых.
 */
export interface BatchCreate {
  shots?: [string, ...string[]] | null
  model?: string | null
  redraw?: boolean
}

/**
 * Тело `POST /api/batches/{id}/retry-failed`: кадры явно (так повторяются и отказы модели
 * без правки); нет — все упавшие, кроме таких отказов.
 */
export interface RetryFailed {
  shots?: [string, ...string[]] | null
}
