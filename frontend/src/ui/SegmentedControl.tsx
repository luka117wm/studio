import type { LucideIcon } from 'lucide-react'
import { type KeyboardEvent } from 'react'
import { cn } from './cn'
import type { ButtonSize } from './internal/classes'
import { cycle } from './internal/focus'
import { ICON_STROKE } from './internal/icon'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
}

export interface SegmentedControlProps<T extends string> {
  /** 2–4 коротких варианта */
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  size?: ButtonSize
  disabled?: boolean
  className?: string
}

/** Радиогруппа: ←→ переключают, Tab уходит дальше. Активный сегмент — line + text-primary. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  disabled,
  className,
}: SegmentedControlProps<T>) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex((o) => o.value === value)
    let next = index
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = cycle(index, 1, options.length)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = cycle(index, -1, options.length)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = options.length - 1
    else return
    e.preventDefault()
    const option = options[next]
    if (!option) return
    onChange(option.value)
    ;(e.currentTarget.children[next] as HTMLElement | undefined)?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex rounded-control border border-line bg-raised p-px',
        size === 'sm' ? 'h-control-sm' : 'h-control-md',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {options.map(({ value: v, label, icon: Icon }) => {
        const checked = v === value
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(v)}
            className={cn(
              'inline-flex h-full items-center gap-1 rounded-[3px] px-2 text-12 font-medium whitespace-nowrap',
              checked ? 'bg-line text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {Icon && <Icon className="size-icon" strokeWidth={ICON_STROKE} aria-hidden />}
            {label}
          </button>
        )
      })}
    </div>
  )
}
