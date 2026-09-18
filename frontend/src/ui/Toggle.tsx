import { useId } from 'react'
import { cn } from './cn'

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Видимая подпись справа */
  label?: string
  /** Доступное имя без видимой подписи */
  ariaLabel?: string
  disabled?: boolean
  className?: string
}

/** 32×18, knob 12. On — accent + чёрный knob, off — line + серый knob. */
export function Toggle({ checked, onChange, label, ariaLabel, disabled, className }: ToggleProps) {
  const labelId = useId()
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        aria-labelledby={label ? labelId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-4.5 w-8 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-accent' : 'bg-line',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute top-[3px] left-[3px] size-3 rounded-full transition-transform',
            checked ? 'translate-x-3.5 bg-accent-ink' : 'bg-muted',
          )}
        />
      </button>
      {label && (
        <span id={labelId} className={cn('text-13', disabled ? 'text-disabled' : 'text-ink')}>
          {label}
        </span>
      )}
    </span>
  )
}
