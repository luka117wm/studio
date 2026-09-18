import { X } from 'lucide-react'
import { useId, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { IconButton } from './IconButton'
import { cn } from './cn'
import { Portal } from './internal/Portal'
import { useFocusTrap } from './internal/useFocusTrap'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Кнопки подвала; primary — не больше одной */
  footer?: ReactNode
  /** sm 360 · md 480 · lg 640 */
  size?: 'sm' | 'md' | 'lg'
}

const WIDTH = { sm: 'w-90', md: 'w-120', lg: 'w-160' } as const

/** Скрим + карточка panel: шапка 36, подвал 48. Ловушка фокуса, Esc и клик по скриму закрывают,
    фокус возвращается на триггер. */
export function Dialog({ open, onClose, title, children, footer, size = 'md' }: DialogProps) {
  const titleId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTrap(cardRef, open)

  if (!open) return null

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    onClose()
  }
  const onScrimPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <Portal>
      <div
        onPointerDown={onScrimPointerDown}
        onKeyDown={onKeyDown}
        className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      >
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={cn(
            'flex max-h-full max-w-full flex-col rounded-panel border border-line bg-panel shadow-dialog outline-none',
            WIDTH[size],
          )}
        >
          <header className="flex h-9 shrink-0 items-center justify-between border-b border-line pr-2 pl-3">
            <h2 id={titleId} className="text-13 font-semibold text-ink">
              {title}
            </h2>
            <IconButton icon={X} label="Закрыть" onClick={onClose} />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 text-13 text-ink">{children}</div>
          {footer && (
            <footer className="flex h-12 shrink-0 items-center justify-end gap-2 border-t border-line px-3">{footer}</footer>
          )}
        </div>
      </div>
    </Portal>
  )
}
