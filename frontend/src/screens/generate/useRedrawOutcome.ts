/* Итог действий экрана 4 из этой вкладки (M6.8): перерисовка кадра — тост по концу её джоба со списанной суммой или
   причиной сбоя; пачка выбранных — тост, когда её сводка закончилась. Чужие джобы и пачки тостов не дают: следим
   только за поставленным здесь. Источник — кэш запросов (снимок джобов и сводки пачек пишет поток SSE, `api/live.ts`):
   подписка на него, а конец, пришедший раньше ответа постановки, ловится сразу при постановке. Шапку расходов
   обновляет сам конец джоба (L-046). */
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type { BatchSummary } from '@/types/batch'
import type { Job } from '@/types/job'
import { fetchJob, qk, type LiveJobs } from '../../api/queries'
import { formatUsd } from '../../app/format'
import { useUiStore } from '../../store/uiStore'
import type { ToastItem } from '../../ui'
import { failedShots, plural } from '../episodes/board'
import { SHOTS } from './grid'

const FINAL: ReadonlySet<string> = new Set(['done', 'failed', 'cancelled'])

interface Watched {
  /** Джоб перерисовки → его кадр */
  jobs: Map<string, string>
  batches: Set<string>
}

/** Закончившиеся из отслеживаемых: тост и снять с учёта */
function settle(client: QueryClient, watched: Watched, push: (toast: ToastItem) => void) {
  const items = client.getQueryData<LiveJobs>(qk.jobs)?.items ?? []
  for (const state of items) {
    const shot = watched.jobs.get(state.job_id)
    if (shot === undefined || !FINAL.has(state.status)) continue
    watched.jobs.delete(state.job_id)
    const id = `redraw-${state.job_id}`
    // `error` джоба — «<ТипОшибки>: <текст>» (docs/jobs.md); человеку — текст, как на плитке
    const reason = (state.error ?? '').replace(/^\w+: /, '') || 'причина — на плитке'
    if (state.status === 'failed') push({ id, message: `${shot} не перерисован: ${reason}`, status: 'failed' })
    if (state.status !== 'done') continue
    // Итог (`result`) событие не несёт — джоб целиком
    void fetchJob(client, state.job_id)
      .then((job) => {
        const version = Number(job.result?.version ?? 0)
        const usd = Number(job.result?.usd_micro ?? 0)
        push({ id, message: `Перерисовано: ${shot}${version ? `, версия ${version}` : ''}, списано ${formatUsd(usd)}`, status: 'ready' })
      })
      .catch(() => {})
  }
  for (const batchId of [...watched.batches]) {
    const summary = client.getQueryData<BatchSummary>(qk.batch(batchId))
    if (!summary?.finished) continue
    watched.batches.delete(batchId)
    const { done, failed } = summary.jobs
    push({
      id: `redraw-batch-done-${batchId}`,
      message: `Перерисовано ${done} ${plural(done, SHOTS)}, списано ${summary.spent.usd}${failed ? `, ${failed} ${failedShots(failed)}` : ''}`,
      status: failed ? 'warning' : 'ready',
    })
  }
}

export function useRedrawOutcome() {
  const client = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)
  const watched = useRef<Watched>({ jobs: new Map(), batches: new Set() })

  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        const head = event.query.queryKey[0]
        if (event.type === 'updated' && (head === 'jobs' || head === 'batches')) settle(client, watched.current, pushToast)
      }),
    [client, pushToast],
  )

  return {
    watchJob: (job: Job, shotId: string) => {
      watched.current.jobs.set(job.id, shotId)
      settle(client, watched.current, pushToast)
    },
    watchBatch: (batch: BatchSummary) => {
      watched.current.batches.add(batch.id)
      settle(client, watched.current, pushToast)
    },
  }
}
