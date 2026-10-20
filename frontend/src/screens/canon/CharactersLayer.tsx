/* Слой «Персонажи» экрана 12 (артборд 12): список персонажей канала 280 слева, карточка персонажа в центре,
   «Нужно каналу» (облики из планов) справа. Строка списка — имя, канал, число обликов и готовых листов, глиф статуса.
   Карточка — «Неизменяемое» (характер, осанка, манера, черты лица) и «Облики» карточками: миниатюра выбранного фаса
   листа, подпись, статус листа и цена. У облика без листа — «Кадры с этим обликом не генерируются». Карточка выбирает
   облик и открывает его лист опорных портретов (`?sheet=`, M5.9); под карточками — форма выбранного облика. Канон
   изолирован по каналам: список — только своего канала. */
import { ListTodo, Plus, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Appearance, CanonCharacterItem, CanonPeriodItem, CanonSummary, Character } from '@/types/canon'
import { setSearchParam, useSearchParam } from '../../app/navigation'
import { ScreenLayout, type LeftPanelKind, type RightPanelKind, type SidePanel } from '../../app/ScreenLayout'
import { useStatusNote } from '../../app/useStatusNote'
import {
  anchorThumb,
  useAppearanceAnchors,
  useAppearanceEstimate,
  useAppearanceSheets,
  useCanonNeeded,
  useChannels,
  useCreateCanonDraft,
  type ChannelId,
} from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import { Button, Dialog, EmptyState, Input, StatusGlyph, Textarea, cn, formatPrice } from '../../ui'
import { plural } from '../episodes/board'
import { CYRILLIC_HINT, isCyrillic, messageOf, selectCanon } from './canonFields'
import { AnchorSheet } from './AnchorSheet'
import { AppearanceForm, CopyAppearanceDialog, NewAppearanceDialog } from './AppearanceForm'
import {
  NATURE_ROWS,
  appearanceTitle,
  appearancesText,
  characterMeta,
  characterStatus,
  charactersStatus,
  diffCharacter,
  emptyCharacter,
  sheetView,
} from './characterFields'
import { LEVEL_NOTE, LayerWorkspace, type LayerBodyProps } from './LayerWorkspace'
import { NeededPanel } from './NeededPanel'
import { PERIOD_ID_RE } from './periodFields'
import { useSheetToasts } from './sheetJobs'
import { ReadOnlyValue } from './StyleLayer'

const charactersNote = (n: number) => `${n} ${plural(n, ['персонаж', 'персонажа', 'персонажей'])}`
const initials = (id: string) => id.slice(0, 3).toUpperCase()

export function CharactersLayer({ channel, summary, view }: { channel: ChannelId; summary: CanonSummary; view: ReactNode }) {
  const selected = useSearchParam('character')
  const characters = summary.characters
  const current = characters.find((c) => c.id === selected) ?? characters[0] ?? null
  const needed = useCanonNeeded(channel)
  const channelName = useChannels().data?.find((c) => c.id === channel)?.name ?? channel
  const [creating, setCreating] = useState(false)
  useSheetToasts(channel)

  const left = {
    kind: 'canon' as const,
    title: 'Персонажи канала',
    note: charactersNote(characters.length),
    icon: Users,
    collapsible: true,
    children: <CharacterList characters={characters} current={current?.id ?? null} channelName={channelName} onNew={() => setCreating(true)} />,
  }
  const right = {
    title: 'Нужно каналу',
    note: needed.data?.appearances.length ? String(needed.data.appearances.length) : undefined,
    icon: ListTodo,
    children: <NeededPanel channel={channel} kind="appearances" />,
  }
  const dialog = creating && <NewCharacterDialog channel={channel} characters={characters} onClose={() => setCreating(false)} />

  if (!current) {
    return (
      <>
        <NoCharacters view={view} left={left} right={right} onNew={() => setCreating(true)} />
        {dialog}
      </>
    )
  }

  return (
    <>
      <LayerWorkspace
        key={current.id}
        channel={channel}
        path={`characters/${current.id}`}
        versions={current.versions}
        exists
        view={view}
        of={`персонажа ${current.id}`}
        first="первая версия персонажа"
        diff={diffCharacter}
        body={(props) => <CharacterCard {...props} channel={channel} periods={summary.periods} />}
        status={({ viewing }) => `${charactersStatus(characters)}${viewing ? ` · ${current.label || current.id} ${viewing}, только чтение` : ''}`}
        empty={
          <div className="flex flex-1 items-center justify-center p-4">
            <EmptyState icon={Users} title="Персонажа больше нет" description="Черновик сброшен, версий у персонажа не было. Выберите другого в списке или создайте нового." />
          </div>
        }
        left={left}
        right={right}
      />
      {dialog}
    </>
  )
}

