/* Эпоха через мост (M5.6; docs/bridge.md, «Эпоха»): «Скопировать промпт эпохи» → ответ чата в черновик → список
   «Чат предложил иначе» для полей, заполненных человеком; «Дополнить запреты» → «Добавлено N, повторов M». Общие шаги
   моста — `CopyPrompt` и `PasteAnswer` экранов 2 и 3. Мост пишет только эпоху: стиль и облики — человек (принцип 13).
   Перед промптом и ответом несохранённая правка пишется на диск: чат видит текущий черновик, бэкенд сливает ответ
   с ним же. */
import { useState } from 'react'
import type { Period, PeriodConflict } from '@/types/canon'
import { useApplyPeriodAnswer, usePeriodPrompt, type ChannelId } from '../../api/queries'
import { Button } from '../../ui'
import { CopyPrompt, type CopiedPrompt } from '../bridge/CopyPrompt'
import { PasteAnswer, type AppliedAnswer } from '../bridge/PasteAnswer'
import { periodFieldLabel, periodValueText } from './periodFields'

const ONE_CHAT = 'Один обмен — один чат: каждую эпоху ведите в своём новом чате claude.ai, «Дополнить запреты» — в том же, где писался черновик.'
const UNSAVED = 'Черновик не сохранён — нажмите «Повторить» в шапке, потом вставьте ответ снова.'

export interface PeriodBridgeProps {
  channel: ChannelId
  period: Period
  /** Черновик пуст: промпт эпохи — главное действие экрана */
  empty: boolean
  flush: () => Promise<boolean>
  /** Ответ принят: черновик на бэкенде новый, локальная правка устарела */
  replaced: () => void
}

function useBridge(channel: ChannelId, period: Period, flush: () => Promise<boolean>, replaced: () => void) {
  const prompt = usePeriodPrompt(channel, period.id)
  const answer = useApplyPeriodAnswer(channel, period.id)
  const request =
    (mode: 'draft' | 'forbidden', copied: string) =>
    async (): Promise<CopiedPrompt> => {
      await flush()
      const result = await prompt.mutateAsync(mode)
      return { text: result.text, copied }
    }
  const apply = async (mode: 'draft' | 'forbidden', text: string) => {
    if (!(await flush())) throw new Error(UNSAVED)
    const result = await answer.mutateAsync({ mode, text })
    replaced()
    return result
  }
  return { request, apply }
}

/** Черновик эпохи из чата: пустой — крупным блоком с главной кнопкой, заполненный — строкой «чат заполнит пустые поля» */
export function PeriodBridge({ channel, period, empty, flush, replaced }: PeriodBridgeProps) {
  const { request, apply } = useBridge(channel, period, flush, replaced)
  const [open, setOpen] = useState(false)
  const [conflicts, setConflicts] = useState<PeriodConflict[]>([])

  const onApply = async (text: string): Promise<AppliedAnswer> => {
    const result = await apply('draft', text)
    setConflicts(result.conflicts)
    return { toast: result.message, warnings: [] }
  }
  const copy = (
    <CopyPrompt
      label="Скопировать промпт эпохи"
      variant={empty ? 'primary' : 'secondary'}
      request={request('draft', `Промпт эпохи ${period.id} скопирован — вставьте его в новый чат claude.ai`)}
    />
  )

  return (
    <section aria-label="Эпоха через чат" className="flex flex-col gap-2 rounded-panel border border-line bg-panel p-3">
      {empty ? (
        <>
          <div className="flex flex-col gap-1">
            <h2 className="text-13 font-semibold text-ink">Эпоха пуста</h2>
            <p className="text-12 text-muted">
              Чат напишет черновик по заявкам выпусков, где эпоха встречается: материалы, свет, архитектуру, одежду, предметы и не меньше десяти запретов. Публикует человек — проверьте факты перед «Опубликовать».
            </p>
          </div>
          <div className="flex items-start">{copy}</div>
          <PasteAnswer apply={onApply} />
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <h2 className="text-13 font-semibold text-ink">Через чат</h2>
              <span className="text-12 text-muted">Чат заполнит только пустые поля; заполненное вами останется, несовпадения — списком ниже.</span>
            </div>
            {copy}
            <Button variant="ghost" onClick={() => setOpen((o) => !o)}>
              {open ? 'Скрыть ответ' : 'Вставить ответ'}
            </Button>
          </div>
          {open && <PasteAnswer apply={onApply} />}
        </>
      )}
      {conflicts.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-12 font-medium text-warning">Чат предложил иначе — в черновике осталось ваше:</span>
          <ul aria-label="Чат предложил иначе" className="flex flex-col gap-1">
            {conflicts.map((c) => (
              <li key={c.field} className="flex gap-2 text-12">
                <span className="w-30 shrink-0 text-muted">{periodFieldLabel(c.field)}</span>
                <span className="min-w-0 text-ink">
                  {periodValueText(c.current)}
                  <span className="text-muted">{` — чат: ${periodValueText(c.proposed)}`}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-11 text-muted">{ONE_CHAT}</p>
    </section>
  )
}

/** «Дополнить запреты»: чат получает текущие списки и присылает только новые запреты, повторы не добавляются */
export function ForbiddenBridge({ channel, period, flush, replaced }: Omit<PeriodBridgeProps, 'empty'>) {
  const { request, apply } = useBridge(channel, period, flush, replaced)
  const [result, setResult] = useState<string | null>(null)
  const onApply = async (text: string): Promise<AppliedAnswer> => {
    const accepted = await apply('forbidden', text)
    setResult(accepted.message)
    const repeats = accepted.repeats.length ? [`Не добавлены, уже были в списке: ${accepted.repeats.map((r) => `«${r}»`).join(', ')}`] : []
    return { toast: accepted.message, warnings: repeats }
  }
  return (
    <div aria-label="Дополнить запреты через чат" role="group" className="flex flex-col gap-2 rounded-control border border-line bg-panel p-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-12 text-muted">Чат увидит текущие запреты и пришлёт только новые; приложение добавит их в конец без повторов.</span>
        <CopyPrompt label="Скопировать промпт запретов" request={request('forbidden', `Промпт запретов ${period.id} скопирован — вставьте его в чат этой эпохи`)} />
      </div>
      <PasteAnswer apply={onApply} />
      {result && (
        <p className="text-12 text-ink">
          {result}
        </p>
      )}
    </div>
  )
}
