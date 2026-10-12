import { useEffect, useRef } from 'react'
import { Portal } from './internal/Portal'
import { useLatest } from './internal/useLatest'
import { Toast, type ToastItem } from './Toast'

export interface ToastStackProps {
  /** Тот же объект — тот же таймер; повторный push с тем же id — новый объект и новые `autoHideMs` */
  toasts: ToastItem[]
  onDismiss: (id: string) => void
  /** Автоскрытие тоста через столько мс после его появления в стеке */
  autoHideMs?: number
}

const VISIBLE = 3

/** Внизу справа, стек до 3 — дальше «и ещё N». Таймеры автоскрытия живут здесь: у каждого тоста свой, от его появления
 *  в видимых. Соседний тост таймер не перезапускает — иначе стек продлевал бы старые тосты (M4.12: тост импорта плана
 *  жил 10 с поверх «Утвердить план»). */
export function ToastStack({ toasts, onDismiss, autoHideMs = 4000 }: ToastStackProps) {
  const visible = toasts.slice(0, VISIBLE)
  const rest = toasts.length - visible.length
  const dismiss = useLatest(onDismiss)
  const timers = useRef(new Map<ToastItem, number>())

  useEffect(() => {
    const shown = new Set(visible)
    for (const [item, timer] of timers.current) {
      if (shown.has(item)) continue
      window.clearTimeout(timer)
      timers.current.delete(item)
    }
    for (const item of visible) {
      if (timers.current.has(item)) continue
      const timer = window.setTimeout(() => {
        timers.current.delete(item)
        dismiss.current(item.id)
      }, autoHideMs)
      timers.current.set(item, timer)
    }
  })

  useEffect(() => {
    const live = timers.current
    return () => {
      live.forEach((timer) => window.clearTimeout(timer))
      live.clear()
    }
  }, [])

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
