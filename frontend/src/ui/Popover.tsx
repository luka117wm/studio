import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { cn } from './cn'
import { Portal } from './internal/Portal'
import { focusables } from './internal/focus'
import { layerStyle, useAnchorPosition, type Placement } from './internal/useAnchorPosition'
import { useOutsidePointer } from './internal/useOutsidePointer'

export interface PopoverProps {
  open: boolean
  onClose: () => void
  /** Якорь: элемент, у которого открывается слой (обычно кнопка-триггер) */
  anchorRef: RefObject<HTMLElement | null>
  ariaLabel: string
  children: ReactNode
  placement?: Placement
  className?: string
}

/** Немодальный слой у якоря. Esc и клик вне закрывают; фокус уходит внутрь при открытии
    и возвращается на якорь при закрытии. */
export function Popover({ open, onClose, anchorRef, ariaLabel, children, placement = 'bottom-start', className }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const position = useAnchorPosition(anchorRef, panelRef, open, placement)
  useOutsidePointer(open, onClose, [anchorRef, panelRef])

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ;(focusables(panel)[0] ?? panel).focus()
    return () => previous?.focus()
  }, [open])

  if (!open) return null

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    onClose()
  }

  return (
    <Portal>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={layerStyle(position)}
        className={cn('z-40 min-w-48 rounded-panel border border-line bg-raised p-3 text-13 text-ink shadow-overlay outline-none', className)}
      >
        {children}
      </div>
    </Portal>
  )
}
