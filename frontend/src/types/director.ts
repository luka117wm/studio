/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/director.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:4612593385a24fe49bd12e193f70760da243d2cfb5b210d36bc520b8ac9bbab8
 */
export interface AnimateSpec {
  recommended?: boolean
  reason?: string | null
  prompt?: string | null
  seconds?: number
}

export interface Brief {
  idea: string
  angle: string
  hook_promise: string
  reference_mode?: 'none' | 'structure_clone' | 'own_version'
  sources?: Source[]
}

/**
 * Ссылки на версии канона; ключи `periods` и `appearances` — то, на что ссылаются кадры.
 *
 * Формат значений (`periods/<id>/vNNN`, `characters/<id>/vNNN#<облик>`) проверяет
 * `check_director`.
 */
export interface CanonRef {
  style: string
  periods?: {
    [k: string]: string
  }
  appearances?: {
    [k: string]: string
  }
}

/**
 * Режиссёрский план эпизода Studio, версия studio.director/1.
 */
export interface Director {
  schema: 'studio.director/1'
  meta: Meta
  brief: Brief
  canon_ref?: CanonRef | null
  voice?: VoiceCfg | null
  sections: Section[]
  shots: Shot[]
  music?: MusicCue[]
  thumbnail: Thumbnail
  publish: PublishMeta
  facts?: Fact[]
}

export interface Fact {
  claim: string
  status: 'verified' | 'disputed' | 'not_found'
  source_url?: string | null
}

export interface ImageSpec {
  prompt: string
  period: string
  appearances?: string[]
  shot_size: 'establishing' | 'action' | 'reaction' | 'detail'
}

export interface Meta {
  channel: 'cursus' | 'otto'
  episode_id: string
  working_title: string
  format: 'every_rank' | 'host'
  language?: string
  target_minutes: number
  part?: number
  parts_total?: number
}

export interface Motion {
  type:
    'push_in' | 'pull_out' | 'pan_left' | 'pan_right' | 'tilt_up' | 'tilt_down' | 'static' | 'drift'
  strength: number
  ease: 'linear' | 'in_out_sine' | 'in_out_cubic' | 'in_cubic' | 'out_cubic'
}

export interface MusicCue {
  section: string
  mood: string
  gain_db: number
}

export interface PublishMeta {
  titles: string[]
  description: string
  tags: string[]
  category_id: string
  synthetic_media: boolean
  made_for_kids: boolean
}

export interface Section {
  id: string
  chapter?: boolean
  vo_direction?: string | null
}

export interface SfxSpec {
  prompt: string
  offset?: number
  duration: number
  gain_db: number
}

export interface Shot {
  id: string
  section: string
  vo: string
  image: ImageSpec
  motion: Motion
  transition_in?: Transition
  animate?: AnimateSpec
  sfx?: SfxSpec[]
  overlay?: null
}

export interface Source {
  url: string
}

export interface Thumbnail {
  concepts: ThumbnailConcept[]
}

export interface ThumbnailConcept {
  prompt: string
  text: string
}

export interface Transition {
  type?: 'cut' | 'crossfade' | 'dip'
  duration?: number
}

export interface VoiceCfg {
  provider: string
  voice_id: string
  model: string
  pace_wpm: number
}
