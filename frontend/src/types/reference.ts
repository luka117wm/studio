/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/reference.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:45500bd5dcadff50212c2761f5789bf2ea1c12fc8cb311fe35644c9d60992f62
 */
/**
 * Сегмент разбора: вид, подпись своими словами, начало, сколько фактов.
 */
export interface AnalysisSegment {
  kind: 'hook' | 'promise' | 'rank' | 'retention' | 'finale' | 'other'
  label: string
  start: number
  facts: number
}

/**
 * Разбор референса чатом (ответ на промпт `reference`). Лишние ключи чата игнорируются.
 */
export interface ReferenceAnalysis {
  title: string
  author: string
  topic: string
  segments: AnalysisSegment[]
  techniques: Technique[]
}

export interface ReferenceAnswer {
  text: string
}

export interface ReferenceCreate {
  channel: 'cursus' | 'otto'
  url?: string
  subtitles: string
}

/**
 * «Новая тема по этой структуре» (`structure_clone`) или «Своя версия этой темы»
 * (`own_version`).
 */
export interface ReferenceEpisodeCreate {
  mode: 'structure_clone' | 'own_version'
}

/**
 * Метрики референса — считает код по репликам и разбору; средней длины кадра нет (нужно
 * видео).
 */
export interface ReferenceMetrics {
  duration_s: number
  words: number
  pace_wpm: number
  norm_wpm: number
  pace_delta: number
  facts_total: number
  facts_per_min: number
  holds_until_s: number | null
  retention_hooks_s: number[]
  segments_total: number
  ranks_total: number
  segments: SegmentMetrics[]
}

/**
 * Промпт разбора для кнопки «Скопировать»; обмен открыт (`run_id`).
 */
export interface ReferencePrompt {
  text: string
  prompt_id: string
  version: number
  run_id: string
}

/**
 * Референс в ответах API: разбор и метрики — когда разобран.
 */
export interface ReferenceVideo {
  id: string
  channel: 'cursus' | 'otto'
  url: string
  title: string
  author: string
  duration_s: number
  cues: number
  subtitles: string
  analysis: ReferenceAnalysis | null
  metrics: ReferenceMetrics | null
  created_at: string
  analyzed_at: string | null
}

export interface SegmentMetrics {
  index: number
  kind: 'hook' | 'promise' | 'rank' | 'retention' | 'finale' | 'other'
  label: string
  start_s: number
  duration_s: number
  words: number
  pace_wpm: number
  facts: number
  facts_per_min: number
}

/**
 * Приём подачи своими словами и сколько раз он встречается.
 */
export interface Technique {
  text: string
  count: number
}
