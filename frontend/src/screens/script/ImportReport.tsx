/* «Изменения vNNN» в правой панели экрана 3 (M6.11; устав M6, решение 9): что изменила последняя версия плана,
   пришедшая с этого экрана (мост, «Сохранить как версию», «Перевести на новые версии»). Счёт кадров и кадры, чья
   картинка устарела, — с датой и ценой выбранной версии: «картинка 12:41, $0.067 — устарела». Картинки не удаляются:
   перерисуются только эти кадры, сколько это стоит — в смете ниже. Всё считает бэкенд (`ImportResult`); отчёт живёт
   до следующего импорта или «Скрыть». */
import { X } from 'lucide-react'
import type { ImportResult, ShotChange } from '@/types/project'
import { useImportReport } from '../../api/queries'
import { formatClock, formatSlotDate } from '../../app/format'
import { IconButton, StatusGlyph } from '../../ui'
import { plural } from '../episodes/board'

const SHOTS = ['кадр', 'кадра', 'кадров'] as const
/** Сколько устаревших кадров перечислять; остальные — числом */
const SHOWN = 8

export function ImportReport({ episodeId, onShot }: { episodeId: string; onShot: (shotId: string) => void }) {
  const { report, dismiss } = useImportReport(episodeId)
  if (!report) return null
  const stale = report.changes.filter((change) => change.stale)
  return (
    <section aria-label={`Изменения ${report.version}`} className="flex flex-col gap-2 border-t border-line p-3">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-13 font-semibold text-ink">Изменения {report.version}</h2>
        <IconButton icon={X} label="Скрыть изменения" onClick={dismiss} />
      </div>
      <p className="text-12 text-muted">{summary(report, stale.length)}</p>
      {stale.length > 0 && (
        <ul aria-label="Устаревшие картинки" className="flex flex-col gap-1">
          {stale.slice(0, SHOWN).map((change) => (
            <li key={change.shot_id} className="flex items-baseline gap-1.5 text-11 leading-3.5">
              <StatusGlyph status="warning" label="Картинка устарела" className="shrink-0 self-center" />
              <button
                type="button"
                onClick={() => onShot(change.shot_id)}
                aria-label={`Перейти к кадру ${change.shot_id}`}
                title={change.change}
                className="shrink-0 rounded-control font-script text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {change.shot_id}
              </button>
              <span className="min-w-0 text-muted">{pictureNote(change)}</span>
            </li>
          ))}
          {stale.length > SHOWN && <li className="text-11 text-muted">и ещё {stale.length - SHOWN}</li>}
        </ul>
      )}
    </section>
  )
}

/** «Изменено 12 кадров, новых 2, убрано 1; картинки устарели у 3» */
function summary(report: ImportResult, stale: number): string {
  const parts = [
    report.changed ? `изменено ${report.changed} ${plural(report.changed, SHOTS)}` : null,
    report.added ? `новых ${report.added}` : null,
    report.removed ? `убрано ${report.removed}` : null,
  ].filter(Boolean)
  const head = parts.length ? parts.join(', ') : 'кадры не изменились'
  const tail = stale ? `; картинки устарели у ${stale}` : '; картинки в силе'
  return head[0]!.toUpperCase() + head.slice(1) + tail
}

/** «картинка 12:41, $0.067 — устарела»; не сегодня — с датой: «картинка 26 окт 12:41, …» */
function pictureNote(change: Pick<ShotChange, 'drawn_at' | 'price'>): string {
  const when = change.drawn_at ? drawnWhen(change.drawn_at) : null
  const facts = [when && `картинка ${when}`, change.price?.usd].filter(Boolean).join(', ')
  return facts ? `${facts} — устарела` : 'картинка устарела'
}

function drawnWhen(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const clock = formatClock(iso)
  return day(date) === day(now) ? clock : `${formatSlotDate(day(date))} ${clock}`
}
