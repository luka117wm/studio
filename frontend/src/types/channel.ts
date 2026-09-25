/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/channel.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:65b74ae5a9386a0c259bfc212f2b335936079dc823e3ff76b80d51968f0e0e36
 */
/**
 * Лимиты в USD: конфигурация, не накопление (накопление — в микродолларах, L-001).
 */
export interface Budgets {
  monthly_usd: number
  per_episode_usd: number
  animation_usd: number
}

export interface ChannelProfile {
  id: 'cursus' | 'otto'
  name: string
  format: 'every_rank' | 'host'
  budgets: Budgets
  voice_quota: VoiceQuota
}

export interface VoiceQuota {
  limit_chars: number
}
