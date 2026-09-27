/* Состояния оболочки при работе с API (design/CLAUDE.md, «Состояния»): бэкенд недоступен — карточка ошибки
   вида ErrorCard каталога состояний на месте рабочей области; загрузка — скелетоны зон, не спиннер;
   ошибка конкретного запроса — её текст в зоне, где нужны данные. */
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/client'
import { Button, Skeleton, StatusGlyph, cn } from '../ui'

export const BACKEND_DOWN_TITLE = 'Бэкенд недоступен'

/** «Бэкенд недоступен. Запустите ./run.sh и повторите» + «Повторить»: сброс запросов перезапрашивает всё,
 *  что на экране, — и если бэкенд поднят, экран возвращается. */
export function BackendState() {
  const client = useQueryClient()
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div role="alert" className="flex w-full max-w-110 flex-col gap-2.5 rounded-panel border border-failed bg-surface-failed p-3">
        <div className="flex gap-2.5">
          <StatusGlyph status="failed" className="mt-0.5" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-13 font-medium text-failed-text">{BACKEND_DOWN_TITLE}</span>
            <span className="text-12 text-muted">Сервер не отвечает. Запустите ./run.sh и повторите.</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="statusOutline" status="failed" onClick={() => void client.resetQueries()}>
            Повторить
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Текст ошибки запроса в зоне — «что случилось и что сделать» приходит с бэкенда */
export function QueryError({ error, className }: { error: unknown; className?: string }) {
  const message = error instanceof ApiError ? error.message : 'Не удалось загрузить данные — повторите.'
  return (
    <p role="alert" className={cn('text-12 text-failed-text', className)}>
      {message}
    </p>
  )
}

/** Скелетон рабочей области экрана выпуска */
export function WorkAreaSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загрузка" className="flex flex-1 flex-col gap-3 p-4">
      <Skeleton className="h-6 w-60" />
      <Skeleton variant="text" lines={3} className="w-110" />
      <Skeleton className="min-h-0 flex-1" />
    </div>
  )
}
