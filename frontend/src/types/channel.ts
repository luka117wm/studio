/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/channel.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:05ff4c03b84076a933c73125f43f731d42e7392cd14d5968396495209019b922
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

/**
 * Цена вызова: оценка до постановки или факт после. Строку для кнопки собирает фронт.
 */
export interface Cost {
  stage: string
  provider: string
  model: string
  lines: CostLine[]
  usd_micro: number
  stale_pricing: boolean
}

export interface CostLine {
  unit: 'image' | 'char' | 'second' | 'token_in' | 'token_out' | 'search'
  quantity: number
  variant: string | null
  usd_micro: number
}

/**
 * Смета выпуска: цена этапа на маршруте профиля по умолчанию и итог, микродоллары.
 */
export interface EpisodeEstimate {
  stages: Cost[]
  usd_micro: number
}

export interface FormatMinutes {
  min: number
  target: number
  max: number
}

export interface FormatPreset {
  label: string
  hint: string
  minutes: FormatMinutes
  sections: number
  shots: number
  words_per_minute: number
}

export interface FormatPreview {
  channel: 'cursus' | 'otto'
  format: 'every_rank' | 'host'
  preset: FormatPreset
  estimate: EpisodeEstimate
  stale_pricing: boolean
}

export interface VoiceQuota {
  limit_chars: number
}
