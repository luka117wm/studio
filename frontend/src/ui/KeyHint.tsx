import { cn } from './cn'

export interface KeyHintProps {
  /** Клавиши по одной: ['⌘', 'K'], ['Esc'] */
  keys: string[]
  /** Что делает сочетание: «Сохранить» */
  label?: string
  /** sm — 16px в статус-строке и меню; md — 20px, 11/600 в оверлее клавиш */
  size?: 'sm' | 'md'
  className?: string
}

export function KeyHint({ keys, label, size = 'sm', className }: KeyHintProps) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-11 text-muted', className)}>
      <span className="inline-flex items-center gap-0.5">
        {keys.map((key, i) => (
          <kbd
            key={`${key}-${i}`}
            className={cn(
              'inline-flex items-center justify-center rounded-clip border font-dense text-11',
              size === 'md' ? 'h-5 min-w-5 border-line-strong bg-panel px-1.5 font-semibold text-ink' : 'h-4 min-w-4 border-line bg-raised px-1 text-muted',
            )}
          >
            {key}
          </kbd>
        ))}
      </span>
      {label}
    </span>
  )
}
