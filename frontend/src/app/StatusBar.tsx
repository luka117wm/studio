/* Статус-строка 24px: слева — что происходит сейчас (первый идущий джоб из потока SSE, глиф штриховки и процент),
   в середине — ближайший слот с риском тем же текстом, что в ячейке полосы (`slotText.ts`), справа — 2–3 горячие
   клавиши из реестра (записи с hint, включённые сейчас). */
import type { EpisodeListItem } from '@/types/episode'
import { useEpisodes, useJobs, useSlots } from '../api/queries'
import { KeyHint, StatusGlyph } from '../ui'
import { formatKeys, isEnabled } from './keyboard'
import { slotRiskLine } from '../screens/episodes/slotText'
import { jobKindLabel } from './labels'
import { useRegisteredHotkeys } from './useHotkey'

const MAX_HINTS = 3

const nameOf = (episodes: EpisodeListItem[] | undefined, id: string | null) => {
  const episode = id === null ? undefined : episodes?.find((e) => e.id === id)
  return episode ? (episode.short_title ?? episode.title) : id
}

function Process({ episodes }: { episodes: EpisodeListItem[] | undefined }) {
  const jobs = useJobs()
  const running = jobs.data?.items.find((job) => job.status === 'running')
  if (!running) return <span>Готово</span>
  const episode = nameOf(episodes, running.episode_id)
  const text = [jobKindLabel(running.kind), episode ? `: ${episode}` : '', running.message ? `, ${running.message}` : ''].join('')
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <StatusGlyph status="generating" className="size-3 shrink-0" />
      <span className="truncate">{text}</span>
      <span className="text-ink tabular-nums">{Math.round(running.progress * 100)}%</span>
    </span>
  )
}

function SlotRisk({ episodes }: { episodes: EpisodeListItem[] | undefined }) {
  const slots = useSlots()
  const line = slots.data ? slotRiskLine(slots.data, episodes) : null
  if (!line) return null
  return <span className={line.level === 'failed' ? 'truncate text-failed-text' : 'truncate text-warning'}>{line.text}</span>
}

export function StatusBar() {
  const hotkeys = useRegisteredHotkeys()
  const hints = hotkeys.filter((h) => h.hint && h.scope !== 'modal' && isEnabled(h)).slice(-MAX_HINTS)
  // Названия выпусков для строки — из общего списка обоих каналов: джоб и слот бывают чужого канала
  const episodes = useEpisodes('all').data
  return (
    <footer role="status" className="flex h-shell-statusbar shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-11 text-muted">
      <Process episodes={episodes} />
      <span aria-hidden className="h-3 w-px bg-line" />
      <SlotRisk episodes={episodes} />
      <span className="flex-1" />
      {hints.map((h) => (
        <KeyHint key={h.id} keys={formatKeys(h.keys)} label={h.hint} />
      ))}
    </footer>
  )
}
