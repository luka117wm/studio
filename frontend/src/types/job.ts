/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/job.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:0c92fc032d38229c32bfb5c06cf1127463cbc66efeef1382026f324c0d4b2e52
 */
export interface Job {
  id: string
  kind: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  progress: number
  message: string | null
  payload: {
    [k: string]: unknown
  }
  result: {
    [k: string]: unknown
  } | null
  error: string | null
  attempts: number
  cancel_requested: boolean
  episode_id: string | null
  batch_id: string | null
  idempotency_key: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  cost_usd_micro: number | null
  cost_stage: string | null
  channel: string | null
}

export interface JobCreate {
  kind: string
  payload?: {
    [k: string]: unknown
  }
  idempotency_key?: string | null
  episode_id?: string | null
  batch_id?: string | null
}

/**
 * `data` событий SSE `job.*` (`docs/jobs.md`): полное состояние, клиент заменяет его.
 */
export interface JobEventData {
  job_id: string
  kind: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  progress: number
  message: string | null
  attempts: number
  cancel_requested: boolean
  episode_id: string | null
  batch_id: string | null
  channel: string | null
  error: string | null
}

export interface JobList {
  items: Job[]
  summary: JobSummary
  last_event_id: number
}

/**
 * Счётчики по статусам — сводка пачки (`GET /api/jobs?batch=`).
 */
export interface JobSummary {
  total: number
  queued: number
  running: number
  done: number
  failed: number
  cancelled: number
}
