/* Карта структуры референса (артборд 2, вкладка «Референс»): полоса сегментов 44 — ширина по длительности, подпись и
   длительность внутри; у узких сегментов подпись только в Tooltip (фокусируемая область на всю ячейку). Под полосой —
   шкала 0, ¼, ½, ¾, конец. */
import type { ReferenceMetrics } from '@/types/reference'
import { Tooltip, cn } from '../../ui'
import { SEGMENT_CLASS, layoutSegments, scaleTicks } from './structureMap'

export function StructureMap({ metrics }: { metrics: ReferenceMetrics }) {
  const boxes = layoutSegments(metrics.segments)
  return (
    <div className="flex flex-col gap-1.5">
      <div role="list" aria-label="Сегменты" className="flex h-11 overflow-hidden rounded-clip border border-line">
        {boxes.map((box) => (
          <div
            key={box.index}
            role="listitem"
            aria-label={box.tooltip}
            data-narrow={box.narrow || undefined}
            style={{ width: `${box.widthPct}%` }}
            className={cn('grid min-w-0 border-r border-app/50 last:border-r-0', SEGMENT_CLASS[box.kind])}
          >
            {box.narrow ? (
              <Tooltip content={box.tooltip}>
                <span
                  tabIndex={0}
                  aria-label={box.tooltip}
                  className="flex-1 self-stretch focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
                />
              </Tooltip>
            ) : (
              <span className="flex min-w-0 flex-col justify-between px-1.5 py-1">
                <span className="truncate text-11 leading-3.5 font-medium">{box.label}</span>
                <span className="truncate font-script text-11 leading-3 opacity-70">{box.length}</span>
              </span>
            )}
          </div>
        ))}
      </div>
      <div aria-label="Шкала времени" className="flex justify-between font-script text-11 text-muted">
        {scaleTicks(metrics.duration_s).map((tick, i) => (
          <span key={i}>{tick}</span>
        ))}
      </div>
    </div>
  )
}
