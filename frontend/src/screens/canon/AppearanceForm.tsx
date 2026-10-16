/* Облик персонажа на слое «Персонажи» (артборд 12; docs/canon_schema.md, «Облик»): форма полей облика, «Новый облик»
   и «Скопировать облик в другой период». Копия — тот же человек в другой эпохе: черты лица, телосложение, волосы,
   возраст и неизменяемое переносятся побайтово, подпись, одежда, износ и предметы пишутся заново, лист — новый
   (устав M5, решение 5). Облик пишет человек: мост его не трогает (принцип 13). */
import { useState, type ReactNode } from 'react'
import type { Appearance, CanonPeriodItem, Character } from '@/types/canon'
import { useCopyAppearance, type ChannelId } from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import { Button, Dialog, Input, Select, StatusGlyph, Textarea, cn } from '../../ui'
import { CYRILLIC_HINT, isCyrillic, messageOf, selectCanon } from './canonFields'
import { APPEARANCE_ID_RE, APPEARANCE_ROWS, appearanceTitle, copyId, copyKeeps, copyResets, emptyAppearance, periodName, type CopyRow } from './characterFields'
import { ChipList } from './ChipList'
import { ReadOnlyValue } from './StyleLayer'

const periodOptions = (periods: CanonPeriodItem[], current: string) => {
  const options = periods.map((p) => ({ value: p.id, label: `${p.label || p.id}${p.versions.length ? '' : ' (черновик)'}` }))
  return current && !periods.some((p) => p.id === current) ? [{ value: current, label: `${current} (нет в каноне)` }, ...options] : options
}

export interface AppearanceFormProps {
  appearance: Appearance
  periods: CanonPeriodItem[]
  /** Нет — только чтение */
  onChange?: (appearance: Appearance) => void
}

export function AppearanceForm({ appearance, periods, onChange }: AppearanceFormProps) {
  const set = (patch: Partial<Appearance>) => onChange?.({ ...appearance, ...patch })
  return (
    <section aria-label={`Облик ${appearance.id}`} className="flex flex-col gap-2 rounded-panel border border-line bg-panel p-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-13 font-semibold text-ink">Облик</h3>
        <span className="font-dense text-12 text-muted">{appearance.id}</span>
      </div>
      <div className="flex items-start gap-3">
        <Labeled label="Подпись" hint="по-русски">
          {onChange ? <Input ariaLabel="Облик: подпись" value={appearance.label} placeholder="пороховая обезьяна" onChange={(label) => set({ label })} /> : <ReadOnlyValue label="Облик: подпись" value={appearance.label} />}
        </Labeled>
        <Labeled label="Эпоха" hint="материалы и запреты">
          {onChange ? (
            <Select ariaLabel="Облик: эпоха" value={appearance.period || null} onChange={(period) => set({ period })} options={periodOptions(periods, appearance.period)} placeholder="Выберите эпоху" />
          ) : (
            <ReadOnlyValue label="Облик: эпоха" value={periodName(periods, appearance.period)} />
          )}
        </Labeled>
        <Labeled label="Возраст" hint="полных лет">
          {onChange ? <AgeInput age={appearance.age} onChange={(age) => set({ age })} /> : <ReadOnlyValue label="Облик: возраст" value={appearance.age === null ? '' : String(appearance.age)} />}
        </Labeled>
      </div>
      {APPEARANCE_ROWS.map(({ field, label }) => (
        <div key={field} className="flex items-start gap-2">
          <span className="w-29 shrink-0 pt-1.5 text-12 text-muted">{label}</span>
          {onChange ? (
            <Textarea
              autosize
              ariaLabel={`Облик: ${label}`}
              value={appearance[field]}
              onChange={(value) => set({ [field]: value })}
              error={isCyrillic(appearance[field]) ? CYRILLIC_HINT : undefined}
              className="min-w-0 flex-1"
            />
          ) : (
            <ReadOnlyValue label={`Облик: ${label}`} value={appearance[field]} />
          )}
        </div>
      ))}
      <div className="flex items-start gap-2">
        <span className="w-29 shrink-0 pt-1 text-12 text-muted">Предметы</span>
        <div className="min-w-0 flex-1">
          <ChipList label="Облик: предметы" items={appearance.props} onChange={onChange && ((props) => set({ props }))} />
        </div>
      </div>
      <div className="flex items-start gap-2">
        <span className="w-29 shrink-0 pt-1 text-12 text-muted">Negative облика</span>
        <div className="min-w-0 flex-1">
          <ChipList label="Облик: negative" addLabel="Добавить запрет" items={appearance.negative_local} onChange={onChange && ((negative_local) => set({ negative_local }))} note="Поверх запретов эпохи и глобального negative канала." />
        </div>
      </div>
    </section>
  )
}

