import { Compass } from 'lucide-react'
import { EmptyState } from '../ui'
import { navigate } from './navigation'
import { paths } from './routes'

/** Неизвестный путь: что случилось и куда идти. */
export function NotFoundScreen({ pathname }: { pathname: string }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <EmptyState
        icon={Compass}
        title="Нет такого экрана"
        description={`Путь ${pathname} ничему не соответствует. Возможно, ссылка устарела.`}
        secondary={{ label: 'К выпускам', onClick: () => navigate(paths.episodes) }}
      />
    </div>
  )
}
