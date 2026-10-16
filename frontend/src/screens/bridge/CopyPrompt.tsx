/* Мост через чат, шаг 1: промпт задачи — в буфер обмена (общий для экранов 2 и 3, docs/bridge.md).
   Приложение не открывает claude.ai и не читает буфер: только пишет промпт по клику. Буфер недоступен
   (нет разрешения, не HTTPS) — диалог с текстом промпта, скопировать руками. */
import { Copy } from 'lucide-react'
import { useState } from 'react'
import { useUiStore } from '../../store/uiStore'
import { Button, Dialog, Textarea } from '../../ui'

export interface CopiedPrompt {
  text: string
  /** Тост после копирования: «Промпт части 2 из 4 скопирован» */
  copied: string
}

export interface CopyPromptProps {
  /** «Скопировать промпт части 2 из 4» */
  label: string
  /** Запрос промпта у бэкенда; ошибка — тост с её текстом */
  request: () => Promise<CopiedPrompt>
  disabled?: boolean
  /** Почему кнопка выключена — подпись под ней («Заполните идею») */
  disabledReason?: string
  /** primary — когда копирование промпта и есть главное действие экрана (пустая эпоха на экране 12) */
  variant?: 'primary' | 'secondary'
}

export function CopyPrompt({ label, request, disabled, disabledReason, variant = 'secondary' }: CopyPromptProps) {
  const pushToast = useUiStore((s) => s.pushToast)
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState<string | null>(null)

  const copy = async () => {
    setBusy(true)
    try {
      const prompt = await request()
      try {
        if (!navigator.clipboard) throw new Error('clipboard unavailable')
        await navigator.clipboard.writeText(prompt.text)
        pushToast({ id: 'bridge-copy', message: prompt.copied, status: 'ready' })
      } catch {
        setManual(prompt.text)
      }
    } catch (error) {
      pushToast({ id: 'bridge-copy', message: error instanceof Error ? error.message : String(error), status: 'failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant={variant} icon={Copy} disabled={disabled} loading={busy} loadingLabel="Собираю промпт" onClick={() => void copy()}>
        {label}
      </Button>
      {disabled && disabledReason && <span className="text-11 text-muted">{disabledReason}</span>}
      <Dialog
        open={manual !== null}
        onClose={() => setManual(null)}
        title="Промпт для чата"
        note="Буфер обмена недоступен. Выделите и скопируйте вручную."
        size="lg"
        footer={<Button onClick={() => setManual(null)}>Закрыть</Button>}
      >
        <Textarea value={manual ?? ''} onChange={() => {}} readOnly variant="prompt" rows={16} ariaLabel="Текст промпта" />
      </Dialog>
    </div>
  )
}
