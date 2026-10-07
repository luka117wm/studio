/* Экран 3 «Сценарий и план»: заголовок с режимами «Сценарий / План кадров / JSON» (⌘⇧1…⌘⇧3, режим — в адресе
   `?mode=`) и счётчиками; в центре — заявка или принятый план; справа — «Источник плана» (мост через чат).
   Лист и таблицу наполнит M4.5, JSON-редактор, факт-чек и смету — M4.7. План — только кэш запросов. */
import { Braces, ChevronDown, ChevronRight, MessagesSquare } from 'lucide-react'
import { useState } from 'react'
import type { EpisodeListItem } from '@/types/episode'
import type { EffectivePlan } from '@/types/plan'
import type { EpisodeBrief } from '@/types/project'
import { useAutosave } from '../../app/autosave'
import { EpisodeScreen } from '../../app/EpisodeScreen'
import { formatTimecode } from '../../app/format'
import { setSearchParam, useSearchParam } from '../../app/navigation'
import type { RouteParams } from '../../app/routes'
import { ScreenLayout } from '../../app/ScreenLayout'
import { useHotkeySet } from '../../app/useHotkey'
import { useFormat, usePlan, useProject, useSaveBrief } from '../../api/queries'
import { Button, EmptyState, SegmentedControl, Skeleton, cn } from '../../ui'
import { formatCount, plural } from '../episodes/board'
import { BridgePanel } from './BridgePanel'
import { EMPTY_BRIEF } from './brief'
import { BriefForm } from './BriefForm'
import { PlanPreview } from './PlanPreview'

export type ScriptMode = 'script' | 'plan' | 'json'

const MODES: { value: ScriptMode; label: string; hint: string; keys: string }[] = [
  { value: 'script', label: 'Сценарий', hint: 'сценарий', keys: 'Mod+Shift+1' },
  { value: 'plan', label: 'План кадров', hint: 'план', keys: 'Mod+Shift+2' },
  { value: 'json', label: 'JSON', hint: 'JSON', keys: 'Mod+Shift+3' },
]

const isMode = (value: string | null): value is ScriptMode => MODES.some((m) => m.value === value)

export function ScriptScreen({ params }: { params: RouteParams }) {
  return (
    <EpisodeScreen params={params}>{(episode) => <ScriptWorkspace key={episode.id} episode={episode} />}</EpisodeScreen>
  )
}

function ScriptWorkspace({ episode }: { episode: EpisodeListItem }) {
  const param = useSearchParam('mode')
  const mode: ScriptMode = isMode(param) ? param : 'script'
  const setMode = (next: ScriptMode) => setSearchParam('mode', next === 'script' ? null : next)
  useHotkeySet(
    MODES.map((m) => ({
      id: `script-mode-${m.value}`,
      keys: m.keys,
      scope: 'screen' as const,
      group: 'Сценарий',
      description: `Режим: ${m.label.toLowerCase()}`,
      hint: m.hint,
      handler: () => setMode(m.value),
    })),
  )

  const project = useProject(episode.id)
  const plan = usePlan(episode.id)
  const format = useFormat(episode.channel)
  const saveBrief = useSaveBrief(episode.id)
  // Правка заявки живёт здесь до записи: её видят и форма, и кнопка промпта (без идеи выключена)
  const [draft, setDraft] = useState<EpisodeBrief | undefined>(undefined)
  useAutosave(`brief:${episode.id}`, draft, async (brief) => {
    const saved = await saveBrief.mutateAsync(brief)
    return saved.updated_at
  })
  const brief = draft ?? project.data?.brief ?? EMPTY_BRIEF

  return (
    <ScreenLayout
      header={{
        title: 'Сценарий и план',
        view: (
          <SegmentedControl
            ariaLabel="Режим"
            value={mode}
            onChange={setMode}
            options={MODES.map(({ value, label }) => ({ value, label }))}
          />
        ),
        actions: <Counters plan={plan.data ?? null} wordsPerMinute={format.data?.preset.words_per_minute ?? null} />,
      }}
      right={{
        title: 'Источник плана',
        icon: MessagesSquare,
        collapsible: true,
        children: <BridgePanel episodeId={episode.id} hasIdea={brief.idea.trim() !== ''} />,
      }}
    >
      <div className="flex min-h-0 flex-1 justify-center overflow-y-auto p-4">
        <Center
          mode={mode}
          plan={plan.data}
          planError={plan.error}
          brief={project.isPending ? undefined : brief}
          onBrief={setDraft}
        />
      </div>
    </ScreenLayout>
  )
}

