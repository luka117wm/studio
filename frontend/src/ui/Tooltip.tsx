import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react'
import { Portal } from './internal/Portal'
import { layerStyle, useAnchorPosition } from './internal/useAnchorPosition'

export interface TooltipTargetProps {
  'aria-describedby'?: string
}

export interface TooltipProps {
  content: string
  /** Один интерактивный элемент: подсказка открывается по наведению и по фокусу */
  children: ReactElement<TooltipTargetProps>
  placement?: 'top' | 'bottom'
  /** Задержка появления по наведению, мс; по фокусу — сразу */
  delayMs?: number
}

export function Tooltip({ content, children, placement = 'top', delayMs = 300 }: TooltipProps) {
  const id = useId()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const position = useAnchorPosition(anchorRef, tipRef, open, placement === 'top' ? 'top-start' : 'bottom-start')

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => cancel, [])

  const show = (delay: number) => {
    cancel()
    if (delay === 0) setOpen(true)
    else timer.current = window.setTimeout(() => setOpen(true), delay)
  }
  const hide = () => {
    cancel()
    setOpen(false)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      hide()
    }
  }

  return (
    <>
      <span
        ref={anchorRef}
        onPointerEnter={() => show(delayMs)}
        onPointerLeave={hide}
        onFocus={() => show(0)}
        onBlur={hide}
        onKeyDown={onKeyDown}
        className="inline-flex"
      >
        {cloneElement(children, { 'aria-describedby': open ? id : children.props['aria-describedby'] })}
      </span>
      {open && (
        <Portal>
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            style={layerStyle(position)}
            className="pointer-events-none z-40 max-w-64 rounded-control border border-line bg-raised px-2 py-1 text-12 text-ink shadow-overlay"
          >
            {content}
          </div>
        </Portal>
      )}
    </>
  )
}
