import { Plus, X } from 'lucide-react'
import { cn } from './cn'

interface ChipBase {
  label: string
  disabled?: boolean
  className?: string
}

export type ChipProps =
  /** Фильтр-переключатель: включён — заливка accent */
  | (ChipBase & { variant: 'filter'; selected: boolean; onToggle: () => void })
  /** Тег с кнопкой удаления */
  | (ChipBase & { variant: 'tag'; onRemove: () => void })
  /** Добавить: пунктирная граница */
  | (ChipBase & { variant: 'add'; onClick: () => void })

const BASE = 'inline-flex h-control-sm items-center gap-1 rounded-control px-2 text-12 font-medium whitespace-nowrap'

export function Chip(props: ChipProps) {
  const { label, disabled, className } = props
  if (props.variant === 'filter') {
    return (
      <button
        type="button"
        aria-pressed={props.selected}
        disabled={disabled}
        onClick={props.onToggle}
        className={cn(
          BASE,
          props.selected
            ? 'bg-accent text-accent-ink hover:bg-accent-hover'
            : 'border border-line bg-raised text-ink hover:border-line-strong',
          'disabled:pointer-events-none disabled:text-disabled',
          className,
        )}
      >
        {label}
      </button>
    )
  }
  if (props.variant === 'add') {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={props.onClick}
        className={cn(
          BASE,
          'border border-dashed border-line-strong text-muted hover:border-accent hover:text-ink disabled:pointer-events-none disabled:text-disabled',
          className,
        )}
      >
        <Plus className="size-3" strokeWidth={1.5} aria-hidden />
        {label}
      </button>
    )
  }
  return (
    <span className={cn(BASE, 'border border-line bg-raised pr-1', disabled ? 'text-disabled' : 'text-ink', className)}>
      {label}
      <button
        type="button"
        aria-label={`Удалить ${label}`}
        title={`Удалить ${label}`}
        disabled={disabled}
        onClick={props.onRemove}
        className="flex size-4 items-center justify-center rounded-clip text-muted hover:bg-hover hover:text-ink disabled:pointer-events-none"
      >
        <X className="size-3" strokeWidth={1.5} aria-hidden />
      </button>
    </span>
  )
}
