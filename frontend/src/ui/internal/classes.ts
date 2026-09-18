/* Классы кнопок, общие для Button, IconButton и триггера DropdownMenu. */
import { cn } from '../cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'statusOutline'
export type ButtonSize = 'md' | 'sm'
export type ButtonStatus = 'warning' | 'failed'
export type IconButtonVariant = 'ghost' | 'dangerHover'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control text-13 font-medium select-none'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent-pressed',
  secondary: 'border border-line bg-raised text-ink hover:border-line-strong active:bg-hover',
  ghost: 'text-muted hover:bg-hover hover:text-ink active:bg-raised',
  danger: 'border border-failed text-failed-text hover:bg-surface-failed active:bg-surface-failed',
  statusOutline: 'border',
}

const BUTTON_STATUS: Record<ButtonStatus, string> = {
  warning: 'border-warning text-warning hover:bg-surface-warning',
  failed: 'border-failed text-failed-text hover:bg-surface-failed',
}

const BUTTON_SIZE: Record<ButtonSize, string> = {
  md: 'h-control-md px-3',
  sm: 'h-control-sm px-2',
}

/** Кнопка с подписью. Disabled одинаков для всех вариантов: bg-raised + text-disabled. */
export function buttonClass(opts: {
  variant: ButtonVariant
  size: ButtonSize
  status: ButtonStatus
  disabled: boolean
  loading: boolean
}): string {
  const { variant, size, status, disabled, loading } = opts
  return cn(
    BUTTON_BASE,
    BUTTON_SIZE[size],
    disabled && !loading
      ? 'pointer-events-none border border-line bg-raised text-disabled'
      : [BUTTON_VARIANT[variant], variant === 'statusOutline' && BUTTON_STATUS[status]],
    loading && 'pointer-events-none',
  )
}

const ICON_BUTTON_BASE =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-control text-muted disabled:pointer-events-none disabled:text-disabled'

const ICON_BUTTON_VARIANT: Record<IconButtonVariant, string> = {
  ghost: 'hover:bg-hover hover:text-ink active:bg-raised',
  dangerHover: 'hover:bg-surface-failed hover:text-failed-text',
}

/** Кнопка-иконка 24×24. */
export function iconButtonClass(variant: IconButtonVariant): string {
  return cn(ICON_BUTTON_BASE, ICON_BUTTON_VARIANT[variant])
}

/** Поле ввода: Input, Textarea, NumberInput, триггер Select. */
export function fieldClass(opts: { error: boolean; size?: ButtonSize }): string {
  return cn(
    'w-full rounded-control border bg-raised px-2 text-13 text-ink outline-none',
    'focus:border-accent disabled:text-disabled',
    opts.size === 'sm' ? 'h-control-sm' : 'h-control-md',
    opts.error ? 'border-failed' : 'border-line',
  )
}