function NoCharacters({
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
  useStatusNote(`Персонажей нет. ${LEVEL_NOTE}`)
  return (
    <ScreenLayout header={{ title: 'Канон', titleHidden: true, view }} left={left} right={right}>
      <div className="flex flex-1 items-center justify-center p-4">
        <EmptyState
          icon={Users}
          title="Персонажей пока нет"
          description="Персонаж — неизменяемое (характер, осанка, манера, черты лица) и облики по эпохам и возрастам. У каждого облика — лист опорных портретов. Создайте персонажа сами или из «Нужно каналу», если планы уже ссылаются на его облики."
          primary={{ label: 'Новый персонаж', onClick: onNew }}
        />
      </div>
    </ScreenLayout>
  )
}

/* ---- Список персонажей ---- */

function CharacterList({ characters, current, channelName, onNew }: { characters: CanonCharacterItem[]; current: string | null; channelName: string; onNew: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <ul aria-label="Персонажи" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {characters.map((c) => {
          const on = c.id === current
          const status = characterStatus(c)
          return (
            <li key={c.id}>
              <button
                type="button"
                aria-current={on || undefined}
                onClick={() => selectCanon('characters', { character: c.id, appearance: null })}
                className={cn('flex w-full items-center gap-2 rounded-control p-1.5 text-left hover:bg-raised', on && 'bg-raised shadow-[inset_2px_0_0_var(--color-accent)]')}
              >
                <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-clip border border-line bg-hover font-dense text-11 text-muted">
                  {initials(c.id)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-13 font-medium text-ink">{c.label || c.id}</span>
                  <span className="truncate text-11 text-muted">{characterMeta(c, channelName)}</span>
                </span>
                <StatusGlyph status={status} label={status === 'ready' ? 'Все листы готовы' : status === 'warning' ? 'Не все листы готовы' : 'Листов нет'} />
              </button>
            </li>
          )
        })}
      </ul>
      <div className="border-t border-line p-3">
        <Button icon={Plus} onClick={onNew} className="w-full justify-center">
          Новый персонаж
        </Button>
      </div>
    </div>
  )
}

/* ---- Карточка персонажа ---- */

function CharacterCard({
  data: character,
  onChange,
  draft,
  flush,
  replaced,
  channel,
  periods,
}: LayerBodyProps<Character> & { channel: ChannelId; periods: CanonPeriodItem[] }) {
  const param = useSearchParam('appearance')
  const appearance = character.appearances.find((a) => a.id === param) ?? character.appearances[0] ?? null
  const sheetParam = useSearchParam('sheet')
  const sheetOf = character.appearances.find((a) => a.id === sheetParam) ?? null
  const [dialog, setDialog] = useState<'new' | 'copy' | null>(null)
  const set = (patch: Partial<Character>) => onChange?.({ ...character, ...patch })
  const setAppearance = (next: Appearance) => set({ appearances: character.appearances.map((a) => (a.id === next.id ? next : a)) })
  const readyCount = useReadySheets(channel, character.appearances)

  return (
    <form aria-label="Персонаж" className="flex flex-col gap-3 p-3" onSubmit={(e) => e.preventDefault()}>
      <div className="flex items-end gap-3">
        <label className="flex w-80 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            <span className="text-12 font-medium text-ink">Имя</span>
            <span className="text-11 text-muted">по-русски, только для экрана</span>
          </span>
          {onChange ? <Input ariaLabel="Имя персонажа" value={character.label} placeholder="You — рассказчик-участник" onChange={(label) => set({ label })} /> : <ReadOnlyValue label="Имя персонажа" value={character.label} />}
        </label>
        <span className="pb-1.5 font-dense text-12 text-muted">{character.id}</span>
      </div>

      <section aria-label="Неизменяемое" className="flex flex-col gap-1.5 rounded-panel border border-line bg-panel p-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-13 font-semibold text-ink">Неизменяемое</h2>
          <span className="text-11 text-muted">одинаково во всех обликах и эпохах</span>
        </div>
        {NATURE_ROWS.map(({ field, label }) => (
          <div key={field} className="flex items-start gap-2">
            <span className="w-29 shrink-0 pt-1.5 text-12 text-muted">{label}</span>
            {onChange ? (
              <Textarea
                autosize
                ariaLabel={`Неизменяемое: ${label}`}
                value={character.nature[field]}
                onChange={(value) => set({ nature: { ...character.nature, [field]: value } })}
                error={isCyrillic(character.nature[field]) ? CYRILLIC_HINT : undefined}
                className="min-w-0 flex-1"
              />
            ) : (
              <ReadOnlyValue label={`Неизменяемое: ${label}`} value={character.nature[field]} />
            )}
          </div>
        ))}
      </section>

      <section aria-label="Облики" className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-13 font-semibold text-ink">Облики</h2>
          <span className="text-12 text-muted">
            {character.appearances.length ? `${appearancesText(character.appearances.length)} · ${readyCount} ${plural(readyCount, ['лист готов', 'листа готово', 'листов готово'])}` : 'обликов нет'}
          </span>
          <span className="flex-1" />
          {onChange && (
            <>
              <Button size="sm" onClick={() => setDialog('new')}>
                Новый облик
              </Button>
              <Button size="sm" variant={draft ? 'secondary' : 'primary'} disabled={!appearance} onClick={() => setDialog('copy')}>
                Скопировать облик в другой период
              </Button>
            </>
          )}
        </div>
        {character.appearances.length === 0 ? (
          <p className="rounded-panel border border-dashed border-line-strong p-3 text-12 text-muted">
            Обликов нет: персонаж без облика не публикуется. «Новый облик» — эпоха и возраст, дальше одежда и предметы.
          </p>
        ) : (
          <ul aria-label="Облики персонажа" className="flex gap-2 overflow-x-auto pb-1">
            {character.appearances.map((a) => (
              <AppearanceCard key={a.id} channel={channel} character={character} appearance={a} periods={periods} selected={a.id === appearance?.id} />
            ))}
          </ul>
        )}
      </section>

      {appearance && <AppearanceForm appearance={appearance} periods={periods} onChange={onChange && setAppearance} />}

      {dialog === 'new' && onChange && (
        <NewAppearanceDialog
          character={character}
          periods={periods}
          onClose={() => setDialog(null)}
          onCreate={(created) => {
            set({ appearances: [...character.appearances, created] })
            selectCanon('characters', { character: character.id, appearance: created.id })
            setDialog(null)
          }}
        />
      )}
      {dialog === 'copy' && appearance && (
        <CopyAppearanceDialog
          channel={channel}
          character={character}
          periods={periods}
          source={appearance.id}
          flush={flush}
          replaced={replaced}
          onClose={() => setDialog(null)}
        />
      )}
      {sheetOf && <AnchorSheet channel={channel} character={character} appearance={sheetOf} periods={periods} onClose={() => setSearchParam('sheet', null)} />}
    </form>
  )
}

/** Сколько обликов персонажа с готовым листом — из тех же запросов, что карточки */
function useReadySheets(channel: ChannelId, appearances: Appearance[]): number {
  return useAppearanceSheets(
    channel,
    appearances.map((a) => a.id),
  ).filter((state) => state?.status === 'ready').length
}

/** Карточка облика 168: миниатюра выбранного фаса листа, подпись, статус листа, цена; клик открывает лист */
function AppearanceCard({
  channel,
  character,
  appearance,
  periods,
  selected,
}: {
  channel: ChannelId
  character: Character
  appearance: Appearance
  periods: CanonPeriodItem[]
  selected: boolean
}) {
  const anchors = useAppearanceAnchors(channel, appearance.id)
  const estimate = useAppearanceEstimate(channel, appearance.id)
  const sheet = sheetView(anchors.data)
  const front = anchors.data?.slots.find((slot) => slot.slot === 'front')?.chosen ?? null
  const sheetLine = estimate.data?.sheet
  const cost =
    anchors.data?.status === 'ready'
      ? `собран, ${anchors.data.spent.usd}`
      : sheetLine
        ? `сборка ${formatPrice(sheetLine.usd.usd_micro / 1_000_000)}`
        : ''
  const title = appearanceTitle(character, appearance, periods)
  return (
    <li className="w-42 shrink-0">
      <button
        type="button"
        aria-label={title}
        aria-current={selected || undefined}
        onClick={() => selectCanon('characters', { character: character.id, appearance: appearance.id, sheet: appearance.id })}
        className={cn(
          'flex h-full w-full flex-col gap-1.5 rounded-panel border bg-panel p-2 text-left hover:border-line-strong',
          selected ? 'border-accent' : 'border-line',
          sheet?.blocked && 'opacity-75',
        )}
      >
        <span className={cn('relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-clip border bg-hover', sheet?.blocked ? 'border-failed' : 'border-line')}>
          {front ? (
            <img src={anchorThumb(channel, appearance.id, front.candidate)} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
          ) : (
            <span className="font-dense text-11 text-muted">{appearance.age ?? '—'}</span>
          )}
          {sheet?.blocked && (
            <span className="absolute inset-x-0 bottom-0 border-t border-failed bg-surface-failed px-1.5 py-1 text-11 text-failed-text">Кадры с этим обликом не генерируются</span>
          )}
        </span>
        <span className={cn('line-clamp-2 text-12 font-medium', sheet?.blocked ? 'text-muted' : 'text-ink')}>{title}</span>
        <span className="flex-1" />
        {sheet && (
          <span className="flex items-center gap-1.5">
            <StatusGlyph status={sheet.status} label={sheet.text} />
            <span className={cn('min-w-0 flex-1 truncate text-11', sheet.status === 'ready' ? 'text-muted' : sheet.status === 'warning' ? 'text-warning' : 'text-failed-text')}>{sheet.text}</span>
          </span>
        )}
        {cost && <span className="font-dense text-11 text-muted">{cost}</span>}
      </button>
    </li>
  )
}

/* ---- «Новый персонаж» ---- */

function NewCharacterDialog({ channel, characters, onClose }: { channel: ChannelId; characters: CanonCharacterItem[]; onClose: () => void }) {
  const [id, setId] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const create = useCreateCanonDraft(channel)
  const pushToast = useUiStore((s) => s.pushToast)
  const idError =
    id && !PERIOD_ID_RE.test(id) ? 'Только строчные латинские буквы, цифры и дефис, например captain' : characters.some((c) => c.id === id) ? `Персонаж ${id} уже есть — откройте его в списке.` : undefined
  const onCreate = async () => {
    setError(null)
    try {
      await create.mutateAsync({ path: `characters/${id}`, data: emptyCharacter(id, label.trim()) })
      selectCanon('characters', { character: id, appearance: null })
      pushToast({ id: 'canon-character-new', message: `Черновик персонажа ${id} начат: заполните неизменяемое и добавьте облик`, status: 'ready' })
      onClose()
    } catch (failure) {
      setError(messageOf(failure))
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Новый персонаж"
      note="черновик, публикует человек"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" disabled={!id || Boolean(idError)} loading={create.isPending} loadingLabel="Создаю" onClick={() => void onCreate()}>
            Создать черновик
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-12 text-muted">id персонажа</span>
            <Input ariaLabel="id персонажа" value={id} placeholder="captain" onChange={(v) => setId(v.trim())} error={idError} autoFocus />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-12 text-muted">Имя</span>
            <Input ariaLabel="Имя нового персонажа" value={label} placeholder="Капитан (второй план)" onChange={setLabel} />
          </label>
        </div>
        <p className="text-12 text-muted">Облики персонажа — {'<id>@<облик>'}: you@powder-monkey-11. Неизменяемое пишется по-английски: оно уходит в промпт каждого кадра с персонажем.</p>
        {error && (
          <p role="alert" className="text-12 text-failed-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
