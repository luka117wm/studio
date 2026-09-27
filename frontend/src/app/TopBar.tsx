/* Верхняя панель 44px (components.md, TopBar): логотип → переключатель канала → название выпуска с
   переименованием → индикатор сохранения → расход месяца → «?» → настройки. */
import { CircleQuestionMark, Settings } from 'lucide-react'
import type { CostSummary } from '@/types/cost'
import { useBackendDown, useChannels, useCostSummaries, useEpisode, type ChannelScope } from '../api/queries'
import { useUiStore } from '../store/uiStore'
import { IconButton, ProgressBar, Skeleton } from '../ui'
import { ChannelSwitcher } from './ChannelSwitcher'
import { EpisodeTitle } from './EpisodeTitle'
import { formatUsd } from './format'
import { STAGE_LABEL } from './labels'
import { Link } from './Link'
import { navigate } from './navigation'
import { paths } from './routes'
import { SaveIndicator } from './SaveIndicator'

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
  const setHelpOpen = useUiStore((s) => s.setHelpOpen)
  const episode = useEpisode(episodeId)
  const down = useBackendDown()

  return (
    <header aria-label="Верхняя панель" className="flex h-shell-topbar shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <Link to={paths.episodes} title="Выпуски" className="flex h-7 items-center border-r border-line pr-3 text-13 font-semibold tracking-[0.04em] text-ink">
        Studio
      </Link>
      <ChannelSwitcher />
      {episodeId === null ? (
        <span className="text-13 text-muted">Выпуск не открыт</span>
      ) : episode.data ? (
        <div className="flex min-w-0 items-baseline gap-2">
          <EpisodeTitle episode={episode.data} />
          <span className="whitespace-nowrap text-12 text-muted">{STAGE_LABEL[episode.data.stage]}</span>
        </div>
      ) : episode.isPending ? (
        <Skeleton className="h-4 w-60" />
      ) : null}
      <div className="flex-1" />
      <SaveIndicator />
      {!down && <MonthSpend scope={scope} />}
      <IconButton icon={CircleQuestionMark} label="Горячие клавиши (?)" onClick={() => setHelpOpen(true)} />
      <IconButton icon={Settings} label="Настройки и расходы" onClick={() => navigate(paths.settings)} />
    </header>
  )
}
