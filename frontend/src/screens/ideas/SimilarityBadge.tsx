/* Сходство VO плана с референсом (принцип 11) — общее для вкладки «Референс» и правой панели экрана 3: «Сходство 3 %,
   норма, порог 10 %» с полоской и отметкой порога, выше порога — warning с совпавшими фразами, без плана — причина. */
import type { SimilarityReport } from '@/types/plan'
import { Skeleton, StatusGlyph, cn } from '../../ui'
import { percent } from './referenceView'

export function SimilarityBadge({ report, error }: { report: SimilarityReport | undefined; error?: Error | null }) {
  if (error) return <p className="text-11 text-failed-text">{error.message}</p>
  if (!report) return <Skeleton className="h-3 w-40" />
  const found = report.similarity
  if (!found) return <p className="text-11 text-muted">{report.reason}</p>
  const width = Math.min(found.ratio * 100, 100)
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-baseline gap-1.5 text-12">
        {!found.ok && <StatusGlyph status="warning" label="Выше порога" className="shrink-0 self-center" />}
        <span className="text-muted">Сходство</span>
        <span className={cn('font-semibold', found.ok ? 'text-ink' : 'text-warning')}>{percent(found.ratio)}</span>
        <span className={found.ok ? 'text-muted' : 'text-warning'}>
          {found.ok ? `норма, порог ${percent(found.threshold)}` : `выше порога ${percent(found.threshold)}`}
        </span>
      </p>
      <div aria-hidden className="relative h-1 rounded-sm bg-rule-inner">
        <div
          className={cn('absolute top-0 left-0 h-1 min-w-0.75 rounded-sm', found.ok ? 'bg-accent-deep' : 'bg-warning')}
          style={{ width: `${width}%` }}
        />
        <div className="absolute -top-0.75 h-2.5 w-px bg-warning" style={{ left: `${found.threshold * 100}%` }} title={`Порог ${percent(found.threshold)}`} />
      </div>
      {!found.ok && found.phrases.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-11 text-warning">Перепишите совпавшие фразы:</span>
          <ul aria-label="Совпавшие фразы" className="flex flex-col gap-0.5">
            {found.phrases.map((phrase) => (
              <li key={phrase} className="text-11 leading-3.5 text-muted">
                «{phrase}»
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
