import type { LucideIcon } from 'lucide-react'
import { type KeyboardEvent } from 'react'
import { cn } from './cn'
import type { ButtonSize } from './internal/classes'
import { cycle } from './internal/focus'
import { ICON_STROKE } from './internal/icon'
import { Tooltip } from './Tooltip'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
  /** Вариант виден, но не выбирается (`aria-disabled`): остаётся в фокусе и под мышью, чтобы показать `tooltip` */
  disabled?: boolean
  /** Подсказка к сегменту — у выключенного это причина («Нет ключа …») */
  tooltip?: string
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

/** Радиогруппа: ←→ переключают, Tab уходит дальше. Контейнер: отступ 2, зазор 2; сегмент 0 12 (components.md);
    активный — line + text-primary. Выключенный сегмент стрелки проходят фокусом, но не выбирают. */
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
    // Сегменты с подсказкой обёрнуты в якорь Tooltip — ищем кнопки по роли, не по детям контейнера
    const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'))
    const focused = radios.indexOf(document.activeElement as HTMLElement)
    const index = focused >= 0 ? focused : options.findIndex((o) => o.value === value)
    let next = index
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = cycle(index, 1, options.length)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = cycle(index, -1, options.length)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = options.length - 1
    else return
    e.preventDefault()
    const option = options[next]
    if (!option) return
    if (!option.disabled) onChange(option.value)
    radios[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex gap-0.5 rounded-control border border-line bg-raised p-0.5',
        size === 'sm' ? 'h-control-sm' : 'h-control-md',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {options.map(({ value: v, label, icon: Icon, disabled: off, tooltip }) => {
        const checked = v === value
        const segment = (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={off || undefined}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              if (!off) onChange(v)
            }}
            className={cn(
              'inline-flex h-full items-center justify-center gap-1 rounded-[3px] px-3 text-12 font-medium whitespace-nowrap',
              checked ? 'bg-line text-ink' : off ? 'cursor-default text-disabled' : 'text-muted hover:text-ink',
            )}
          >
            {Icon && <Icon className="size-icon" strokeWidth={ICON_STROKE} aria-hidden />}
            {label}
          </button>
        )
        return tooltip ? (
          <Tooltip key={v} content={tooltip} placement="bottom">
            {segment}
          </Tooltip>
        ) : (
          segment
        )
      })}
    </div>
  )
}
