/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/idea.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:6336b8da51ab9d75932f5b504a94e61f1f12362ecb7738d5d2d56f66de695c12
 */
export interface Idea {
  id: string
  channel: 'cursus' | 'otto'
  title: string
  angle: string
  hook_promise: string
  summary: string
  score: number | null
  score_reason: string | null
  source: 'manual' | 'bridge'
  status: 'proposed' | 'backlog' | 'used' | 'dropped'
  episode_id: string | null
  created_at: string
  updated_at: string
}

/**
 * Идея руками: `source: manual`, сразу в бэклог.
 */
export interface IdeaCreate {
  channel: 'cursus' | 'otto'
  title: string
  angle?: string
  hook_promise?: string
  summary?: string
  score?: number | null
  score_reason?: string | null
}

/**
 * Правка идеи. Поля нет в теле — не меняется; `score: null` — сбросить оценку. Статус — по
 * `TRANSITIONS`, неверный переход — 409 в API.
 */
export interface IdeaPatch {
  title?: string
  angle?: string
  hook_promise?: string
  summary?: string
  score?: number | null
  score_reason?: string | null
  status?: ('proposed' | 'backlog' | 'used' | 'dropped') | null
}

export interface IdeasAnswerBody {
  channel: 'cursus' | 'otto'
  text: string
}

export interface IdeasAnswerResult {
  run_id: string
  created: Idea[]
  skipped: SkippedIdea[]
}

/**
 * Промпт идей для кнопки «Скопировать»; обмен открыт (`run_id`).
 */
export interface IdeasPrompt {
  text: string
  prompt_id: string
  version: number
  run_id: string
  count: number
}

export interface IdeasPromptBody {
  channel: 'cursus' | 'otto'
  count?: number
}

/**
 * Несохранённая идея ответа: номер в ответе с 1, название (если разобралось), причина.
 */
export interface SkippedIdea {
  index: number
  title: string | null
  reason: string
}
