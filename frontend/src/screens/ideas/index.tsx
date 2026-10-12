/* Экран 2 «Идеи» (артборд 2). Вкладка «Тренды»: семена ниши 300 слева, бэклог в центре (вместо радара — его нет без
   ключа YouTube, устав M4), «Идеи из чата» 340 справа с мостом. Вкладка «Референс» — `ReferenceTab` (M4.11). Вкладка — в адресе
   `?tab=`. Идеи и семена у каждого канала свои (правило 6 handoff): в «Все каналы» экран просит выбрать канал.
   Статус-строка: «Идей в бэклоге 7, слот 21 сентября свободен» — ближайший пустой слот после сегодняшнего. */
import { Layers, MessagesSquare, Sprout } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Slot } from '@/types/slot'
import { useChannels, useIdeas, useSlots, type ChannelId } from '../../api/queries'
import { formatSlotDate } from '../../app/format'
import { setSearchParam, useSearchParam } from '../../app/navigation'
import type { RouteParams } from '../../app/routes'
import { ScreenLayout } from '../../app/ScreenLayout'
import { useStatusNote } from '../../app/useStatusNote'
import { useUiStore } from '../../store/uiStore'
import { EmptyState, SegmentedControl } from '../../ui'
import { formatCount, plural } from '../episodes/board'
import { Backlog } from './Backlog'
import { ChatIdeas } from './ChatIdeas'
import { ReferenceTab } from './ReferenceTab'
import { backlogOf } from './ideaView'
import { SeedsPanel } from './SeedsPanel'
import { useStartEpisode } from './useStartEpisode'

type Tab = 'trends' | 'reference'

const IDEAS = ['идея', 'идеи', 'идей'] as const
const TABS: { value: Tab; label: string }[] = [
  { value: 'trends', label: 'Тренды' },
  { value: 'reference', label: 'Референс' },
]

export function IdeasScreen(_props: { params: RouteParams }) {
  const scope = useUiStore((s) => s.channel)
  const tab: Tab = useSearchParam('tab') === 'reference' ? 'reference' : 'trends'
  const setTab = (next: Tab) => setSearchParam('tab', next === 'trends' ? null : next)
  const view = <SegmentedControl ariaLabel="Вкладка" value={tab} onChange={setTab} options={TABS} />

  if (scope === 'all') return <PickChannel view={view} />
  return <ChannelIdeas key={scope} channel={scope} tab={tab} view={view} />
}

/** Вкладки — отдельные компоненты: у каждой своя шапка и строка статуса (эффект родителя иначе перетёр бы детей) */
function ChannelIdeas({ channel, tab, view }: { channel: ChannelId; tab: Tab; view: ReactNode }) {
  return tab === 'reference' ? <ReferenceTab channel={channel} view={view} /> : <TrendsTab channel={channel} view={view} />
}

function TrendsTab({ channel, view }: { channel: ChannelId; view: ReactNode }) {
  const ideas = useIdeas(channel)
  const slots = useSlots()
  const { start, busyId } = useStartEpisode(channel)
  const backlog = ideas.data ? backlogOf(ideas.data).length : null
  const proposed = ideas.data?.filter((idea) => idea.status === 'proposed').length ?? null
  useStatusNote(backlog === null ? null : statusNote(backlog, slots.data))

  return (
    <ScreenLayout
      header={{
        title: 'Идеи',
        view,
        actions:
          backlog === null ? undefined : (
            <span className="text-12 text-muted">{`Бэклог: ${formatCount(backlog)} ${plural(backlog, IDEAS)}`}</span>
          ),
      }}
      left={{ kind: 'seeds', title: 'Семена ниши', icon: Sprout, children: <SeedsPanel channel={channel} /> }}
      right={{
        kind: 'clusters',
        title: 'Идеи из чата',
        note: proposed ? `${proposed} ${plural(proposed, IDEAS)}` : undefined,
        icon: MessagesSquare,
        children: <ChatIdeas channel={channel} ideas={ideas.data} onStart={(idea) => void start(idea)} busyId={busyId} />,
      }}
    >
      {ideas.error ? (
        <p role="alert" className="m-4 text-13 text-failed-text">
          {ideas.error.message}
        </p>
      ) : (
        <Backlog channel={channel} ideas={ideas.data} onStart={(idea) => void start(idea)} busyId={busyId} />
      )}
    </ScreenLayout>
  )
}

/** «Идей в бэклоге 7, слот 21 сентября свободен» — ближайший пустой слот расписания после сегодняшнего */
function statusNote(backlog: number, slots: Slot[] | undefined): string {
  const head = `Идей в бэклоге ${formatCount(backlog)}`
  if (!slots) return head
  const free = slots.find((slot) => slot.state === 'empty')
  return free ? `${head}, слот ${formatSlotDate(free.date, { long: true })} свободен` : `${head}, свободных слотов нет`
}

/** «Все каналы»: идеи и семена у каждого канала свои — экран просит выбрать канал */
function PickChannel({ view }: { view: ReactNode }) {
  const channels = useChannels()
  const setChannel = useUiStore((s) => s.setChannel)
  return (
    <ScreenLayout header={{ title: 'Идеи', view }}>
      <div className="flex flex-1 items-center justify-center p-4">
        <EmptyState
          icon={Layers}
          title="Выберите канал"
          description="Идеи, бэклог и семена ниши у каждого канала свои. Выберите канал здесь или в переключателе вверху."
          primary={channels.data?.[0] ? { label: channels.data[0].name, onClick: () => setChannel(channels.data![0]!.id) } : undefined}
          secondary={channels.data?.[1] ? { label: channels.data[1].name, onClick: () => setChannel(channels.data![1]!.id) } : undefined}
        />
      </div>
    </ScreenLayout>
  )
}
