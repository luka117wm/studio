/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/canon_draft.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:23697c8f3132f2ba64e5a226f20992b884b7c7f053626e967bd1b16d75b39b5c
 */
/**
 * Облик: персонаж в одной эпохе и одном возрасте. Свой лист опорных портретов.
 */
export interface Appearance {
  id: string
  label?: string
  period?: string
  age?: number | null
  build?: string
  face?: string
  hair?: string
  clothing?: string
  wear?: string
  props?: string[]
  negative_local?: string[]
}

/**
 * Персонаж — один файл версии на всех обликов; ссылка на облик —
 * `characters/<персонаж>/vNNN#<облик>`.
 */
export interface Character {
  id: string
  label?: string
  nature?: Nature
  appearances?: Appearance[]
}

export interface Light {
  character?: string
  contrast?: string
  direction?: string
}

/**
 * Неизменяемое персонажа: одинаково во всех обликах.
 */
export interface Nature {
  personality?: string
  posture?: string
  manner?: string
  face?: string
}

export interface Optics {
  focal?: string
  depth?: string
  distortion?: string
}

export interface Palette {
  rule?: string
  swatches?: Swatch[]
}

/**
 * Эпоха: факты времени и места, переиспользуются между выпусками. `forbidden` —
 * анахронизмы: идут в negative каждого кадра эпохи (L-007).
 */
export interface Period {
  id: string
  label?: string
  region?: string
  years?: Years | null
  palette_shift?: string[]
  materials?: string[]
  light_sources?: string[]
  architecture?: string[]
  clothing?: string[]
  props?: string[]
  forbidden?: string[]
}

/**
 * Стиль канала — один на канал, одинаков для всех выпусков (артборд 12, слой «Стиль»).
 */
export interface Style {
  render?: string
  material?: string
  processing?: string
  optics?: Optics
  light?: Light
  palette?: Palette
  grain?: string
  composition?: string
  negative_global?: string[]
}

export interface Swatch {
  role?: string
  hex: string
}

export interface Years {
  from: number
  to: number
}
