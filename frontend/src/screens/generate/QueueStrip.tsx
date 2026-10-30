/* Полоса очередей экрана 4, 72 (артборд 4, layout.md). Левая дорожка — последняя пачка кадров выпуска по `BatchSummary`
   (ответ API и событие SSE `batch.updated`, без перезапроса): готово из всех, остаток времени, прогресс из двух частей
   (готово — белая, рисуется — штриховка, на паузе — warning), потрачено из сметы, сколько рисуется сейчас, ошибки;
   пауза и продолжение, отмена — через подтверждение: начатые кадры дорисуются (docs/generation.md, «Пауза…»).
   Правая дорожка — голос, заглушка до модуля M7. */
import { Pause, Play, X } from 'lucide-react'
import { useState } from 'react'
import type { BatchSummary } from '@/types/batch'
import { useBatchAction, type BatchAction } from '../../api/queries'
import { useModalScope } from '../../app/useHotkey'
import { useUiStore } from '../../store/uiStore'
import { Button, Dialog, IconButton, StatusGlyph, cn, type Status } from '../../ui'
import { HATCH } from '../../ui/internal/hatch'
import { plural } from '../episodes/board'

const REQUESTS = ['запрос', 'запроса', 'запросов'] as const
const ERRORS = ['ошибка', 'ошибки', 'ошибок'] as const

const TOAST: Record<BatchAction, { message: string; status: Status }> = {
  pause: { message: 'Очередь на паузе', status: 'warning' },
  resume: { message: 'Очередь продолжена', status: 'ready' },
  cancel: { message: 'Очередь отменена, начатые кадры дорисуются', status: 'failed' },
}

export interface QueueStripProps {
  episodeId: string
  /** `null` — пачек у выпуска не было, `undefined` — грузится */
  batch: BatchSummary | null | undefined
  error: Error | null
}

export function QueueStrip({ episodeId, batch, error }: QueueStripProps) {
  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 border-r border-line px-4">
        {error ? (
          <p role="alert" className="text-12 text-failed-text">
            {error.message}
          </p>
        ) : batch ? (
          <BatchTrack episodeId={episodeId} batch={batch} />
        ) : (
          <span className="text-12 text-muted">{batch === null ? 'Кадры: очередь пуста' : 'Кадры: загружаю очередь'}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
        <StatusGlyph status="queued" label="не начат" />
        <span className="text-13 font-semibold text-muted">Голос — модуль M7</span>
      </div>
    </>
  )
}

/** Что с пачкой сейчас — подпись рядом с заголовком и её цвет */
function stateOf(batch: BatchSummary): { text: string; tone: string; glyph: Status } {
  const failed = batch.jobs.failed > 0
  if (batch.finished) {
    return { text: batch.cancelled ? 'отменена' : 'готово', tone: 'text-muted', glyph: failed ? 'warning' : 'ready' }
  }
  if (batch.paused) return { text: 'на паузе', tone: 'text-warning', glyph: 'warning' }
  if (batch.cancelled) return { text: 'отменена, начатые дорисовываются', tone: 'text-muted', glyph: 'generating' }
  const eta = batch.eta_s === null ? '' : `осталось ~${Math.max(1, Math.ceil(batch.eta_s / 60))} мин`
  return { text: eta, tone: 'text-generating', glyph: 'generating' }
}

function BatchTrack({ episodeId, batch }: { episodeId: string; batch: BatchSummary }) {
  const action = useBatchAction(episodeId)
  const pushToast = useUiStore((s) => s.pushToast)
  const [confirm, setConfirm] = useState(false)
  // Пока открыто подтверждение, пробел и R на его кнопках не трогают сетку
  useModalScope(confirm)
  const { jobs } = batch
  const state = stateOf(batch)
  // Пауза и отмена — пока у пачки есть что ставить: отменённая только дорисовывает начатые
  const controllable = !batch.finished && !batch.cancelled
  const percent = (n: number) => (jobs.total ? (n / jobs.total) * 100 : 0)

  const run = async (kind: BatchAction) => {
    try {
      await action.mutateAsync({ batchId: batch.id, action: kind })
      pushToast({ id: `batch-${kind}`, ...TOAST[kind] })
      setConfirm(false)
    } catch {
      // Показ — из action.error
    }
  }

  const notes = [
    jobs.failed ? `${jobs.failed} ${plural(jobs.failed, ERRORS)}` : 'ошибок нет',
    jobs.cancelled ? `отменено ${jobs.cancelled}` : null,
  ].filter(Boolean)

  return (
    <>
      <div className="flex items-center gap-2">
        <StatusGlyph status={state.glyph} label={state.text || 'рисуется'} />
        <span className="text-13 font-semibold text-ink">
          Кадры: {jobs.done} из {jobs.total}
        </span>
        {state.text && <span className={cn('truncate text-12', state.tone)}>{state.text}</span>}
        <span className="flex-1" />
        {controllable && (
          <>
            {batch.paused ? (
              <IconButton icon={Play} label="Продолжить" disabled={action.isPending} onClick={() => void run('resume')} />
            ) : (
              <IconButton icon={Pause} label="Пауза" disabled={action.isPending} onClick={() => void run('pause')} />
            )}
            <IconButton icon={X} label="Отменить очередь" variant="dangerHover" disabled={action.isPending} onClick={() => setConfirm(true)} />
          </>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Кадры пачки"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent(jobs.done))}
        className="flex h-1 overflow-hidden rounded-clip bg-rule-inner"
      >
        {/* ширины — вычисляемая геометрия, поэтому style, а не класс */}
        <div data-part="done" className="h-full bg-ink" style={{ width: `${percent(jobs.done)}%` }} />
        <div data-part="running" className={cn('h-full', batch.paused ? 'bg-warning' : HATCH)} style={{ width: `${percent(jobs.running)}%` }} />
      </div>
      <div className="flex items-baseline gap-3 text-11 text-muted">
        <span>
          <span className="text-ink">{batch.spent.usd}</span> из {batch.estimate.usd} по смете
        </span>
        {jobs.running > 0 && (
          <span>
            параллельно {jobs.running} {plural(jobs.running, REQUESTS)}
          </span>
        )}
        <span className="flex-1" />
        {/* Пауза или продолжение не прошли — текст бэкенда на месте сводки ошибок, до следующего действия */}
        {action.error && !confirm ? (
          <span role="alert" className="truncate text-failed-text">
            {action.error.message}
          </span>
        ) : (
          <span className={jobs.failed ? 'text-failed-text' : undefined}>{notes.join(', ')}</span>
        )}
      </div>
      <Dialog
        open={confirm}
        onClose={() => {
          action.reset()
          setConfirm(false)
        }}
        title="Отменить очередь"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Не отменять
            </Button>
            <Button variant="danger" loading={action.isPending} loadingLabel="Отменяю" onClick={() => void run('cancel')}>
              Отменить очередь
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p>
            Кадры из очереди ({jobs.queued}) не будут нарисованы. Начатые кадры дорисуются ({jobs.running}).
          </p>
          <p className="text-12 text-muted">Смета освободит бюджет за неначатые кадры. Нарисованное остаётся.</p>
          {action.error && (
            <p role="alert" className="text-12 text-failed-text">
              {action.error.message}
            </p>
          )}
        </div>
      </Dialog>
    </>
  )
}
