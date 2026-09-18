import { useEffect } from 'react'
import { Portal } from './internal/Portal'
import { useLatest } from './internal/useLatest'
import { Toast, type ToastItem } from './Toast'

export interface ToastStackProps {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
  /** Автоскрытие видимых тостов, мс */
  autoHideMs?: number
}

const VISIBLE = 3

/** Внизу справа, стек до 3 — дальше «и ещё N». Таймеры автоскрытия живут здесь. */
export function ToastStack({ toasts, onDismiss, autoHideMs = 4000 }: ToastStackProps) {
  const visible = toasts.slice(0, VISIBLE)
  const rest = toasts.length - visible.length
  const dismiss = useLatest(onDismiss)
  const visibleKey = visible.map((t) => t.id).join('\n')

  useEffect(() => {
    if (visibleKey === '') return
    const timers = visibleKey.split('\n').map((id) => window.setTimeout(() => dismiss.current(id), autoHideMs))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [visibleKey, autoHideMs, dismiss])

  if (toasts.length === 0) return null
  return (
    <Portal>
      <div aria-live="polite" className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
        {visible.map((item) => (
          <Toast key={item.id} item={item} onDismiss={onDismiss} />
        ))}
        {rest > 0 && <span className="text-11 text-muted">и ещё {rest}</span>}
      </div>
    </Portal>
  )
}
