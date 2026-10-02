import type { EpisodeListItem } from '@/types/episode'
import { StatusGlyph } from '../../ui'

/** Глиф статуса выпуска: пять статусов — глифы кита, «Опубликован» — сплошная точка `status-published`
    (tokens.css; в ките его нет — это статус выпуска, а не кадра). */
export function EpisodeGlyph({ status }: { status: EpisodeListItem['status'] }) {
  if (status !== 'published') return <StatusGlyph status={status} />
  return (
    <span role="img" aria-label="Опубликован" data-status="published" className="inline-flex size-icon shrink-0 items-center justify-center">
      <span className="size-2.5 rounded-full bg-published" />
    </span>
  )
}
