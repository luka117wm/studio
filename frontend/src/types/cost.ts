/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/cost.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:39b9bb2e46b8d074a9e9c5d3f8dd6a6a5e4c75a6955dec722137ea91f9718b13
 */
export interface BudgetUsage {
  limit: Money
  charged: Money
  reserved: Money
  queued: Money
  remaining: Money
}

/**
 * Цена вызова: оценка до постановки или факт после. Строку для кнопки собирает фронт.
 */
export interface Cost {
  stage: string
  provider: string
  model: string
  lines: CostLine[]
  usd_micro: number
  stale_pricing: boolean
}

export interface CostLine {
  unit: 'image' | 'char' | 'second' | 'token_in' | 'token_out' | 'search'
  quantity: number
  variant: string | null
  usd_micro: number
}

export interface CostSummary {
  channel: 'cursus' | 'otto'
  month: string
  budget: BudgetUsage
  by_stage: StageSpend[]
  stale_pricing: StalePrice[]
}

export interface LedgerPage {
  items: LedgerRow[]
  episode_budget: BudgetUsage | null
  animation_budget: BudgetUsage | null
}

export interface LedgerRow {
  id: number
  ts: string
  channel: string
  episode_id: string | null
  stage: string
  job_id: string | null
  provider: string
  model: string
  unit: string
  quantity: number
  variant: string | null
  usd_micro: number
  usd: string
  status: 'estimated' | 'charged' | 'cached' | 'refused' | 'failed'
  call_id: string | null
  input_hash: string | null
}

export interface Money {
  usd_micro: number
  usd: string
}

export interface StageSpend {
  stage: string
  spent: Money
}

export interface StalePrice {
  provider: string
  model: string
  checked_at: string
  age_days: number
}
