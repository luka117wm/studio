/* Экран 2 «Идеи»: бэклог идей канала. Содержимое — M4. */
import { Lightbulb } from 'lucide-react'
import { ScreenLayout } from '../../app/ScreenLayout'
import type { RouteParams } from '../../app/routes'
import { estimates } from '../../mocks/fixtures'
import { EmptyState } from '../../ui'

export function IdeasScreen(_props: { params: RouteParams }) {
  return (
    <ScreenLayout header={{ title: 'Идеи', note: 'бэклог канала' }}>
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
