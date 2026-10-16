/* Экран 12 «Канон» (артборд 12): канон уровня канала, не выпуска. Заголовок — слои «Стиль / Периоды / Персонажи»
   (⌘⇧1…⌘⇧3, слой — в адресе `?layer=`), подпись слоя, справа — версия, «История», «Сравнить с vN», «Опубликовать vN».
   Слой «Стиль»: правка шапки пишется в черновик автосохранением, «Опубликовать» делает неизменяемую версию, старая
   версия — только чтение и «Создать vN из vM»; справа — опорные кадры стиля 480 и история версий. Слои «Периоды» и
   «Персонажи» — M5.8. Данные — кэш запросов; локально живёт только несохранённая правка черновика. */
import { Image, Landmark, Layers, Palette, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Style } from '@/types/canon'
import { autosaver, useAutosave } from '../../app/autosave'
import { setSearchParam, useSearchParam } from '../../app/navigation'
import type { RouteParams } from '../../app/routes'
import { ScreenLayout } from '../../app/ScreenLayout'
import { useHotkeySet } from '../../app/useHotkey'
import { useStatusNote } from '../../app/useStatusNote'
import { ApiError } from '../../api/client'
import {
  useCanonSummary,
  useChannels,
  useDiscardStyleDraft,
  usePublishStyle,
  useSaveStyleDraft,
  useStyle,
  useStyleAnchors,
  useStyleDraftFrom,
  type ChannelId,
} from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import { EmptyState, SegmentedControl, Skeleton } from '../../ui'
import { StyleAnchors } from './StyleAnchors'
import { StyleDiff, StyleLayer } from './StyleLayer'
import { EMPTY_STYLE, anchorsNote, headLabel, nextVersion, type StyleHead } from './styleFields'
import { PublishDialog, ReadOnlyBar, VersionBar, VersionHistory } from './VersionBar'

type Layer = 'style' | 'periods' | 'characters'

const LAYERS: { value: Layer; label: string; keys: string; note: string }[] = [
  { value: 'style', label: 'Стиль', keys: 'Mod+Shift+1', note: 'рендер, оптика, свет, палитра — подаётся в каждый кадр' },
  { value: 'periods', label: 'Периоды', keys: 'Mod+Shift+2', note: 'что бывает в кадре эпохи и чего быть не может' },
  { value: 'characters', label: 'Персонажи', keys: 'Mod+Shift+3', note: 'один человек, разные облики и эпохи' },
]

const isLayer = (value: string | null): value is Layer => LAYERS.some((l) => l.value === value)
const setLayer = (next: Layer) => setSearchParam('layer', next === 'style' ? null : next)

/** Принцип 14 — в статус-строке на каждом слое */
const LEVEL_NOTE = 'Канон уровня канала: правка не задевает выпуски, пока их не перевели на новую версию'

export function CanonScreen(_props: { params: RouteParams }) {
  const scope = useUiStore((s) => s.channel)
  const param = useSearchParam('layer')
  const layer: Layer = isLayer(param) ? param : 'style'
  // Явный порядок в окне клавиш — группа «Канон» в GROUP_ORDER (L-028)
  useHotkeySet(
    LAYERS.map((l) => ({
      id: `canon-layer-${l.value}`,
      keys: l.keys,
      scope: 'screen' as const,
      group: 'Канон',
      description: `Слой: ${l.label.toLowerCase()}`,
      hint: l.label.toLowerCase(),
      handler: () => setLayer(l.value),
    })),
  )
  const view = (
    <>
      <SegmentedControl ariaLabel="Слой канона" value={layer} onChange={setLayer} options={LAYERS.map(({ value, label }) => ({ value, label }))} />
      <span className="text-12 text-muted">{LAYERS.find((l) => l.value === layer)?.note}</span>
    </>
  )
  if (scope === 'all') return <PickChannel view={view} />
  if (layer === 'style') return <StyleWorkspace key={scope} channel={scope} view={view} />
  return <LayerPending layer={layer} view={view} />
}

/** «Все каналы»: канон у каждого канала свой (правило 6 handoff) — экран просит выбрать канал, как экран 2 */
function PickChannel({ view }: { view: ReactNode }) {
  const channels = useChannels()
  const setChannel = useUiStore((s) => s.setChannel)
  useStatusNote(LEVEL_NOTE)
  const [first, second] = channels.data ?? []
  return (
    <ScreenLayout header={{ title: 'Канон', titleHidden: true, view }}>
      <div className="flex flex-1 items-center justify-center p-4">
        <EmptyState
          icon={Layers}
          title="Выберите канал"
          description="Стиль, эпохи и персонажи у каждого канала свои. Выберите канал здесь или в переключателе вверху."
          primary={first ? { label: first.name, onClick: () => setChannel(first.id) } : undefined}
          secondary={second ? { label: second.name, onClick: () => setChannel(second.id) } : undefined}
        />
      </div>
    </ScreenLayout>
  )
}

