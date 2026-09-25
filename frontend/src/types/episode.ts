/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/episode.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:c02c195d819a3d901c56fcd000bbf3c303503f4443e0801a8fd959401d83fe6b
 */
export interface Episode {
  id: string
  channel: 'cursus' | 'otto'
  short_title: string | null
  stage: 'idea' | 'script' | 'generate' | 'edit' | 'export' | 'publish'
  status: 'queued' | 'generating' | 'warning' | 'ready' | 'failed' | 'published'
  slot_date: string | null
  created_at: string
  updated_at: string
}

export interface EpisodeCreate {
  id: string
  channel: 'cursus' | 'otto'
  short_title?: string | null
}
