import { cn } from './cn'

export interface RadioProps {
  name: string
  value: string
  checked: boolean
  onChange: (value: string) => void
  label?: string
  ariaLabel?: string
  disabled?: boolean
  className?: string
}

/** 14×14. On — граница accent + точка 7px. */
export function Radio({ name, value, checked, onChange, label, ariaLabel, disabled, className }: RadioProps) {
  return (
    <label className={cn('inline-flex items-center gap-2 text-13', disabled ? 'text-disabled' : 'text-ink', className)}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'flex size-3.5 shrink-0 items-center justify-center rounded-full border bg-raised peer-focus-visible:shadow-focus',
          checked ? 'border-accent' : 'border-line',
          disabled && 'opacity-50',
        )}
      >
        {checked && <span className="size-1.75 rounded-full bg-accent" />}
      </span>
      {label}
    </label>
  )
}
