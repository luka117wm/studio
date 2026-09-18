import { cn } from './cn'

export interface KeyHintProps {
  /** Клавиши по одной: ['⌘', 'K'], ['Esc'] */
  keys: string[]
  /** Что делает сочетание: «Сохранить» */
  label?: string
  className?: string
}

export function KeyHint({ keys, label, className }: KeyHintProps) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-11 text-muted', className)}>
      <span className="inline-flex items-center gap-0.5">
        {keys.map((key, i) => (
          <kbd
            key={`${key}-${i}`}
            className="inline-flex h-4 min-w-4 items-center justify-center rounded-clip border border-line bg-raised px-1 font-dense text-11 text-muted"
          >
            {key}
          </kbd>
        ))}
      </span>
      {label}
    </span>
  )
}
