// Карта структуры референса (артборд 2, вкладка «Референс»): раскладка сегментов по длительности и шкала времени.
// Только раскладка и подписи — метрики считает бэкенд (docs/research.md, «Референс»).
import type { SegmentMetrics } from '@/types/reference'
import { formatDuration } from '../../app/format'

type Kind = SegmentMetrics['kind']

/** Сегмент уже этой доли полосы (%) — подпись не помещается, она уходит в Tooltip */
export const NARROW_PCT = 6

export interface SegmentBox {
  index: number
  kind: Kind
  label: string
  /** Длительность подписью: «3:16» */
  length: string
  /** Ширина в процентах полосы; сумма по всем сегментам — ровно 100 */
  widthPct: number
  /** Подпись не помещается — только в Tooltip */
  narrow: boolean
  /** «Ранг 2, длительность 3:16» — для Tooltip и доступного имени */
  tooltip: string
}

/** Ширины пропорциональны длительностям и в сумме дают ровно 100 %: доли считаются в сотых процента, остаток
 *  раздаётся сегментам с наибольшей дробной частью. Нулевая длительность всего ролика — равные доли. */
export function layoutSegments(segments: SegmentMetrics[], narrowPct = NARROW_PCT): SegmentBox[] {
  if (!segments.length) return []
  const total = segments.reduce((sum, s) => sum + Math.max(s.duration_s, 0), 0)
  const exact = segments.map((s) => (total > 0 ? (Math.max(s.duration_s, 0) / total) * 10_000 : 10_000 / segments.length))
  const units = exact.map(Math.floor)
  let rest = 10_000 - units.reduce((sum, u) => sum + u, 0)
  const order = exact.map((value, i) => ({ i, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction)
  for (const { i } of order) {
    if (rest <= 0) break
    units[i] = (units[i] ?? 0) + 1
    rest -= 1
  }
  return segments.map((segment, i) => {
    const widthPct = (units[i] ?? 0) / 100
    const length = formatDuration(segment.duration_s)
    return {
      index: segment.index,
      kind: segment.kind,
      label: segment.label,
      length,
      widthPct,
      narrow: widthPct < narrowPct,
      tooltip: `${segment.label}, длительность ${length}`,
    }
  })
}

/** Шкала под полосой: 0, ¼, ½, ¾ и конец ролика — «0:00 … 22:41» */
export function scaleTicks(durationS: number): string[] {
  return [0, 0.25, 0.5, 0.75, 1].map((share) => formatDuration(durationS * share))
}

/** Цвет сегмента по виду — только токены (design/CLAUDE.md): ранг — основной цвет полосы, крючок удержания —
 *  акцент, хук, обещание и финал — свои. Тёплые цвета артборда у хука и обещания — только для смысла, поэтому
 *  заменены цветами дорожек (docs/visual_review.md). Текст — по контрасту заливки. */
export const SEGMENT_CLASS: Record<Kind, string> = {
  rank: 'bg-track-subtitles text-accent-ink',
  hook: 'bg-track-shots text-accent-ink',
  promise: 'bg-track-music text-ink',
  retention: 'bg-accent text-accent-ink',
  finale: 'bg-accent-deep text-accent-ink',
  other: 'bg-raised text-ink',
}
