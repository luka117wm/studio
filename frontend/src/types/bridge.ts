/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/bridge.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:44f1c9152f8abb4dfb720c41ecee8348c68808251df27e1b7884798ecff2a75f
 */
export interface BridgeApiStatus {
  available: boolean
  reason: string | null
}

/**
 * Тело ответа 422 на неверный ответ чата. Тексты — для пользователя, по-русски.
 */
export interface BridgeError {
  message: string
  hint: string
  errors: BridgeIssue[]
}

/**
 * Одна ошибка внутри ответа: где (`shots[3].image.prompt`, `s012`) и что не так.
 */
export interface BridgeIssue {
  path: string
  message: string
}

export interface BridgeRun {
  id: string
  task: 'plan' | 'ideas' | 'reference' | 'canon_period'
  channel: 'cursus' | 'otto'
  episode_id: string | null
  target_id: string | null
  prompt_id: string
  prompt_version: number
  prompt_hash: string
  part: number
  parts_total: number
  status: 'prompted' | 'applied' | 'failed'
  errors: BridgeIssue[]
  created_at: string
  answered_at: string | null
}

export interface BridgeSettings {
  plan_source: 'bridge' | 'api'
  api: BridgeApiStatus
}
