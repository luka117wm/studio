/* Правая панель экрана 3 «Источник плана» (артборд 3): сегменты «Claude API / Мост через чат», промпт части
   в буфер, полоски частей, ответ чата. Номер части — следующей недостающей: порядок держит бэкенд
   (docs/bridge.md, «План»). Claude API в M4 выключен — подсказка с причиной из `/api/bridge/settings`. */
import { useState } from 'react'
import type { PlanAnswerResult, PlanParts } from '@/types/plan'
import { autosaver } from '../../app/autosave'
import { formatClock, formatSlotDate } from '../../app/format'
import { useApplyPlanAnswer, useBridgeSettings, usePlan, usePlanParts, usePlanPrompt } from '../../api/queries'
import { SegmentedControl, cn } from '../../ui'
import { CopyPrompt } from '../bridge/CopyPrompt'
import { PasteAnswer, type AppliedAnswer } from '../bridge/PasteAnswer'
import { plural } from '../episodes/board'

const SHOTS = ['кадр', 'кадра', 'кадров'] as const

type PartState = 'ready' | 'failed' | 'queued'

const PART_CLASS: Record<PartState, string> = { ready: 'bg-ready', failed: 'bg-failed', queued: 'bg-queued' }
const PART_LABEL: Record<PartState, string> = { ready: 'принята', failed: 'отклонена', queued: 'ждёт вставки' }

export function BridgePanel({ episodeId, hasIdea }: { episodeId: string; hasIdea: boolean }) {
  const settings = useBridgeSettings()
  const parts = usePlanParts(episodeId)
  const plan = usePlan(episodeId)
  const prompt = usePlanPrompt(episodeId)
  const answer = useApplyPlanAnswer(episodeId)
  // Сколько кадров в части — знает только ответ на вставку; после перезагрузки подпись без числа
  const [lastResult, setLastResult] = useState<PlanAnswerResult | null>(null)

  const api = settings.data?.api
  const total = parts.data?.parts_total ?? 1
  const part = parts.data?.next_part ?? 1

  const request = async () => {
    // Недописанная заявка уходит на бэкенд до промпта: без идеи он ответит 409
    await autosaver.flushAll()
    const issued = await prompt.mutateAsync(part)
    return { text: issued.text, copied: `Промпт части ${issued.part} из ${issued.parts_total} скопирован` }
  }

  const apply = async (text: string): Promise<AppliedAnswer> => {
    const result = await answer.mutateAsync(text)
    setLastResult(result)
    const imported = result.import_result
    const toast = imported
      ? `План ${imported.version}: +${imported.added} ${plural(imported.added, SHOTS)}`
      : `Часть ${result.part} из ${result.parts_total} принята, ${result.shots_in_part} ${plural(result.shots_in_part, SHOTS)}`
    return { toast, warnings: result.warnings }
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <SegmentedControl
        ariaLabel="Источник плана"
        value={settings.data?.plan_source ?? 'bridge'}
        onChange={() => {}}
        className="w-full [&>*]:flex-1 [&>span>button]:flex-1"
        options={[
          { value: 'api', label: 'Claude API', disabled: !api?.available, tooltip: api?.reason ?? undefined },
          { value: 'bridge', label: 'Мост через чат' },
        ]}
      />
      <CopyPrompt
        label={`Скопировать промпт части ${part} из ${total}`}
        request={request}
        disabled={!hasIdea}
        disabledReason="Заполните идею"
      />
      {parts.data && <PartStrips parts={parts.data} />}
      <span className="text-11 text-muted">{partsNote(parts.data, lastResult, plan.data?.version ?? null)}</span>
      {parts.data?.last_run && (
        <span className="text-11 text-muted">
          Последний обмен: {when(parts.data.last_run.answered_at ?? parts.data.last_run.created_at)}, часть{' '}
          {parts.data.last_run.part}
        </span>
      )}
      <PasteAnswer apply={apply} />
    </div>
  )
}

function PartStrips({ parts }: { parts: PlanParts }) {
  const failed = parts.last_run?.status === 'failed' ? parts.last_run.part : null
  const states = Array.from({ length: parts.parts_total }, (_, i): PartState => {
    const n = i + 1
    if (parts.received.includes(n)) return 'ready'
    return n === failed ? 'failed' : 'queued'
  })
  return (
    <ul aria-label="Части плана" className="flex gap-1">
      {states.map((state, i) => {
        const label = `Часть ${i + 1} из ${parts.parts_total}: ${PART_LABEL[state]}`
        return <li key={i} title={label} aria-label={label} data-state={state} className={cn('h-1 flex-1 rounded-[1px]', PART_CLASS[state])} />
      })}
    </ul>
  )
}

/** «Часть 1 вставлена, 26 кадров. Ждёт часть 2.»; без частей — что дальше */
function partsNote(parts: PlanParts | undefined, last: PlanAnswerResult | null, version: string | null): string {
  if (!parts) return ''
  if (!parts.received.length) {
    if (version) return `План ${version} принят. Новая версия — с части 1.`
    return `План придёт из чата ${parts.parts_total} ${plural(parts.parts_total, ['частью', 'частями', 'частями'])} по ${parts.shots_per_part} кадров. Ждёт часть 1.`
  }
  const latest = Math.max(...parts.received)
  const shots = last && last.part === latest && !last.import_result ? `, ${last.shots_in_part} ${plural(last.shots_in_part, SHOTS)}` : ''
  const next = parts.next_part === null ? 'Все части на месте.' : `Ждёт часть ${parts.next_part}.`
  return `Часть ${latest} вставлена${shots}. ${next}`
}

/** «сегодня 11:58», «вчера 18:02», «9 сент 12:10» — по часам машины */
function when(iso: string): string {
  const date = new Date(iso)
  const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  const label = day(date) === day(today) ? 'сегодня' : day(date) === day(yesterday) ? 'вчера' : formatSlotDate(day(date))
  return `${label} ${formatClock(iso)}`
}
