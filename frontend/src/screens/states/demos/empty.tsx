/* Пустые состояния кита: EmptyState с действием и ценой, без действий, с подписью. */
import { Film, Image, Lightbulb } from 'lucide-react'
import { EmptyState } from '../../../ui'
import type { Demo } from '../registry'

export const empty: Demo[] = [
  {
    component: 'EmptyState',
    state: 'с primary и ценой, secondary и подписью',
    node: (
      <EmptyState
        icon={Film}
        title="Кадров пока нет"
        description="Кадры появятся после утверждения плана."
        primary={{ label: 'Сгенерировать 24 кадра', price: 1.61, onClick: () => {} }}
        secondary={{ label: 'Открыть план', onClick: () => {} }}
        hint="Бюджет выпуска: $4.00"
      />
    ),
  },
  {
    component: 'EmptyState',
    state: 'только описание (панель)',
    node: <EmptyState icon={Image} title="Кадр не выбран" description="Версии, промпт и причина отказа выбранного кадра." />,
  },
  {
    component: 'EmptyState',
    state: 'с secondary без цены',
    node: (
      <EmptyState
        icon={Lightbulb}
        title="Идей пока нет"
        description="Из идеи начинается выпуск."
        secondary={{ label: 'Найти идеи', price: 0.12, onClick: () => {} }}
      />
    ),
  },
]
