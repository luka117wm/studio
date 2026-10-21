/* Лист опорных портретов облика (артборд 12) — полноэкранный слой поверх экрана 12, адрес `?sheet=<облик>`.
   Шапка: «← Лист опорных портретов», облик, статус «готов 6/6». Баннер устаревания с причиной от бэкенда и действием
   с ценой: лицо — «Пересобрать лист», одежда — «Пересобрать 3 ракурса» одним джобом. Шесть ракурсов сеткой 3 × 2.
   Подвал: готовность, зачем лист, «Собрать лист (6 ракурсов × 2 кандидата, ~$1.61)» — цена из сметы до клика, отказ
   бюджета текстом до очереди. Пока идёт джоб — прогресс из потока SSE на ракурсе и общий, «Отменить». Esc и «←»
   закрывают слой, фокус возвращается на карточку облика. Тосты по концу джоба — `useSheetToasts` слоя «Персонажи». */
import { ArrowLeft } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import type { Appearance, AnchorSlot, CanonPeriodItem, Character } from '@/types/canon'
import { budgetRefusal } from '../../api/client'
import {
  useAppearanceAnchors,
  useAppearanceEstimate,
  useCancelJob,
  useCollectSheet,
  useRegenerateStale,
  useSheetJob,
  type ChannelId,
  type SheetJob,
} from '../../api/queries'
import { Button, IconButton, ProgressBar, Skeleton, StatusGlyph, cn } from '../../ui'
import { Portal } from '../../ui/internal/Portal'
import { useFocusTrap } from '../../ui/internal/useFocusTrap'
import { plural } from '../episodes/board'
import { AnchorAngle, type PendingCandidate } from './AnchorAngle'
import { messageOf } from './canonFields'
import { appearanceTitle, sheetHead, sheetProgressText, sheetStale } from './characterFields'

export interface AnchorSheetProps {
  channel: ChannelId
  character: Character
  appearance: Appearance
  periods: CanonPeriodItem[]
  onClose: () => void
}

const HEAD_TEXT = { ready: 'text-muted', warning: 'text-warning', failed: 'text-failed-text' } as const

/** Кандидаты идущего джоба по ракурсу: обработчик сообщает `index/total` перед каждым кандидатом (docs/jobs.md),
 *  так что первые `round(progress × total)` уже нарисованы, следующий — рисуется */
function jobByAngle(job: SheetJob | null, slots: AnchorSlot[]) {
  const pending = new Map<string, PendingCandidate[]>()
  const progress = new Map<string, { drawn: number; total: number }>()
  if (!job) return { pending, progress }
  const { items } = job.order
  const running = job.state.status === 'running'
  const drawn = running ? Math.round(job.state.progress * items.length) : 0
  items.forEach((item, index) => {
    const line = progress.get(item.slot) ?? { drawn: 0, total: 0 }
    line.total += 1
    if (index < drawn) line.drawn += 1
    progress.set(item.slot, line)
    const slot = slots.find((s) => s.slot === item.slot)
    const done = slot?.candidates.some((c) => c.n === item.n && c.version === job.order.version && c.status !== 'failed')
    if (index >= drawn && !done) pending.set(item.slot, [...(pending.get(item.slot) ?? []), { n: item.n, drawing: running && index === drawn }])
  })
  return { pending, progress }
}

