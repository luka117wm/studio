/* Экран 4 «Генерация»: канон 280 + очередь 72 и сетка кадров + инспектор 320. Содержимое — M6. */
import { Image, Palette, Sparkles } from 'lucide-react'
import { EpisodeScreen } from '../../app/EpisodeScreen'
import { navigate } from '../../app/navigation'
import { ScreenLayout } from '../../app/ScreenLayout'
import { paths, type RouteParams } from '../../app/routes'
import { estimates } from '../../mocks/fixtures'
import { EmptyState } from '../../ui'

export function GenerateScreen({ params }: { params: RouteParams }) {
  return (
    <EpisodeScreen params={params}>
      {(episode) => (
        <ScreenLayout
          header={{ title: 'Генерация', note: `${episode.shots} кадров · ${episode.period?.label ?? 'период не выбран'}` }}
          strip={{
            title: 'Очереди генерации',
            children: (
              <>
                <div className="flex flex-1 items-center border-r border-line px-4 text-12 text-muted">Кадры: очередь пуста</div>
                <div className="flex flex-1 items-center px-4 text-12 text-muted">Голос: очередь пуста</div>
              </>
            ),
          }}
          left={{
            kind: 'library',
            title: 'Канон',
            note: episode.period?.label,
            icon: Palette,
            collapsible: true,
            children: (
              <EmptyState
                icon={Palette}
                title="Канон не собран"
                description="Стиль канала, период и облики персонажей подставляются в каждый кадр."
                secondary={{ label: 'Открыть канон', onClick: () => navigate(paths.canon) }}
              />
            ),
          }}
          right={{
            title: 'Кадр',
            icon: Image,
            collapsible: true,
            children: <EmptyState icon={Image} title="Кадр не выбран" description="Версии, промпт и причина отказа выбранного кадра." />,
          }}
        >
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <EmptyState
              icon={Sparkles}
              title="Кадры не сгенерированы"
              description="Пакетная генерация запускается только после утверждения плана. Один кадр не удался — пачка продолжается."
              primary={{ label: `Сгенерировать ${episode.shots} кадра`, price: estimates.shotsUsd, onClick: () => {} }}
              hint={`Бюджет выпуска учитывается до постановки в очередь`}
            />
          </div>
        </ScreenLayout>
      )}
    </EpisodeScreen>
  )
}
