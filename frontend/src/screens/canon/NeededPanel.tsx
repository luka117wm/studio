/* «Нужно каналу» (устав M5, решение 2; docs/canon_schema.md, «Нужно каналу»): эпохи и облики, на которые ссылаются
   текущие планы выпусков канала, а опубликованной версии у них нет. Какие выпуски и сколько кадров ссылаются;
   «Создать» — скелет-черновик с одним id и переход к нему, начатый черновик — «Открыть». Правая колонка слоёв
   «Периоды» (эпохи) и «Персонажи» (облики). */
import type { NeededItem } from '@/types/canon'
import { useState } from 'react'
import { useCanonNeeded, useCreateNeeded, type ChannelId } from '../../api/queries'
import { Button, Skeleton } from '../../ui'
import { plural } from '../episodes/board'
import { messageOf, openNeeded, type NeededKind } from './canonFields'

const shotsText = (n: number) => `${n} ${plural(n, ['кадр', 'кадра', 'кадров'])}`

export function NeededPanel({ channel, kind }: { channel: ChannelId; kind: NeededKind }) {
  const needed = useCanonNeeded(channel)
  const create = useCreateNeeded(channel)
  const [error, setError] = useState<string | null>(null)
  const items: NeededItem[] = needed.data?.[kind] ?? []

  const onCreate = async (id: string) => {
    setError(null)
    try {
      await create.mutateAsync({ kind, id })
      openNeeded(kind, id)
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  if (needed.isPending) {
    return (
      <div className="p-3">
        <Skeleton variant="text" lines={3} />
      </div>
    )
  }
  if (needed.error) return <p className="p-3 text-12 text-failed-text">{needed.error.message}</p>

  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-12 text-muted">
        {kind === 'periods'
          ? 'Эпохи из планов выпусков, у которых нет опубликованной версии: кадры с ними не сгенерируются.'
          : 'Облики из планов выпусков, у которых нет опубликованной версии: без облика и его листа кадры с персонажем не генерируются.'}
      </p>
      {items.length === 0 ? (
        <p className="text-12 text-muted">
          {kind === 'periods' ? 'Все эпохи из планов уже опубликованы.' : 'Все облики из планов уже опубликованы.'}
        </p>
      ) : (
        <ul aria-label="Нужно каналу" className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 rounded-panel border border-line bg-app p-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-dense text-13 font-medium text-ink">{item.id}</span>
                {item.draft ? (
                  <Button size="sm" variant="ghost" onClick={() => openNeeded(kind, item.id)}>
                    Открыть
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => void onCreate(item.id)} loading={create.isPending && create.variables?.id === item.id} loadingLabel="Создаю">
                    Создать
                  </Button>
                )}
              </div>
              <span className="text-11 text-muted">
                {`${shotsText(item.shots)} в ${item.episodes.length} ${plural(item.episodes.length, ['выпуске', 'выпусках', 'выпусках'])}`}
                {item.draft && ' · черновик начат, не опубликован'}
              </span>
              <ul aria-label={`Выпуски ${item.id}`} className="flex flex-col">
                {item.episodes.map((episode) => (
                  <li key={episode.id} className="flex gap-2 text-11">
                    <span className="min-w-0 flex-1 truncate text-ink">{episode.title || episode.id}</span>
                    <span className="shrink-0 font-dense text-muted">{shotsText(episode.shots)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-12 text-failed-text">
          {error}
        </p>
      )}
    </div>
  )
}
