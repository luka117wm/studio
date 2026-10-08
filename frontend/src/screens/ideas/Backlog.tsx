/* Бэклог идей — центр вкладки «Тренды» экрана 2 вместо таблицы радара (радара до ключа YouTube нет, устав M4).
   Строка: название, угол, оценка, источник; «Начать выпуск» и «Убрать». Фильтр «Бэклог / Убранные»: у убранных —
   «Вернуть». Порядок — по оценке (без оценки — в конце), потом новые первыми. Оценка — мнение чата, не данные
   (docs/research.md). */
import { Archive, Lightbulb } from 'lucide-react'
import { useState } from 'react'
import type { Idea } from '@/types/idea'
import { usePatchIdea, type ChannelId } from '../../api/queries'
import { PanelHeader } from '../../app/PanelHeader'
import { useUiStore } from '../../store/uiStore'
import { Button, EmptyState, SegmentedControl } from '../../ui'
import { formatCount, plural } from '../episodes/board'
import { IdeaScore } from './IdeaScore'
import { byScore } from './ideaView'

type View = 'backlog' | 'dropped'

const IDEAS = ['идея', 'идеи', 'идей'] as const

export interface BacklogProps {
  channel: ChannelId
  ideas: Idea[] | undefined
  onStart: (idea: Idea) => void
  /** Идея, по которой сейчас создаётся выпуск */
  busyId: string | null
}

export function Backlog({ channel, ideas, onStart, busyId }: BacklogProps) {
  const [view, setView] = useState<View>('backlog')
  const patch = usePatchIdea(channel)
  const pushToast = useUiStore((s) => s.pushToast)
  const list = (ideas ?? []).filter((idea) => idea.status === view).sort(byScore)
  const dropped = (ideas ?? []).filter((idea) => idea.status === 'dropped').length

  const move = async (idea: Idea, status: Idea['status']) => {
    try {
      await patch.mutateAsync({ id: idea.id, patch: { status } })
    } catch (error) {
      pushToast({ id: 'idea-move', message: error instanceof Error ? error.message : String(error), status: 'failed' })
    }
  }

  return (
    <section aria-label="Бэклог идей" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PanelHeader
        title={view === 'backlog' ? 'Бэклог' : 'Убранные'}
        note={ideas ? `${formatCount(list.length)} ${plural(list.length, IDEAS)}` : undefined}
        actions={
          <SegmentedControl
            ariaLabel="Какие идеи"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'backlog', label: 'Бэклог' },
              { value: 'dropped', label: dropped ? `Убранные ${dropped}` : 'Убранные' },
            ]}
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!ideas ? null : list.length === 0 ? (
          view === 'backlog' ? (
            <EmptyState
              icon={Lightbulb}
              title="Бэклог пуст"
              description="Возьмите идеи из чата справа: «В бэклог» переносит идею сюда, «Начать выпуск» сразу создаёт выпуск."
            />
          ) : (
            <EmptyState icon={Archive} title="Убранных идей нет" description="«Убрать» в бэклоге переносит идею сюда — её можно вернуть." />
          )
        ) : (
          <ul className="flex flex-col">
            {list.map((idea) => (
              <li key={idea.id}>
                <BacklogRow
                  idea={idea}
                  busy={busyId === idea.id}
                  locked={busyId !== null || patch.isPending}
                  onStart={() => onStart(idea)}
                  onMove={(status) => void move(idea, status)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

interface RowProps {
  idea: Idea
  busy: boolean
  locked: boolean
  onStart: () => void
  onMove: (status: Idea['status']) => void
}

function BacklogRow({ idea, busy, locked, onStart, onMove }: RowProps) {
  return (
    <article
      aria-label={idea.title}
      className="flex items-start gap-4 border-b border-row-border px-4 py-3 hover:bg-hover"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="text-13 font-medium text-ink">{idea.title}</h3>
        {idea.angle && <p className="line-clamp-2 text-12 text-muted">{idea.angle}</p>}
        <div className="flex items-center gap-2 text-11 text-muted">
          <span>{idea.source === 'bridge' ? 'из чата' : 'вручную'}</span>
          {idea.score_reason && <span className="min-w-0 truncate">{idea.score_reason}</span>}
        </div>
      </div>
      <IdeaScore value={idea.score} />
      <div className="flex shrink-0 items-center gap-2">
        {idea.status === 'backlog' ? (
          <>
            <Button size="sm" variant="ghost" disabled={locked} onClick={() => onMove('dropped')}>
              Убрать
            </Button>
            <Button size="sm" variant="secondary" loading={busy} loadingLabel="Создаю выпуск" disabled={locked && !busy} onClick={onStart}>
              Начать выпуск
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" disabled={locked} onClick={() => onMove('backlog')}>
            Вернуть
          </Button>
        )}
      </div>
    </article>
  )
}
