/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/canon.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:e3990c6a4bc2fe24b4492e1544e0498f8ed5d6c8b17e2956ea1778f9564fd574
 */
/**
 * Облик: персонаж в одной эпохе и одном возрасте. Свой лист опорных портретов.
 */
export interface Appearance {
  id: string
  label: string
  period: string
  age: number | null
  build: string
  face: string
  hair: string
  clothing: string
  wear: string
  props: string[]
  negative_local: string[]
}

/**
 * Подпись и число обликов — из черновика, а без него — из последней версии.
 */
export interface CanonCharacterItem {
  id: string
  label: string
  versions: CanonVersionInfo[]
  draft: boolean
  appearances_count: number
}

/**
 * «Нужно каналу» (`GET /api/canon/{channel}/needed`): эпохи и облики из `canon_ref` текущих
 * версий планов, у которых нет ни одной опубликованной версии.
 */
export interface CanonNeeded {
  channel: string
  periods: NeededItem[]
  appearances: NeededAppearance[]
}

/**
 * Подпись и число запретов — из черновика, а без него — из последней версии.
 */
export interface CanonPeriodItem {
  id: string
  label: string
  versions: CanonVersionInfo[]
  draft: boolean
  forbidden_count: number
}

export interface CanonStyleSummary {
  versions: CanonVersionInfo[]
  draft: boolean
}

export interface CanonSummary {
  channel: string
  style: CanonStyleSummary
  periods: CanonPeriodItem[]
  characters: CanonCharacterItem[]
}

export interface CanonVersionInfo {
  version: string
  based_on: string | null
  published_at: string
}

/**
 * Персонаж — один файл версии на всех обликов; ссылка на облик —
 * `characters/<персонаж>/vNNN#<облик>`.
 */
export interface Character {
  id: string
  label: string
  nature: Nature
  appearances: Appearance[]
}

export interface CharacterDoc {
  draft: boolean
  version: string | null
  based_on: string | null
  updated_at: string
  data: Character
}

export interface Light {
  character: string
  contrast: string
  direction: string
}

/**
 * Неизменяемое персонажа: одинаково во всех обликах.
 */
export interface Nature {
  personality: string
  posture: string
  manner: string
  face: string
}

export interface NeededAppearance {
  id: string
  draft: boolean
  shots: number
  episodes: NeededEpisode[]
  character_exists: boolean
}

export interface NeededEpisode {
  id: string
  title: string
  shots: number
}

export interface NeededItem {
  id: string
  draft: boolean
  shots: number
  episodes: NeededEpisode[]
}

export interface Optics {
  focal: string
  depth: string
  distortion: string
}

export interface Palette {
  rule: string
  swatches: Swatch[]
}

/**
 * Эпоха: факты времени и места, переиспользуются между выпусками. `forbidden` —
 * анахронизмы: идут в negative каждого кадра эпохи (L-007).
 */
export interface Period {
  id: string
  label: string
  region: string
  years: Years | null
  palette_shift: string[]
  materials: string[]
  light_sources: string[]
  architecture: string[]
  clothing: string[]
  props: string[]
  forbidden: string[]
}

export interface PeriodDoc {
  draft: boolean
  version: string | null
  based_on: string | null
  updated_at: string
  data: Period
}

/**
 * Стиль канала — один на канал, одинаков для всех выпусков (артборд 12, слой «Стиль»).
 */
export interface Style {
  render: string
  material: string
  processing: string
  optics: Optics
  light: Light
  palette: Palette
  grain: string
  composition: string
  negative_global: string[]
}

export interface StyleDoc {
  draft: boolean
  version: string | null
  based_on: string | null
  updated_at: string
  data: Style
}

export interface Swatch {
  role: string
  hex: string
}

export interface Years {
  from: number
  to: number
}
