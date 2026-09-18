import { useId, useState, type KeyboardEvent } from 'react'
import { cn } from './cn'
import { FieldError } from './internal/FieldError'
import { fieldClass, type ButtonSize } from './internal/classes'
import { clamp, snap } from './internal/number'

export interface NumberInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Суффикс единицы: «%», «с», «дБ» */
  unit?: string
  size?: ButtonSize
  id?: string
  ariaLabel?: string
  disabled?: boolean
  error?: string
  className?: string
}

/** Число справа налево, шрифт плотный. Пока поле в фокусе, показывается черновик ввода;
    наружу уходят только разобранные числа, на blur значение выравнивается по min/max/step. */
export function NumberInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  unit,
  size = 'md',
  id,
  ariaLabel,
  disabled,
  error,
  className,
}: NumberInputProps) {
  const errorId = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(value)

  const commit = (next: number) => {
    const normalized = clamp(snap(next, step, min), min, max)
    if (normalized !== value) onChange(normalized)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const delta = (e.shiftKey ? 10 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1)
    setDraft(null)
    commit(value + delta)
  }

  return (
    <div className={cn('relative', className)}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={shown}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        disabled={disabled}
        onFocus={() => setDraft(String(value))}
        onChange={(e) => {
          setDraft(e.target.value)
          const parsed = Number(e.target.value.replace(',', '.'))
          if (e.target.value.trim() !== '' && Number.isFinite(parsed)) onChange(parsed)
        }}
        onBlur={() => {
          setDraft(null)
          commit(value)
        }}
        onKeyDown={onKeyDown}
        className={cn(fieldClass({ error: Boolean(error), size }), 'font-dense text-right', unit && 'pr-6')}
      />
      {unit && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-11 text-muted">
          {unit}
        </span>
      )}
      {error && <FieldError id={errorId} message={error} />}
    </div>
  )
}
