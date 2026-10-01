/* Название открытого выпуска в шапке с инлайн-переименованием. Клик или Enter на названии — поле; Enter или
   потеря фокуса — принять, Esc — вернуть. Пустое не сохраняется: подпись ошибки под полем. Принятое название
   сразу видно везде (кэш выпуска и списков), запись — через автосохранение; ошибка сервера откатывает название
   к последнему подтверждённому, текст — в индикаторе сохранения. */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { EpisodeListItem } from '@/types/episode'
import { renameInCache, usePatchEpisode } from '../api/queries'
import { Input } from '../ui'
import { useAutosave } from './autosave'

const TITLE_MAX = 200

/** Принятое название — новый объект на каждое принятие: повтор того же текста после отката тоже пишется */
interface Commit {
  id: string
  title: string
}

function validate(title: string): string | undefined {
  if (!title) return 'Название не может быть пустым — введите текст.'
  if (title.length > TITLE_MAX) return `Название длиннее ${TITLE_MAX} знаков — сократите его.`
  return undefined
}

export function EpisodeTitle({ episode }: { episode: EpisodeListItem }) {
  const client = useQueryClient()
  const patch = usePatchEpisode(episode.id)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(episode.title)
  const [error, setError] = useState<string>()
  const [commit, setCommit] = useState<Commit>()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  // Последнее название, подтверждённое сервером, — куда откатываться при ошибке записи
  const confirmed = useRef({ id: episode.id, title: episode.title })
  useEffect(() => {
    if (confirmed.current.id !== episode.id) confirmed.current = { id: episode.id, title: episode.title }
  }, [episode.id, episode.title])

  useAutosave(
    `episode:${episode.id}:title`,
    commit?.id === episode.id ? commit : undefined,
    async ({ title }) => {
      const saved = await patch.mutateAsync({ title })
      confirmed.current = { id: saved.id, title: saved.title }
      return saved.updated_at
    },
    { onFail: () => renameInCache(client, confirmed.current.id, confirmed.current.title) },
  )

  useEffect(() => {
    if (editing || !refocus.current) return
    refocus.current = false
    buttonRef.current?.focus()
  }, [editing])

  const start = () => {
    setText(episode.title)
    setError(undefined)
    setEditing(true)
  }

  const accept = (withFocus: boolean) => {
    const title = text.trim()
    const problem = validate(title)
    if (problem) {
      setError(problem)
      return
    }
    refocus.current = withFocus
    setError(undefined)
    setEditing(false)
    if (title === episode.title) return
    renameInCache(client, episode.id, title)
    setCommit({ id: episode.id, title })
  }

  const cancel = () => {
    refocus.current = true
    setText(episode.title)
    setError(undefined)
    setEditing(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      accept(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation() // Esc поля не закрывает верхний слой оболочки
      cancel()
    }
  }

  if (editing) {
    return (
      <Input
        value={text}
        onChange={setText}
        onKeyDown={onKeyDown}
        onBlur={() => accept(false)}
        ariaLabel="Название выпуска"
        error={error}
        autoFocus
        // Подпись ошибки — поверх содержимого под шапкой, высота шапки не меняется
        className="relative w-110 [&>p]:absolute [&>p]:top-full [&>p]:left-0 [&>p]:whitespace-nowrap"
      />
    )
  }
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={start}
      title="Переименовать выпуск"
      className="min-w-0 cursor-text truncate rounded-control px-1 py-0.5 text-left text-13 font-medium text-ink hover:bg-raised"
    >
      {episode.title}
    </button>
  )
}
