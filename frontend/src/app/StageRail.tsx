/* Рельс этапов 56px: шесть этапов открытого выпуска. Все кликабельны; недоступные — для просмотра.
   todo — иконка text-disabled и полый маркер · active — заливка accent · done — сплошной маркер · error — квадрат failed. */
import { Clapperboard, FileText, Lightbulb, Sparkles, Upload, Play } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useUiStore } from '../store/uiStore'
import { cn } from '../ui'
import { episodeById } from '../mocks/fixtures'
import type { StageId, StageState } from '../types/fixtures'
import { Link } from './Link'
import { useRoute } from './navigation'
import { paths } from './routes'

const STAGES: { id: StageId; label: string; icon: LucideIcon }[] = [
  { id: 'idea', label: 'Идея', icon: Lightbulb },
  { id: 'script', label: 'Сценарий', icon: FileText },
  { id: 'generate', label: 'Генерация', icon: Sparkles },
  { id: 'edit', label: 'Монтаж', icon: Clapperboard },
  { id: 'export', label: 'Экспорт', icon: Upload },
  { id: 'publish', label: 'Публикация', icon: Play },
]

const STATE_LABEL: Record<StageState, string> = {
  todo: 'не начат',
  active: 'в работе',
  done: 'готово',
  error: 'ошибка',
}

export function StageRail() {
  const episodeId = useUiStore((s) => s.episodeId)
  const episode = episodeById(episodeId)
  const route = useRoute()
  if (!episode) return null
  const current = route?.route.stage ?? null

  return (
    <nav aria-label="Этапы выпуска" className="flex w-shell-stage-rail shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2">
      {STAGES.map(({ id, label, icon: Icon }) => {
        const state = episode.stages[id]
        const active = id === current
        return (
          <Link
            key={id}
            to={paths.stage(episode.id, id)}
            title={`${label} — ${STATE_LABEL[state]}`}
            ariaLabel={label}
            current={active}
            className={cn(
              'relative flex size-10 items-center justify-center rounded-control',
              active ? 'bg-accent text-accent-ink' : 'hover:bg-raised',
              !active && (state === 'done' || state === 'error' ? 'text-ink' : 'text-disabled'),
            )}
          >
            <Icon className="size-icon" strokeWidth={1.5} aria-hidden />
            {!active && state === 'done' && <span aria-hidden className="absolute right-[5px] bottom-[5px] size-[5px] rounded-full bg-ink" />}
            {!active && state === 'todo' && <span aria-hidden className="absolute right-[5px] bottom-[5px] size-[5px] rounded-full border border-disabled" />}
            {!active && state === 'error' && <span aria-hidden className="absolute right-[5px] bottom-[5px] size-[5px] rounded-[1px] bg-failed" />}
          </Link>
        )
      })}
    </nav>
  )
}
