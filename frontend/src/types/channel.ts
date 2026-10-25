/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/channel.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:b4f0bf22c28018b19a2e0c19e2933513c0388f3d0a787d306b6c61fc32e760a2
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
 * Проверки готовых кадров канала (устав M6, решение 7). Лицо — локально и бесплатно, всегда;
 * анахронизмы — платный вопрос к VLM, его можно выключить: выключенная не платит и не помечает.
 */
export interface ChannelChecksInput {
  anachronism?: boolean
}

/**
 * Проверки готовых кадров канала (устав M6, решение 7). Лицо — локально и бесплатно, всегда;
 * анахронизмы — платный вопрос к VLM, его можно выключить: выключенная не платит и не помечает.
 */
export interface ChannelChecksOutput {
  anachronism: boolean
}

/**
 * Тело `PATCH /api/channels/{id}`: семена ниши (M4.8), проверки кадров (M6.6). Поле не
 * прислано — не меняется; профиль пишется атомарно.
 */
export interface ChannelPatch {
  seeds?: string[] | null
  checks?: ChannelChecksInput | null
}

export interface ChannelProfile {
  id: 'cursus' | 'otto'
  name: string
  format: 'every_rank' | 'host'
  budgets: Budgets
  voice_quota: VoiceQuota
  voice: ChannelVoice
  seeds: string[]
  checks?: ChannelChecksOutput | null
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
