import { cn } from './cn'

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical'
  /** Разделитель внутри карточки — rule-inner вместо line */
  inset?: boolean
  className?: string
}

export function Divider({ orientation = 'horizontal', inset, className }: DividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        inset ? 'bg-rule-inner' : 'bg-line',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch',
        className,
      )}
    />
  )
}
