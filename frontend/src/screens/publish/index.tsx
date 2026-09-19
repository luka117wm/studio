/* Экран 8 «Публикация»: метаданные 380 + обложка и загрузка. Содержимое — M10. */
import { FileText, Image, Upload } from 'lucide-react'
import { EpisodeScreen } from '../../app/EpisodeScreen'
import { ScreenLayout } from '../../app/ScreenLayout'
import type { RouteParams } from '../../app/routes'
import { estimates } from '../../mocks/fixtures'
import { EmptyState } from '../../ui'

export function PublishScreen({ params }: { params: RouteParams }) {
  return (
    <EpisodeScreen params={params}>
      {(episode) => (
        <ScreenLayout
          header={{ title: 'Публикация', note: episode.slot ? `слот ${episode.slot}` : 'слот не назначен' }}
          left={{
            kind: 'metadata',
            title: 'Метаданные',
            icon: FileText,
            children: <EmptyState icon={FileText} title="Метаданные не заполнены" description="Три варианта названия, описание, теги, категория и пометка о синтетическом видео — из плана." />,
          }}
          right={{
            title: 'Загрузка',
            note: 'через API',
            icon: Upload,
            children: <EmptyState icon={Upload} title="Канал не подключён" description="Авторизация YouTube, способ загрузки, чеклист перед публикацией и возобновляемая загрузка." />,
          }}
        >
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <EmptyState
              icon={Image}
              title="Обложка не собрана"
              description="Варианты A/B/C, слои и безопасная зона бейджа длительности; предпросмотр в трёх размерах ленты."
              primary={{ label: 'Собрать обложку', price: estimates.thumbnailUsd, onClick: () => {} }}
            />
          </div>
        </ScreenLayout>
      )}
    </EpisodeScreen>
  )
}
