/* Ракурс листа опорных портретов (артборд 12): подпись, подсказка и глиф; кандидаты плитками 3:4 с миниатюрой 320
   (принцип 12) — клик выбирает (галочка, рамка accent), «Отбраковать» под кандидатом переносит его в `rejected/`,
   отбракованные не пропадают — раскрываются приглушёнными. Пока у листа идёт джоб, его кандидаты этого ракурса —
   плитки «рисую» и «в очереди». «Перегенерировать ракурс (~$0.27)» — цена из сметы до клика, у устаревшего ракурса —
   в цвете warning. */
import { Check } from 'lucide-react'
import { useState } from 'react'
import type { AnchorCandidate, AnchorSlot, EstimateLine } from '@/types/canon'
import { budgetRefusal } from '../../api/client'
import { anchorThumb, useChooseCandidate, useRegenerateAngle, useRejectCandidate, type ChannelId } from '../../api/queries'
import { Button, StatusGlyph, cn, type Status } from '../../ui'
import { HATCH } from '../../ui/internal/hatch'
import { messageOf } from './canonFields'

/** Кандидат идущего джоба, которого ещё нет в листе */
export interface PendingCandidate {
  n: number
  drawing: boolean
}

export interface AnchorAngleProps {
  channel: ChannelId
  appearanceId: string
  slot: AnchorSlot
  /** Кандидаты ракурса в идущем джобе листа, ещё не нарисованные */
  pending: PendingCandidate[]
  /** Прогресс джоба на ракурсе: нарисовано из заказанных; null — ракурс в джобе не участвует */
  progress: { drawn: number; total: number } | null
  /** У листа идёт джоб: второй на набор не ставится */
  busy: boolean
  /** Цена перегенерации ракурса из сметы */
  price: EstimateLine | undefined
}

function angleStatus(slot: AnchorSlot, drawing: boolean): Status {
  if (slot.stale) return 'warning'
  if (drawing) return 'generating'
  if (slot.chosen) return 'ready'
  return slot.candidates.some((c) => c.status === 'failed') && !slot.candidates.some((c) => c.status === 'ready') ? 'failed' : 'queued'
}

function angleStatusText(slot: AnchorSlot, progress: AnchorAngleProps['progress']): string {
  if (progress) return `в работе, нарисовано ${progress.drawn} из ${progress.total}`
  if (slot.stale) return `устарел: ${slot.stale}`
  if (slot.chosen) return 'кандидат выбран'
  return slot.candidates.some((c) => c.status === 'ready') ? 'выберите кандидата' : 'не собран'
}

