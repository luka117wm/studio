/* Слой «Стиль» экрана 12: группы полей артборда карточками, палитра с образцами, глобальный negative чипами;
   сравнение двух версий построчно. Правит только шапку (черновик или последнюю версию — первая правка заводит
   черновик); старая версия — только чтение. Hex образца — данные канона, а не цвет интерфейса: образец рисуется
   `style={{ background }}` из данных, классы экрана — только токены. */
import { X } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import type { Style, Swatch } from '@/types/canon'
import { Button, Chip, IconButton, Input, Textarea, cn } from '../../ui'
import { plural } from '../episodes/board'
import {
  HEX_RE,
  STYLE_GROUPS,
  SWATCHES_MAX,
  changedCount,
  diffStyle,
  diffSummary,
  getField,
  isCyrillic,
  negativeKey,
  setField,
  type StyleGroup,
} from './styleFields'

const CYRILLIC_HINT = 'Пишите по-английски: текст стиля уходит в промпт картинки, публикация кириллицу не примет.'

export interface StyleLayerProps {
  style: Style
  /** `onChange` есть — форма правится; нет — только чтение */
  onChange?: (style: Style) => void
}

export function StyleLayer({ style, onChange }: StyleLayerProps) {
  return (
    <form aria-label="Стиль канала" className="flex flex-col gap-3 p-3" onSubmit={(e) => e.preventDefault()}>
      {STYLE_GROUPS.map((group) => (
        <GroupCard key={group.title} group={group} style={style} onChange={onChange} />
      ))}
    </form>
  )
}

function GroupCard({ group, style, onChange }: { group: StyleGroup; style: Style; onChange?: (style: Style) => void }) {
  const count = style.palette.swatches.length
  const note = group.palette ? `${count} ${plural(count, ['образец', 'образца', 'образцов'])} с ролями` : group.note
  return (
    <section aria-label={group.title} className="flex flex-col gap-1.5 rounded-panel border border-line bg-panel p-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-13 font-semibold text-ink">{group.title}</h2>
        <span className="text-11 text-muted">{note}</span>
      </div>
      {group.rows.map(({ field, label }) => {
        const value = getField(style, field)
        return (
          <div key={field} className="flex items-start gap-2">
            <span className="w-29 shrink-0 pt-1.5 text-12 text-muted">{label}</span>
            {onChange ? (
              <Textarea
                autosize
                ariaLabel={`${group.title}: ${label}`}
                value={value}
                onChange={(next) => onChange(setField(style, field, next))}
                error={isCyrillic(value) ? CYRILLIC_HINT : undefined}
                className="min-w-0 flex-1"
              />
            ) : (
              <ReadOnlyValue label={`${group.title}: ${label}`} value={value} />
            )}
          </div>
        )
      })}
      {group.palette && <Swatches swatches={style.palette.swatches} onChange={onChange && ((swatches) => onChange({ ...style, palette: { ...style.palette, swatches } }))} />}
      {group.negative && <Negative items={style.negative_global} onChange={onChange && ((negative_global) => onChange({ ...style, negative_global }))} />}
    </section>
  )
}

function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return (
    <p aria-label={label} className="flex min-h-7 min-w-0 flex-1 items-center rounded-control border border-rule-inner bg-strip px-2 py-1 text-12 text-muted">
      {value || '—'}
    </p>
  )
}

/* ---- Палитра: образец, роль, hex. Hex пишется в стиль только целым кодом #RRGGBB, пока набирается — живёт в поле. ---- */

function Swatches({ swatches, onChange }: { swatches: Swatch[]; onChange?: (swatches: Swatch[]) => void }) {
  const update = (index: number, swatch: Swatch) => onChange?.(swatches.map((s, i) => (i === index ? swatch : s)))
  return (
    <div className="flex flex-col gap-2 pt-0.5">
      <ul aria-label="Образцы палитры" className="grid grid-cols-5 gap-2">
        {swatches.map((swatch, index) => (
          <li key={index} className="flex min-w-0 flex-col gap-1">
            {/* Цвет образца — данные канона */}
            <div className="h-8 rounded-control border border-line" style={HEX_RE.test(swatch.hex) ? { background: swatch.hex } : undefined} />
            {onChange ? (
              <>
                <Input
                  ariaLabel={`Образец ${index + 1}: роль`}
                  value={swatch.role}
                  placeholder="роль"
                  onChange={(role) => update(index, { ...swatch, role })}
                  error={isCyrillic(swatch.role) ? 'По-английски' : undefined}
                />
                <div className="flex items-center gap-1">
                  <HexInput index={index} hex={swatch.hex} onChange={(hex) => update(index, { ...swatch, hex })} />
                  <IconButton icon={X} label={`Убрать образец ${index + 1}`} onClick={() => onChange(swatches.filter((_, i) => i !== index))} />
                </div>
              </>
            ) : (
              <>
                <span className="truncate text-11 font-medium text-ink">{swatch.role || 'без роли'}</span>
                <span className="font-dense text-11 text-muted">{swatch.hex}</span>
              </>
            )}
          </li>
        ))}
      </ul>
      {onChange && (
        <div className="flex items-center gap-2">
          <Chip
            variant="add"
            label="Добавить образец"
            disabled={swatches.length >= SWATCHES_MAX}
            onClick={() => onChange([...swatches, { role: '', hex: '#808080' }])}
          />
          <span className="text-11 text-muted">От 3 до 5 образцов, у каждого роль: для чего этот цвет в кадре.</span>
        </div>
      )}
    </div>
  )
}

