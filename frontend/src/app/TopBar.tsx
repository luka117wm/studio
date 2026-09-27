/* Верхняя панель 44px: логотип → переключатель канала → выпуск → расход месяца → «?» → настройки.
   Индикатор сохранения вернётся с автосохранением (M3.4). */
import { CircleQuestionMark, Settings } from 'lucide-react'
import type { CostSummary } from '@/types/cost'
import { useBackendDown, useChannels, useCostSummaries, useEpisode, type ChannelScope } from '../api/queries'
import { useUiStore } from '../store/uiStore'
import { IconButton, ProgressBar, Select, Skeleton } from '../ui'
import { formatUsd } from './format'
import { STAGE_LABEL } from './labels'
import { Link } from './Link'
import { navigate, useRoute } from './navigation'
import { paths } from './routes'

const ALL_CHANNELS = 'Все каналы'

/** Потрачено за месяц: списано и зарезервировано идущими вызовами (docs/providers.md, «Бюджеты») */
const spentOf = (summary: CostSummary) => summary.budget.charged.usd_micro + summary.budget.reserved.usd_micro

function MonthSpend({ scope }: { scope: ChannelScope }) {
  const channels = useChannels()
  const summaries = useCostSummaries(scope)
  if (summaries.error) return null // бэкенд недоступен или сводки нет — шапка без расхода
  if (!summaries.data) return summaries.isPending ? <Skeleton className="h-6 w-33" /> : null
  const spent = summaries.data.reduce((sum, s) => sum + spentOf(s), 0)
  const limit = summaries.data.reduce((sum, s) => sum + s.budget.limit.usd_micro, 0)
  const nameOf = (id: string) => channels.data?.find((c) => c.id === id)?.name ?? id
  const title =
    summaries.data.length === 1
      ? `Расход месяца: ${formatUsd(spent)} из ${formatUsd(limit)}`
      : `Расход месяца по каналам: ${summaries.data
          .map((s) => `${nameOf(s.channel)} ${formatUsd(spentOf(s))} из ${formatUsd(s.budget.limit.usd_micro)}`)
          .join(', ')}`
  return (
    <div className="flex flex-col gap-1 border-l border-line pl-3" title={title}>
      <span className="flex items-baseline gap-1.5 text-12">
        <span className="font-medium text-ink">{formatUsd(spent)}</span>
        <span className="text-muted">из {formatUsd(limit)}</span>
      </span>
      <ProgressBar value={limit > 0 ? (spent / limit) * 100 : 0} status="ready" ariaLabel="Расход месяца" className="w-33" />
    </div>
  )
}

export function TopBar() {
  const scope = useUiStore((s) => s.channel)
  const episodeId = useUiStore((s) => s.episodeId)
  const setChannel = useUiStore((s) => s.setChannel)
  const closeEpisode = useUiStore((s) => s.closeEpisode)
  const setHelpOpen = useUiStore((s) => s.setHelpOpen)
  const route = useRoute()
  const channels = useChannels()
  const episode = useEpisode(episodeId)
  const down = useBackendDown()

  const onChannel = (next: string) => {
    const scopeNext = next as ChannelScope
    setChannel(scopeNext)
    // Каналы изолированы: выпуск другого канала закрывается, экран выпуска уходит к списку.
    // «Все каналы» — режим просмотра, открытый выпуск в нём остаётся.
    if (scopeNext !== 'all' && episode.data && episode.data.channel !== scopeNext) {
      closeEpisode()
      if (route?.params.episodeId) navigate(paths.episodes)
    }
  }

  return (
    <header aria-label="Верхняя панель" className="flex h-shell-topbar shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <Link to={paths.episodes} title="Выпуски" className="flex h-7 items-center border-r border-line pr-3 text-13 font-semibold tracking-[0.04em] text-ink">
        Studio
      </Link>
      {channels.data ? (
        <Select
          ariaLabel="Канал"
          value={scope}
          onChange={onChannel}
          options={[{ value: 'all', label: ALL_CHANNELS }, ...channels.data.map((c) => ({ value: c.id, label: c.name }))]}
          className="w-44"
        />
      ) : channels.isPending ? (
        <Skeleton className="h-7 w-44" />
      ) : null}
      {episodeId === null ? (
        <span className="text-13 text-muted">Выпуск не открыт</span>
      ) : episode.data ? (
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-13 font-medium text-ink" title="Переименовать выпуск">
            {episode.data.title}
          </span>
          <span className="whitespace-nowrap text-12 text-muted">{STAGE_LABEL[episode.data.stage]}</span>
        </div>
      ) : episode.isPending ? (
        <Skeleton className="h-4 w-60" />
      ) : null}
      <div className="flex-1" />
      {!down && <MonthSpend scope={scope} />}
      <IconButton icon={CircleQuestionMark} label="Горячие клавиши (?)" onClick={() => setHelpOpen(true)} />
      <IconButton icon={Settings} label="Настройки и расходы" onClick={() => navigate(paths.settings)} />
    </header>
  )
}
