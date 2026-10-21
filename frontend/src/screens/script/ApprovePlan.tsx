/* «Утвердить план» — подвал правой панели экрана 3, primary экрана (принцип 10; устав M4, решения 7–8). Утверждение
   бесплатно и ничего не ставит в очередь: смета показана выше, генерация — M6. Отказ 409 — сводка и проблемы со
   ссылками на кадры, а проблемы канона (`check: canon`, M5.10) — со ссылками на экран 12: лист — на лист облика,
   нет версии — на сущность; «ссылка не находит версию» чинит «Перевести на новые версии» в секции канона выше.
   Успех — тост и стадия «Генерация» на рельсе и доске (кэш выпуска и списков). Строку артборда
   «Утверждение доступно, кадр уйдёт в очередь последним» не повторяем: при проблемах бэкенд отказывает
   (docs/visual_review.md). */
import { Check } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { EffectivePlan, PlanParts } from '@/types/plan'
import { approvalRefusal } from '../../api/client'
import { useApprovePlan } from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import { Button } from '../../ui'
import { CanonLink } from './CanonLink'
import { problemHref } from './canonLinks'

export interface ApprovePlanProps {
  episodeId: string
  /** `null` — плана ещё нет, `undefined` — грузится */
  plan: EffectivePlan | null | undefined
  parts: PlanParts | undefined
  onShot: (shotId: string) => void
}

export function ApprovePlan({ episodeId, plan, parts, onShot }: ApprovePlanProps) {
  const approve = useApprovePlan(episodeId)
  const pushToast = useUiStore((s) => s.pushToast)
  // Отказ относится к плану, на который нажали: новый ответ плана (правка, версия) его снимает
  const reset = useRef(approve.reset)
  useEffect(() => {
    reset.current = approve.reset
  })
  useEffect(() => {
    reset.current()
  }, [plan])

  const current = plan?.version ?? null
  const approved = plan?.approved_version ?? null
  const done = current !== null && approved === current

  const submit = async () => {
    try {
      await approve.mutateAsync()
      pushToast({ id: 'plan-approve', message: `План ${current} утверждён`, status: 'ready' })
    } catch {
      // Показ — из approve.error: отказ со списком или текст ошибки
    }
  }

  const refusal = approvalRefusal(approve.error)
  const note = !plan
    ? plan === null
      ? notAssembled(parts)
      : null
    : done
      ? 'Новая версия плана вернёт выпуск в «Сценарий» — утвердить нужно будет снова.'
      : approved
        ? `Утверждена ${approved}, текущая — ${current}.`
        : null

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-line p-3">
      <Button
        variant="primary"
        className="w-full"
        icon={done ? Check : undefined}
        disabled={!plan || done}
        loading={approve.isPending}
        loadingLabel="Утверждаю план"
        onClick={() => void submit()}
      >
        {done ? `План ${current} утверждён` : approved ? 'Утвердить снова' : 'Утвердить план'}
      </Button>
      {refusal ? (
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-11 leading-3.5 text-failed-text">{refusal.message}</p>
          {refusal.problems.some((p) => p.canon) && (
            <ul aria-label="Канон выпуска не готов" className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {refusal.problems.map(({ canon, message }, i) =>
                canon ? (
                  <li key={i} className="text-11 leading-3.5">
                    {canon.issue === 'unresolved' ? (
                      <span className="text-muted">{message}</span>
                    ) : (
                      <CanonLink href={problemHref(canon)} className="text-accent">
                        {message}
                      </CanonLink>
                    )}
                  </li>
                ) : null,
              )}
            </ul>
          )}
          {refusal.problems.some((p) => p.shot_id) && (
            <ul aria-label="Кадры с проблемами" className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {refusal.problems.map((problem, i) =>
                problem.shot_id ? (
                  <li key={i} className="flex gap-1.5 text-11 leading-3.5">
                    <button
                      type="button"
                      onClick={() => onShot(problem.shot_id!)}
                      aria-label={`Перейти к кадру ${problem.shot_id}`}
                      className="shrink-0 rounded-control font-script text-failed-text hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      {problem.shot_id}
                    </button>
                    <span className="min-w-0 text-muted">{withoutShot(problem.message, problem.shot_id)}</span>
                  </li>
                ) : null,
              )}
            </ul>
          )}
        </div>
      ) : approve.error ? (
        <p role="alert" className="text-11 leading-3.5 text-failed-text">
          {approve.error.message}
        </p>
      ) : (
        note && <p className="text-11 leading-3.5 text-muted">{note}</p>
      )}
    </div>
  )
}

/** Почему утверждать нечего: частей не хватает или плана нет вовсе */
function notAssembled(parts: PlanParts | undefined): string {
  if (parts && parts.received.length) {
    const missing = Array.from({ length: parts.parts_total }, (_, i) => i + 1).filter((n) => !parts.received.includes(n))
    return `План ещё не собран: не хватает ${missing.length === 1 ? 'части' : 'частей'} ${missing.join(', ')} из ${parts.parts_total}.`
  }
  return 'Плана ещё нет — вставьте ответ чата на все части.'
}

const withoutShot = (message: string, shotId: string) => message.replace(new RegExp(`^кадр ${shotId}: `), '')
