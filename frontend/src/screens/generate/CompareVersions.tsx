/* Режим «Сравнение версий» экрана 4 (артборд 4; устав M6, решение 8; M6.9): версии одного кадра карточками рядом —
   картинка 16:9 (миниатюра 320, по клику — файл), модель, seed, время, цена, соответствие канону — и выбор версии,
   которая идёт в монтаж (`…/images/{version}/choose`). Невыбранные не скрываются: они в истории кадра. «Добавить
   версию» — `redraw` моделью выбранной версии с ценой из сметы бэкенда; новая карточка встаёт справа штриховкой
   «рисуется» и сменяется картинкой, когда project.json принесёт версию (SSE). Выбор у готового кадра не меняется сам
   (E-1, docs/generation.md). Карточки прокручиваются горизонтально, по три в окне. «Сделать опорным» — вне M6. */
import { Check } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Job } from '@/types/job'
import type { PlanShot } from '@/types/plan'
import type { Project } from '@/types/project'
import type { StageCatalog } from '@/types/provider'
import { budgetRefusal } from '../../api/client'
import { shotFile, shotThumb, useChooseVersion, useJobs, useRedraw, useRedrawEstimate } from '../../api/queries'
import { formatUnitUsd, formatUsd } from '../../app/format'
import { useUiStore } from '../../store/uiStore'
import { Button, StatusGlyph, cn } from '../../ui'
import { HATCH } from '../../ui/internal/hatch'
import { ICON_STROKE } from '../../ui/internal/icon'
import { statusTextClass } from '../../ui/status'
import type { RedrawAction } from './useRedrawOutcome'
import { formatCreated, pendingCards, versionCards, type PendingCard, type TrackedJob, type VersionCard } from './versions'

export interface CompareVersionsProps {
  episodeId: string
  /** Кадр действующего плана: действие с правками и что поправлено */
  shot: PlanShot
  sectionTitle: string
  project: Project
  catalog: StageCatalog | undefined
  /** Модель экрана (полоса выбора) — если модели версий нет в каталоге */
  model: string | null
  onQueued: (job: Job, shotId: string, action: RedrawAction) => void
}

const NOTE = 'Выбранная версия идёт в монтаж. Остальные остаются в истории кадра и доступны в любой момент.'

