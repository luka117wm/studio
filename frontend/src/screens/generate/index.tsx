/* Экран 4 «Генерация» (артборд 4, режим «Сетка кадров»; устав M6, решение 8): полоса очередей 72 над всем, канон
   выпуска 280 слева (только чтение, ⌥1), сетка кадров по разделам в центре, «Голос» 320 справа (⌥3) — заглушка до M7.
   Кадры рисуются только по утверждённому плану (принцип 10): до утверждения — объяснение со ссылкой на экран 3, до
   первой пачки — главное действие «Сгенерировать N кадров (~$X)» с ценой из сметы бэкенда. Сетка и полоса живут от
   потока SSE (`api/live.ts`): сводка пачки — из события, плитки — перезапросом project.json.
   M6.8: выбор кадров (клик, ⇧-клик, ⌘A, Esc) и полоса выбора 44 с моделью; действия плитки и R; «С правкой…».
   Модель — одна на экран (полоса выбора), по умолчанию — профиль канала из каталога. */
import { FileText, Mic, Palette, Sparkles } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { EpisodeListItem } from '@/types/episode'
import type { Job } from '@/types/job'
import { budgetRefusal } from '../../api/client'
import { useCatalog, useEpisodeBatch, useGenerate, useGenerateEstimate, usePlan, useProject, useRedraw } from '../../api/queries'
import { EpisodeScreen } from '../../app/EpisodeScreen'
import { QueryError, WorkAreaSkeleton } from '../../app/BackendState'
import { navigate } from '../../app/navigation'
import { ScreenLayout } from '../../app/ScreenLayout'
import { paths, type RouteParams } from '../../app/routes'
import { isEditable } from '../../app/keyboard'
import { useHotkeySet } from '../../app/useHotkey'
import { useStatusNote } from '../../app/useStatusNote'
import { useUiStore } from '../../store/uiStore'
import { Button, EmptyState, cn } from '../../ui'
import { plural } from '../episodes/board'
import { CanonSide } from './CanonSide'
import { EditActionDialog } from './EditActionDialog'
import { QueueStrip } from './QueueStrip'
import { SelectionBar } from './SelectionBar'
import { ShotGrid } from './ShotGrid'
import { VoiceStub } from './VoiceStub'
import { SHOTS, gridSections, hasImages, headerNote, statusNote } from './grid'
import { useSelection } from './selection'
import { useRedrawOutcome } from './useRedrawOutcome'

export function GenerateScreen({ params }: { params: RouteParams }) {
  return <EpisodeScreen params={params}>{(episode) => <Generate episode={episode} />}</EpisodeScreen>
}

const usd = (micro: number) => micro / 1_000_000

