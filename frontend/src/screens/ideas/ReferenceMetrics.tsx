/* Метрики референса (артборд 2): «Темп» со сравнением с нормой канала, «Плотность фактов» с «держится до N-й минуты»,
   «Сегментов» с числом рангов и временем крючков удержания. Числа считает бэкенд (docs/research.md, «Метрики»), здесь
   только подписи. «Средней длины кадра» нет: без видео её не посчитать (docs/visual_review.md). */
import type { ReferenceMetrics as Metrics } from '@/types/reference'
import { plural } from '../episodes/board'
import { decimal, densityHint, hooksHint, paceHint } from './referenceView'

export function ReferenceMetrics({ metrics, channelName }: { metrics: Metrics; channelName: string }) {
  const cards = [
    { label: 'Темп', value: String(Math.round(metrics.pace_wpm)), unit: 'слов/мин', hint: paceHint(metrics, channelName) },
    { label: 'Плотность фактов', value: decimal(metrics.facts_per_min), unit: 'на минуту', hint: densityHint(metrics) },
    {
      label: 'Сегментов',
      value: String(metrics.segments_total),
      unit: `из них ${metrics.ranks_total} ${plural(metrics.ranks_total, ['ранг', 'ранга', 'рангов'])}`,
      hint: hooksHint(metrics),
    },
  ]
  return (
    <dl aria-label="Метрики референса" className="grid grid-cols-3 gap-2">
      {cards.map((card) => (
        <div key={card.label} className="flex flex-col gap-1 rounded-panel border border-line bg-panel p-2">
          <dt className="text-11 text-muted">{card.label}</dt>
          <dd className="flex items-baseline gap-1">
            <span className="text-15 font-semibold text-ink">{card.value}</span>
            <span className="text-11 text-muted">{card.unit}</span>
          </dd>
          <dd className="text-11 leading-3.5 text-muted">{card.hint}</dd>
        </div>
      ))}
    </dl>
  )
}
