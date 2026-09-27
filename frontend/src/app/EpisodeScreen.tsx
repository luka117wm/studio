import { FileQuestionMark } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import type { EpisodeListItem } from '@/types/episode'
import { ApiError } from '../api/client'
import { useEpisode } from '../api/queries'
import { useUiStore } from '../store/uiStore'
import { EmptyState } from '../ui'
import { QueryError, WorkAreaSkeleton } from './BackendState'
import { navigate } from './navigation'
import { paths, type RouteParams } from './routes'

/** Экран выпуска: выпуск из `/api` по параметру маршрута. Загрузка — скелетон, 404 — объяснение, другая ошибка —
 *  её текст. Загруженный выпуск становится открытым, и его канал — текущим (`uiStore.openEpisode`). */
export function EpisodeScreen({ params, children }: { params: RouteParams; children: (episode: EpisodeListItem) => ReactNode }) {
  const episodeId = params.episodeId ?? null
  const episode = useEpisode(episodeId)
  const openEpisode = useUiStore((s) => s.openEpisode)
  const loaded = episode.isPlaceholderData ? undefined : episode.data

  useEffect(() => {
    if (loaded) openEpisode({ id: loaded.id, channel: loaded.channel })
  }, [loaded, openEpisode])

  if (episode.error instanceof ApiError && episode.error.status === 404) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={FileQuestionMark}
          title="Выпуск не найден"
          description={`Выпуска «${episodeId ?? ''}» нет в этом канале. Возможно, он удалён или ссылка устарела.`}
          secondary={{ label: 'К выпускам', onClick: () => navigate(paths.episodes) }}
        />
      </div>
    )
  }
  if (episode.error) return <QueryError error={episode.error} className="p-4" />
  if (!episode.data) return <WorkAreaSkeleton />
  return children(episode.data)
}
