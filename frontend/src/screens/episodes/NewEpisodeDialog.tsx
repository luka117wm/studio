/* Диалог «Новый выпуск» (артборд 1): канал, пресет формата со сметой, откуда начать. Выпуск создаётся в ближайшем
   свободном слоте (`slot: "next_free"`, docs/slots.md), после создания открывается сценарий. Названия в диалоге нет —
   выпуск переименовывается в шапке (решение 2 устава M3). Монтируется на время открытия: состояние каждый раз новое. */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { FormatPreview } from '@/types/channel'
import type { EpisodeCreate } from '@/types/episode'
import { useChannelName, useCreateEpisode, useFormat, type ChannelId } from '../../api/queries'
import { channelLook } from '../../app/channelLook'
import { formatSlotDate, formatUsd } from '../../app/format'
import { navigate } from '../../app/navigation'
import { paths } from '../../app/routes'
import { useModalScope } from '../../app/useHotkey'
import { useUiStore } from '../../store/uiStore'
import { Button, Dialog, Radio, Skeleton, cn } from '../../ui'
import { plural } from './board'

const CHANNELS: readonly ChannelId[] = ['cursus', 'otto']

type Origin = NonNullable<EpisodeCreate['origin']>

const SOURCES: readonly { value: Origin; label: string; hint: string; disabled?: boolean }[] = [
  { value: 'backlog', label: 'Из бэклога идей', hint: 'появится с экраном идей', disabled: true },
  // Поле ссылки появится со сценарием (M4); до него выпуск только помечается `origin: reference`
  { value: 'reference', label: 'Из референса', hint: 'ссылку на ролик добавите в сценарии' },
  { value: 'blank', label: 'С нуля', hint: 'пустой сценарий и план' },
]

const minutesRange = ({ preset }: FormatPreview) => `${preset.minutes.min}–${preset.minutes.max} мин`

/** «Рассказчик во втором лице, 8 разделов, ~100 кадров, ~$3.80 за выпуск» — смета с бэкенда (`Gateway.estimate`) */
function presetHint({ preset, estimate }: FormatPreview): string {
  const sections = `${preset.sections} ${plural(preset.sections, ['раздел', 'раздела', 'разделов'])}`
  const shots = `~${preset.shots} ${plural(preset.shots, ['кадр', 'кадра', 'кадров'])}`
  return `${preset.hint}, ${sections}, ${shots}, ~${formatUsd(estimate.usd_micro)} за выпуск`
}