function Generate({ episode }: { episode: EpisodeListItem }) {
  const plan = usePlan(episode.id)
  const project = useProject(episode.id)
  const batch = useEpisodeBatch(episode.id)
  const approved = Boolean(plan.data && plan.data.approved_version === plan.data.version)
  const estimate = useGenerateEstimate(episode.id, approved)
  const generate = useGenerate(episode.id)
  const pushToast = useUiStore((s) => s.pushToast)
  const sections = useMemo(() => (plan.data ? gridSections(plan.data, project.data) : []), [plan.data, project.data])
  useStatusNote(approved && project.data ? statusNote(sections) : null)

  const order = useMemo(() => sections.flatMap((section) => section.shots.map((shot) => shot.id)), [sections])
  const selection = useSelection(order)
  const catalog = useCatalog('images')
  const [modelChoice, setModel] = useState<string | null>(null)
  const model = modelChoice ?? catalog.data?.default ?? null
  const redraw = useRedraw(episode.id)
  const outcome = useRedrawOutcome()
  const [editing, setEditing] = useState<string | null>(null)

  const drawn = hasImages(project.data)
  const unfinished = batch.data ? !batch.data.finished : false
  const toDraw = estimate.data?.count ?? 0

  const start = async () => {
    if (generate.isPending) return // второй клик поставил бы те же кадры и получил бы 409 «заняты»
    try {
      const result = await generate.mutateAsync({})
      const count = result.batch.jobs.total
      pushToast({ id: 'generate', message: `В очереди ${count} ${plural(count, SHOTS)}`, status: 'ready' })
    } catch {
      // Показ — из generate.error
    }
  }
  const startAction = estimate.data && toDraw > 0 ? { label: `Сгенерировать ${toDraw} ${plural(toDraw, SHOTS)}`, price: usd(estimate.data.total.usd_micro), onClick: () => void start() } : null

  // Сетка уже есть, а рисовать ещё есть что (новые кадры плана, stale, отменённая пачка) — то же действие в шапке
  const headerAction =
    approved && (drawn || batch.data) && !unfinished && startAction ? (
      <Button variant="primary" price={startAction.price} loading={generate.isPending} loadingLabel="Ставлю в очередь" onClick={startAction.onClick}>
        {startAction.label}
      </Button>
    ) : undefined

  /** «Перерисовать» плитки и R: следующий вариант моделью полосы; отказ — тостом с текстом бэкенда */
  const redrawShot = async (shotId: string) => {
    try {
      const job = await redraw.mutateAsync({ shotId, model })
      outcome.watchJob(job, shotId) // тост «Перерисовано» — по концу джоба, плитка тем временем «в очереди»
    } catch (error) {
      pushToast({ id: `redraw-refused-${shotId}`, message: budgetRefusal(error)?.message ?? (error as Error).message, status: 'failed' })
    }
  }

  const grid = approved && Boolean(plan.data) && project.data !== undefined && (drawn || Boolean(batch.data))
  const failedIds = useMemo(
    () => new Set(sections.flatMap((section) => section.shots.filter((shot) => shot.status === 'failed').map((shot) => shot.id))),
    [sections],
  )
  /** Кадр под фокусом клавиатуры — плитка, на кнопке выбора или действии которой стоит фокус */
  const focusedShot = () => (document.activeElement instanceof HTMLElement ? (document.activeElement.closest<HTMLElement>('[data-shot]')?.dataset.shot ?? null) : null)
  useHotkeySet([
    {
      id: 'generate-select-all',
      keys: 'Mod+A',
      scope: 'screen',
      group: 'Генерация',
      description: 'Выбрать все кадры',
      when: () => grid && !isEditable(document.activeElement),
      handler: () => selection.selectAll(),
    },
    {
      id: 'generate-clear',
      keys: 'Escape',
      scope: 'screen',
      group: 'Генерация',
      description: 'Снять выбор',
      when: () => selection.selected.length > 0,
      handler: () => selection.clear(),
    },
    {
      id: 'generate-redraw',
      keys: 'R',
      scope: 'screen',
      group: 'Генерация',
      description: 'Перерисовать кадр под фокусом',
      hint: 'перерисовать кадр',
      when: () => grid,
      handler: () => {
        const shotId = focusedShot()
        if (shotId) void redrawShot(shotId)
      },
    },
  ])

  const editShot = editing ? plan.data?.shots.find((shot) => shot.id === editing) : undefined
  const onQueued = (job: Job, shotId: string) => outcome.watchJob(job, shotId)

  const center = () => {
    const error = plan.error ?? project.error
    if (error) return <QueryError error={error} className="p-4" />
    if (plan.data === undefined || project.data === undefined) return <WorkAreaSkeleton />
    if (plan.data === null) {
      return (
        <Centered>
          <EmptyState
            icon={FileText}
            title="План ещё не импортирован"
            description="Кадры рисуются по плану выпуска. Соберите его на экране «Сценарий» и утвердите."
            secondary={{ label: 'Открыть сценарий', onClick: () => navigate(paths.stage(episode.id, 'script')) }}
          />
        </Centered>
      )
    }
    if (!approved) {
      return (
        <Centered>
          <EmptyState
            icon={FileText}
            title="План не утверждён"
            description="Генерация начнётся после «Утвердить план» на экране «Сценарий»: кадры рисуются только по утверждённому плану."
            secondary={{ label: 'Открыть сценарий', onClick: () => navigate(paths.stage(episode.id, 'script')) }}
          />
        </Centered>
      )
    }
    if (!drawn && batch.data === undefined) return <WorkAreaSkeleton />
    if (!drawn && batch.data === null) {
      const skipped = estimate.data?.skipped ?? []
      return (
        <Centered>
          <EmptyState
            icon={Sparkles}
            title="Кадры не сгенерированы"
            description="Пачка рисует кадры по утверждённому плану и канону выпуска. Один кадр не удался — пачка продолжается."
            primary={startAction ?? undefined}
            hint={
              skipped.length
                ? `Не встанут в очередь: ${skipped.length} ${plural(skipped.length, SHOTS)} — ${skipped[0]!.reason}`
                : 'Бюджет выпуска и месяца проверяется суммой до постановки в очередь'
            }
          />
          {estimate.error && <Alert message={estimate.error.message} />}
          {generate.error && <Alert message={generate.error.message} />}
        </Centered>
      )
    }
    return (
      <>
        {generate.error && <Alert message={generate.error.message} className="border-b border-line px-4 py-2" />}
        <ShotGrid
          episodeId={episode.id}
          sections={sections}
          selected={selection.selection.ids}
          model={model}
          onSelect={selection.click}
          onRedraw={(shotId) => void redrawShot(shotId)}
          onEdit={setEditing}
          onOpen={(shotId) => navigate(paths.shot(episode.id, shotId))}
        />
        <SelectionBar
          episodeId={episode.id}
          selected={selection.selected}
          failed={selection.selected.filter((id) => failedIds.has(id)).length}
          catalog={catalog.data}
          model={model}
          onModel={setModel}
          onQueued={(summary) => {
            outcome.watchBatch(summary)
            selection.clear()
          }}
        />
        {editShot && (
          <EditActionDialog
            episodeId={episode.id}
            shot={editShot}
            error={project.data?.shots[editShot.id]?.error ?? null}
            model={model}
            onClose={() => setEditing(null)}
            onQueued={onQueued}
          />
        )}
      </>
    )
  }

  return (
    <ScreenLayout
      header={{ title: 'Генерация', note: plan.data ? headerNote(sections) : undefined, actions: headerAction }}
      strip={{ title: 'Очереди генерации', children: <QueueStrip episodeId={episode.id} batch={batch.data} error={batch.error} /> }}
      left={{
        kind: 'canon',
        title: 'Канон выпуска',
        note: 'только чтение',
        icon: Palette,
        collapsible: true,
        children: <CanonSide channel={episode.channel} episodeId={episode.id} version={plan.data?.version ?? null} />,
      }}
      right={{ title: 'Голос', icon: Mic, collapsible: true, children: <VoiceStub /> }}
    >
      {center()}
    </ScreenLayout>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4">{children}</div>
}

/** Отказ бэкенда текстом: бюджет суммой, рисовать нечего, кадры заняты */
function Alert({ message, className }: { message: string; className?: string }) {
  return (
    <p role="alert" className={cn('text-12 text-failed-text', className ?? 'max-w-96 text-center')}>
      {message}
    </p>
  )
}
