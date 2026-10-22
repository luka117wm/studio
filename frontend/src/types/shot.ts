/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/shot.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:596a285d576aa82eae58b47a3d3df250e367d645a4762f2bc89090f009e2859d
 */
/**
 * Тело `POST …/generate`: модель — ключ каталога `images` или ID модели из него; нет —
 * профиль качества по умолчанию.
 */
export interface ShotGenerate {
  model?: string | null
}
