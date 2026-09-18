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
  disabled?: boolean
  onClick?: () => void
  className?: string
}

/** 24×24, иконка 16. */
export function IconButton({ icon: Icon, label, variant = 'ghost', disabled, onClick, className }: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(iconButtonClass(variant), className)}
    >
      <Icon className={ICON_CLASS} strokeWidth={ICON_STROKE} aria-hidden />
    </button>
  )
}
