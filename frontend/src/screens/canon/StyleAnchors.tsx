/* Панель «Опорные кадры стиля» экрана 12 (480, layout.md): сетка шести шаблонов с подписями и статусом, устаревание
   после смены рендера, оптики или света, «Пересобрать (6, ~$0.80)» в выбранной эпохе — цена из сметы бэкенда до клика,
   отказ бюджета и канона текстом, прогресс джоба из потока SSE. Картинки кадров на экране — M5.9: здесь рамка 16:9. */
import { Image } from 'lucide-react'
import { useState } from 'react'
import type { AnchorSlot, CanonPeriodItem } from '@/types/canon'
import { budgetRefusal } from '../../api/client'
import { useAnchorsEstimate, useCollectStyleAnchors, useJobs, useStyleAnchors, type ChannelId } from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import { Button, EmptyState, ProgressBar, Select, Skeleton, StatusGlyph, cn, type Status } from '../../ui'

const ACTIVE = new Set(['queued', 'running'])

const slotStatus = (slot: AnchorSlot): Status =>
  slot.stale ? 'warning' : slot.chosen ? 'ready' : slot.candidates.some((c) => c.status === 'failed') ? 'failed' : 'queued'

const slotStatusText = (slot: AnchorSlot): string =>
  slot.stale ? `устарел: ${slot.stale}` : slot.chosen ? 'готов' : slot.candidates.some((c) => c.status === 'failed') ? 'не удался' : 'не собран'

export interface StyleAnchorsProps {
  channel: ChannelId
  /** Есть опубликованная версия стиля: без неё кадры не собираются */
  published: boolean
  periods: CanonPeriodItem[]
}

export function StyleAnchors({ channel, published, periods }: StyleAnchorsProps) {
  const state = useStyleAnchors(channel, published)
  const estimate = useAnchorsEstimate(channel, published)
  const jobs = useJobs()
  const collect = useCollectStyleAnchors(channel)
  const pushToast = useUiStore((s) => s.pushToast)
  const ready = periods.filter((p) => p.versions.length > 0)
  const [period, setPeriod] = useState<string | null>(null)
  const chosenPeriod = period ?? ready[0]?.id ?? null
  const [refusal, setRefusal] = useState<string | null>(null)

  if (!published) {
    return (
      <div className="p-3">
        <EmptyState
          icon={Image}
          title="Кадров стиля пока нет"
          description="Шесть кадров показывают, как стиль читается в картинке. Собираются после публикации стиля: опубликуйте черновик — появится v001."
        />
      </div>
    )
  }

  const job = jobs.data?.items.find((j) => j.kind === 'style_anchors' && j.channel === channel && ACTIVE.has(j.status))
  const line = estimate.data?.style
  const total = state.data?.total ?? 6

  const rebuild = async () => {
    if (!chosenPeriod) return
    setRefusal(null)
    try {
      await collect.mutateAsync(chosenPeriod)
      const label = ready.find((p) => p.id === chosenPeriod)?.label ?? chosenPeriod
      pushToast({ id: 'style-anchors', message: `Кадры стиля поставлены в очередь: ${label}`, status: 'generating' })
    } catch (error) {
      setRefusal(budgetRefusal(error)?.message ?? (error instanceof Error ? error.message : String(error)))
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {state.data?.stale && (
        <div role="note" className="flex items-start gap-2 rounded-panel border border-warning bg-surface-warning p-2.5 text-12 text-warning">
          <StatusGlyph status="warning" />
          <span>{state.data.stale}</span>
        </div>
      )}
      {state.isPending ? (
        <Skeleton className="h-50 w-full" />
      ) : state.error ? (
        <p className="text-12 text-failed-text">{state.error.message}</p>
      ) : (
        <ul aria-label="Кадры стиля" className="grid grid-cols-3 gap-2">
          {state.data?.slots.map((slot, index) => (
            <li key={slot.slot} className="flex flex-col gap-1">
              <div
                data-status={slotStatus(slot)}
                className={cn('relative aspect-video rounded-clip border bg-hover', slot.stale ? 'border-warning' : 'border-line')}
              >
                <span className="absolute top-0.5 left-1 font-script text-11 text-muted">{String(index + 1).padStart(2, '0')}</span>
                <StatusGlyph status={slotStatus(slot)} label={`${slot.label}: ${slotStatusText(slot)}`} className="absolute right-1 bottom-1" />
              </div>
              <span className="line-clamp-2 text-11 text-muted">{slot.label}</span>
            </li>
          ))}
        </ul>
      )}

      {job && (
        <div aria-label="Сборка кадров стиля" className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-12">
            <span className="text-generating">{job.status === 'queued' ? 'В очереди' : (job.message ?? 'Собираю кадры стиля')}</span>
            <span className="text-ink tabular-nums">{Math.round(job.progress * 100)}%</span>
          </div>
          <ProgressBar value={job.status === 'queued' ? null : job.progress * 100} status="generating" ariaLabel="Кадры стиля" />
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-panel border border-line bg-panel p-2.5">
        <p className="text-11 text-muted">Опорные кадры показывают, как канон читается в картинке. Пересобираются при смене рендера, оптики или света.</p>
        {ready.length === 0 ? (
          <p className="text-12 text-warning">Нет опубликованной эпохи: кадры стиля рисуются в эпохе — опубликуйте её на слое «Периоды».</p>
        ) : (
          <div className="flex items-center gap-2">
            <Select
              ariaLabel="Эпоха кадров стиля"
              value={chosenPeriod}
              onChange={setPeriod}
              options={ready.map((p) => ({ value: p.id, label: p.label || p.id }))}
              className="min-w-0 flex-1"
            />
            <Button
              onClick={() => void rebuild()}
              disabled={!line || job !== undefined}
              loading={collect.isPending}
              loadingLabel="Ставлю в очередь"
              price={line ? line.usd.usd_micro / 1_000_000 : undefined}
              priceNote={String(total)}
              title={line ? `${line.title}: ${line.label}` : undefined}
            >
              Пересобрать
            </Button>
          </div>
        )}
        {refusal && (
          <p role="alert" className="text-12 text-failed-text">
            {refusal}
          </p>
        )}
        {state.data && state.data.spent.usd_micro > 0 && <p className="text-11 text-muted">{`Оплачено за кадры стиля: ${state.data.spent.usd}`}</p>}
      </div>
    </div>
  )
}