export function AnchorAngle({ channel, appearanceId, slot, pending, progress, busy, price }: AnchorAngleProps) {
  const choose = useChooseCandidate(channel, appearanceId)
  const reject = useRejectCandidate(channel, appearanceId)
  const regenerate = useRegenerateAngle(channel, appearanceId)
  const [error, setError] = useState<string | null>(null)
  const [showRejected, setShowRejected] = useState(false)
  const visible = slot.candidates.filter((c) => c.status !== 'rejected')
  const rejected = slot.candidates.filter((c) => c.status === 'rejected')
  const status = angleStatus(slot, progress !== null)

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
    } catch (failure) {
      setError(budgetRefusal(failure)?.message ?? messageOf(failure))
    }
  }

  return (
    <section
      aria-label={slot.label}
      data-status={status}
      className={cn('flex flex-col gap-1.5 rounded-panel border bg-panel p-2.5', slot.stale ? 'border-warning' : 'border-line')}
    >
      <div className="flex items-baseline gap-2">
        <h3 className="text-12 font-semibold text-ink">{slot.label}</h3>
        <span className="line-clamp-1 min-w-0 flex-1 text-11 text-muted">{slot.hint}</span>
        <StatusGlyph status={status} label={`${slot.label}: ${angleStatusText(slot, progress)}`} className="self-center" />
      </div>
      {progress && <span className="text-11 text-generating">{`Нарисовано ${progress.drawn} из ${progress.total}`}</span>}

      <ul aria-label={`Кандидаты: ${slot.label}`} className="grid grid-cols-2 gap-1.5">
        {visible.map((candidate) => (
          <li key={candidate.id} aria-label={`Кандидат ${candidate.n}`} className="flex flex-col gap-1">
            {candidate.status === 'failed' ? (
              <FailedTile candidate={candidate} />
            ) : (
              <CandidateTile
                src={anchorThumb(channel, appearanceId, candidate.id)}
                label={`${slot.label}, кандидат ${candidate.n}`}
                n={candidate.n}
                chosen={slot.chosen?.candidate === candidate.id}
                disabled={choose.isPending}
                onPick={() => void run(() => choose.mutateAsync({ angle: slot.slot, candidate: candidate.id }))}
              />
            )}
            {candidate.status === 'ready' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={slot.chosen?.candidate === candidate.id || reject.isPending}
                title={slot.chosen?.candidate === candidate.id ? 'Выбранного не отбраковать — сначала выберите другого' : 'Перенести в отбракованные — файл не удаляется'}
                onClick={() => void run(() => reject.mutateAsync({ angle: slot.slot, candidate: candidate.id }))}
                className="self-start"
              >
                Отбраковать
              </Button>
            )}
          </li>
        ))}
        {pending.map((item) => (
          <li key={`pending-${item.n}`} aria-label={`Кандидат ${item.n}`}>
            <PlaceholderTile n={item.n} state={item.drawing ? 'drawing' : 'waiting'} />
          </li>
        ))}
        {visible.length === 0 &&
          pending.length === 0 &&
          [1, 2].map((n) => (
            <li key={`empty-${n}`} aria-label={`Кандидат ${n}`}>
              <PlaceholderTile n={n} state="empty" />
            </li>
          ))}
      </ul>

      {rejected.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <button type="button" aria-expanded={showRejected} onClick={() => setShowRejected((on) => !on)} className="self-start text-11 text-muted hover:text-ink">
            {`Отбракованные (${rejected.length})`}
          </button>
          {showRejected && (
            <ul aria-label={`Отбракованные: ${slot.label}`} className="grid grid-cols-2 gap-1.5">
              {rejected.map((candidate) => (
                <li key={candidate.id} aria-label={`Кандидат ${candidate.n}, отбракован`} className="relative aspect-[3/4] overflow-hidden rounded-clip border border-line bg-hover opacity-50">
                  <Thumb src={anchorThumb(channel, appearanceId, candidate.id)} />
                  <span className="absolute top-0.5 left-1 font-script text-11 text-muted">{`кандидат ${candidate.n} · отбракован`}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant={slot.stale ? 'statusOutline' : 'secondary'}
          status="warning"
          disabled={!price || busy}
          loading={regenerate.isPending}
          loadingLabel="Ставлю в очередь"
          price={price ? price.usd.usd_micro / 1_000_000 : undefined}
          title={busy ? 'У листа уже идёт сборка — дождитесь окончания или отмените её' : price ? `${price.title}: ${price.label}` : undefined}
          onClick={() => void run(() => regenerate.mutateAsync(slot.slot))}
        >
          Перегенерировать ракурс
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-12 text-failed-text">
          {error}
        </p>
      )}
    </section>
  )
}

/** Миниатюра 320 по id кандидата; не загрузилась — остаётся плейсхолдер плитки */
function Thumb({ src }: { src: string }) {
  const [broken, setBroken] = useState(false)
  if (broken) return null
  return <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className="absolute inset-0 size-full object-contain" />
}

function CandidateTile({ src, label, n, chosen, disabled, onPick }: { src: string; label: string; n: number; chosen: boolean; disabled: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      aria-label={label}
      title={chosen ? `${label} — выбран` : `${label}: выбрать`}
      disabled={disabled}
      onClick={chosen ? undefined : onPick}
      className={cn('relative aspect-[3/4] w-full overflow-hidden rounded-clip border bg-hover', chosen ? 'border-accent' : 'border-line hover:border-line-strong')}
    >
      <Thumb src={src} />
      <span className="absolute top-0.5 left-1 font-script text-11 text-muted">{`кандидат ${n}`}</span>
      {chosen && (
        <span aria-hidden className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-clip bg-accent text-accent-ink">
          <Check size={12} strokeWidth={3} />
        </span>
      )}
    </button>
  )
}

function FailedTile({ candidate }: { candidate: AnchorCandidate }) {
  return (
    <div title={candidate.error ?? undefined} className="relative flex aspect-[3/4] w-full flex-col items-center justify-center gap-1 rounded-clip border border-failed bg-surface-failed p-1.5 text-center">
      <span className="absolute top-0.5 left-1 font-script text-11 text-muted">{`кандидат ${candidate.n}`}</span>
      <StatusGlyph status="failed" label="Не удался" />
      <span className="line-clamp-4 text-11 text-failed-text">{candidate.error ?? 'Не удался'}</span>
    </div>
  )
}

function PlaceholderTile({ n, state }: { n: number; state: 'drawing' | 'waiting' | 'empty' }) {
  return (
    <div
      data-state={state}
      className={cn(
        'relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-clip border border-dashed',
        state === 'drawing' ? 'border-generating bg-hover' : 'border-line bg-app',
      )}
    >
      <span className="absolute top-0.5 left-1 font-script text-11 text-muted">{`кандидат ${n}`}</span>
      {state === 'drawing' && <StatusGlyph status="generating" label="Рисую" />}
      {state === 'waiting' && <StatusGlyph status="queued" label="В очереди" />}
      {state === 'drawing' && <span aria-hidden className={cn('absolute inset-x-0 bottom-0 h-0.5', HATCH)} />}
    </div>
  )
}
