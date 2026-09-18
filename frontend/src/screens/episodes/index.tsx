/* Экран 1 «Выпуски»: заголовок 52 с поиском и фильтром, полоса слотов, доска по стадиям. Содержимое — M3. */
import { Film, Search } from 'lucide-react'
import { useState } from 'react'
import { ScreenLayout } from '../../app/ScreenLayout'
import type { RouteParams } from '../../app/routes'
import { episodes, slots } from '../../mocks/fixtures'
import { useUiStore } from '../../store/uiStore'
import { EmptyState, Input, SegmentedControl } from '../../ui'

type Filter = 'all' | 'active' | 'ready'

export function EpisodesScreen(_props: { params: RouteParams }) {
  const channel = useUiStore((s) => s.channel)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const own = episodes.filter((e) => e.channel === channel)
  const free = slots.filter((s) => s.empty).length

  return (
    <ScreenLayout
      header={{
        title: 'Выпуски',
        note: `${own.length} в канале`,
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
          <span className="text-12 text-muted">сентябрь 2026 · {slots.length} слотов, {free} свободных</span>
        </div>
      </section>
      <section aria-label="Доска выпусков" className="flex min-h-0 flex-1 items-center justify-center px-4 pb-3">
        <EmptyState
          icon={Film}
          title="Выпусков пока нет"
          description="Доска по стадиям: идея, сценарий, генерация, монтаж, готов, опубликован. Создайте первый выпуск — из идеи или с чистого листа."
          primary={{ label: 'Новый выпуск', onClick: () => {} }}
          hint="⌘N — новый выпуск"
        />
      </section>
    </ScreenLayout>
  )
}
