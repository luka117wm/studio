/* Экран 6 «Инспектор — анимация и SFX»: раскладка монтажа, правая панель — секции кадра. Содержимое — M8. */
import { Music, WandSparkles } from 'lucide-react'
import { EpisodeScreen } from '../../app/EpisodeScreen'
import { PanelHeader } from '../../app/PanelHeader'
import type { RouteParams } from '../../app/routes'
import { EmptyState } from '../../ui'
import { EditLayout } from '../edit'

export function InspectorScreen({ params }: { params: RouteParams }) {
  return (
    <EpisodeScreen params={params}>
      {(episode) => (
        <EditLayout
          episode={episode}
          inspector={{
            title: 'Инспектор',
            note: params.shotId,
            icon: WandSparkles,
            children: (
              <div className="flex flex-col">
                <PanelHeader title="Анимация" note="лимит выпуска: 0 из 3" />
                <EmptyState icon={WandSparkles} title="Кадр не оживлён" description="Рекомендация из плана, промпт и длительность — здесь." />
                <PanelHeader title="SFX" note="0 эффектов" />
                <EmptyState icon={Music} title="Эффектов нет" description="Смещение, длина, громкость каждого эффекта и предложения из плана." />
              </div>
            ),
          }}
        />
      )}
    </EpisodeScreen>
  )
}
