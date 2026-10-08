/* «Семена ниши» — левая колонка 300 экрана 2 (артборд 2, layout.md): направления канала для промпта идей. Чипы `tag`
   с ×, «Семя» (`add`) открывает поле: Enter добавляет, Esc закрывает. Каждая правка сразу уходит в профиль канала
   (`PATCH /api/channels/{id}`), тоста нет — изменение видно по чипам. Повтор ловится до запроса, лимит — выключенным
   «Семя»; отказ бэкенда — текстом под полем. Семена у каждого канала свои (правило 6 handoff). */
import { useState } from 'react'
import { useChannels, usePatchChannelSeeds, type ChannelId } from '../../api/queries'
import { Chip, Input, Skeleton } from '../../ui'

const SEEDS_MAX = 20

export function SeedsPanel({ channel }: { channel: ChannelId }) {
  const channels = useChannels()
  const profile = channels.data?.find((c) => c.id === channel)
  // Пустой список бэкенд не выгружает (L-033): поля нет — семян нет
  const seeds = profile?.seeds ?? []
  const save = usePatchChannelSeeds(channel)
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const full = seeds.length >= SEEDS_MAX

  const write = async (next: string[]): Promise<boolean> => {
    setError(null)
    try {
      await save.mutateAsync(next)
      return true
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      return false
    }
  }

  const add = async () => {
    const seed = value.trim()
    if (!seed) return
    const repeat = seeds.find((s) => s.toLowerCase() === seed.toLowerCase())
    if (repeat) {
      setError(`Семя «${repeat}» уже есть — повтор не нужен.`)
      return
    }
    if (await write([...seeds, seed])) setValue('')
  }

  const close = () => {
    setAdding(false)
    setValue('')
    setError(null)
  }

  if (!profile) {
    return (
      <div className="p-3">
        <Skeleton variant="text" lines={2} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-12 text-muted">
        Направления для промпта идей: чат опирается на них и на формат канала. Без семян — только на формат.
      </p>
      <ul aria-label="Семена ниши" className="flex flex-wrap gap-1">
        {seeds.map((seed) => (
          <li key={seed}>
            <Chip variant="tag" label={seed} disabled={save.isPending} onRemove={() => void write(seeds.filter((s) => s !== seed))} />
          </li>
        ))}
        {!adding && (
          <li>
            <Chip variant="add" label="Семя" disabled={full} onClick={() => setAdding(true)} />
          </li>
        )}
      </ul>
      {adding && (
        <Input
          value={value}
          onChange={(next) => {
            setValue(next)
            setError(null)
          }}
          ariaLabel="Новое семя"
          placeholder="Тема в паре слов, Enter — добавить"
          autoFocus
          disabled={full}
          error={error ?? undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void add()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              close()
            }
          }}
          onBlur={() => {
            if (!value.trim()) close()
          }}
        />
      )}
      {!adding && error && (
        <p role="alert" className="text-11 text-failed-text">
          {error}
        </p>
      )}
      {full && <p className="text-11 text-muted">Семян {SEEDS_MAX} — больше нельзя: уберите лишнее, чтобы добавить новое.</p>}
    </div>
  )
}
