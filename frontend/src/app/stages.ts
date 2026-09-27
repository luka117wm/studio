// Состояние этапов рельса из стадии и статуса выпуска.
import type { Episode } from '@/types/episode'
import type { StageId } from './routes'

export const STAGE_ORDER: StageId[] = ['idea', 'script', 'generate', 'edit', 'export', 'publish']

export type StageState = 'todo' | 'active' | 'done' | 'error'

/** Пройденные стадии — `done`, текущая — `active` (при статусе `failed` — `error`), дальше — `todo`.
 *  Опубликованный выпуск прошёл все этапы. */
export function stageStates(episode: Pick<Episode, 'stage' | 'status'>): Record<StageId, StageState> {
  const current = STAGE_ORDER.indexOf(episode.stage)
  const published = episode.status === 'published'
  return Object.fromEntries(
    STAGE_ORDER.map((id, i) => {
      if (published || i < current) return [id, 'done']
      if (i > current) return [id, 'todo']
      return [id, episode.status === 'failed' ? 'error' : 'active']
    }),
  ) as Record<StageId, StageState>
}
