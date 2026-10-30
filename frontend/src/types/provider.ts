/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/provider.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:712a44a39d006f480ae2c42e54a4df571fea0f8ee5f01338cf6a1b5b6e1588f3
 */
/**
 * Модель каталога этапа: ключ — то, что уходит в `model` заказа; цена — одной единицы.
 */
export interface CatalogModel {
  key: string
  label: string
  model: string
  unit: 'image' | 'char' | 'second' | 'token_in' | 'token_out' | 'search'
  price: Money
}

/**
 * Пакет символов ElevenLabs — один на аккаунт и общий для голоса и видео.
 */
export interface CharQuota {
  tier: string | null
  used_chars: number
  limit_chars: number
  resets_at: string | null
}

export interface KeyStatus {
  provider: string
  configured: boolean
  ok: boolean
  message: string
  missing_models: string[]
  quota: CharQuota | null
}

/**
 * Деньги в ответе API: по `usd_micro` считать, `usd` показывать.
 */
export interface Money {
  usd_micro: number
  usd: string
}

/**
 * Каталог этапа для выбора модели (полоса выбора экрана «Генерация», M6.8).
 */
export interface StageCatalog {
  stage: string
  kind: 'text' | 'image' | 'speech' | 'video' | 'vision'
  default: string
  models: CatalogModel[]
}
