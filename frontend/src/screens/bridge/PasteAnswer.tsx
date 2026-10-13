/* Мост через чат, шаг 2: ответ чата вставляется руками в поле и уходит на бэкенд (общий для экранов 2 и 3).
   Буфер обмена программно не читается. Отказ — карточка ошибки по-русски с id кадров (docs/bridge.md,
   «Ошибка ответа в API»); поле не очищается, чтобы поправить ответ или вставить исправленный. */
import { useState } from 'react'
import { bridgeError } from '../../api/client'
import { useUiStore } from '../../store/uiStore'
import { Button, StatusGlyph, Textarea } from '../../ui'

export interface AppliedAnswer {
  /** Тост принятого ответа: «Часть 2 из 4 принята, 26 кадров» */
  toast: string
  /** Принято, но стоит посмотреть: подменённые блоки, факты без источника */
  warnings: string[]
}

export interface PasteAnswerProps {
  apply: (text: string) => Promise<AppliedAnswer>
}

export function PasteAnswer({ apply }: PasteAnswerProps) {
  const pushToast = useUiStore((s) => s.pushToast)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const applied = await apply(text)
      setText('')
      setWarnings(applied.warnings)
      pushToast({ id: 'bridge-answer', message: applied.toast, status: 'ready' })
    } catch (failure) {
      setWarnings([])
      setError(failure)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea value={text} onChange={setText} variant="prompt" rows={5} placeholder="Вставить ответ из чата" ariaLabel="Ответ из чата" />
      <Button variant="secondary" disabled={!text.trim()} loading={busy} loadingLabel="Проверяю ответ" onClick={() => void submit()}>
        Применить вставку
      </Button>
      {error !== null && <AnswerError error={error} />}
      {warnings.length > 0 && (
        <ul aria-label="Предупреждения" className="flex flex-col gap-1 text-12 text-warning">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Карточка отказа в виде ErrorCard каталога состояний: что не так, что попросить у чата, ошибки по кадрам */
function AnswerError({ error }: { error: unknown }) {
  const refusal = bridgeError(error)
  const message = refusal?.message ?? (error instanceof Error ? error.message : String(error))
  return (
    <div role="alert" className="flex gap-2.5 rounded-panel border border-failed bg-surface-failed p-3">
      <StatusGlyph status="failed" className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-13 font-medium text-failed-text">{message}</span>
        {refusal?.hint && <span className="text-12 text-muted">{refusal.hint}</span>}
        {refusal && refusal.errors.length > 0 && (
          <ul aria-label="Ошибки ответа" className="mt-1 flex flex-col gap-1">
            {refusal.errors.map((issue) => (
              <li key={`${issue.path}:${issue.message}`} className="text-12 break-words text-ink">
                {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
