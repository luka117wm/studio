/* Экран 5 «Монтаж»: библиотека 280 + плеер с транспортом 44 + инспектор 320; таймлайн 260 на всю ширину,
   подписи дорожек 72. Экран 6 переиспользует раскладку с другим инспектором. Содержимое — M8. */
import { Library, Mic, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { EpisodeScreen } from '../../app/EpisodeScreen'
import { ScreenLayout } from '../../app/ScreenLayout'
import type { RouteParams } from '../../app/routes'
import { estimates } from '../../mocks/fixtures'
import type { Episode } from '../../types/fixtures'
import { EmptyState } from '../../ui'

const TRACKS = ['Субтитры', 'Кадры', 'Голос', 'SFX', 'Музыка']

export function EditLayout({
  episode,
  inspector,
}: {
  episode: Episode
  inspector: { title: string; note?: string; icon: LucideIcon; children: ReactNode }
}) {
  return (
    <ScreenLayout
      left={{
        kind: 'library',
        title: 'Библиотека',
        icon: Library,
        collapsible: true,
        children: <EmptyState icon={Library} title="Библиотека пуста" description="Кадры, версии, голос, SFX и музыка выпуска." />,
      }}
      right={{ ...inspector, collapsible: true }}
      bottom={{
        title: 'Таймлайн',
        children: (
          <div className="flex min-h-0 flex-1">
            <div className="flex w-shell-track-labels shrink-0 flex-col border-r border-line bg-panel text-11 text-muted">
              {TRACKS.map((t) => (
                <span key={t} className="flex h-row-md items-center border-b border-row-border px-2">
                  {t}
                </span>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-center text-12 text-muted">
              Таймлайн пуст: клипы выстроятся под голос
            </div>
          </div>
        ),
      }}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <EmptyState
          icon={Mic}
          title="Голос не записан"
          description={`Голос — мастер-дорожка: длительность каждого кадра равна его реплике. ${episode.words.toLocaleString('ru-RU')} слов сценария.`}
          primary={{ label: 'Озвучить', price: estimates.voiceUsd, onClick: () => {} }}
        />
      </div>
      <div className="flex h-11 shrink-0 items-center gap-2 border-t border-line bg-strip px-3 text-12 text-muted">00:00:00 · 00:00 из {episode.duration}</div>
    </ScreenLayout>
  )
}

export function EditScreen({ params }: { params: RouteParams }) {
  return (
    <EpisodeScreen params={params}>
      {(episode) => (
        <EditLayout
          episode={episode}
          inspector={{
            title: 'Инспектор',
            icon: SlidersHorizontal,
            children: <EmptyState icon={SlidersHorizontal} title="Кадр не выбран" description="Кадр, VO, промпт, длина, движение, кадрирование, переход." />,
          }}
        />
      )}
    </EpisodeScreen>
  )
}