function Center({
  mode,
  plan,
  planError,
  brief,
  onBrief,
}: {
  mode: ScriptMode
  plan: EffectivePlan | null | undefined
  planError: Error | null
  brief: EpisodeBrief | undefined
  onBrief: (next: EpisodeBrief) => void
}) {
  if (planError) {
    return <p role="alert" className="w-190 text-13 text-failed-text">{planError.message}</p>
  }
  if (plan === undefined || brief === undefined) {
    return (
      <div className="flex w-190 flex-col gap-3">
        <Skeleton variant="text" lines={6} />
      </div>
    )
  }
  if (plan === null) {
    return (
      <section aria-label="Заявка выпуска" className="flex w-190 shrink-0 flex-col gap-4 self-start rounded-panel border border-line bg-panel p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-15 font-semibold">Заявка выпуска</h2>
          <p className="text-12 text-muted">
            План приходит из чата частями по 26 кадров: заполните заявку, скопируйте промпт справа и вставьте ответ чата.
          </p>
        </div>
        <BriefForm value={brief} onChange={onBrief} />
      </section>
    )
  }
  if (mode === 'json') {
    return (
      <EmptyState
        icon={Braces}
        title="JSON плана"
        description={`Версия ${plan.version} целиком: правка с проверкой и сохранение новой версией.`}
        className="self-center"
      />
    )
  }
  return (
    <div className="flex w-190 shrink-0 flex-col gap-3 self-start">
      <BriefBlock brief={brief} onBrief={onBrief} />
      <PlanPreview plan={plan} />
    </div>
  )
}

/** С принятым планом заявка свёрнута над ним: новая версия плана начинается с неё же */
function BriefBlock({ brief, onBrief }: { brief: EpisodeBrief; onBrief: (next: EpisodeBrief) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <section aria-label="Заявка выпуска" className="flex flex-col gap-3 rounded-panel border border-line bg-panel p-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" icon={open ? ChevronDown : ChevronRight} onClick={() => setOpen(!open)}>
          Заявка
        </Button>
        {!open && <span className="min-w-0 flex-1 truncate text-12 text-muted">{brief.idea}</span>}
      </div>
      {open && <BriefForm value={brief} onChange={onBrief} />}
    </section>
  )
}

const WORDS = ['слово', 'слова', 'слов'] as const

/** Счётчики заголовка (layout.md: через 12, с разделителем) по действующему плану; без плана — «—» */
function Counters({ plan, wordsPerMinute }: { plan: EffectivePlan | null; wordsPerMinute: number | null }) {
  const shots = plan?.shots.filter((shot) => shot.status !== 'removed') ?? null
  const words = shots?.reduce((sum, shot) => sum + countWords(shot.vo), 0) ?? null
  const items = [
    {
      label: 'Хронометраж по тексту',
      value: words !== null && wordsPerMinute ? formatTimecode((words / wordsPerMinute) * 60) : '—',
    },
    {
      label: 'Темп',
      value: wordsPerMinute ? `${wordsPerMinute} ${plural(wordsPerMinute, WORDS)}/мин` : '—',
      muted: true,
    },
    { label: 'Слова', value: words !== null ? formatCount(words) : '—' },
    { label: 'Кадры', value: shots !== null ? formatCount(shots.length) : '—' },
  ]
  return (
    <dl className="flex h-7 items-stretch gap-3">
      {items.map((item, i) => (
        <div key={item.label} className={cn('flex flex-col justify-center gap-0.5', i > 0 && 'border-l border-line pl-3')}>
          <dt className="text-11 leading-3 text-muted">{item.label}</dt>
          <dd className={cn('text-13 leading-4 font-medium', item.muted ? 'text-muted' : 'text-ink')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}
