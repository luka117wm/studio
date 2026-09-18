import { FileQuestionMark } from 'lucide-react'
import type { ReactNode } from 'react'
import { episodeById } from '../mocks/fixtures'
import type { Episode } from '../types/fixtures'
import { EmptyState } from '../ui'
import { navigate } from './navigation'
import { paths, type RouteParams } from './routes'

/** Экран выпуска: находит выпуск по параметру маршрута, иначе объясняет, что случилось. */
export function EpisodeScreen({ params, children }: { params: RouteParams; children: (episode: Episode) => ReactNode }) {
  const episode = episodeById(params.episodeId ?? null)
  if (!episode) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={FileQuestionMark}
          title="Выпуск не найден"
          description={`Выпуска «${params.episodeId ?? ''}» нет в этом канале. Возможно, он удалён или ссылка устарела.`}
          secondary={{ label: 'К выпускам', onClick: () => navigate(paths.episodes) }}
        />
      </div>
    )
  }
  return children(episode)
}
