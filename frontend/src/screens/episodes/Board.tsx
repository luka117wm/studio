/* Доска по стадиям (артборд 1): шесть колонок с меткой 3×12 и счётчиком. Шапка колонки стоит на месте, список карточек
   прокручивается внутри колонки (layout.md, «Скролл и прилипание»). В «Идее» — ссылка в бэклог идей. */
import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import type { EpisodeListItem } from '@/types/episode'
import { Link } from '../../app/Link'
import { paths } from '../../app/routes'
import { Skeleton, cn } from '../../ui'
import { COLUMNS, boardColumn, localToday, type Column } from './board'
import { EpisodeCard } from './EpisodeCard'

/** `episodes: null` — загрузка: скелетоны карточек в колонках */
export function Board({ episodes }: { episodes: EpisodeListItem[] | null }) {
  const today = localToday()
  return (
    <div
      aria-busy={episodes === null || undefined}
      className="grid min-h-0 flex-1 grid-cols-6 gap-2"
    >
      {COLUMNS.map((column) => {
        const cards = episodes?.filter((e) => boardColumn(e) === column.id) ?? null
        return (
          <BoardColumn key={column.id} column={column} count={cards?.length ?? null}>
            {cards === null
              ? [0, 1].map((i) => (
                  <li key={i} aria-hidden className="flex flex-col">
                    <Skeleton className="h-28" />
                  </li>
                ))
              : cards.map((episode) => (
                  <li key={episode.id} className="flex flex-col">
                    <EpisodeCard episode={episode} today={today} />
                  </li>
                ))}
            {column.id === 'idea' && (
              <li className="flex flex-col">
                <Link
                  to={paths.ideas}
                  className="flex h-control-md items-center gap-1.5 rounded-control border border-dashed border-line px-2 text-12 text-muted hover:border-line-strong hover:text-ink"
                >
                  <Plus className="size-icon shrink-0" strokeWidth={1.5} aria-hidden />
                  Из бэклога идей
                </Link>
              </li>
            )}
          </BoardColumn>
        )
      })}
    </div>
  )
}

function BoardColumn({ column, count, children }: { column: Column; count: number | null; children: ReactNode }) {
  const headingId = `board-column-${column.id}`
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-0 min-w-0 flex-col rounded-panel border border-row-border bg-strip"
    >
      <header className="flex h-7 shrink-0 items-center gap-1.5 border-b border-line px-2">
        <span aria-hidden className={cn('h-3 w-0.75 shrink-0 rounded-[1px]', column.markClass)} />
        <h2 id={headingId} className="truncate text-13 font-semibold text-ink">
          {column.label}
        </h2>
        {count !== null && <span className="text-12 text-muted">{count}</span>}
      </header>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">{children}</ul>
    </section>
  )
}
