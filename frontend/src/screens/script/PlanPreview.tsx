/* Принятый план до листа и таблицы (M4.5): кадры по разделам — номер на поле и VO. Данные — действующий план
   бэкенда (версия плюс ручные правки, M4.3); убранные кадры — в конце, их не теряем (принцип 8). */
import type { EffectivePlan, PlanShot } from '@/types/plan'
import { plural } from '../episodes/board'

const SOURCE: Record<EffectivePlan['source'], string> = {
  bridge: 'из чата',
  manual: 'из JSON',
  api: 'из Claude API',
}

const SHOTS = ['кадр', 'кадра', 'кадров'] as const

export function PlanPreview({ plan }: { plan: EffectivePlan }) {
  const active = plan.shots.filter((shot) => shot.status !== 'removed')
  const removed = plan.shots.filter((shot) => shot.status === 'removed')
  const sections = plan.sections.map((section) => ({
    section,
    shots: active.filter((shot) => shot.section === section.id),
  }))

  return (
    <article aria-label="План" className="flex w-190 shrink-0 flex-col gap-4 rounded-panel border border-line bg-panel px-4 pt-5 pb-7">
      <header className="flex items-baseline gap-2 border-b border-line pb-3">
        <h2 className="font-script text-13 font-bold tracking-wide uppercase">{plan.meta.working_title}</h2>
        <span className="text-12 text-muted">
          Версия {plan.version} {SOURCE[plan.source]}, {active.length} {plural(active.length, SHOTS)}
        </span>
      </header>
      {sections.map(({ section, shots }) => (
        <section key={section.id} aria-label={section.title} className="flex flex-col gap-2">
          <h3 className="font-script text-13 font-bold uppercase">{section.title}</h3>
          {shots.map((shot) => (
            <ShotLine key={shot.id} shot={shot} />
          ))}
        </section>
      ))}
      {removed.length > 0 && (
        <section aria-label="Убраны из плана" className="flex flex-col gap-2 border-t border-line pt-3">
          <h3 className="text-12 text-muted">Убраны из плана</h3>
          {removed.map((shot) => (
            <ShotLine key={shot.id} shot={shot} />
          ))}
        </section>
      )}
    </article>
  )
}

function ShotLine({ shot }: { shot: PlanShot }) {
  const gone = shot.status === 'removed'
  return (
    <div className="grid grid-cols-[48px_1fr] gap-3 font-script text-13 leading-5">
      <span className="text-muted">{shot.id}</span>
      <p className={gone ? 'text-disabled' : 'text-ink'}>
        {shot.vo}
        {gone && shot.stale_reasons.length > 0 && <span className="block font-ui text-11">{shot.stale_reasons.join('; ')}</span>}
      </p>
    </div>
  )
}
