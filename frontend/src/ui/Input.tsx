import { useId, type KeyboardEvent } from 'react'
import { cn } from './cn'
import { FieldError } from './internal/FieldError'
import { fieldClass } from './internal/classes'

export interface InputProps {
  value: string
  onChange: (value: string) => void
  id?: string
  name?: string
  type?: 'text' | 'search' | 'url' | 'password'
  placeholder?: string
  /** Доступное имя, если нет внешнего <label htmlFor> */
  ariaLabel?: string
  disabled?: boolean
  readOnly?: boolean
  /** Текст ошибки под полем; включает aria-invalid */
  error?: string
  autoFocus?: boolean
  onBlur?: () => void
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  className?: string
}

export function Input({
  value,
  onChange,
  id,
  name,
  type = 'text',
  placeholder,
  ariaLabel,
  disabled,
  readOnly,
  error,
  autoFocus,
  onBlur,
  onKeyDown,
  className,
}: InputProps) {
  const errorId = useId()
  return (
    <div className={className}>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
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
        className={cn(fieldClass({ error: Boolean(error) }))}
      />
      {error && <FieldError id={errorId} message={error} />}
    </div>
  )
}
