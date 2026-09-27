/* Переключатель канала в шапке: кнопка с квадратным аватаром, именем и шевроном; меню «Все каналы», Cursus,
   Otto's Timeline, выбранный — с галочкой accent (правило Select, components.md). У DropdownMenu кита нет слота
   для аватара и отметки выбранного, поэтому меню собрано на Popover кита. Tab доходит до кнопки; ↓, Enter,
   Space открывают; ↑↓ Home End ходят по пунктам, Enter выбирает, Esc и Tab закрывают. */
import { Check, ChevronDown } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { useChannels, type ChannelScope } from '../api/queries'
import { useUiStore } from '../store/uiStore'
import { Popover, Skeleton, cn } from '../ui'
import { channelLook } from './channelLook'
import { useSwitchChannel } from './useChannel'

const ALL_CHANNELS = 'Все каналы'

function Avatar({ scope }: { scope: ChannelScope }) {
  const look = channelLook(scope)
  return (
    <span
      aria-hidden
      className={cn('flex size-5 shrink-0 items-center justify-center rounded-control text-11 font-semibold', look.avatarClass)}
    >
      {look.initial}
    </span>
  )
}

export function ChannelSwitcher() {
  const scope = useUiStore((s) => s.channel)
  const channels = useChannels()
  const switchTo = useSwitchChannel()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  if (!channels.data) return channels.isPending ? <Skeleton className="h-7 w-28" /> : null
  const options: { value: ChannelScope; label: string }[] = [
    { value: 'all', label: ALL_CHANNELS },
    ...channels.data.map((c) => ({ value: c.id, label: c.name })),
  ]
  const current = options.find((o) => o.value === scope) ?? options[0]!

  const choose = (value: ChannelScope) => {
    setOpen(false)
    switchTo(value)
  }

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown') return
    e.preventDefault()
    setOpen(true)
  }

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])
    const index = items.findIndex((el) => el === document.activeElement)
    const focus = (i: number) => items[(i + items.length) % items.length]?.focus()
    switch (e.key) {
      case 'ArrowDown':
        focus(index + 1)
        break
      case 'ArrowUp':
        focus(index - 1)
        break
      case 'Home':
        focus(0)
        break
      case 'End':
        focus(items.length - 1)
        break
      case 'Tab':
        setOpen(false)
        return
      default:
        return
    }
    e.preventDefault()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Канал: ${current.label}`}
        title="Переключить канал"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        className="flex h-control-md items-center gap-2 rounded-control border border-line bg-raised px-2 text-13 font-medium text-ink hover:border-line-strong"
      >
        <Avatar scope={current.value} />
        <span className="whitespace-nowrap">{current.label}</span>
        <ChevronDown className="size-icon text-muted" strokeWidth={1.5} aria-hidden />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} ariaLabel="Канал" className="min-w-52 px-0! py-1!">
        <div ref={menuRef} role="menu" aria-label="Канал" onKeyDown={onMenuKeyDown}>
          {options.map((option) => {
            const selected = option.value === current.value
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                // Фокус открытого меню — на выбранном пункте, остальные — стрелками
                tabIndex={selected ? 0 : -1}
                onClick={() => choose(option.value)}
                className="flex h-control-md w-full items-center gap-2 px-2 text-left text-13 text-ink outline-none hover:bg-hover focus-visible:bg-hover"
              >
                <Avatar scope={option.value} />
                <span className="flex-1 truncate">{option.label}</span>
                {selected && <Check className="size-icon shrink-0 text-accent" strokeWidth={1.5} aria-hidden />}
              </button>
            )
          })}
        </div>
      </Popover>
    </>
  )
}
