import type { ReactNode } from 'react'
import { cn } from './cn'

export interface ScrollAreaProps {
  children: ReactNode
  orientation?: 'vertical' | 'horizontal' | 'both'
  /** Доступное имя прокручиваемой области — тогда она получает фокус с клавиатуры */
  ariaLabel?: string
  className?: string
}

/** Прокрутка с тонкими скроллбарами из base.css; сама область — min-h-0 для flex-родителей. */
export function ScrollArea({ children, orientation = 'vertical', ariaLabel, className }: ScrollAreaProps) {
  return (
    <div
      role={ariaLabel ? 'region' : undefined}
      aria-label={ariaLabel}
      tabIndex={ariaLabel ? 0 : undefined}
      className={cn(
        'min-h-0 min-w-0',
        orientation === 'vertical' && 'overflow-x-hidden overflow-y-auto',
        orientation === 'horizontal' && 'overflow-x-auto overflow-y-hidden',
        orientation === 'both' && 'overflow-auto',
        className,
      )}
    >
      {children}
    </div>
  )
}
