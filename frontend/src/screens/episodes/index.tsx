/* Экран 1 «Выпуски»: заголовок 52 со счётчиком, поиском и фильтром канала, полоса слотов, доска по стадиям.
   Список берётся по обоим каналам: фильтр канала (= `uiStore.channel`) и поиск режут его здесь, а счётчик считает
   видимые из всех — «3 из 9», как в артборде. Полоса слотов и диалог «Новый выпуск» — M3.6. */
import { Film, Plus, Search, SearchX } from 'lucide-react'
import { useState } from 'react'
import { ScreenLayout } from '../../app/ScreenLayout'
import type { RouteParams } from '../../app/routes'
import { QueryError } from '../../app/BackendState'
import { useSwitchChannel } from '../../app/useChannel'
import { useEpisodes, useSlots, type ChannelScope } from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import { Button, EmptyState, Input, SegmentedControl, Tooltip } from '../../ui'
import { Board } from './Board'
import { countLabel, matchesQuery } from './board'

export function EpisodesScreen(_props: { params: RouteParams }) {
  const channel = useUiStore((s) => s.channel)
  const switchChannel = useSwitchChannel()
  const [query, setQuery] = useState('')
  const episodes = useEpisodes('all')
  const slots = useSlots()
  const free = slots.data?.filter((s) => s.state === 'empty').length ?? 0

  const all = episodes.data ?? null
  const inChannel = all?.filter((e) => channel === 'all' || e.channel === channel) ?? null
  const visible = inChannel?.filter((e) => matchesQuery(e, query)) ?? null
  const empty = inChannel !== null && inChannel.length === 0

  return (
    <ScreenLayout
      header={{
        title: 'Выпуски',
        note: all && visible ? countLabel(visible.length, all) : undefined,
        actions: (
          <>
            <span className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-icon -translate-y-1/2 text-muted" strokeWidth={1.5} aria-hidden />
              <Input value={query} onChange={setQuery} placeholder="Поиск по выпускам" ariaLabel="Поиск по выпускам" type="search" className="w-57 [&_input]:pl-7" />
            </span>
            <SegmentedControl<ChannelScope>
              ariaLabel="Фильтр канала"
              value={channel}
              onChange={switchChannel}
              options={[
                { value: 'all', label: 'Все' },
                { value: 'cursus', label: 'Cursus' },
                { value: 'otto', label: 'Otto' },
              ]}
            />
            {/* Пустая доска несёт свою primary — на экране она одна (design/CLAUDE.md) */}
            {!empty && (
              <Tooltip content="Диалог нового выпуска ещё не подключён">
                <Button variant="primary" icon={Plus} disabled>
                  Новый выпуск
                </Button>
              </Tooltip>
            )}
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
      <section aria-label="Доска выпусков" className="flex min-h-0 flex-1 flex-col px-4 pt-2 pb-3">
        {episodes.error ? (
          <QueryError error={episodes.error} />
        ) : empty ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={Film}
              title="Выпусков пока нет"
              description="Доска по стадиям: идея, сценарий, генерация, монтаж, готов, опубликован. Создайте первый выпуск — из идеи или с чистого листа."
              primary={{ label: 'Новый выпуск', onClick: () => {} }}
            />
          </div>
        ) : visible !== null && visible.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={SearchX}
              title={`Ничего не найдено по «${query.trim()}»`}
              description="Поиск идёт по названию и короткому имени выпуска."
              secondary={{ label: 'Сбросить поиск', onClick: () => setQuery('') }}
            />
          </div>
        ) : (
          <Board episodes={visible} />
        )}
      </section>
    </ScreenLayout>
  )
}
