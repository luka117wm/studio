/* «С правкой…» (устав M6, решение 3; docs/generation.md, «Перерисовка и версии»): новое действие кадра и перерисовка
   следующим вариантом одним запросом `POST …/redraw {prompt}`. Действие — то же `user_override.image.prompt`, что
   правка на листе экрана 3: пометка «правка», если кадр уже правили. Стоп-лист знает только бэкенд: стилевой токен —
   422 до записи, текст у поля, диалог открыт, джоба и правки нет. Отказ модели у кадра — над полем: его и лечим. */
import { useState } from 'react'
import type { Job } from '@/types/job'
import type { PlanShot } from '@/types/plan'
import { ApiError, budgetRefusal } from '../../api/client'
import { useRedraw, useRedrawEstimate } from '../../api/queries'
import { useModalScope } from '../../app/useHotkey'
import { useUiStore } from '../../store/uiStore'
import { Button, Dialog, Textarea } from '../../ui'
import { fieldMessage } from '../script/useShotEdit'

export interface EditActionDialogProps {
  episodeId: string
  /** Кадр действующего плана: действие с правками и что поправлено */
  shot: PlanShot
  /** Причина последнего сбоя кадра, если он упал */
  error: string | null
  model: string | null
  onClose: () => void
  onQueued: (job: Job, shotId: string) => void
}

export function EditActionDialog({ episodeId, shot, error, model, onClose, onQueued }: EditActionDialogProps) {
  // Пока диалог открыт, пробел, R и Esc экрана молчат (Esc закрывает сам диалог)
  useModalScope(true)
  const [prompt, setPrompt] = useState(shot.image.prompt)
  const redraw = useRedraw(episodeId)
  const estimate = useRedrawEstimate(episodeId, shot.id, model, true)
  const pushToast = useUiStore((s) => s.pushToast)
  const edited = shot.overridden.includes('image.prompt')

  const submit = async () => {
    if (redraw.isPending) return
    try {
      const job = await redraw.mutateAsync({ shotId: shot.id, model, prompt })
      pushToast({ id: `redraw-edit-${job.id}`, message: `${shot.id}: правка записана, новая версия в очереди`, status: 'ready' })
      onQueued(job, shot.id)
      onClose()
    } catch {
      // Показ — из redraw.error
    }
  }

  const invalid = redraw.error instanceof ApiError && redraw.error.status === 422 ? fieldMessage(redraw.error) : undefined
  const refusal = redraw.error && !invalid ? (budgetRefusal(redraw.error)?.message ?? redraw.error.message) : null

  return (
    <Dialog
      open
      onClose={onClose}
      title={`С правкой: ${shot.id}`}
      note="новое действие и новая версия"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            price={estimate.data ? estimate.data.usd.usd_micro / 1_000_000 : undefined}
            loading={redraw.isPending}
            loadingLabel="Ставлю в очередь"
            onClick={() => void submit()}
          >
            Перерисовать с правкой
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {error && <p className="text-12 text-failed-text">{error}</p>}
        <div className="flex items-center gap-2">
          <label htmlFor="shot-action" className="text-12 font-medium text-muted">
            Действие кадра
          </label>
          {edited && <span className="rounded-control bg-accent-deep/40 px-1 text-11 text-ink">правка</span>}
        </div>
        <Textarea
          id="shot-action"
          variant="prompt"
          value={prompt}
          onChange={(value) => {
            setPrompt(value)
            if (redraw.error) redraw.reset()
          }}
          error={invalid}
          autoFocus
        />
        <p className="text-11 text-muted">Только действие, композиция и ракурс — стиль задаёт канон.</p>
        {estimate.data && <p className="text-11 text-muted">Нарисуется вариант {estimate.data.variant}.</p>}
        {refusal && (
          <p role="alert" className="text-12 text-failed-text">
            {refusal}
          </p>
        )}
      </div>
    </Dialog>
  )
}
