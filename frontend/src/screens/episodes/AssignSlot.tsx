/* Меню ячейки полосы слотов: пустой слот — назначить выпуск без слота, занятый — открыть выпуск или снять со слота.
   Назначение оптимистично (`useSetSlot`); итог — тост: «Назначено на 23 сентября», «Снято со слота» или текст отказа
   бэкенда (409 — слот занят, 422 — не день слота), ячейка при отказе возвращается как была. */
import type { EpisodeListItem } from '@/types/episode'
import type { Slot } from '@/types/slot'
import { useChannels, useSetSlot, type SlotChange } from '../../api/queries'
import { formatSlotDate } from '../../app/format'
import { navigate } from '../../app/navigation'
import { paths } from '../../app/routes'
import { useUiStore } from '../../store/uiStore'
import { DropdownMenu, cn, type MenuItem } from '../../ui'

/* Триггер-иконка меню кита растянут на зону: зона целиком кликабельна и держит одну остановку Tab, содержимое
   лежит поверх с pointer-events-none. Размер 24×24 триггера перебивается селектором потомка — у `cn` нет
   tailwind-merge, два класса одного свойства решал бы порядок CSS. */
const STRETCH = 'absolute inset-0 flex [&>button]:size-full'

function useSlotChange() {
  const setSlot = useSetSlot()
  const pushToast = useUiStore((s) => s.pushToast)
  return async (change: SlotChange) => {
    const id = `slot-${change.id}`
    try {
      await setSlot.mutateAsync(change)
      const message = change.date ? `Назначено на ${formatSlotDate(change.date, { long: true })}` : 'Снято со слота'
      pushToast({ id, message, status: 'ready' })
    } catch (error) {
      pushToast({ id, message: error instanceof Error ? error.message : String(error), status: 'failed' })
    }
  }
}

export interface AssignSlotProps {
  slot: Slot
  /** Выпуски без слота видимого канала; в «Все каналы» — обоих */
  candidates: EpisodeListItem[]
  /** «Все каналы»: в пункте меню — ещё и канал выпуска */
  showChannel: boolean
}

/** Пустой слот: пунктирная «Назначить выпуск», по ней — меню выпусков без слота */
export function AssignSlot({ slot, candidates, showChannel }: AssignSlotProps) {
  const change = useSlotChange()
  const channels = useChannels().data
  const channelName = (episode: EpisodeListItem) => channels?.find((c) => c.id === episode.channel)?.name ?? episode.channel
  const items: MenuItem[] = candidates.length
    ? candidates.map((episode) => ({
        id: episode.id,
        label: showChannel ? `${episode.title}, ${channelName(episode)}` : episode.title,
        onSelect: () => void change({ id: episode.id, channel: episode.channel, date: slot.date }),
      }))
    : [{ id: 'none', label: 'Выпусков без слота нет', disabled: true, onSelect: () => {} }]

  return (
    <div className="group/assign relative flex flex-1">
      <div className={cn(STRETCH, '[&>button]:rounded-control')}>
        <DropdownMenu trigger="icon" label={`Назначить выпуск на ${formatSlotDate(slot.date, { long: true })}`} items={items} />
      </div>
      <span
        aria-hidden
        className="pointer-events-none relative flex flex-1 items-center justify-center rounded-control border border-dashed border-line text-11 text-muted group-hover/assign:border-line-strong group-hover/assign:text-ink"
      >
        Назначить выпуск
      </span>
    </div>
  )
}

export interface SlotActionsProps {
  slot: Slot
  /** Выпуск слота; пока список выпусков не загружен — undefined */
  episode: EpisodeListItem | undefined
  /** Имя в ячейке — оно же в подписи меню */
  name: string
}

/** Занятый слот: вся ячейка — триггер меню «Открыть выпуск», «Снять со слота» (у опубликованного — только первое) */
export function SlotActions({ slot, episode, name }: SlotActionsProps) {
  const change = useSlotChange()
  const openEpisode = useUiStore((s) => s.openEpisode)
  const { episode_id: id, channel } = slot
  const items: MenuItem[] = [
    {
      id: 'open',
      label: 'Открыть выпуск',
      disabled: !episode,
      onSelect: () => {
        if (!episode) return
        openEpisode(episode)
        navigate(paths.stage(episode.id, episode.stage))
      },
    },
  ]
  if (slot.state !== 'published' && id !== null && channel !== null) {
    items.push({ id: 'unassign', label: 'Снять со слота', onSelect: () => void change({ id, channel, date: null }) })
  }

  return (
    <div className={cn(STRETCH, '[&>button]:rounded-panel')}>
      <DropdownMenu trigger="icon" label={`Слот ${formatSlotDate(slot.date, { long: true })}: ${name}`} items={items} />
    </div>
  )
}
