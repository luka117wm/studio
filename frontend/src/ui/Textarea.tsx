import { useId, type KeyboardEvent } from 'react'
import { cn } from './cn'
import { FieldError } from './internal/FieldError'

export type TextareaVariant = 'default' | 'prompt'

export interface TextareaProps {
  value: string
  onChange: (value: string) => void
  /** prompt — шрифт сценария 12/18, авторост до 6 строк */
  variant?: TextareaVariant
  rows?: number
  id?: string
  name?: string
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  readOnly?: boolean
  error?: string
  autoFocus?: boolean
  onBlur?: () => void
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  className?: string
}

export function Textarea({
  value,
  onChange,
  variant = 'default',
  rows = 3,
  id,
  name,
  placeholder,
  ariaLabel,
  disabled,
  readOnly,
  error,
  autoFocus,
  onBlur,
  onKeyDown,
  className,
}: TextareaProps) {
  const errorId = useId()
  return (
    <div className={className}>
      <textarea
        id={id}
        name={name}
        value={value}
        rows={variant === 'prompt' ? 2 : rows}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        disabled={disabled}
        readOnly={readOnly}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={cn(
          'block w-full resize-none rounded-control border bg-raised p-2 text-ink outline-none focus:border-accent disabled:text-disabled',
          error ? 'border-failed' : 'border-line',
          variant === 'prompt'
            ? 'field-sizing-content max-h-[calc(6lh+var(--space-1)*4)] font-script text-12 leading-4.5'
            : 'text-13',
        )}
      />
      {error && <FieldError id={errorId} message={error} />}
    </div>
  )
}
