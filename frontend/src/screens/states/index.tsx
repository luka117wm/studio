/* Экран 10 «Состояния»: каталог пустых, процессных и ошибочных состояний каждого экрана. Наполняется в M1.5. */
import { ListTodo } from 'lucide-react'
import { ScreenLayout } from '../../app/ScreenLayout'
import type { RouteParams } from '../../app/routes'
import { EmptyState } from '../../ui'

export function StatesScreen(_props: { params: RouteParams }) {
  return (
    <ScreenLayout header={{ title: 'Состояния', note: 'пустое · процесс · ошибка · конфликт' }}>
      <div className="flex flex-1 items-center justify-center p-4">
        <EmptyState
          icon={ListTodo}
          title="Каталог пуст"
          description="Каждый экран обязан иметь пустое, процессное и ошибочное состояние. Здесь они собраны рядом, как в storybook."
        />
      </div>
    </ScreenLayout>
  )
}