export function CompareVersions({ episodeId, shot, sectionTitle, project, catalog, model, onQueued }: CompareVersionsProps) {
  const state = project.shots[shot.id]
  const cards = versionCards(project, shot.id)
  const chosen = state?.image_version ?? null
  const staleReasons = state?.status === 'stale' ? state.stale_reasons : []
  const edited = shot.overridden.includes('image.prompt')
  const [tracked, setTracked] = useState<TrackedJob[]>([])
  const jobs = useJobs().data?.items
  const pending = pendingCards(tracked, jobs, cards, state?.status ?? shot.status)
  const strip = useRef<HTMLUListElement>(null)
  const pushToast = useUiStore((s) => s.pushToast)
  // Новая карточка — справа: лента едет к ней, когда карточка уже в DOM (рендер после ответа `redraw` идёт отдельной
  // задачей — прокрутка сразу после ответа не находила карточки, найдено вживую)
  useEffect(() => {
    if (tracked.length && strip.current) strip.current.scrollLeft = strip.current.scrollWidth
  }, [tracked.length])

  // «Добавить версию» — той же моделью, что выбранная версия (артборд: ~$0.07 у Nano Banana 2); её нет в каталоге —
  // моделью последней версии, затем моделью экрана
  const known = (key: string | null | undefined) => (key && catalog?.models.some((entry) => entry.key === key) ? key : null)
  const redrawModel = known(cards.find((card) => card.version === chosen)?.model) ?? known(cards.at(-1)?.model) ?? model
  const estimate = useRedrawEstimate(episodeId, shot.id, redrawModel, true)
  const redraw = useRedraw(episodeId)
  const choose = useChooseVersion(episodeId)

  const pick = async (version: number) => {
    try {
      await choose.mutateAsync({ shotId: shot.id, version })
      pushToast({ id: `choose-${shot.id}`, message: `Выбрана версия ${version}, остальные в истории кадра`, status: 'ready' })
    } catch (error) {
      pushToast({ id: `choose-refused-${shot.id}`, message: (error as Error).message, status: 'failed' })
    }
  }

  const add = async () => {
    if (redraw.isPending) return
    try {
      const job = await redraw.mutateAsync({ shotId: shot.id, model: redrawModel })
      setTracked((list) => [...list, { jobId: job.id, variant: Number(job.payload.variant ?? 0) }])
      onQueued(job, shot.id, 'add')
    } catch (error) {
      pushToast({ id: `redraw-refused-${shot.id}`, message: budgetRefusal(error)?.message ?? (error as Error).message, status: 'failed' })
    }
  }

  const modelLabel = (card: VersionCard) => catalog?.models.find((entry) => entry.key === card.model)?.label ?? card.modelId ?? card.model ?? '—'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line bg-strip px-3">
        <h2 className="text-13 font-semibold text-ink">Версии кадра {shot.id}</h2>
        <span className="text-12 text-muted">{sectionTitle}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className="flex items-start gap-2 rounded-control border border-line bg-panel p-2">
          <p aria-label="Действие кадра" className="min-w-0 flex-1 font-script text-12 leading-4.5 text-muted">
            {shot.image.prompt}
          </p>
          {edited && (
            <span title="Действие поправлено вручную" className="shrink-0 rounded-control bg-accent-deep/40 px-1 text-11 text-ink">
              правка
            </span>
          )}
        </div>

        {cards.length === 0 && pending.length === 0 ? (
          <p className="text-12 text-muted">У кадра ещё нет версий — «Добавить версию» нарисует первую.</p>
        ) : (
          <ul
            ref={strip}
            aria-label={`Версии кадра ${shot.id}`}
            className="grid shrink-0 auto-cols-[calc((100%_-_24px)/3)] grid-flow-col gap-3 overflow-x-auto pb-1"
          >
            {cards.map((card) => (
              <VersionItem
                key={card.version}
                episodeId={episodeId}
                shotId={shot.id}
                card={card}
                total={cards.length}
                chosen={card.version === chosen}
                staleReasons={card.version === chosen ? staleReasons : []}
                modelLabel={modelLabel(card)}
                busy={choose.isPending}
                onPick={() => void pick(card.version)}
              />
            ))}
            {pending.map((item) => (
              <PendingItem key={item.key} item={item} />
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2 rounded-panel border border-line bg-panel p-2">
          <p className="text-12 text-muted">{NOTE}</p>
          {estimate.error && (
            <p role="alert" className="text-12 text-failed-text">
              {estimate.error.message}
            </p>
          )}
          <Button
            size="sm"
            className="ml-auto shrink-0"
            price={estimate.data ? estimate.data.usd.usd_micro / 1_000_000 : undefined}
            disabled={!estimate.data}
            loading={redraw.isPending}
            loadingLabel="Ставлю в очередь"
            title={estimate.data ? `Вариант ${estimate.data.variant}` : undefined}
            onClick={() => void add()}
          >
            Добавить версию
          </Button>
        </div>
      </div>
    </div>
  )
}

interface VersionItemProps {
  episodeId: string
  shotId: string
  card: VersionCard
  total: number
  chosen: boolean
  staleReasons: string[]
  modelLabel: string
  busy: boolean
  onPick: () => void
}

function VersionItem({ episodeId, shotId, card, total, chosen, staleReasons, modelLabel, busy, onPick }: VersionItemProps) {
  const label = `версия ${card.version} из ${total}`
  const rows: [string, string, string?][] = [
    ['Модель', modelLabel, 'text-ink'],
    ['Seed', card.seed === null ? '—' : card.seed.toLocaleString('ru-RU')],
    ['Создана', card.createdAt ? formatCreated(card.createdAt) : '—'],
    ['Цена', card.cached ? `${formatUsd(0)}, из кэша` : formatUnitUsd(card.usdMicro), 'text-ink'],
  ]
  return (
    <li
      aria-label={`${label}${chosen ? ', выбрана' : ''}`}
      data-version={card.version}
      data-chosen={chosen || undefined}
      className={cn('flex min-w-0 flex-col rounded-panel border bg-panel', chosen ? 'border-accent' : 'border-line')}
    >
      <a
        href={shotFile(episodeId, shotId, card.version)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Открыть картинку: ${label}`}
        title="Открыть картинку версии"
        className={cn(
          'relative block aspect-video overflow-hidden rounded-t-panel border-b bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
          chosen ? 'border-accent' : 'border-line',
        )}
      >
        <img src={shotThumb(episodeId, shotId, card.version)} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
        <span className="absolute top-1.5 left-1.5 rounded-control bg-app/70 px-1 text-11 text-muted">{label}</span>
        {chosen && (
          <span className="absolute top-1.5 right-1.5 flex h-4.5 items-center gap-1 rounded-control bg-accent px-1.5 text-11 font-semibold text-accent-ink">
            <Check className="size-3" strokeWidth={ICON_STROKE * 2} aria-hidden />
            выбрана
          </span>
        )}
      </a>
      <div className="flex flex-col gap-1 p-2 text-12">
        <dl className="flex flex-col gap-1">
          {rows.map(([term, value, tone]) => (
            <Row key={term} term={term}>
              <span className={tone ?? 'text-muted'}>{value}</span>
            </Row>
          ))}
          <Row term="Соответствие канону">
            <span title={card.face.detail ?? undefined} className={cn('flex items-center gap-1', card.face.status ? statusTextClass[card.face.status] : 'text-muted')}>
              {card.face.status && <StatusGlyph status={card.face.status} label={`Сходство лица: ${card.face.word}`} />}
              {card.face.word}
            </span>
          </Row>
          {card.found.length > 0 && (
            <Row term="Анахронизмы">
              <span className="flex items-center gap-1 text-right text-warning">
                <StatusGlyph status="warning" label="Найдены анахронизмы" />
                {card.found.join(', ')}
              </span>
            </Row>
          )}
        </dl>
        {staleReasons.length > 0 && (
          <p className="flex items-start gap-1 text-11 text-warning">
            <StatusGlyph status="warning" label="Версия устарела" />
            Устарела: {staleReasons.join('; ')}
          </p>
        )}
        <div className="mt-1 flex border-t border-rule-inner pt-1.5">
          <Button size="sm" className="flex-1" disabled={chosen || busy} onClick={onPick}>
            {chosen ? 'Выбрана' : `Выбрать версию ${card.version}`}
          </Button>
        </div>
      </div>
    </li>
  )
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-muted">{term}</dt>
      <dd className="min-w-0 font-dense">{children}</dd>
    </div>
  )
}

/** Новая версия в работе: как плитка сетки — «в очереди» полым кругом, «рисуется» штриховкой по нижней кромке */
function PendingItem({ item }: { item: PendingCard }) {
  const drawing = item.label === 'рисуется'
  return (
    <li aria-label={`новая версия, ${item.label}`} aria-busy className="flex min-w-0 flex-col rounded-panel border border-accent/50 bg-panel">
      <div className="relative aspect-video overflow-hidden rounded-t-panel border-b border-line bg-strip">
        {drawing && <span aria-hidden className={cn('absolute inset-x-0 bottom-0 h-1', HATCH)} />}
        <span className={cn('absolute top-1.5 left-1.5 flex items-center gap-1 text-11', drawing ? 'text-generating' : 'text-queued-text')}>
          <StatusGlyph status={drawing ? 'generating' : 'queued'} label={item.label} />
          {item.label}
        </span>
      </div>
      <p className="p-2 text-12 text-muted">Карточка сменится картинкой, когда версия будет готова.</p>
    </li>
  )
}
