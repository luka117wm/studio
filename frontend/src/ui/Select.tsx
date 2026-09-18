import { Check, ChevronDown } from 'lucide-react'
import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from './cn'
import { FieldError } from './internal/FieldError'
import { Portal } from './internal/Portal'
import { fieldClass, type ButtonSize } from './internal/classes'
import { cycle } from './internal/focus'
import { ICON_STROKE } from './internal/icon'
import { layerStyle, useAnchorPosition } from './internal/useAnchorPosition'
import { useOutsidePointer } from './internal/useOutsidePointer'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps {
  options: SelectOption[]
  value: string | null
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  id?: string
  size?: ButtonSize
  disabled?: boolean
  error?: string
  className?: string
}

/** Поле + шеврон; меню — listbox в портале, выбранное помечено галочкой accent.
    Фокус остаётся на поле (aria-activedescendant), ↑↓ Home End Enter Space Esc. */
export function Select({
  options,
  value,
  onChange,
  placeholder = 'Не выбрано',
  ariaLabel,
  id,
  size = 'md',
  disabled,
  error,
  className,
}: SelectProps) {
  const listId = useId()
  const errorId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const position = useAnchorPosition(triggerRef, listRef, open)
  useOutsidePointer(open, () => setOpen(false), [triggerRef, listRef])

  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = selectedIndex === -1 ? undefined : options[selectedIndex]

  const openAt = (index: number) => {
    setActive(index)
    setOpen(true)
  }
  const choose = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    onChange(option.value)
    setOpen(false)
  }
  const move = (delta: number) => {
    if (options.length === 0) return
    let next = active
    for (let i = 0; i < options.length; i += 1) {
      next = cycle(next, delta, options.length)
      if (!options[next]?.disabled) break
    }
    setActive(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openAt(selectedIndex === -1 ? 0 : selectedIndex)
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(-1)
        break
      case 'Home':
        e.preventDefault()
        setActive(0)
        break
      case 'End':
        e.preventDefault()
        setActive(options.length - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        choose(active)
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  const optionId = (index: number) => `${listId}-${index}`

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openAt(selectedIndex === -1 ? 0 : selectedIndex))}
        onKeyDown={onKeyDown}
        className={cn(fieldClass({ error: Boolean(error), size }), 'flex items-center justify-between gap-2 text-left')}
      >
        <span className={cn('truncate', !selected && 'text-muted')}>{selected ? selected.label : placeholder}</span>
        <ChevronDown className="size-icon shrink-0 text-muted" strokeWidth={ICON_STROKE} aria-hidden />
      </button>
      {error && <FieldError id={errorId} message={error} />}
      {open && (
        <Portal>
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            style={layerStyle(position, true)}
            className="z-40 max-h-80 overflow-y-auto rounded-panel border border-line bg-raised py-1 shadow-overlay"
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                onMouseEnter={() => !option.disabled && setActive(index)}
                onClick={() => choose(index)}
                className={cn(
                  'flex h-control-md items-center justify-between gap-2 px-2 text-13',
                  option.disabled ? 'text-disabled' : 'text-ink',
                  index === active && !option.disabled && 'bg-hover',
                )}
              >
                <span className="truncate">{option.label}</span>
                {option.value === value && <Check className="size-icon shrink-0 text-accent" strokeWidth={ICON_STROKE} aria-hidden />}
              </li>
            ))}
          </ul>
        </Portal>
      )}
    </div>
  )
}
