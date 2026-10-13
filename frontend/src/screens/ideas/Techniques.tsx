/* «Приёмы подачи списком» (артборд 2): номер, приём своими словами (из разбора чата), сколько раз встречается. */
import type { Technique } from '@/types/reference'
import { plural } from '../episodes/board'

export function Techniques({ techniques }: { techniques: Technique[] }) {
  return (
    <section aria-label="Приёмы подачи" className="flex min-w-0 flex-1 flex-col gap-1.5">
      <h3 className="text-12 font-medium text-muted">Приёмы подачи списком</h3>
      {techniques.length === 0 ? (
        <p className="text-12 text-muted">Чат не выделил повторяющихся приёмов.</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {techniques.map((technique, i) => (
            <li key={i} className="flex h-7 items-baseline gap-2 rounded-control border border-line bg-panel px-2 leading-7">
              <span className="w-5 shrink-0 font-script text-11 text-muted">{String(i + 1).padStart(2, '0')}</span>
              <span className="min-w-0 flex-1 truncate text-13 text-ink" title={technique.text}>
                {technique.text}
              </span>
              <span className="shrink-0 text-11 text-muted">
                {technique.count} {plural(technique.count, ['раз', 'раза', 'раз'])}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
