/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/canon.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:e7271b99df9742e5bfac8247af7a96dd47b5cc4472ea03e3de6709b56313745e
 */
export interface AnchorCandidate {
  id: string
  n: number
  status: 'ready' | 'rejected' | 'failed'
  file: string | null
  error: string | null
  seed: number
  version: string
  ref: string | null
  usd: Money
  cached: boolean
  created_at: string
}

/**
 * Лист облика (`GET …/appearances/{id}/anchors`) или кадры стиля (`GET …/style/anchors`).
 */
export interface AnchorSetState {
  channel: string
  target: string
  version: string | null
  status: 'missing' | 'partial' | 'ready' | 'outdated'
  chosen: number
  total: number
  stale: string | null
  slots: AnchorSlot[]
  spent: Money
}

/**
 * Ракурс листа или шаблон кадра стиля.
 */
export interface AnchorSlot {
  slot: string
  label: string
  hint: string
  candidates: AnchorCandidate[]
  chosen: ChosenAnchor | null
  stale: string | null
}

/**
 * Цена до клика (`GET …/anchors/estimate`): лист, ракурс, кадры стиля.
 */
export interface AnchorsEstimate {
  sheet: EstimateLine
  angle: EstimateLine
  style: EstimateLine
}

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
 * Тело «Копировать облик в другую эпоху»: эпоха и id нового облика того же персонажа.
 */
export interface AppearanceCopy {
  period: string
  appearance_id: string
}

/**
 * Тело «Выбрать» и «Отбраковать»: id кандидата из состояния листа.
 */
export interface CandidatePick {
  candidate: string
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

export interface ChosenAnchor {
  candidate: string
  file: string
  seed: number
  version: string
  chosen_at: string
  usd: Money
}

export interface CostLine {
  unit: 'image' | 'char' | 'second' | 'token_in' | 'token_out' | 'search'
  quantity: number
  variant: string | null
  usd_micro: number
}

/**
 * Строка сметы плана для экрана: что, сколько и почём.
 */
export interface EstimateLine {
  title: string
  label: string
  usd: Money
  cost: StageCost
}

export interface Light {
  character: string
  contrast: string
  direction: string
}

/**
 * Деньги в ответе API: по `usd_micro` считать, `usd` показывать.
 */
export interface Money {
  usd_micro: number
  usd: string
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

export interface PeriodAnswerBody {
  text: string
}

/**
 * Ответ чата принят в черновик эпохи. `filled`, `conflicts` — у черновика; `added`,
 * `repeats` — у «Дополнить запреты».
 */
export interface PeriodAnswerResult {
  run_id: string
  period_id: string
  mode: 'draft' | 'forbidden'
  doc: PeriodDoc
  filled: string[]
  conflicts: PeriodConflict[]
  added: string[]
  repeats: string[]
  message: string
}

/**
 * Поле, заполненное человеком, где чат предложил другое: в черновике остаётся `current`.
 */
export interface PeriodConflict {
  field: string
  current: unknown
  proposed: unknown
}

export interface PeriodDoc {
  draft: boolean
  version: string | null
  based_on: string | null
  updated_at: string
  data: Period
}

/**
 * Промпт эпохи для claude.ai и обмен `prompted` в журнале моста.
 */
export interface PeriodPrompt {
  text: string
  prompt_id: string
  version: number
  run_id: string
  period_id: string
  mode: 'draft' | 'forbidden'
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

/**
 * Тело «Пересобрать кадры стиля»: эпоха, в которой показать стиль.
 */
export interface StyleAnchorsCreate {
  period: string
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
