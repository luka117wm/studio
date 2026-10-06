/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/channel.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:ec0e7a0efd32e592bf1c13fae30e32e06489cc5a1d3630ac2cd736f1e555a08e
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
  voice: ChannelVoice
}

/**
 * Голос канала для плана (устав M4, решение 4): код подставляет его в `director.voice`.
 *
 * Модель голоса — маршрут `voice` в `config/providers.yaml`, не профиль (принцип 5). Голос
 * выбирается в модуле голоса, до него — `unset`.
 */
export interface ChannelVoice {
  voice_id: string
  pace_wpm: number | null
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
