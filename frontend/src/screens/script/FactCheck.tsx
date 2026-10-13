/* «Факт-чек» в правой панели экрана 3 (артборд 3): факты, которые прислал чат вместе с планом (`facts[]`). Статус —
   глиф и подпись, источник — ссылкой, кадр — переход к нему на листе. Проверку фактов делает чат (мост), не код. */
import type { Fact } from '@/types/plan'
import { StatusGlyph, type Status } from '../../ui'

const FACT: Record<Fact['status'], { status: Status; label: string; text: string }> = {
  verified: { status: 'ready', label: 'подтверждено', text: 'text-ink' },
  disputed: { status: 'warning', label: 'спорно', text: 'text-warning' },
  not_found: { status: 'failed', label: 'источник не найден', text: 'text-failed-text' },
}
/** Сводка в заголовке: «2 подтверждено, 1 спорно, 1 без источника» */
const SUMMARY: [Fact['status'], string][] = [
  ['verified', 'подтверждено'],
  ['disputed', 'спорно'],
  ['not_found', 'без источника'],
]

function factSummary(facts: Fact[]): string {
  return SUMMARY.map(([status, word]) => [facts.filter((f) => f.status === status).length, word] as const)
    .filter(([count]) => count > 0)
    .map(([count, word]) => `${count} ${word}`)
    .join(', ')
}

/** Ссылка источника короче адреса: хост и путь без протокола и хвостового «/» */
function sourceLabel(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`.replace(/\/$/, '')
  } catch {
    return url
  }
}

export function FactCheck({ facts, onShot }: { facts: Fact[]; onShot: (shotId: string) => void }) {
  const summary = factSummary(facts)
  return (
    <section aria-label="Факт-чек" className="flex flex-col gap-2 border-t border-line p-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="shrink-0 text-13 font-semibold text-ink">Факт-чек</h2>
        {summary && <span className="text-12 text-muted">{summary}</span>}
      </div>
      {facts.length === 0 ? (
        <p className="text-12 text-muted">Чат не прислал фактов на проверку.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {facts.map((fact, i) => (
            <li key={i} className="flex gap-2 rounded-control border border-line bg-panel p-1.5">
              <FactRow fact={fact} onShot={onShot} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function FactRow({ fact, onShot }: { fact: Fact; onShot: (shotId: string) => void }) {
  const look = FACT[fact.status]
  const shotId = fact.shot_id ?? null
  return (
    <>
      <StatusGlyph status={look.status} label={look.label} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-12 leading-4 text-ink">{fact.claim}</p>
        <div className="flex min-w-0 items-baseline gap-2 text-11 leading-3.5">
          <span className={look.text}>{look.label}</span>
          {fact.source_url && (
            <a
              href={fact.source_url}
              target="_blank"
              rel="noreferrer"
              title={fact.source_url}
              className="min-w-0 truncate text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {sourceLabel(fact.source_url)}
            </a>
          )}
        </div>
      </div>
      {shotId && (
        <button
          type="button"
          onClick={() => onShot(shotId)}
          aria-label={`Перейти к кадру ${shotId}`}
          className="shrink-0 self-start rounded-control font-script text-11 text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          {shotId}
        </button>
      )}
    </>
  )
}
