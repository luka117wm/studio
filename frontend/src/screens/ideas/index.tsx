/* Экран 2 «Идеи»: бэклог идей канала. Содержимое — M4. */
import { Lightbulb, Radar, Sprout } from 'lucide-react'
import { ScreenLayout } from '../../app/ScreenLayout'
import type { RouteParams } from '../../app/routes'
import { estimates } from '../../mocks/fixtures'
import { EmptyState } from '../../ui'

/* Экран 2: семена ниши 300 слева, выбросы радара в центре, идеи из кластеров 340 справа (артборд 2). */
export function IdeasScreen(_props: { params: RouteParams }) {
  return (
    <ScreenLayout
      header={{ title: 'Идеи', note: 'бэклог: 0 идей' }}
      left={{
        kind: 'seeds',
        title: 'Семена ниши',
        icon: Sprout,
        children: <EmptyState icon={Sprout} title="Семян нет" description="Темы, язык, регион, период и длина — из них радар собирает выбросы." />,
      }}
      right={{
        kind: 'clusters',
        title: 'Идеи из кластеров',
        icon: Radar,
        children: <EmptyState icon={Radar} title="Кластеров нет" description="Идеи с доказательствами и оценкой насыщенности появятся после радара." />,
      }}
    >
      <div className="flex flex-1 items-center justify-center p-4">
        <EmptyState
          icon={Lightbulb}
          title="Идей пока нет"
          description="Заголовок, угол, референсы и оценка тренда. Из идеи начинается выпуск: «Начать выпуск» ведёт в сценарий и план."
          primary={{ label: 'Добавить идею', onClick: () => {} }}
          secondary={{ label: 'Найти идеи', price: estimates.ideasUsd, onClick: () => {} }}
        />
      </div>
    </ScreenLayout>
  )
}
