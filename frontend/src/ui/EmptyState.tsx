import type { LucideIcon } from 'lucide-react'
import { Button } from './Button'
import { cn } from './cn'
import { ICON_CLASS, ICON_STROKE } from './internal/icon'

export interface EmptyStateAction {
  label: string
  onClick: () => void
  /** Цена, если действие платное */
  price?: number
}

export interface EmptyStateProps {
  icon: LucideIcon
  title: string
  /** Что это такое и почему пусто */
  description: string
  /** Следующее действие; единственная primary-кнопка экрана */
  primary?: EmptyStateAction
  secondary?: EmptyStateAction
  /** Вспомогательная подпись под кнопками */
  hint?: string
  className?: string
}

export function EmptyState({ icon: Icon, title, description, primary, secondary, hint, className }: EmptyStateProps) {
  return (
    <div className={cn('flex max-w-96 flex-col items-center gap-3 p-4 text-center', className)}>
      <span className="flex size-8 items-center justify-center rounded-control bg-raised text-muted">
        <Icon className={ICON_CLASS} strokeWidth={ICON_STROKE} aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-15 font-semibold text-ink">{title}</h2>
        <p className="text-13 text-muted">{description}</p>
      </div>
      {(primary || secondary) && (
        <div className="flex items-center gap-2">
          {primary && (
            <Button variant="primary" price={primary.price} onClick={primary.onClick}>
              {primary.label}
            </Button>
          )}
          {secondary && (
            <Button variant="secondary" price={secondary.price} onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          )}
        </div>
      )}
      {hint && <p className="text-11 text-muted">{hint}</p>}
    </div>
  )
}
