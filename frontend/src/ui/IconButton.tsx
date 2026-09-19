import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'
import { iconButtonClass, type IconButtonVariant } from './internal/classes'
import { ICON_CLASS, ICON_STROKE } from './internal/icon'

export type { IconButtonVariant }

export interface IconButtonProps {
  icon: LucideIcon
  /** Доступное имя: всегда идёт в title и aria-label */
  label: string
  variant?: IconButtonVariant
  /** Кнопка-переключатель: aria-pressed и заливка raised во включённом состоянии */
  pressed?: boolean
  disabled?: boolean
  onClick?: () => void
  className?: string
}

/** 24×24, иконка 16. */
export function IconButton({ icon: Icon, label, variant = 'ghost', pressed, disabled, onClick, className }: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(iconButtonClass(variant), pressed && 'bg-raised text-ink', className)}
    >
      <Icon className={ICON_CLASS} strokeWidth={ICON_STROKE} aria-hidden />
    </button>
  )
}
