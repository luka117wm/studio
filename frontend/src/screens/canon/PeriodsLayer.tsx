/* Слой «Периоды» экрана 12 (артборд 12): список эпох 280 слева, карточка эпохи в центре, «Нужно каналу» справа.
   Строка списка — название, годы, регион, число запретов и выпусков; эпоха без запретов — «нельзя использовать».
   Карточка — подпись, регион, годы, шесть групп чипами и блок «Не должно появляться в кадре», всегда раскрытый:
   это то, что реально ломает эпоху (L-007). Черновик эпохи можно получить через мост, «Дополнить запреты» — тем же
   мостом. «Новый период» и «Дублировать период» начинают черновик с близкой эпохи. Версии — `LayerWorkspace`. */
import { Landmark, ListTodo, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { CanonPeriodItem, CanonSummary, Period, Years } from '@/types/canon'
import { useSearchParam } from '../../app/navigation'
import { ScreenLayout, type LeftPanelKind, type RightPanelKind, type SidePanel } from '../../app/ScreenLayout'
import { useStatusNote } from '../../app/useStatusNote'
import { useCanonDoc, useCanonNeeded, useCreateCanonDraft, type ChannelId } from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import { Button, Dialog, EmptyState, Input, Select, StatusGlyph, cn } from '../../ui'
import { plural } from '../episodes/board'
import { CYRILLIC_HINT, isCyrillic, messageOf, selectCanon } from './canonFields'
import { ChipList } from './ChipList'
import { LEVEL_NOTE, LayerWorkspace, type LayerBodyProps } from './LayerWorkspace'
import { NeededPanel } from './NeededPanel'
import { ForbiddenBridge, PeriodBridge } from './PeriodBridge'
import {
  PERIOD_GROUPS,
  PERIOD_ID_RE,
  copyPeriod,
  diffPeriod,
  episodesText,
  forbiddenText,
  isEmptyPeriod,
  periodMeta,
  periodRowNote,
  periodStatus,
  positionsText,
  yearsText,
} from './periodFields'
import { ReadOnlyValue } from './StyleLayer'

const periodsNote = (n: number) => `${n} ${plural(n, ['период', 'периода', 'периодов'])}`

export function PeriodsLayer({ channel, summary, view }: { channel: ChannelId; summary: CanonSummary; view: ReactNode }) {
  const selected = useSearchParam('period')
  const periods = summary.periods
  const current = periods.find((p) => p.id === selected) ?? periods[0] ?? null
  const needed = useCanonNeeded(channel)
  // Диалог «Новый период»: источник — id эпохи из списка или данные открытой версии («Дублировать период»)
  const [dialog, setDialog] = useState<{ source: string | null; data: Period | null } | null>(null)

  const left = {
    kind: 'canon' as const,
    title: 'Периоды',
    note: periodsNote(periods.length),
    icon: Landmark,
    collapsible: true,
    children: <PeriodList periods={periods} current={current?.id ?? null} onNew={() => setDialog({ source: current?.id ?? null, data: null })} />,
  }
  const right = {
    title: 'Нужно каналу',
    note: needed.data?.periods.length ? String(needed.data.periods.length) : undefined,
    icon: ListTodo,
    children: <NeededPanel channel={channel} kind="periods" />,
  }
  const newDialog = dialog && (
    <NewPeriodDialog channel={channel} periods={periods} initial={dialog} onClose={() => setDialog(null)} />
  )

  if (!current) {
    return (
      <>
        <NoPeriods view={view} left={left} right={right} onNew={() => setDialog({ source: null, data: null })} />
        {newDialog}
      </>
    )
  }

  return (
    <>
      <LayerWorkspace
        key={current.id}
        channel={channel}
        path={`periods/${current.id}`}
        versions={current.versions}
        exists
        view={view}
        of={`эпохи ${current.id}`}
        first="первая версия эпохи"
        diff={diffPeriod}
        body={(props) => <PeriodCard {...props} channel={channel} item={current} onDuplicate={(data) => setDialog({ source: current.id, data })} />}
        status={({ data, viewing }) => `${periodStatus(data)}${viewing ? ` · ${viewing}, только чтение` : ''}`}
        empty={
          <div className="flex flex-1 items-center justify-center p-4">
            <EmptyState icon={Landmark} title="Эпохи больше нет" description="Черновик сброшен, версий у эпохи не было. Выберите другую эпоху в списке или создайте новую." />
          </div>
        }
        left={left}
        right={right}
        publishPrimary={(data) => !isEmptyPeriod(data)}
        publishExtra={<p className="text-12 text-muted">Факты эпохи проверяет человек: чат ошибается в датах и спорных предметах. Запреты уйдут в negative каждого кадра эпохи.</p>}
      />
      {newDialog}
    </>
  )
}

function NoPeriods({
  view,
  left,
  right,
  onNew,
}: {
  view: ReactNode
  left: SidePanel & { kind: LeftPanelKind }
  right: SidePanel & { kind?: RightPanelKind }
  onNew: () => void
}) {
  useStatusNote(`Эпох нет: кадры не генерируются. ${LEVEL_NOTE}`)
  return (
    <ScreenLayout header={{ title: 'Канон', titleHidden: true, view }} left={left} right={right}>
      <div className="flex flex-1 items-center justify-center p-4">
        <EmptyState
          icon={Landmark}
          title="Эпох пока нет"
          description="Эпоха — материалы, свет, архитектура, одежда и запреты времени и места. Переиспользуется между выпусками. Создайте её сами или из «Нужно каналу», если планы уже на неё ссылаются."
          primary={{ label: 'Новый период', onClick: onNew }}
        />
      </div>
    </ScreenLayout>
  )
}

/* ---- Список эпох ---- */

function PeriodList({ periods, current, onNew }: { periods: CanonPeriodItem[]; current: string | null; onNew: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <ul aria-label="Эпохи канала" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {periods.map((p) => {
          const note = periodRowNote(p)
          const on = p.id === current
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-current={on || undefined}
                onClick={() => selectCanon('periods', { period: p.id })}
                className={cn('flex w-full flex-col gap-1 rounded-control p-2 text-left hover:bg-raised', on && 'bg-raised shadow-[inset_2px_0_0_var(--color-accent)]')}
              >
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-13 font-semibold text-ink">{p.label || p.id}</span>
                  <span className="shrink-0 font-dense text-11 text-muted">{yearsText(p.years)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <StatusGlyph status={note.blocked ? 'failed' : 'ready'} label={note.blocked ? 'Нельзя использовать' : 'Можно использовать'} />
                  <span className={cn('min-w-0 flex-1 text-11', note.blocked ? 'text-failed-text' : 'truncate text-muted')}>{note.text}</span>
                </span>
                <span className="flex gap-2 pl-6 font-dense text-11 text-muted">
                  <span>{episodesText(p.episodes)}</span>
                  {p.draft && <span>{p.versions.length ? 'есть черновик' : 'черновик, не опубликована'}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-col gap-1.5 border-t border-line p-3">
        <Button icon={Plus} onClick={onNew} className="w-full justify-center">
          Новый период
        </Button>
        <span className="text-11 text-muted">Предложит начать с близкого периода: «Англия, 1347» → «Франция, 1360-е», материалы и запреты переносятся.</span>
      </div>
    </div>
  )
}

/* ---- Карточка эпохи ---- */

function PeriodCard({
  data: period,
  onChange,
  flush,
  replaced,
  channel,
  item,
  onDuplicate,
}: LayerBodyProps<Period> & { channel: ChannelId; item: CanonPeriodItem; onDuplicate: (data: Period) => void }) {
  const [suggesting, setSuggesting] = useState(false)
  const empty = isEmptyPeriod(period)
  const forbiddenEmpty = period.forbidden.length === 0
  const set = (patch: Partial<Period>) => onChange?.({ ...period, ...patch })
  return (
    <form aria-label="Эпоха" className="flex flex-col gap-3 p-3" onSubmit={(e) => e.preventDefault()}>
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-15 font-semibold text-ink">{period.label || period.id}</h2>
          <span className="truncate text-12 text-muted">{periodMeta(period, item.episodes)}</span>
        </div>
        <Button onClick={() => onDuplicate(period)}>Дублировать период</Button>
      </div>

      {onChange && <PeriodBridge channel={channel} period={period} empty={empty} flush={flush} replaced={replaced} />}

      <section aria-label="Эпоха: подпись и годы" className="flex items-start gap-3 rounded-panel border border-line bg-panel p-2.5">
        <Field label="Подпись" hint="по-русски, только для экрана">
          {onChange ? <Input ariaLabel="Подпись эпохи" value={period.label} placeholder="Карибы, 1716" onChange={(label) => set({ label })} /> : <ReadOnlyValue label="Подпись эпохи" value={period.label} />}
        </Field>
        <Field label="Регион" hint="по-английски, уходит в промпт">
          {onChange ? (
            <Input ariaLabel="Регион" value={period.region} placeholder="Caribbean Sea, Nassau" onChange={(region) => set({ region })} error={isCyrillic(period.region) ? CYRILLIC_HINT : undefined} />
          ) : (
            <ReadOnlyValue label="Регион" value={period.region} />
          )}
        </Field>
        <Field label="Годы" hint="с какого по какой">
          {onChange ? <YearsInput years={period.years} onChange={(years) => set({ years })} /> : <ReadOnlyValue label="Годы" value={period.years ? yearsText(period.years) : ''} />}
        </Field>
      </section>

      <div className="grid grid-cols-2 gap-3">
        {PERIOD_GROUPS.map(({ field, title }) => (
          <section key={field} aria-label={title} className="flex flex-col gap-1.5 rounded-panel border border-line bg-panel p-2.5">
            <div className="flex items-baseline gap-2">
              <h3 className="text-12 font-semibold text-ink">{title}</h3>
              <span className="flex-1" />
              <span className="font-dense text-11 text-muted">{positionsText(period[field].length)}</span>
            </div>
            <ChipList label={`Эпоха: ${title}`} items={period[field]} onChange={onChange && ((items) => set({ [field]: items }))} narrow />
          </section>
        ))}
      </div>

      <section
        aria-label="Не должно появляться в кадре"
        className={cn('flex flex-col gap-2 rounded-panel border p-3', forbiddenEmpty ? 'border-failed bg-surface-failed' : 'border-warning bg-surface-warning')}
      >
        <div className="flex items-center gap-2">
          <StatusGlyph status={forbiddenEmpty ? 'failed' : 'warning'} label={forbiddenEmpty ? 'Запретов нет' : 'Запреты'} />
          <h3 className={cn('text-13 font-semibold', forbiddenEmpty ? 'text-failed-text' : 'text-warning')}>Не должно появляться в кадре</h3>
          <span className={cn('font-dense text-12', forbiddenEmpty ? 'text-failed-text' : 'text-warning')}>{forbiddenEmpty ? 'список пуст' : forbiddenText(period.forbidden.length)}</span>
          <span className="flex-1" />
          {onChange && !empty && (
            <Button size="sm" variant="statusOutline" status={forbiddenEmpty ? 'failed' : 'warning'} onClick={() => setSuggesting((s) => !s)}>
              {suggesting ? 'Скрыть' : 'Дополнить запреты'}
            </Button>
          )}
        </div>
        {forbiddenEmpty && (
          <p role="alert" className="rounded-control border border-failed bg-surface-failed px-2.5 py-2 text-12 text-failed-text">
            Период нельзя использовать: заполните список. Без запретов кадры уйдут в генерацию с анахронизмами, а чеклист проверки будет пустым.
          </p>
        )}
        {suggesting && onChange && <ForbiddenBridge channel={channel} period={period} flush={flush} replaced={replaced} />}
        <ChipList
          label="Не должно появляться в кадре"
          addLabel="Добавить анахронизм"
          items={period.forbidden}
          onChange={onChange && ((forbidden) => set({ forbidden }))}
          similar
          note="Попадает в negative каждого кадра периода и в чеклист проверки."
        />
      </section>
    </form>
  )
}

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
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

/** Годы эпохи: в черновик уходят только целые годы «с ≤ по»; оба поля пусты — годов нет. Набор держится в полях. */
function YearsInput({ years, onChange }: { years: Years | null; onChange: (years: Years | null) => void }) {
  const [from, setFrom] = useState(years ? String(years.from) : '')
  const [to, setTo] = useState(years ? String(years.to) : '')
  // Годы пришли снаружи (ответ моста, другая версия) — поля берут их
  const key = years ? `${years.from}-${years.to}` : ''
  const [seen, setSeen] = useState(key)
  if (key !== seen) {
    setSeen(key)
    setFrom(years ? String(years.from) : '')
    setTo(years ? String(years.to) : '')
  }
  const parse = (text: string) => (/^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : null)
  const update = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom)
    setTo(nextTo)
    const a = parse(nextFrom)
    const b = parse(nextTo)
    if (!nextFrom.trim() && !nextTo.trim()) onChange(null)
    else if (a !== null && b !== null && a <= b) onChange({ from: a, to: b })
  }
  const a = parse(from)
  const b = parse(to)
  const error =
    (from.trim() && a === null) || (to.trim() && b === null)
      ? 'Год — число, например 1716'
      : a !== null && b !== null && a > b
        ? 'Годы наоборот: первый позже второго'
        : (from.trim() || to.trim()) && (a === null || b === null)
          ? 'Нужны оба года'
          : undefined
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input ariaLabel="Годы: с" value={from} placeholder="1716" onChange={(v) => update(v, to)} className="w-20 font-dense" />
        <span className="text-12 text-muted">–</span>
        <Input ariaLabel="Годы: по" value={to} placeholder="1726" onChange={(v) => update(from, v)} className="w-20 font-dense" />
      </div>
      {error && <span className="text-11 text-failed-text">{error}</span>}
    </div>
  )
}

/* ---- «Новый период» и «Дублировать период» ---- */

function NewPeriodDialog({
  channel,
  periods,
  initial,
  onClose,
}: {
  channel: ChannelId
  periods: CanonPeriodItem[]
  initial: { source: string | null; data: Period | null }
  onClose: () => void
}) {
  const [id, setId] = useState('')
  const [label, setLabel] = useState('')
  const [source, setSource] = useState<string>(initial.source ?? '')
  const [error, setError] = useState<string | null>(null)
  const pushToast = useUiStore((s) => s.pushToast)
  const create = useCreateCanonDraft(channel)
  // «Дублировать» берёт открытую версию как есть; «Начать с» другой эпохи — её шапку
  const fixed = initial.data && source === initial.source ? initial.data : null
  const head = useCanonDoc(channel, `periods/${source}`, null, Boolean(source) && !fixed)
  const sourceData = fixed ?? (source ? (head.data?.data ?? null) : null)
  const taken = periods.some((p) => p.id === id)
  const idError = id && !PERIOD_ID_RE.test(id) ? 'Только строчные латинские буквы, цифры и дефис, например france-1360' : taken ? `Эпоха ${id} уже есть — откройте её в списке.` : undefined

  const onCreate = async () => {
    setError(null)
    try {
      await create.mutateAsync({ path: `periods/${id}`, data: copyPeriod(sourceData, id, label.trim()) })
      selectCanon('periods', { period: id })
      pushToast({ id: 'canon-period-new', message: sourceData ? `Черновик ${id} начат с ${source}: материалы и запреты перенесены` : `Черновик эпохи ${id} начат`, status: 'ready' })
      onClose()
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  const options = [{ value: '', label: 'С нуля' }, ...periods.map((p) => ({ value: p.id, label: p.label || p.id }))]
  return (
    <Dialog
      open
      onClose={onClose}
      title={initial.data ? 'Дублировать период' : 'Новый период'}
      note="черновик, публикует человек"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" disabled={!id || Boolean(idError) || (Boolean(source) && !sourceData)} loading={create.isPending} loadingLabel="Создаю" onClick={() => void onCreate()}>
            Создать черновик
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-12 text-muted">id эпохи</span>
            <Input ariaLabel="id эпохи" value={id} placeholder="france-1360" onChange={(v) => setId(v.trim())} error={idError} autoFocus />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-12 text-muted">Подпись</span>
            <Input ariaLabel="Подпись новой эпохи" value={label} placeholder="Франция, 1360-е" onChange={setLabel} />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-12 text-muted">Начать с</span>
          <Select ariaLabel="Начать с эпохи" value={source} onChange={setSource} options={options} />
        </label>
        <p className="text-12 text-muted">
          {source
            ? 'Переносятся сдвиг палитры, материалы, источники света, архитектура, одежда, предметы и запреты. Подпись, регион и годы — заново.'
            : 'Пустой черновик: заполните сами или скопируйте промпт эпохи для чата.'}
        </p>
        {error && (
          <p role="alert" className="text-12 text-failed-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
