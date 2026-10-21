/* Слой «Стиль» экрана 12: группы полей артборда карточками, палитра с образцами, глобальный negative чипами.
   Правит только шапку (черновик или последнюю версию — первая правка заводит черновик); старая версия — только
   чтение. Hex образца — данные канона, а не цвет интерфейса: образец рисуется `style={{ background }}` из данных,
   классы экрана — только токены. */
import { X } from 'lucide-react'
import { useState } from 'react'
import type { Style, Swatch } from '@/types/canon'
import { Chip, IconButton, Input, Textarea } from '../../ui'
import { plural } from '../episodes/board'
import { CYRILLIC_HINT, isCyrillic } from './canonFields'
import { ChipList } from './ChipList'
import { HEX_RE, STYLE_GROUPS, SWATCHES_MAX, getField, setField, type StyleGroup } from './styleFields'

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
      {group.negative && (
        <ChipList
          label="Глобальный negative"
          addLabel="Добавить запрет"
          items={style.negative_global}
          onChange={onChange && ((negative_global) => onChange({ ...style, negative_global }))}
          note="Уходит в negative каждого кадра канала, поверх запретов периода."
        />
      )}
    </section>
  )
}

export function ReadOnlyValue({ label, value }: { label: string; value: string }) {
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
