/* Экран 1 «Выпуски»: заголовок 52 с поиском и фильтром, полоса слотов, доска по стадиям.
   До доски (M3.5) и полосы слотов (M3.6) — данные API простым списком: пусто → пустое состояние. */
import { Film, Search } from 'lucide-react'
import { useState } from 'react'
import { ScreenLayout } from '../../app/ScreenLayout'
import type { RouteParams } from '../../app/routes'
import { QueryError } from '../../app/BackendState'
import { useEpisodes, useSlots } from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import { EmptyState, Input, SegmentedControl, Skeleton } from '../../ui'

type Filter = 'all' | 'active' | 'ready'

export function EpisodesScreen(_props: { params: RouteParams }) {
  const channel = useUiStore((s) => s.channel)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const episodes = useEpisodes(channel)
  const slots = useSlots()
  const free = slots.data?.filter((s) => s.state === 'empty').length ?? 0

  return (
    <ScreenLayout
      header={{
        title: 'Выпуски',
        note: episodes.data ? `${episodes.data.length} в ${channel === 'all' ? 'обоих каналах' : 'канале'}` : undefined,
        actions: (
          <>
            <span className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-icon -translate-y-1/2 text-muted" strokeWidth={1.5} aria-hidden />
              <Input value={query} onChange={setQuery} placeholder="Поиск по выпускам" ariaLabel="Поиск по выпускам" type="search" className="w-57 [&_input]:pl-7" />
            </span>
            <SegmentedControl
              ariaLabel="Фильтр выпусков"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'Все' },
                { value: 'active', label: 'В работе' },
                { value: 'ready', label: 'Готовые' },
              ]}
            />
          </>
        ),
      }}
    >
      <section aria-label="Слоты публикации" className="flex flex-col gap-2 px-4 pt-3 pb-2">
        <div className="flex items-baseline gap-2">
          <span className="text-12 font-medium text-muted">Слоты публикации, раз в два дня</span>
          <span className="h-px flex-1 bg-line" />
          {slots.data && (
            <span className="text-12 text-muted">
              {slots.data.length} слотов, {free} свободных
            </span>
          )}
        </div>
      </section>
      <section aria-label="Доска выпусков" className="flex min-h-0 flex-1 flex-col px-4 pb-3">
        {episodes.error ? (
          <QueryError error={episodes.error} />
        ) : !episodes.data ? (
          <Skeleton variant="text" lines={4} className="w-110" />
        ) : episodes.data.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={Film}
              title="Выпусков пока нет"
              description="Доска по стадиям: идея, сценарий, генерация, монтаж, готов, опубликован. Создайте первый выпуск — из идеи или с чистого листа."
              primary={{ label: 'Новый выпуск', onClick: () => {} }}
            />
          </div>
        ) : (
          <ul className="flex flex-col">
            {episodes.data.map((episode) => (
              <li key={episode.id} className="flex h-8 items-center border-b border-row-border text-13 text-ink">
                {episode.title}
              </li>
            ))}
          </ul>
        )}
      </section>
    </ScreenLayout>
  )
}
