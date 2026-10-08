/* Оценка идеи (артборд 2): число 15/600 и полоска 40×2; от 75 — accent. Оценка — мнение чата, не данные. */
import { cn } from '../../ui'

export function IdeaScore({ value }: { value: number | null }) {
  const high = value !== null && value >= 75
  return (
    <div
      className="flex w-10 shrink-0 flex-col items-end gap-1"
      title={value === null ? 'Чат не оценил идею' : 'Оценка чата, 0–100 — мнение, не данные'}
    >
      <span className={cn('text-15 leading-4 font-semibold', high ? 'text-accent' : value === null ? 'text-muted' : 'text-ink')}>
        {value ?? '—'}
      </span>
      {value !== null && (
        <span aria-hidden className="h-0.5 w-10 overflow-hidden rounded-[1px] bg-rule-inner">
          <span className={cn('block h-0.5', high ? 'bg-accent' : 'bg-muted')} style={{ width: `${value}%` }} />
        </span>
      )}
    </div>
  )
}
