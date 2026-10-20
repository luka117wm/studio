/* Экран 12 «Канон» (артборд 12): канон уровня канала, не выпуска. Заголовок — слои «Стиль / Периоды / Персонажи»
   (⌘⇧1…⌘⇧3, слой — в адресе `?layer=`), подпись слоя, справа — версия, «История», «Сравнить с vN», «Опубликовать vN».
   У всех слоёв одна механика версий (`LayerWorkspace`): правка — в черновик автосохранением, «Опубликовать» делает
   неизменяемую версию, старая версия — только чтение и «Создать vN из vM». Стиль — с опорными кадрами стиля 480
   справа; эпохи и персонажи — список 280 слева и «Нужно каналу» справа. Данные — кэш запросов. */
import { Image, Layers, Palette } from 'lucide-react'
import type { ReactNode } from 'react'
import type { CanonSummary } from '@/types/canon'
import { setSearchParam, useSearchParam } from '../../app/navigation'
import type { RouteParams } from '../../app/routes'
import { ScreenLayout } from '../../app/ScreenLayout'
import { useHotkeySet } from '../../app/useHotkey'
import { useStatusNote } from '../../app/useStatusNote'
import { ApiError } from '../../api/client'
import { useCanonSummary, useChannels, useSaveCanonDraft, useStyleAnchors, type ChannelId } from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import { EmptyState, SegmentedControl, Skeleton } from '../../ui'
import { headLabel, messageOf } from './canonFields'
import { CharactersLayer } from './CharactersLayer'
import { LEVEL_NOTE, LayerWorkspace } from './LayerWorkspace'
import { PeriodsLayer } from './PeriodsLayer'
import { StyleAnchors } from './StyleAnchors'
import { StyleLayer } from './StyleLayer'
import { EMPTY_STYLE, anchorsNote, diffStyle } from './styleFields'

type Layer = 'style' | 'periods' | 'characters'

const LAYERS: { value: Layer; label: string; keys: string; note: string }[] = [
  { value: 'style', label: 'Стиль', keys: 'Mod+Shift+1', note: 'рендер, оптика, свет, палитра — подаётся в каждый кадр' },
  { value: 'periods', label: 'Периоды', keys: 'Mod+Shift+2', note: 'что бывает в кадре эпохи и чего быть не может' },
  { value: 'characters', label: 'Персонажи', keys: 'Mod+Shift+3', note: 'один человек, разные облики и эпохи' },
]

const isLayer = (value: string | null): value is Layer => LAYERS.some((l) => l.value === value)
const setLayer = (next: Layer) => {
  setSearchParam('sheet', null) // лист опорных портретов — часть слоя «Персонажи»
  setSearchParam('layer', next === 'style' ? null : next)
}

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
  return <ChannelCanon key={scope} channel={scope} layer={layer} view={view} />
}

/** Канон одного канала: сводка слоёв нужна каждому слою — списки, версии, счётчики */
function ChannelCanon({ channel, layer, view }: { channel: ChannelId; layer: Layer; view: ReactNode }) {
  const summary = useCanonSummary(channel)
  if (summary.error || !summary.data) {
    return (
      <ScreenLayout header={{ title: 'Канон', titleHidden: true, view }}>
        {summary.error ? (
          <p role="alert" className="p-4 text-13 text-failed-text">
            {summary.error instanceof ApiError ? summary.error.message : 'Канон не загрузился — обновите страницу.'}
          </p>
        ) : (
          <div className="flex flex-col gap-3 p-3">
            <Skeleton className="h-30 w-full" />
            <Skeleton className="h-30 w-full" />
          </div>
        )}
      </ScreenLayout>
    )
  }
  if (layer === 'periods') return <PeriodsLayer channel={channel} summary={summary.data} view={view} />
  if (layer === 'characters') return <CharactersLayer channel={channel} summary={summary.data} view={view} />
  return <StyleWorkspace channel={channel} summary={summary.data} view={view} />
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

function StyleWorkspace({ channel, summary, view }: { channel: ChannelId; summary: CanonSummary; view: ReactNode }) {
  const versions = summary.style.versions
  const anchors = useStyleAnchors(channel, versions.length > 0)
  const save = useSaveCanonDraft(channel, 'style')
  const pushToast = useUiStore((s) => s.pushToast)
  return (
    <LayerWorkspace
      channel={channel}
      path="style"
      versions={versions}
      exists={versions.length > 0 || summary.style.draft}
      view={view}
      of="стиля"
      first="первая версия стиля канала"
      diff={diffStyle}
      body={({ data, onChange }) => <StyleLayer style={data} onChange={onChange} />}
      status={({ head, viewing }) =>
        viewing ? `Стиль ${viewing} · только чтение` : head.draft ? `Стиль: ${headLabel(head).toLowerCase()}` : `Стиль ${head.version} · текущая версия`
      }
      emptyStatus="Канон канала не создан: генерация кадров недоступна"
      empty={
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState
            icon={Palette}
            title="Задайте стиль канала"
            description="Стиль — рендер, оптика, свет и палитра, которые подаются в каждый кадр канала. Без него выпуски выглядят по-разному, а кадры не генерируются. Эпохи и персонажи заводятся после стиля."
            primary={{ label: 'Создать стиль канала', onClick: () => void save.mutateAsync(EMPTY_STYLE).catch((e: unknown) => pushToast({ id: 'canon-style-create', message: messageOf(e), status: 'failed' })) }}
          />
        </div>
      }
      right={{
        kind: 'anchors',
        title: 'Опорные кадры стиля',
        note: anchorsNote(anchors.data),
        icon: Image,
        children: <StyleAnchors channel={channel} published={versions.length > 0} periods={summary.periods} />,
      }}
    />
  )
}