function HexInput({ index, hex, onChange }: { index: number; hex: string; onChange: (hex: string) => void }) {
  // Набор держится в поле; в стиль (и в черновик) уходит только целый код — неполный не пишется и не теряется
  const [text, setText] = useState(hex)
  const [seen, setSeen] = useState(hex)
  if (hex !== seen) {
    setSeen(hex)
    setText(hex)
  }
  const valid = HEX_RE.test(text)
  return (
    <Input
      ariaLabel={`Образец ${index + 1}: цвет`}
      value={text}
      onChange={(next) => {
        setText(next)
        if (HEX_RE.test(next)) onChange(next.toUpperCase())
      }}
      error={valid ? undefined : 'Нужен код #RRGGBB'}
      className="min-w-0 flex-1 font-dense"
    />
  )
}

/* ---- Глобальный negative: чипы, «Добавить запрет» по Enter, повтор без учёта регистра не добавляется ---- */

function Negative({ items, onChange }: { items: string[]; onChange?: (items: string[]) => void }) {
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
  return (
    <div className="flex flex-col gap-1.5 pt-0.5">
      <ul aria-label="Глобальный negative" className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>
            {onChange ? (
              <Chip variant="tag" label={item} onRemove={() => onChange(items.filter((_, i) => i !== index))} className={cn(isCyrillic(item) && 'border-failed')} />
            ) : (
              <span className="inline-flex h-control-sm items-center rounded-control border border-line bg-raised px-2 text-12 text-muted">{item}</span>
            )}
          </li>
        ))}
        {onChange && (
          <li className="flex items-center gap-1">
            <Input ariaLabel="Добавить запрет" value={draft} placeholder="Добавить запрет" onChange={(v) => (setDraft(v), setRepeat(null))} onKeyDown={onKeyDown} className="w-44" />
            {draft.trim() && (
              <Button size="sm" variant="ghost" onClick={add}>
                Добавить
              </Button>
            )}
          </li>
        )}
      </ul>
      {repeat && <span className="text-11 text-warning">«{repeat}» уже есть в списке.</span>}
      {russian.length > 0 && <span className="text-11 text-failed-text">{`Запреты ${russian.map((r) => `«${r}»`).join(', ')} по-русски. ${CYRILLIC_HINT}`}</span>}
      <span className="text-11 text-muted">Уходит в negative каждого кадра канала, поверх запретов периода.</span>
    </div>
  )
}

/* ---- Сравнение версий: было → стало по полям, изменённые помечены ---- */

export interface StyleDiffProps {
  before: { label: string; style: Style }
  after: { label: string; style: Style }
  onClose: () => void
}

export function StyleDiff({ before, after, onClose }: StyleDiffProps) {
  const rows = diffStyle(before.style, after.style)
  return (
    <section aria-label="Сравнение версий" className="flex flex-col p-3">
      <div className="mb-2 flex h-7 items-center gap-2">
        <h2 className="text-13 font-semibold text-ink">{`Сравнение ${before.label} и ${after.label}`}</h2>
        <span className={cn('text-12', changedCount(rows) ? 'text-warning' : 'text-muted')}>{diffSummary(rows)}</span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onClose}>
          Закрыть сравнение
        </Button>
      </div>
      <table className="w-full table-fixed border-collapse text-12">
        <thead>
          <tr className="h-6 border-b border-line text-left font-dense text-11 font-medium text-muted">
            <th scope="col" className="w-37 px-2 font-medium">
              Поле
            </th>
            <th scope="col" className="px-2 font-medium">
              {before.label}
            </th>
            <th scope="col" className="px-2 font-medium">
              {after.label}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.label}
              data-changed={r.changed || undefined}
              className={cn('border-b border-row-border align-top', r.changed && 'bg-surface-warning shadow-[inset_2px_0_0_var(--color-warning)]')}
            >
              <th scope="row" className={cn('px-2 py-2 text-left font-medium', r.changed ? 'text-warning' : 'text-muted')}>
                {r.label}
              </th>
              <td className="px-2 py-2 text-muted">{r.before}</td>
              <td className={cn('px-2 py-2', r.changed ? 'text-ink' : 'text-muted')}>{r.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
