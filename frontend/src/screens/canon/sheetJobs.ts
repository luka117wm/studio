// Тосты по концу джоба листа облика (M5.9): «Лист собран, списано $1.61», «Ракурс «профиль» перегенерирован, списано
// $0.27», отмена и сбой. Конец джоба приходит событием SSE без итога — сумма берётся из `GET /api/jobs/{id}`.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type { Job } from '@/types/job'
import { formatUsd } from '../../app/format'
import { ACTIVE_JOB, SHEET_KINDS, anchorOrderOf, fetchJob, useJobs, type ChannelId } from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import type { ToastItem } from '../../ui'
import { plural } from '../episodes/board'

/** «Лист собран, списано $1.61», «Ракурс «профиль» перегенерирован, списано $0.27»; отмена и сбой — тоже тостом */
export function sheetToast(job: Job): ToastItem {
  const order = anchorOrderOf(job)
  const result = job.result ?? {}
  const spent = formatUsd(Number(result.spent_usd_micro ?? 0))
  const sheet = job.kind === 'anchor_sheet'
  const angles = [...new Set(order?.items.map((item) => item.label.toLowerCase()) ?? [])]
  const many = !sheet && angles.length > 1
  const what = sheet ? 'Лист' : many ? `Ракурсы ${angles.map((a) => `«${a}»`).join(', ')}` : `Ракурс «${angles[0] ?? ''}»`
  const verb = sheet ? 'собран' : many ? 'перегенерированы' : 'перегенерирован'
  const id = `sheet-${job.id}`
  if (job.status === 'cancelled') return { id, message: `${sheet ? 'Сборка листа' : 'Перегенерация'} отменена, списано ${spent}`, status: 'warning' }
  if (job.status === 'failed') return { id, message: `${what} не ${verb}: ${(job.error ?? '').replace(/^\w+: /, '')}`, status: 'failed' }
  const failed = Number(result.failed ?? 0)
  const tail = failed ? `; не удались ${failed} ${plural(failed, ['кандидат', 'кандидата', 'кандидатов'])}` : ''
  return { id, message: `${what} ${verb}, списано ${spent}${tail}`, status: failed ? 'warning' : 'ready' }
}

/** Тост по концу джоба листа, который был активен при этом монтировании: итог берётся из `GET /api/jobs/{id}` */
export function useSheetToasts(channel: ChannelId): void {
  const client = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)
  const items = useJobs().data?.items
  const seen = useRef(new Set<string>())
  useEffect(() => {
    for (const job of items ?? []) {
      if (job.channel !== channel || !SHEET_KINDS.has(job.kind)) continue
      if (ACTIVE_JOB.has(job.status)) {
        seen.current.add(job.job_id)
        continue
      }
      if (!seen.current.delete(job.job_id)) continue
      fetchJob(client, job.job_id).then(
        (full) => pushToast(sheetToast(full)),
        () => undefined, // итога нет — статус листа виден и без тоста
      )
    }
  }, [items, channel, client, pushToast])
}
