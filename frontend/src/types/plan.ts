/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/plan.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:5d71059e4b4b31f9ceaca034214a8beb081abd78c2d9f66baf07a88a50d54f44
 */
/**
 * Одна ошибка внутри ответа: где (`shots[3].image.prompt`, `s012`) и что не так.
 */
export interface BridgeIssue {
  path: string
  message: string
}

export interface BridgeRun {
  id: string
  task: 'plan' | 'ideas' | 'reference'
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

export interface ImportResult {
  version: string
  created: boolean
  added: number
  changed: number
  removed: number
  changes: ShotChange[]
}

export interface PlanAnswer {
  text: string
}

/**
 * Часть принята: что дальше — следующая часть или итог импорта версии.
 */
export interface PlanAnswerResult {
  run_id: string
  part: number
  parts_total: number
  shots_in_part: number
  received: number[]
  next_part: number | null
  import_result: ImportResult | null
  warnings: string[]
}

/**
 * Состояние набора частей для панели моста на экране 3.
 */
export interface PlanParts {
  parts_total: number
  shots_per_part: number
  received: number[]
  next_part: number | null
  last_run: BridgeRun | null
}

/**
 * Промпт части для кнопки «Скопировать»; обмен открыт (`run_id`).
 */
export interface PlanPrompt {
  text: string
  prompt_id: string
  version: number
  run_id: string
  part: number
  parts_total: number
  first_shot: string
  last_shot: string
}

/**
 * Строка таблицы расхождений (ConflictBar, экран 10).
 */
export interface ShotChange {
  shot_id: string
  section: string | null
  kind: 'added' | 'changed' | 'removed'
  change: string
  fields: string[]
  stale: boolean
  drawn_at: string | null
  price: number | null
}
