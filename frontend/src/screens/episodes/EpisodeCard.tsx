/* Карточка выпуска на доске (артборд 1): миниатюра, название, канал, длительность, глиф статуса; строка «что сейчас»
   цветом статуса и полоса прогресса 2px; расход и слот. Карточка — ссылка на экран этапа выпуска. */
import type { MouseEvent } from 'react'
import type { EpisodeJob, EpisodeListItem } from '@/types/episode'
import { useChannelName, useFormat, type ChannelId } from '../../api/queries'
import { formatUsd } from '../../app/format'
import { navigate } from '../../app/navigation'
import { paths } from '../../app/routes'
import { useUiStore } from '../../store/uiStore'
import { StatusGlyph, cn } from '../../ui'
import { HATCH } from '../../ui/internal/hatch'
import {
  TONE_CLASS,
  boardColumn,
  cardDuration,
  cardMeta,
  cardProgress,
  cardSlot,
  columnLabel,
  glyphStatus,
  remainingSeconds,
  type ProgressFill,
  type ProgressSample,
} from './board'

export interface EpisodeCardProps {
  episode: EpisodeListItem
  /** Сегодня, `YYYY-MM-DD` — один раз на доску */
  today: string
}

export function EpisodeCard({ episode, today }: EpisodeCardProps) {
  const openEpisode = useUiStore((s) => s.openEpisode)
  const channelName = useChannelName(episode.channel)
  const targetWords = useTargetWords(episode.channel)
  const etaSeconds = jobEta(episode.id, episode.summary.job)
  const column = columnLabel(boardColumn(episode))
  const meta = cardMeta(episode, { targetWords, etaSeconds })
  const progress = cardProgress(episode, targetWords)
  const slot = cardSlot(episode, today)
  const href = paths.stage(episode.id, episode.stage)

  // Клик без модификаторов — открыть выпуск (канал переключается на его канал) и перейти; с модификатором — ссылка
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    openEpisode(episode)
    navigate(href)
  }

  return (
    <a
      href={href}
      onClick={onClick}
      aria-label={`${episode.title}, ${column}`}
      className="flex flex-col gap-2 rounded-panel border border-line bg-panel p-2 text-ink hover:border-line-strong hover:bg-raised"
    >
      <div className="flex items-start gap-2">
        {/* Миниатюра — контурный плейсхолдер, картинки кадров — M6 */}
        <span aria-hidden className="h-9 w-16 shrink-0 rounded-clip border border-dashed border-line bg-hover" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-3 text-13 font-medium">{episode.title}</span>
          <span className="flex items-baseline justify-between gap-1.5 text-11 text-muted">
            <span className="truncate">{channelName}</span>
            <span className="shrink-0 text-ink">{cardDuration(episode)}</span>
          </span>
        </div>
        <StatusGlyph status={glyphStatus(episode.status)} label={episode.status === 'published' ? 'Опубликован' : undefined} />
      </div>
      <div className="flex flex-col gap-1">
        <span className={cn('line-clamp-2 text-11', TONE_CLASS[meta.tone])}>{meta.text}</span>
        <CardBar value={progress.value} fill={progress.fill} label={`Прогресс: ${column.toLowerCase()}`} />
      </div>
      <div className="flex items-baseline justify-between gap-1.5 border-t border-rule-inner pt-1.5 text-11">
        <span className="text-muted">{formatUsd(episode.summary.spent_usd_micro)}</span>
        <span className={slot.today ? 'text-accent' : 'text-muted'}>{slot.text}</span>
      </div>
    </a>
  )
}

/* Заливка полосы — как barFillStyle артборда, только токенами. ProgressBar кита не берём: у него нет queued, а ready
   там мятный (бюджет в шапке), на карточке — светлый, как в артборде. */
const FILL_CLASS: Record<ProgressFill, string> = {
  generating: HATCH,
  failed: 'bg-failed',
  warning: 'bg-warning',
  queued: 'bg-queued',
  ready: 'bg-ink',
}

function CardBar({ value, fill, label }: { value: number; fill: ProgressFill; label: string }) {
  const percent = Math.round(value * 100)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      data-fill={fill}
      className="h-0.5 overflow-hidden rounded-clip bg-rule-inner"
    >
      {/* ширина — вычисляемая геометрия, поэтому style, а не класс */}
      <div className={cn('h-full rounded-clip', FILL_CLASS[fill])} style={{ width: `${percent}%` }} />
    </div>
  )
}

/** Цель сценария в словах по пресету формата канала: «~3 000» у Cursus (20 мин × 150 слов/мин) */
function useTargetWords(channel: ChannelId): number | null {
  const preset = useFormat(channel).data?.preset
  return preset ? preset.minutes.target * preset.words_per_minute : null
}

/* Первый замер прогресса идущего джоба на выпуск: переживает перемонтирование карточки (поиск, фильтр канала).
   Оценка — по скорости с этого замера; времени старта в сводке нет. */
const firstSamples = new Map<string, ProgressSample>()

function jobEta(episodeId: string, job: EpisodeJob | null): number | null {
  if (!job || job.status !== 'running') {
    firstSamples.delete(episodeId)
    return null
  }
  const now: ProgressSample = { at: Date.now(), progress: job.progress }
  const first = firstSamples.get(episodeId)
  // Прогресс откатился — начался другой джоб того же выпуска: мерить заново
  if (!first || first.progress > job.progress) {
    firstSamples.set(episodeId, now)
    return null
  }
  return remainingSeconds(first, now)
}
