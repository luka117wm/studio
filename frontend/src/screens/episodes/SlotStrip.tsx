/* Полоса слотов публикации над доской (артборд 1): подпись и месяц окна, ячейки окна `GET /api/slots` — 3 прошлых,
   сегодня, 7 будущих. Состояние и риск слота считает бэкенд (`docs/slots.md`), здесь они только отображаются:
   граница «сегодня» и риска, заметка из `slotText.ts`, приглушение слотов чужого канала при фильтре. */
import type { EpisodeListItem } from '@/types/episode'
import type { Slot } from '@/types/slot'
import { useSlots, type ChannelScope } from '../../api/queries'
import { QueryError } from '../../app/BackendState'
import { formatSlotDate } from '../../app/format'
import { Skeleton, cn } from '../../ui'
import { AssignSlot, SlotActions } from './AssignSlot'
import { EpisodeGlyph } from './EpisodeGlyph'
import { TONE_CLASS } from './board'
import { slotDay, slotNote, weekdayShort, windowMonths } from './slotText'

/** Окно по умолчанию (`docs/slots.md`) — столько скелетонов, пока полоса грузится */
const DEFAULT_WINDOW = 11

export interface SlotStripProps {
  /** Фильтр канала экрана (= `uiStore.channel`) */
  channel: ChannelScope
  /** Выпуски обоих каналов; null — ещё грузятся */
  episodes: EpisodeListItem[] | null
}

export function SlotStrip({ channel, episodes }: SlotStripProps) {
  const slots = useSlots()
  const months = slots.data ? windowMonths(slots.data) : null
  const unslotted =
    episodes?.filter((e) => e.slot_date === null && e.status !== 'published' && (channel === 'all' || e.channel === channel)) ?? []
  const columns = slots.data?.length || DEFAULT_WINDOW

  return (
    <section aria-label="Слоты публикации" className="flex flex-col gap-2 px-4 pt-3 pb-2">
      <div className="flex items-baseline gap-2">
        <span className="text-12 font-medium text-muted">Слоты публикации, раз в два дня</span>
        <span aria-hidden className="h-px flex-1 bg-line" />
        {months && <span className="text-12 text-muted">{months}</span>}
      </div>
      {slots.error ? (
        <QueryError error={slots.error} />
      ) : (
        <ul
          aria-busy={!slots.data || undefined}
          className="grid gap-2"
          // число колонок — длина окна с бэкенда, поэтому style, а не класс
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {slots.data
            ? slots.data.map((slot) => (
                <SlotCell
                  key={slot.date}
                  slot={slot}
                  episode={episodes?.find((e) => e.id === slot.episode_id)}
                  dimmed={channel !== 'all' && slot.channel !== null && slot.channel !== channel}
                  candidates={unslotted}
                  showChannel={channel === 'all'}
                />
              ))
            : Array.from({ length: DEFAULT_WINDOW }, (_, i) => (
                <li key={i} aria-hidden className="flex flex-col">
                  <Skeleton className="h-24" />
                </li>
              ))}
        </ul>
      )}
    </section>
  )
}

interface SlotCellProps {
  slot: Slot
  episode: EpisodeListItem | undefined
  dimmed: boolean
  candidates: EpisodeListItem[]
  showChannel: boolean
}

function SlotCell({ slot, episode, dimmed, candidates, showChannel }: SlotCellProps) {
  const filled = slot.episode_id !== null
  const today = slot.state === 'today'
  const assignable = !filled && slot.state !== 'missed'
  const name = episode ? (episode.short_title ?? episode.title) : (slot.episode_id ?? '')
  const note = slotNote(slot, episode)
  // Сегодня — accent с левой кромкой 2px, риск — граница статуса; наведение — только у ячеек с действием
  const border = today
    ? 'border-accent shadow-[inset_2px_0_0_var(--accent)]'
    : slot.risk?.level === 'failed'
      ? 'border-failed'
      : slot.risk?.level === 'warning'
        ? 'border-warning'
        : cn('border-line', (filled || assignable) && 'hover:border-line-strong')

  return (
    <li
      aria-label={formatSlotDate(slot.date, { long: true })}
      data-state={slot.state}
      data-risk={slot.risk?.level}
      data-dimmed={dimmed || undefined}
      className={cn(
        'relative flex min-h-24 min-w-0 flex-col gap-1.5 rounded-panel border bg-panel px-2 py-1.5',
        border,
        dimmed && 'opacity-40',
      )}
    >
      {filled && <SlotActions slot={slot} episode={episode} name={name} />}
      <div className="pointer-events-none relative flex items-center justify-between gap-1">
        <span className="flex items-baseline gap-1">
          <span className={cn('text-15 font-medium', today ? 'text-accent' : 'text-ink')}>{slotDay(slot.date)}</span>
          <span className="text-11 text-muted">{weekdayShort(slot.weekday)}</span>
        </span>
        {episode && (
          <EpisodeGlyph status={episode.status} />
        )}
      </div>
      {filled ? (
        <div className="pointer-events-none relative flex min-w-0 flex-col gap-1">
          <span className="truncate text-12 font-medium text-ink">{name}</span>
          {note && <span className={cn('line-clamp-2 text-11', TONE_CLASS[note.tone])}>{note.text}</span>}
        </div>
      ) : assignable ? (
        <AssignSlot slot={slot} candidates={candidates} showChannel={showChannel} />
      ) : (
        <span className="flex flex-1 items-center text-11 text-muted">Слот пропущен</span>
      )}
    </li>
  )
}
