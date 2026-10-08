/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/channel.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:9e965bab75307d22d8377df773a8446439cbaefc0f177288b65f7440e6c5d603
 */
/**
 * Лимиты в USD: конфигурация, не накопление (накопление — в микродолларах, L-001).
 */
export interface Budgets {
  monthly_usd: number
  per_episode_usd: number
  animation_usd: number
}

/**
 * Тело `PATCH /api/channels/{id}`: пока только семена ниши; профиль пишется атомарно.
 */
export interface ChannelPatch {
  seeds: string[]
}

export interface ChannelProfile {
  id: 'cursus' | 'otto'
  name: string
  format: 'every_rank' | 'host'
  budgets: Budgets
  voice_quota: VoiceQuota
  voice: ChannelVoice
  seeds?: string[]
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
  stages: StageCost[]
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

/**
 * Цена этапа в смете. Этап через мост через чат — $0 без строк единиц и с `via: bridge`;
 * у платного этапа поля нет.
 */
export interface StageCost {
  stage: string
  provider: string
  model: string
  lines: CostLine[]
  usd_micro: number
  stale_pricing: boolean
  via?: 'bridge' | null
}

export interface VoiceQuota {
  limit_chars: number
}
