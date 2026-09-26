/*
 * Сгенерировано `pnpm -C frontend typegen` из docs/schema/slot.schema.json (Pydantic-модели бэкенда).
 * Не править руками: меняется модель, затем команда выше.
 * @generated sha256:c1066ff29092718e6b6e75ba7336f5cccdb2822238756d88a3eee4d8ef42f9c1
 */
export interface Slot {
  date: string
  weekday: number
  episode_id: string | null
  channel: ('cursus' | 'otto') | null
  state: 'published' | 'missed' | 'today' | 'filled' | 'empty'
  risk: SlotRisk | null
}

/**
 * Тело `PUT /api/episodes/{id}/slot`: дата слота или null — снять со слота.
 */
export interface SlotAssign {
  date: string | null
}

export interface SlotRisk {
  level: 'warning' | 'failed'
  reason: 'script_not_ready' | 'shots_incomplete' | 'shots_failed' | 'not_exported'
}
