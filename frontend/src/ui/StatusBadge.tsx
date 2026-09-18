import { cn } from './cn'
import { StatusGlyph } from './StatusGlyph'
import { statusLabel, statusTextClass, type Status } from './status'

export interface StatusBadgeProps {
  status: Status
  /** Подпись; по умолчанию — название статуса */
  label?: string
  className?: string
}

/** Глиф + подпись 11/500 в парном светлом цвете. В таблицах — только StatusGlyph. */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const text = label ?? statusLabel[status]
  return (
    <span className={cn('inline-flex items-center gap-1 text-11 font-medium', statusTextClass[status], className)}>
      <StatusGlyph status={status} label={statusLabel[status]} />
      {text}
    </span>
  )
}
