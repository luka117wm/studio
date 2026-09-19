/* Экран 12 «Канон»: слои канона 280 + рабочая зона + опорные портреты 320. Содержимое — M5. */
import { Image, Palette } from 'lucide-react'
import { useState } from 'react'
import { ScreenLayout } from '../../app/ScreenLayout'
import type { RouteParams } from '../../app/routes'
import { channelById, estimates } from '../../mocks/fixtures'
import { useUiStore } from '../../store/uiStore'
import { EmptyState, SegmentedControl } from '../../ui'

type Layer = 'style' | 'periods' | 'characters'

/* Экран 12: слои канона — переключатель в заголовке (артборд 12), слева панели нет,
   справа — опорные кадры стиля (320 по layout.md; в артборде 480 — см. docs/visual_review.md). */
export function CanonScreen(_props: { params: RouteParams }) {
  const channel = channelById(useUiStore((s) => s.channel))
  const [layer, setLayer] = useState<Layer>('style')
  return (
    <ScreenLayout
      header={{
        title: 'Канон',
        note: `${channel.name} · уровень канала, не выпуска`,
        actions: (
          <SegmentedControl
            ariaLabel="Слой канона"
            value={layer}
            onChange={setLayer}
            options={[
              { value: 'style', label: 'Стиль' },
              { value: 'periods', label: 'Периоды' },
              { value: 'characters', label: 'Персонажи' },
            ]}
          />
        ),
      }}
      right={{
        title: 'Опорные кадры стиля',
        icon: Image,
        collapsible: true,
        children: <EmptyState icon={Image} title="Опорных кадров нет" description="Шесть кадров показывают, как канон читается в картинке; пересобираются при смене рендера, оптики или света." />,
      }}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <EmptyState
          icon={Palette}
          title="Стиль канала не собран"
          description="Стиль — визуальная константа канала: рендер, оптика, свет, палитра, грейн и глобальный negative. Без него кадры не генерируются."
          primary={{ label: 'Собрать стиль', price: estimates.styleUsd, onClick: () => {} }}
        />
      </div>
    </ScreenLayout>
  )
}