export function NewEpisodeDialog({ onClose }: { onClose: () => void }) {
  const scope = useUiStore((s) => s.channel)
  const pushToast = useUiStore((s) => s.pushToast)
  const openEpisode = useUiStore((s) => s.openEpisode)
  // Канал по умолчанию — текущий, в «Все каналы» — Cursus
  const [channel, setChannel] = useState<ChannelId>(scope === 'all' ? 'cursus' : scope)
  const [origin, setOrigin] = useState<Origin>('blank')
  const [error, setError] = useState<string | null>(null)
  const channelName = useChannelName(channel)
  const format = useFormat(channel)
  const create = useCreateEpisode()
  const ids = { channel: useId(), preset: useId(), origin: useId() }
  const cards = useRef<Partial<Record<ChannelId, HTMLButtonElement | null>>>({})
  const initial = useRef(channel)
  // Глобальные и экранные сочетания молчат, пока диалог открыт (хвост M1.4)
  useModalScope(true)

  // Фокус — на выбранный канал: эффект родителя идёт после ловушки фокуса Dialog, которая ставит его на первый элемент
  useEffect(() => {
    cards.current[initial.current]?.focus()
  }, [])

  const pick = (next: ChannelId) => {
    setChannel(next)
    cards.current[next]?.focus()
  }
  const onChannelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    const next = CHANNELS[(CHANNELS.indexOf(channel) + step + CHANNELS.length) % CHANNELS.length]
    if (next) pick(next)
  }

  const submit = async () => {
    setError(null)
    try {
      const episode = await create.mutateAsync({ channel, origin, slot: 'next_free' })
      const slot = episode.slot_date ? `слот ${formatSlotDate(episode.slot_date, { long: true })}` : 'слот не назначен'
      pushToast({ id: `created-${episode.id}`, message: `Выпуск создан: ${channelName}, ${slot}`, status: 'ready' })
      openEpisode(episode)
      onClose()
      navigate(paths.stage(episode.id, 'script'))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Новый выпуск"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={create.isPending} loadingLabel="Создаю…" onClick={() => void submit()}>
            Создать выпуск
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 py-1">
        <div className="flex flex-col gap-1">
          <span id={ids.channel} className="text-12 font-medium text-muted">
            Канал
          </span>
          <div role="radiogroup" aria-labelledby={ids.channel} onKeyDown={onChannelKeyDown} className="flex gap-2">
            {CHANNELS.map((id) => (
              <ChannelCard
                key={id}
                id={id}
                checked={id === channel}
                onPick={() => pick(id)}
                buttonRef={(el) => {
                  cards.current[id] = el
                }}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span id={ids.preset} className="text-12 font-medium text-muted">
            Пресет формата
          </span>
          {/* Один пресет на формат — выбирать не из чего, поэтому поле только для чтения, без шеврона артборда */}
          <div
            aria-labelledby={ids.preset}
            role="group"
            className="flex h-control-md items-center rounded-control border border-line bg-raised px-2 text-13 text-ink"
          >
            {format.data ? (
              <span className="truncate">{`${channelName}: ${format.data.preset.label}, ${minutesRange(format.data)}`}</span>
            ) : (
              <Skeleton className="h-3 w-48" />
            )}
          </div>
          {format.error ? (
            <p role="alert" className="text-11 text-failed-text">
              {format.error.message}
            </p>
          ) : format.data ? (
            <span className="text-11 text-muted">{presetHint(format.data)}</span>
          ) : (
            <Skeleton className="h-3 w-80" />
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span id={ids.origin} className="text-12 font-medium text-muted">
            Откуда начать
          </span>
          <div role="radiogroup" aria-labelledby={ids.origin} className="flex flex-col gap-1">
            {SOURCES.map((source) => (
              <div
                key={source.value}
                className={cn('flex h-8 min-w-0 items-center gap-2 rounded-control px-2', origin === source.value && 'bg-raised')}
              >
                <Radio
                  name={ids.origin}
                  value={source.value}
                  checked={origin === source.value}
                  onChange={() => setOrigin(source.value)}
                  label={source.label}
                  disabled={source.disabled}
                  className="shrink-0"
                />
                <span className="truncate text-11 text-muted">{source.hint}</span>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-12 text-failed-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

interface ChannelCardProps {
  id: ChannelId
  checked: boolean
  onPick: () => void
  buttonRef: (el: HTMLButtonElement | null) => void
}

/** Карточка канала: аватар, имя, «18–25 мин, every rank» из пресета; выбранная — граница accent */
function ChannelCard({ id, checked, onPick, buttonRef }: ChannelCardProps) {
  const name = useChannelName(id)
  const format = useFormat(id).data
  const look = channelLook(id)
  const hintId = useId()
  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={name}
      aria-describedby={hintId}
      tabIndex={checked ? 0 : -1}
      onClick={onPick}
      className={cn(
        'flex min-w-0 flex-1 items-center gap-2 rounded-control border bg-raised p-2 text-left',
        checked ? 'border-accent' : 'border-line hover:border-line-strong',
      )}
    >
      <span
        aria-hidden
        className={cn('flex size-4.5 shrink-0 items-center justify-center rounded-clip text-11 font-semibold', look.avatarClass)}
      >
        {look.initial}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-13 font-medium text-ink">{name}</span>
        <span id={hintId} className="truncate text-11 text-muted">
          {format ? `${minutesRange(format)}, ${format.preset.label}` : ' '}
        </span>
      </span>
    </button>
  )
}
