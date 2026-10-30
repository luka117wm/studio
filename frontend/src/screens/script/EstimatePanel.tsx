/* «Смета по плану» в правой панели экрана 3 (артборд 3; принцип 6 — цена до клика): строки кадров, голоса,
   анимации и плана с подписями единиц, итог, остаток месячного бюджета, предупреждения о лимитах. Всё считает
   бэкенд (`GET …/estimate`, M4.6): здесь ни цен, ни правил превышения. После генерации «Кадры» — только кадры без
   годной картинки, нарисованные — строкой «Уже нарисовано · 78 кадров · $0» (M6.11): она приглушена, это не трата. */
import { useEstimate } from '../../api/queries'
import { Skeleton, StatusGlyph, cn } from '../../ui'
import type { PlanEstimate } from '@/types/plan'

/** Строка нарисованных кадров (`estimate.py::DRAWN_TITLE`): $0, не трата */
const DRAWN = 'Уже нарисовано'

export function EstimatePanel({ episodeId, planStamp }: { episodeId: string; planStamp: number }) {
  const estimate = useEstimate(episodeId, planStamp)
  return (
    <section aria-label="Смета по плану" className="flex flex-col gap-1.5 border-t border-line p-3">
      <h2 className="mb-0.5 text-13 font-semibold text-ink">Смета по плану</h2>
      {estimate.error ? (
        <p role="alert" className="text-12 text-failed-text">
          {estimate.error.message}
        </p>
      ) : estimate.data ? (
        <EstimateBody estimate={estimate.data} />
      ) : (
        <Skeleton variant="text" lines={4} />
      )}
    </section>
  )
}

function EstimateBody({ estimate }: { estimate: PlanEstimate }) {
  const month = estimate.budgets.find((budget) => budget.level === 'month')
  return (
    <>
      <dl className="flex flex-col gap-1.5">
        {estimate.lines.map((line) => (
          <div key={line.title} className="flex items-baseline gap-2 text-12">
            <dt className="min-w-0 flex-1 truncate text-muted">{line.title}</dt>
            <dd className="font-dense text-muted">{line.label}</dd>
            <dd className={cn('w-14 shrink-0 text-right', line.title === DRAWN ? 'text-muted' : 'font-medium text-ink')}>
              {line.usd.usd}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-0.5 flex items-baseline gap-2 border-t border-line pt-1.5 text-13 text-ink">
        <span className="flex-1">Итого</span>
        <span className="font-semibold">~{estimate.total.usd}</span>
      </div>
      {month && !month.exceeded && <p className="text-11 leading-3.5 text-muted">{month.message}</p>}
      {estimate.warnings.map((warning) => (
        <p key={warning} className="flex gap-1.5 text-11 leading-3.5 text-warning">
          <StatusGlyph status="warning" label="Превышение лимита" className="mt-px shrink-0" />
          <span>{warning}</span>
        </p>
      ))}
      {estimate.stale_pricing && (
        <p className="text-11 leading-3.5 text-warning">Цены давно не сверялись — сверьте config/pricing.yaml.</p>
      )}
    </>
  )
}