function Labeled({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex items-baseline gap-2">
        <span className="text-12 font-medium text-ink">{label}</span>
        <span className="truncate text-11 text-muted">{hint}</span>
      </span>
      {children}
    </div>
  )
}

/** Возраст 0–120 полных лет: в черновик уходит только целое число, пустое поле — возраста нет */
function AgeInput({ age, onChange }: { age: number | null; onChange: (age: number | null) => void }) {
  const [text, setText] = useState(age === null ? '' : String(age))
  const [seen, setSeen] = useState(age)
  if (age !== seen) {
    setSeen(age)
    setText(age === null ? '' : String(age))
  }
  const valid = (value: string) => /^\d{1,3}$/.test(value) && Number(value) <= 120
  return (
    <Input
      ariaLabel="Облик: возраст"
      value={text}
      placeholder="11"
      onChange={(next) => {
        setText(next)
        const trimmed = next.trim()
        if (!trimmed) onChange(null)
        else if (valid(trimmed)) onChange(Number(trimmed))
      }}
      error={text.trim() && !valid(text.trim()) ? 'Полных лет, от 0 до 120' : undefined}
      className="w-20 font-dense"
    />
  )
}

/* ---- «Новый облик»: id и эпоха, остальное — в форме ---- */

export function NewAppearanceDialog({
  character,
  periods,
  onCreate,
  onClose,
}: {
  character: Character
  periods: CanonPeriodItem[]
  onCreate: (appearance: Appearance) => void
  onClose: () => void
}) {
  const [suffix, setSuffix] = useState('')
  const [period, setPeriod] = useState<string | null>(periods.find((p) => p.versions.length)?.id ?? periods[0]?.id ?? null)
  const [label, setLabel] = useState('')
  const id = `${character.id}@${suffix}`
  const error = !suffix
    ? undefined
    : !APPEARANCE_ID_RE.test(id)
      ? 'Только строчные латинские буквы, цифры и дефис, например captain-35'
      : character.appearances.some((a) => a.id === id)
        ? `Облик ${id} уже есть — выберите другой id.`
        : undefined
  return (
    <Dialog
      open
      onClose={onClose}
      title="Новый облик"
      note={`персонаж ${character.label || character.id}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" disabled={!suffix || Boolean(error) || !period} onClick={() => period && onCreate({ ...emptyAppearance(id, period), label: label.trim() })}>
            Добавить облик
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-12 text-muted">{`id облика: ${character.id}@…`}</span>
          <Input ariaLabel="id облика" value={suffix} placeholder="captain-35" onChange={(v) => setSuffix(v.trim())} error={error} autoFocus />
        </label>
        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-12 text-muted">Эпоха</span>
            <Select ariaLabel="Эпоха нового облика" value={period} onChange={setPeriod} options={periodOptions(periods, '')} placeholder="Выберите эпоху" />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-12 text-muted">Подпись</span>
            <Input ariaLabel="Подпись нового облика" value={label} placeholder="капитан" onChange={setLabel} />
          </label>
        </div>
        <p className="text-12 text-muted">Облик попадёт в черновик персонажа. Лист опорных портретов собирается после публикации: без него кадры с обликом не генерируются.</p>
      </div>
    </Dialog>
  )
}

/* ---- «Скопировать облик в другой период» ---- */

export interface CopyAppearanceDialogProps {
  channel: ChannelId
  character: Character
  periods: CanonPeriodItem[]
  /** Облик, открытый на карточке */
  source: string
  flush: () => Promise<boolean>
  replaced: () => void
  onClose: () => void
}

export function CopyAppearanceDialog({ channel, character, periods, source: initial, flush, replaced, onClose }: CopyAppearanceDialogProps) {
  const pushToast = useUiStore((s) => s.pushToast)
  const copy = useCopyAppearance(channel, character.id)
  const [source, setSource] = useState(initial)
  const from = character.appearances.find((a) => a.id === source) ?? character.appearances[0]!
  const targets = periods.filter((p) => p.id !== from.period)
  const [period, setPeriod] = useState<string | null>(targets[0]?.id ?? null)
  const [typed, setTyped] = useState<string | null>(null)
  const id = typed ?? (period ? copyId(from.id, period) : '')
  const [error, setError] = useState<string | null>(null)
  const idError = !id
    ? undefined
    : !id.startsWith(`${character.id}@`) || !APPEARANCE_ID_RE.test(id)
      ? `id копии — ${character.id}@<облик>: строчные латинские буквы, цифры и дефис`
      : character.appearances.some((a) => a.id === id)
        ? `Облик ${id} уже есть в персонаже ${character.id} — выберите другой id копии.`
        : undefined

  const onCopy = async () => {
    if (!period) return
    setError(null)
    if (!(await flush())) {
      setError('Черновик персонажа не сохранён — нажмите «Повторить» в шапке и скопируйте снова.')
      return
    }
    try {
      await copy.mutateAsync({ source: from.id, period, appearance_id: id })
      replaced()
      selectCanon('characters', { character: character.id, appearance: id })
      pushToast({ id: 'canon-appearance-copy', message: `Облик создан: ${periodName(periods, period)} · лист портретов нужно собрать`, status: 'warning' })
      onClose()
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Скопировать облик в другой период"
      note="тот же человек в другой эпохе"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" disabled={!period || !id || Boolean(idError)} loading={copy.isPending} loadingLabel="Создаю" onClick={() => void onCopy()}>
            Создать облик
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-12 text-muted">Облик-источник</span>
            <Select
              ariaLabel="Облик-источник"
              value={from.id}
              onChange={(value) => {
                setSource(value)
                setTyped(null)
              }}
              options={character.appearances.map((a) => ({ value: a.id, label: appearanceTitle(character, a, periods) }))}
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-12 text-muted">Период-назначение</span>
            <Select
              ariaLabel="Период-назначение"
              value={period}
              onChange={(value) => {
                setPeriod(value)
                setTyped(null)
              }}
              options={periodOptions(targets, '')}
              placeholder="Нет другой эпохи"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-12 text-muted">id копии</span>
          <Input ariaLabel="id копии" value={id} onChange={(v) => setTyped(v.trim())} error={idError} className="font-dense" />
        </label>
        <div className="flex gap-3">
          <CopyColumn title="Переносится" status="ready" rows={copyKeeps(character, from)} />
          <CopyColumn title="Заполняется заново" status="warning" rows={copyResets(from)} reset />
        </div>
        <p className="text-11 text-muted">Лист опорных портретов у нового облика придётся собрать: лицо то же, но одежда, износ и предметы другие.</p>
        {error && (
          <p role="alert" className="text-12 text-failed-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

function CopyColumn({ title, status, rows, reset }: { title: string; status: 'ready' | 'warning'; rows: CopyRow[]; reset?: boolean }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-panel border border-line bg-raised p-2.5">
      <div className="flex items-center gap-1.5">
        <StatusGlyph status={status} label={title} />
        <h3 className="text-12 font-semibold text-ink">{title}</h3>
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-baseline gap-1.5">
            <span className="w-23 shrink-0 text-12 text-muted">{row.label}</span>
            <span className={cn('line-clamp-2 min-w-0 flex-1 text-12', reset ? 'text-warning' : 'text-ink')}>{row.value}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
