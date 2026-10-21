/* Список канона чипами (глобальный negative стиля, поля и запреты эпохи, предметы облика): тег с ×, поле «Добавить»
   по Enter, повтор без учёта регистра не добавляется, кириллица и похожие позиции подсвечены. Без `onChange` —
   только чтение. Одна правка — одно новое значение списка: дальше его пишет автосохранение черновика. */
import { useState, type KeyboardEvent } from 'react'
import { Button, Chip, Input, cn } from '../../ui'
import { CYRILLIC_HINT, isCyrillic, negativeKey, similarPairs } from './canonFields'

export interface ChipListProps {
  /** Доступное имя списка: «Глобальный negative», «Эпоха: Материалы» */
  label: string
  items: string[]
  onChange?: (items: string[]) => void
  /** Подсказка поля ввода и его доступное имя: «Добавить запрет», «Добавить анахронизм» */
  addLabel?: string
  /** Подсказать похожие позиции — смысловые повторы запретов (L-036) */
  similar?: boolean
  /** Подпись под списком */
  note?: string
  /** Поле ввода уже: в карточке на две колонки */
  narrow?: boolean
}

export function ChipList({ label, items, onChange, addLabel = 'Добавить', similar, note, narrow }: ChipListProps) {
  const [draft, setDraft] = useState('')
  const [repeat, setRepeat] = useState<string | null>(null)
  const add = () => {
    const value = draft.trim()
    if (!value || !onChange) return
    if (items.some((item) => negativeKey(item) === negativeKey(value))) {
      setRepeat(value)
      return
    }
    onChange([...items, value])
    setDraft('')
    setRepeat(null)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      add()
    }
  }
  const russian = items.filter(isCyrillic)
  const pairs = similar ? similarPairs(items) : []
  const alike = new Map<number, string>()
  for (const [i, j] of pairs) {
    alike.set(i, items[j]!)
    alike.set(j, items[i]!)
  }
  return (
    <div className="flex flex-col gap-1.5">
      <ul aria-label={label} className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => {
          const twin = alike.get(index)
          const marked = cn(isCyrillic(item) ? 'border-failed' : twin !== undefined && 'border-warning')
          return (
            <li key={`${item}-${index}`} title={twin !== undefined ? `Похоже на «${twin}»` : undefined}>
              {onChange ? (
                <Chip variant="tag" label={item} onRemove={() => onChange(items.filter((_, i) => i !== index))} className={marked} />
              ) : (
                <span className={cn('inline-flex h-control-sm items-center rounded-control border border-line bg-raised px-2 text-12 text-muted', marked)}>{item}</span>
              )}
            </li>
          )
        })}
        {onChange && (
          <li className="flex items-center gap-1">
            <Input ariaLabel={`${label}: ${addLabel.toLowerCase()}`} value={draft} placeholder={addLabel} onChange={(v) => (setDraft(v), setRepeat(null))} onKeyDown={onKeyDown} className={narrow ? 'w-32' : 'w-44'} />
            {draft.trim() && (
              <Button size="sm" variant="ghost" onClick={add}>
                Добавить
              </Button>
            )}
          </li>
        )}
        {!onChange && items.length === 0 && <li className="text-12 text-muted">пусто</li>}
      </ul>
      {repeat && <span className="text-11 text-warning">«{repeat}» уже есть в списке.</span>}
      {russian.length > 0 && <span className="text-11 text-failed-text">{`${russian.map((r) => `«${r}»`).join(', ')} по-русски. ${CYRILLIC_HINT}`}</span>}
      {pairs.length > 0 && (
        <span className="text-11 text-warning">
          {`Похоже на повтор: ${pairs.map(([i, j]) => `«${items[i]}» и «${items[j]}»`).join(', ')} — оставьте одно или уточните разницу.`}
        </span>
      )}
      {note && <span className="text-11 text-muted">{note}</span>}
    </div>
  )
}
