/* Экран 12 «Канон»: слои канона 280 + рабочая зона + опорные портреты 320. Содержимое — M5. */
import { Layers, Palette, Users } from 'lucide-react'
import { ScreenLayout } from '../../app/ScreenLayout'
import type { RouteParams } from '../../app/routes'
import { channelById, estimates } from '../../mocks/fixtures'
import { useUiStore } from '../../store/uiStore'
import { EmptyState } from '../../ui'

export function CanonScreen(_props: { params: RouteParams }) {
  const channel = channelById(useUiStore((s) => s.channel))
  return (
    <ScreenLayout
      header={{ title: 'Канон', note: channel.name }}
      left={{
        kind: 'library',
        title: 'Слои канона',
        icon: Layers,
        collapsible: true,
        children: <EmptyState icon={Layers} title="Слоёв нет" description="Стиль канала, периоды и персонажи — каждый слой версионируется отдельно." />,
      }}
      right={{
        title: 'Опорные портреты',
        icon: Users,
        collapsible: true,
        children: <EmptyState icon={Users} title="Облик не выбран" description="Шесть портретов облика: фас, три четверти, профиль, в рост, в действии, детали." />,
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
