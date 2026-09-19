/* Экран 7 «Экспорт»: пресеты 320 + очередь рендера; лог 420 — кнопкой поверх правой части, на 2560 третьей колонкой. Содержимое — M9. */
import { Clapperboard, SlidersHorizontal, Terminal } from 'lucide-react'
import { EpisodeScreen } from '../../app/EpisodeScreen'
import { ScreenLayout } from '../../app/ScreenLayout'
import type { RouteParams } from '../../app/routes'
import { EmptyState } from '../../ui'

export function ExportScreen({ params }: { params: RouteParams }) {
  return (
    <EpisodeScreen params={params}>
      {(episode) => (
        <ScreenLayout
          header={{ title: 'Экспорт', note: `${episode.duration} · 1920×1080` }}
          left={{
            kind: 'presets',
            title: 'Пресеты',
            icon: SlidersHorizontal,
            children: <EmptyState icon={SlidersHorizontal} title="Пресетов нет" description="Мастер MP4, FCP7 XML, OTIO и SRT — каждый со своими настройками." />,
          }}
          wide={{
            title: 'Лог ffmpeg',
            kind: 'log',
            children: <EmptyState icon={Terminal} title="Лог пуст" description="Строки ffmpeg появятся во время рендера." />,
          }}
          bottom={{
            title: 'Очередь рендера',
            kind: 'queue',
            children: <div className="flex h-full items-center px-4 text-12 text-muted">Задач нет: соберите очередь из пресетов</div>,
          }}
        >
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <EmptyState
              icon={Clapperboard}
              title="Рендер не запускался"
              description="Этапы: кадры → склейка → звук → субтитры → финал. Цвет — sRGB в BT.709, движение считает компоновщик."
              primary={{ label: 'Рендерить мастер', onClick: () => {} }}
              secondary={{ label: 'Открыть лог', onClick: () => {} }}
            />
          </div>
        </ScreenLayout>
      )}
    </EpisodeScreen>
  )
}