export function AnchorSheet({ channel, character, appearance, periods, onClose }: AnchorSheetProps) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  const state = useAppearanceAnchors(channel, appearance.id)
  const estimate = useAppearanceEstimate(channel, appearance.id)
  const job = useSheetJob(channel, appearance.id)
  const collect = useCollectSheet(channel, appearance.id)
  const stale = useRegenerateStale(channel, appearance.id)
  const cancel = useCancelJob()
  const [refusal, setRefusal] = useState<string | null>(null)
  const title = appearanceTitle(character, appearance, periods)
  const sheet = state.data
  const head = sheet ? sheetHead(sheet) : null
  const outdated = sheet ? sheetStale(sheet) : null
  const line = estimate.data?.sheet
  const staleLine = estimate.data?.stale ?? null
  const unpublished = sheet?.version === null
  const busy = job !== null
  const byAngle = jobByAngle(job, sheet?.slots ?? [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    onClose()
  }

  const start = async (action: () => Promise<unknown>) => {
    setRefusal(null)
    try {
      await action()
    } catch (error) {
      setRefusal(budgetRefusal(error)?.message ?? messageOf(error))
    }
  }

  return (
    <Portal>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Лист опорных портретов: ${title}`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="fixed inset-0 z-30 flex flex-col bg-app text-ink outline-none"
      >
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
          <IconButton icon={ArrowLeft} label="Назад к персонажу" onClick={onClose} />
          <h2 className="text-18 font-semibold">Лист опорных портретов</h2>
          <span className="min-w-0 truncate text-12 text-muted">{title}</span>
          <span className="flex-1" />
          {head && (
            <span className="flex items-center gap-2">
              <StatusGlyph status={head.status} label={`Лист ${head.text}`} />
              <span className={cn('text-12', HEAD_TEXT[head.status as keyof typeof HEAD_TEXT])}>{head.text}</span>
            </span>
          )}
        </header>

        {sheet && outdated && (
          <div role="note" aria-label="Лист устарел" className="flex shrink-0 items-center gap-3 border-b border-warning bg-surface-warning px-4 py-2.5">
            <StatusGlyph status="warning" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-13 font-medium text-warning">{outdated.title}</span>
              <span className="text-12 text-muted">{sheet.stale}</span>
            </div>
            {outdated.whole ? (
              <Button
                variant="statusOutline"
                status="warning"
                disabled={!line || busy}
                loading={collect.isPending}
                loadingLabel="Ставлю в очередь"
                price={line ? line.usd.usd_micro / 1_000_000 : undefined}
                priceNote={String(sheet.total)}
                onClick={() => void start(() => collect.mutateAsync())}
              >
                Пересобрать лист
              </Button>
            ) : (
              <Button
                variant="statusOutline"
                status="warning"
                disabled={!staleLine || busy}
                loading={stale.isPending}
                loadingLabel="Ставлю в очередь"
                price={staleLine ? staleLine.usd.usd_micro / 1_000_000 : undefined}
                title={staleLine ? `${staleLine.title}: ${staleLine.label}` : undefined}
                onClick={() => void start(() => stale.mutateAsync())}
              >
                {`Пересобрать ${outdated.slots} ${plural(outdated.slots, ['ракурс', 'ракурса', 'ракурсов'])}`}
              </Button>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {state.error ? (
            <p role="alert" className="text-13 text-failed-text">
              {messageOf(state.error)}
            </p>
          ) : !sheet ? (
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-80 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {sheet.slots.map((slot) => (
                <AnchorAngle
                  key={slot.slot}
                  channel={channel}
                  appearanceId={appearance.id}
                  slot={slot}
                  pending={byAngle.pending.get(slot.slot) ?? []}
                  progress={byAngle.progress.get(slot.slot) ?? null}
                  busy={busy || unpublished}
                  price={estimate.data?.angle}
                />
              ))}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-line bg-panel px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {job ? (
              <div aria-label="Сборка листа" className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2 text-12">
                  <span className="min-w-0 flex-1 truncate text-generating">
                    {job.state.cancel_requested ? 'Останавливаю после текущего кандидата' : job.state.status === 'queued' ? 'В очереди' : (job.state.message ?? 'Собираю лист')}
                  </span>
                  <span className="text-ink tabular-nums">{`${Math.round(job.state.progress * 100)}%`}</span>
                </div>
                <ProgressBar value={job.state.status === 'queued' ? null : job.state.progress * 100} status="generating" ariaLabel="Прогресс сборки листа" />
              </div>
            ) : (
              sheet && <span className="text-12 text-muted">{unpublished ? 'Облик не опубликован — опубликуйте персонажа с этим обликом, потом собирайте лист.' : sheetProgressText(sheet)}</span>
            )}
            <span className="text-11 text-muted">Опорные портреты подаются в каждый кадр с этим персонажем — от них зависит, останется ли он собой.</span>
            {refusal && (
              <p role="alert" className="text-12 text-failed-text">
                {refusal}
              </p>
            )}
          </div>
          {job && (
            <Button variant="ghost" disabled={job.state.cancel_requested} loading={cancel.isPending} loadingLabel="Отменяю" onClick={() => void start(() => cancel.mutateAsync(job.state.job_id))}>
              Отменить
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!line || busy || unpublished}
            loading={collect.isPending}
            loadingLabel="Ставлю в очередь"
            price={line ? line.usd.usd_micro / 1_000_000 : undefined}
            priceNote={line?.label}
            onClick={() => void start(() => collect.mutateAsync())}
          >
            Собрать лист
          </Button>
        </footer>
      </div>
    </Portal>
  )
}
