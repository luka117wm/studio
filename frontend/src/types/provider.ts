/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/provider.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:bae9f9625e9169eb1cfe01d39dd8f7c64989a33e77a25b5b348eba6181b81c86
 */
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
