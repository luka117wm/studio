/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/provider.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:ff95a98516cffdac4942455b336047c67a9730ac038138bc32f9f4b9fc13885e
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
  kind: 'text' | 'image' | 'speech' | 'video'
  default: string
  models: CatalogModel[]
}
