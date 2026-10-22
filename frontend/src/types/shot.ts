/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/shot.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:38c58e014d4bfb46a880176cf62894302c35ccb3a03d837253bd888fa9aef9c7
 */
/**
 * Тело `POST …/redraw`: модель (как у заказа кадра) и, у «С правкой…», новое действие кадра —
 * оно пишется в `user_override.image.prompt` и проверяется стоп-листом, как правка на листе.
 */
export interface RedrawBody {
  model?: string | null
  prompt?: string | null
}

/**
 * Тело `POST …/generate`: модель — ключ каталога `images` или ID модели из него; нет —
 * профиль качества по умолчанию.
 */
export interface ShotGenerate {
  model?: string | null
}
