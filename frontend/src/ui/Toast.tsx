import { Button } from './Button'
import { cn } from './cn'
import type { Status } from './status'

export interface ToastItem {
  id: string
  /** Совершённое действие: «Перерисовано» */
  message: string
  status?: Status
  /** Действие внутри: «Отменить» */
  action?: { label: string; onClick: () => void }
}

export interface ToastProps {
  item: ToastItem
  onDismiss: (id: string) => void
}

const BAR: Record<Status, string> = {
  queued: 'border-l-queued',
  generating: 'border-l-generating',
  ready: 'border-l-ready',
  warning: 'border-l-warning',
  failed: 'border-l-failed',
}

/** Карточка: raised, граница line, левая полоса 2px в цвете статуса. Без действия — кнопка «Скрыть» (артборды 1, 5, 10). */
export function Toast({ item, onDismiss }: ToastProps) {
  const status = item.status ?? 'ready'
  return (
    <div
      role="status"
      data-status={status}
      className={cn(
        'flex w-80 items-center gap-3 rounded-panel border border-line border-l-2 bg-raised py-2 pr-2 pl-3 text-13 text-ink shadow-overlay',
        BAR[status],
      )}
    >
      <span className="min-w-0 flex-1">{item.message}</span>
      {item.action ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            item.action?.onClick()
            onDismiss(item.id)
          }}
        >
          {item.action.label}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => onDismiss(item.id)}>
          Скрыть
        </Button>
      )}
    </div>
  )
}
