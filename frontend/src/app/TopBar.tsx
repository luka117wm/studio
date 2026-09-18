/* Верхняя панель 44px: логотип → переключатель канала → выпуск → индикатор сохранения → расход месяца → «?» → настройки. */
import { CircleQuestionMark, Settings } from 'lucide-react'
import { channelById, channels, episodeById, statusLine } from '../mocks/fixtures'
import { useUiStore } from '../store/uiStore'
import { IconButton, ProgressBar, Select, formatPrice } from '../ui'
import type { ChannelId } from '../types/fixtures'
import { Link } from './Link'
import { navigate, useRoute } from './navigation'
import { paths } from './routes'

const STAGE_LABEL = {
  idea: 'идея',
  script: 'сценарий',
  generate: 'генерация',
  edit: 'монтаж',
  export: 'экспорт',
  publish: 'публикация',
} as const

export function TopBar() {
  const channelId = useUiStore((s) => s.channel)
  const episodeId = useUiStore((s) => s.episodeId)
  const setChannel = useUiStore((s) => s.setChannel)
  const closeEpisode = useUiStore((s) => s.closeEpisode)
  const setHelpOpen = useUiStore((s) => s.setHelpOpen)
  const route = useRoute()
  const channel = channelById(channelId)
  const episode = episodeById(episodeId)
  const spentPercent = (channel.spentUsd / channel.monthlyBudgetUsd) * 100

  const onChannel = (next: string) => {
    const id = next as ChannelId
    setChannel(id)
    // Каналы изолированы: выпуск другого канала закрывается, экран выпуска уходит к списку
    if (episode && episode.channel !== id) {
      closeEpisode()
      if (route?.params.episodeId) navigate(paths.episodes)
    }
  }

  return (
    <header aria-label="Верхняя панель" className="flex h-shell-topbar shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <Link to={paths.episodes} title="Выпуски" className="flex h-7 items-center border-r border-line pr-3 text-13 font-semibold tracking-[0.04em] text-ink">
        Studio
      </Link>
      <Select
        ariaLabel="Канал"
        value={channelId}
        onChange={onChannel}
        options={channels.map((c) => ({ value: c.id, label: c.name }))}
        className="w-44"
      />
      {episode ? (
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-13 font-medium text-ink" title="Переименовать выпуск">
            {episode.title}
          </span>
          {route?.route.stage && <span className="whitespace-nowrap text-12 text-muted">{STAGE_LABEL[route.route.stage]}</span>}
        </div>
      ) : (
        <span className="text-13 text-muted">Выпуск не открыт</span>
      )}
      <div className="flex-1" />
      <span className="flex items-center gap-1.5 text-12 text-muted" data-testid="save-indicator">
        <span className="size-1.5 rounded-full bg-accent-deep" aria-hidden />
        Сохранено {statusLine.savedAt}
      </span>
      <div
        className="flex flex-col gap-1 border-l border-line pl-3"
        title={`Расход месяца: ${formatPrice(channel.spentUsd).slice(1)} из $${channel.monthlyBudgetUsd}`}
      >
        <span className="flex items-baseline gap-1.5 text-12">
          <span className="font-medium text-ink">${channel.spentUsd.toFixed(2)}</span>
          <span className="text-muted">из ${channel.monthlyBudgetUsd}</span>
        </span>
        <ProgressBar value={spentPercent} status="ready" ariaLabel="Расход месяца" className="w-33" />
      </div>
      <IconButton icon={CircleQuestionMark} label="Горячие клавиши (?)" onClick={() => setHelpOpen(true)} />
      <IconButton icon={Settings} label="Настройки и расходы" onClick={() => navigate(paths.settings)} />
    </header>
  )
}
