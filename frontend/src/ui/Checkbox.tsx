import { Check, Minus } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { cn } from './cn'

export interface CheckboxProps {
  checked: boolean | 'indeterminate'
  onChange: (checked: boolean) => void
  label?: string
  ariaLabel?: string
  name?: string
  disabled?: boolean
  className?: string
}

/** 14×14. On — заливка accent + чёрная галочка; indeterminate — чёрная черта. */
export function Checkbox({ checked, onChange, label, ariaLabel, name, disabled, className }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null)
  const indeterminate = checked === 'indeterminate'
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  const on = checked === true || indeterminate
  return (
    <label className={cn('inline-flex items-center gap-2 text-13', disabled ? 'text-disabled' : 'text-ink', className)}>
      <input
        ref={ref}
        type="checkbox"
        name={name}
        checked={checked === true}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'flex size-3.5 shrink-0 items-center justify-center rounded-clip border peer-focus-visible:shadow-focus',
          on ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-raised',
          disabled && 'opacity-50',
        )}
      >
        {indeterminate ? (
          <Minus className="size-2.5" strokeWidth={3} />
        ) : (
          checked && <Check className="size-2.5" strokeWidth={3} />
        )}
      </span>
      {label}
    </label>
  )
}