/** Слои «Периоды» и «Персонажи» — M5.8 */
function LayerPending({ layer, view }: { layer: Exclude<Layer, 'style'>; view: ReactNode }) {
  useStatusNote(LEVEL_NOTE)
  const periods = layer === 'periods'
  return (
    <ScreenLayout header={{ title: 'Канон', titleHidden: true, view }}>
      <div className="flex flex-1 items-center justify-center p-4">
        <EmptyState
          icon={periods ? Landmark : Users}
          title={periods ? 'Эпохи канала' : 'Персонажи канала'}
          description={
            periods
              ? 'Материалы, свет, архитектура, одежда и запреты времени — переиспользуются между выпусками. Слой правки эпох собирается следующим этапом.'
              : 'Неизменяемое персонажа и его облики с листами опорных портретов. Слой правки персонажей собирается следующим этапом.'
          }
        />
      </div>
    </ScreenLayout>
  )
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function StyleWorkspace({ channel, view }: { channel: ChannelId; view: ReactNode }) {
  const summary = useCanonSummary(channel)
  // Шапку запрашиваем, только если по сводке стиль есть: у пустого канала был бы лишний 404
  const hasStyle = summary.data ? summary.data.style.versions.length > 0 || summary.data.style.draft : false
  const head = useStyle(channel, null, hasStyle)
  const anchors = useStyleAnchors(channel, (summary.data?.style.versions.length ?? 0) > 0)
  const pushToast = useUiStore((s) => s.pushToast)

  const [viewing, setViewing] = useState<string | null>(null)
  const viewed = useStyle(channel, viewing ?? '', viewing !== null)
  // Несохранённая правка шапки: её видит форма, автосохранение пишет её в черновик (800 мс, один PUT)
  const [draft, setDraft] = useState<Style | undefined>(undefined)
  const save = useSaveStyleDraft(channel)
  useAutosave(`canon:${channel}:style`, draft, async (style) => (await save.mutateAsync(style)).updated_at)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [compareWith, setCompareWith] = useState<string | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [readOnlyError, setReadOnlyError] = useState<string | null>(null)
  const publish = usePublishStyle(channel)
  const draftFrom = useStyleDraftFrom(channel)
  const discard = useDiscardStyleDraft(channel)

  const versions = summary.data?.style.versions ?? []
  const latest = versions.at(-1)?.version ?? null
  const next = nextVersion(versions)
  const doc = head.data ?? null
  const info: StyleHead | null = doc && { draft: doc.draft, version: doc.version, based_on: doc.based_on }

  // С чем сравнить открытое: выбранное в истории, иначе — версия до открытой (у черновика — та, из которой он начат)
  const shownVersion = viewing ?? (info?.draft ? null : info?.version ?? null)
  const before = (v: string | null) => {
    const index = versions.findIndex((x) => x.version === v)
    return index > 0 ? versions[index - 1]!.version : null
  }
  const defaultTarget = viewing ? before(viewing) : info?.draft ? (info.based_on ?? latest) : before(info?.version ?? null)
  const target = compareWith && compareWith !== shownVersion ? compareWith : defaultTarget
  const compared = useStyle(channel, target ?? '', comparing && target !== null)
  const previous = useStyle(channel, latest ?? '', publishOpen && latest !== null)

  useStatusNote(
    !doc
      ? summary.isPending || head.isLoading
        ? null
        : 'Канон канала не создан: генерация кадров недоступна'
      : `${viewing ? `Стиль ${viewing} · только чтение` : info?.draft ? `Стиль: ${headLabel(info).toLowerCase()}` : `Стиль ${info?.version} · текущая версия`}. ${LEVEL_NOTE}`,
  )

  const open = (version: string | null) => {
    setViewing(version === latest && !info?.draft ? null : version)
    setComparing(false)
    setCompareWith(null)
    setReadOnlyError(null)
  }

  const onPublish = async () => {
    setProblems([])
    await autosaver.flushAll()
    if (autosaver.hasUnsaved()) {
      setProblems(['Черновик не сохранён — нажмите «Повторить» в шапке и опубликуйте снова.'])
      return
    }
    try {
      const published = await publish.mutateAsync()
      setDraft(undefined)
      setPublishOpen(false)
      setComparing(false)
      pushToast({ id: 'canon-style-publish', message: `Опубликована ${published.version}: выпуски на прежних версиях не затронуты`, status: 'ready' })
    } catch (error) {
      setProblems(messageOf(error).split('\n'))
    }
  }

  const onCreateFrom = async (from: string) => {
    setReadOnlyError(null)
    await autosaver.flushAll()
    try {
      await draftFrom.mutateAsync(from)
      setDraft(undefined)
      open(null)
      pushToast({ id: 'canon-style-from', message: `Черновик ${next} начат из ${from}: выпуски на ${from} не затронуты`, status: 'ready' })
    } catch (error) {
      setReadOnlyError(messageOf(error))
    }
  }

  const onDiscard = async () => {
    await autosaver.flushAll()
    const lost = draft ?? doc?.data
    try {
      await discard.mutateAsync()
      setDraft(undefined)
      setComparing(false)
      pushToast({
        id: 'canon-style-discard',
        message: 'Черновик стиля сброшен',
        status: 'ready',
        action: lost ? { label: 'Отменить', onClick: () => void save.mutateAsync(lost) } : undefined,
      })
    } catch (error) {
      pushToast({ id: 'canon-style-discard', message: messageOf(error), status: 'failed' })
    }
  }

  const header = (actions?: ReactNode) => ({ title: 'Канон', titleHidden: true, view, actions })

  if (summary.isPending || head.isLoading) {
    return (
      <ScreenLayout header={header()}>
        <div className="flex flex-col gap-3 p-3">
          <Skeleton className="h-30 w-full" />
          <Skeleton className="h-30 w-full" />
        </div>
      </ScreenLayout>
    )
  }
  const loadError = head.error ?? summary.error
  if (loadError) {
    return (
      <ScreenLayout header={header()}>
        <p role="alert" className="p-4 text-13 text-failed-text">
          {loadError instanceof ApiError ? loadError.message : 'Канон не загрузился — обновите страницу.'}
        </p>
      </ScreenLayout>
    )
  }
  if (!doc || !info) {
    return (
      <ScreenLayout header={header()}>
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState
            icon={Palette}
            title="Задайте стиль канала"
            description="Стиль — рендер, оптика, свет и палитра, которые подаются в каждый кадр канала. Без него выпуски выглядят по-разному, а кадры не генерируются. Эпохи и персонажи заводятся после стиля."
            primary={{ label: 'Создать стиль канала', onClick: () => void save.mutateAsync(EMPTY_STYLE).catch((e: unknown) => pushToast({ id: 'canon-style-create', message: messageOf(e), status: 'failed' })) }}
          />
        </div>
      </ScreenLayout>
    )
  }

  const style = viewing ? viewed.data?.data : (draft ?? doc.data)
  const editable = viewing === null
  const afterLabel = viewing ?? (info.draft ? 'черновик' : `${info.version} · текущая`)

  return (
    <ScreenLayout
      header={header(
        <VersionBar
          head={info}
          versions={versions}
          viewing={viewing}
          onView={open}
          compareTarget={target}
          comparing={comparing}
          onToggleCompare={() => setComparing((c) => !c)}
          historyOpen={historyOpen}
          onToggleHistory={() => setHistoryOpen((h) => !h)}
          next={next}
          onPublish={() => {
            setProblems([])
            setPublishOpen(true)
            void autosaver.flushAll()
          }}
          onDiscard={() => void onDiscard()}
        />,
      )}
      right={{
        kind: 'anchors',
        title: 'Опорные кадры стиля',
        note: anchorsNote(anchors.data),
        icon: Image,
        collapsible: true,
        children: (
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <StyleAnchors channel={channel} published={versions.length > 0} periods={summary.data?.periods ?? []} />
            </div>
            {historyOpen && (
              <VersionHistory
                versions={versions}
                current={latest}
                shown={shownVersion}
                onView={open}
                onCompare={(version) => {
                  setCompareWith(version)
                  setComparing(true)
                }}
                onClose={() => setHistoryOpen(false)}
              />
            )}
          </div>
        ),
      }}
    >
      {viewing && <ReadOnlyBar version={viewing} next={next} onCreate={() => void onCreateFrom(viewing)} onBack={() => open(null)} error={readOnlyError} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!style ? (
          <div className="p-3">
            <Skeleton className="h-60 w-full" />
          </div>
        ) : comparing && target ? (
          compared.data ? (
            <StyleDiff before={{ label: target, style: compared.data.data }} after={{ label: afterLabel, style }} onClose={() => setComparing(false)} />
          ) : (
            <div className="p-3">
              <Skeleton className="h-60 w-full" />
            </div>
          )
        ) : (
          <StyleLayer style={style} onChange={editable ? setDraft : undefined} />
        )}
      </div>
      <PublishDialog
        open={publishOpen}
        next={next}
        previous={latest && previous.data ? { version: latest, style: previous.data.data } : null}
        draft={draft ?? doc.data}
        problems={problems}
        pending={publish.isPending}
        onConfirm={() => void onPublish()}
        onClose={() => setPublishOpen(false)}
      />
    </ScreenLayout>
  )
}
