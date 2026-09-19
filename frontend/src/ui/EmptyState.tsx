import type { LucideIcon } from 'lucide-react'
import { Button } from './Button'
import { cn } from './cn'
import { ICON_STROKE } from './internal/icon'

export interface EmptyStateAction {
  label: string
  onClick: () => void
  /** Цена, если действие платное */
  price?: number
  priceNote?: string
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
      {/* Иконка 24 в контейнере 44 — как в пустых состояниях артборда 10 (исключение из правила «иконки 16») */}
      <span className="flex size-11 items-center justify-center rounded-panel border border-line bg-raised text-muted">
        <Icon className="size-6 shrink-0" strokeWidth={ICON_STROKE} aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-15 font-semibold text-ink">{title}</h2>
        <p className="text-12 text-muted">{description}</p>
      </div>
      {(primary || secondary) && (
        <div className="flex items-center gap-2">
          {primary && (
            <Button variant="primary" price={primary.price} priceNote={primary.priceNote} onClick={primary.onClick}>
              {primary.label}
            </Button>
          )}
          {secondary && (
            <Button variant="secondary" price={secondary.price} priceNote={secondary.priceNote} onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          )}
        </div>
      )}
      {hint && <p className="text-11 text-muted">{hint}</p>}
    </div>
  )
}
