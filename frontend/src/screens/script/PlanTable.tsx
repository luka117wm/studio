/* Таблица плана (режим «План кадров», components.md: PlanTable): 11 колонок артборда 3, строки 28, шапка 24 над
   прокруткой. Правка — в ячейке: VO и промпт — поле поверх ячейки (Enter — принять, Esc — отмена), план, движение,
   переход и анимация — Select, сила движения — NumberInput 3–25 %. Справа от промпта — предпросмотр итогового
   промпта кадра (M5.10). Клавиатура — сетка правимых ячеек и предпросмотра: ↑↓ строки, ←→ ячейки, Enter — правка
   (у предпросмотра — открыть его), Esc — выход. От 30 строк — виртуализация (react-virtuoso).
   Мультивыделения и групповой правки здесь нет — придут с инспектором кадра. */
import { FileText, RotateCcw } from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { Shot } from '@/types/director'
import type { EffectivePlan, PlanShot } from '@/types/plan'
import { useDirectorVersion } from '../../api/queries'
import { Button, Input, NumberInput, Select, StatusGlyph, Tooltip, cn } from '../../ui'
import {
  ANIMATE_OPTIONS,
  DEFAULT_TRANSITION_S,
  MOTION_OPTIONS,
  SHOT_SIZE_OPTIONS,
  TRANSITION_OPTIONS,
  heroesLabel,
  motionLabel,
  motionName,
  shotSizeLabel,
  statusOf,
  transitionLabel,
  type MotionType,
  type ShotSize,
  type TransitionType,
} from './shotLabels'
import { useShotEdit, type ShotEdit } from './useShotEdit'

/** Что ячейке нужно от правок её полей: отметка, ошибка, возврат к плану */
type CellEdit = Pick<ShotEdit<unknown>, 'overridden' | 'error' | 'reset'>

/** Виртуализация — от этого числа строк; меньше — обычный список */
export const VIRTUAL_FROM = 30

const GRID = 'grid grid-cols-[54px_104px_minmax(0,1.4fr)_minmax(0,2.1fr)_120px_92px_104px_92px_68px_56px_104px]'

const HEADERS = ['№', 'Раздел', 'VO', 'Промпт картинки', 'Герои', 'План', 'Движение', 'Переход', 'Анимация', 'SFX', 'Статус']

/** Ячейки по порядку обхода ←→: правимые и предпросмотр промпта (Enter открывает его, а не правку) */
const EDITABLE = ['vo', 'prompt', 'preview', 'size', 'motion', 'transition', 'animate'] as const
const PREVIEW_COL = EDITABLE.indexOf('preview')
type EditableColumn = (typeof EDITABLE)[number]

const STATUS_TEXT = {
  queued: 'text-queued-text',
  generating: 'text-generating',
  ready: 'text-ink',
  warning: 'text-warning',
  failed: 'text-failed-text',
} as const

interface Cursor {
  row: number
  col: number
}

export function PlanTable({ episodeId, plan, onPrompt }: { episodeId: string; plan: EffectivePlan; onPrompt: (shotId: string) => void }) {
  const version = useDirectorVersion(episodeId, plan.version)
  const planShots = useMemo(() => new Map((version.data?.shots ?? []).map((shot) => [shot.id, shot])), [version.data])
  const sections = useMemo(() => new Map(plan.sections.map((s) => [s.id, s.title])), [plan.sections])
  // Убранные кадры в плане больше не участвуют: их правка — 422
  const rows = plan.shots.filter((shot) => shot.status !== 'removed')

  const [cursor, setCursor] = useState<Cursor>({ row: 0, col: 0 })
  const [editing, setEditing] = useState<Cursor | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const virtuoso = useRef<VirtuosoHandle>(null)
  const virtual = rows.length >= VIRTUAL_FROM

  const focusCell = (next: Cursor) => {
    const find = () => grid.current?.querySelector<HTMLElement>(`[data-cell="${next.row}:${next.col}"]`)
    const target = find()
    if (target) {
      target.focus()
      return
    }
    // Строка за пределами окна виртуализации — сначала прокрутить к ней
    virtuoso.current?.scrollToIndex({ index: next.row, align: 'center' })
    requestAnimationFrame(() => find()?.focus())
  }

  const move = (next: Cursor) => {
    const clamped = {
      row: Math.max(0, Math.min(rows.length - 1, next.row)),
      col: Math.max(0, Math.min(EDITABLE.length - 1, next.col)),
    }
    setCursor(clamped)
    focusCell(clamped)
  }

  const closeEditor = () => {
    setEditing(null)
    requestAnimationFrame(() => focusCell(cursor))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeEditor()
      }
      return
    }
    const target = e.target as HTMLElement
    if (!target.dataset.cell) return
    const step: Record<string, Cursor> = {
      ArrowDown: { row: cursor.row + 1, col: cursor.col },
      ArrowUp: { row: cursor.row - 1, col: cursor.col },
      ArrowRight: { row: cursor.row, col: cursor.col + 1 },
      ArrowLeft: { row: cursor.row, col: cursor.col - 1 },
    }
    const next = step[e.key]
    if (next) {
      e.preventDefault()
      move(next)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const shot = rows[cursor.row]
      if (cursor.col === PREVIEW_COL) {
        if (shot) onPrompt(shot.id)
      } else setEditing(cursor)
    }
  }

  const row = (index: number, shot: PlanShot) => (
    <PlanRow
      key={shot.id}
      episodeId={episodeId}
      index={index}
      shot={shot}
      planShot={planShots.get(shot.id)}
      section={sections.get(shot.section) ?? shot.section}
      cursor={cursor}
      editing={editing?.row === index ? (EDITABLE[editing.col] ?? null) : null}
      onFocusCell={(col) => setCursor({ row: index, col })}
      onEdit={(col) => {
        setCursor({ row: index, col })
        setEditing({ row: index, col })
      }}
      onClose={closeEditor}
      onPrompt={() => {
        setCursor({ row: index, col: PREVIEW_COL })
        onPrompt(shot.id)
      }}
    />
  )

  return (
    <div
      ref={grid}
      role="grid"
      aria-label="План кадров"
      aria-rowcount={rows.length + 1}
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div role="row" className={cn(GRID, 'h-6 shrink-0 items-center border-b border-line bg-strip px-3 font-dense text-11 font-medium text-muted')}>
        {HEADERS.map((label, i) => (
          <div key={label} role="columnheader" className={cn('truncate pr-2', i === 9 && 'text-right')}>
            {label}
          </div>
        ))}
      </div>
      {virtual ? (
        <Virtuoso ref={virtuoso} className="min-h-0 flex-1" data={rows} itemContent={(index, shot) => row(index, shot)} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">{rows.map((shot, index) => row(index, shot))}</div>
      )}
    </div>
  )
}

interface RowProps {
  episodeId: string
  index: number
  shot: PlanShot
  planShot: Shot | undefined
  section: string
  cursor: Cursor
  editing: EditableColumn | null
  onFocusCell: (col: number) => void
  onEdit: (col: number) => void
  onClose: () => void
  onPrompt: () => void
}

function PlanRow({ episodeId, index, shot, planShot, section, cursor, editing, onFocusCell, onEdit, onClose, onPrompt }: RowProps) {
  const vo = useShotEdit(episodeId, shot, planShot, 'vo')
  const prompt = useShotEdit(episodeId, shot, planShot, 'image.prompt')
  const size = useShotEdit(episodeId, shot, planShot, 'image.shot_size')
  const motionType = useShotEdit(episodeId, shot, planShot, 'motion.type')
  const strength = useShotEdit(episodeId, shot, planShot, 'motion.strength')
  const transition = useShotEdit(episodeId, shot, planShot, 'transition_in')
  const animate = useShotEdit(episodeId, shot, planShot, 'animate.recommended')
  const status = statusOf(shot.status)

  const cell = (column: EditableColumn, display: ReactNode, edits: CellEdit[], planText: string | undefined, editor: ReactNode) => {
    const col = EDITABLE.indexOf(column)
    const overridden = edits.some((edit) => edit.overridden)
    const error = edits.map((edit) => edit.error).find(Boolean)
    const focused = cursor.row === index && cursor.col === col
    const button = (
      <button
        type="button"
        role="gridcell"
        data-cell={`${index}:${col}`}
        data-overridden={overridden || undefined}
        tabIndex={focused ? 0 : -1}
        onFocus={() => onFocusCell(col)}
        onClick={() => onEdit(col)}
        className={cn(
          'flex h-6 w-full min-w-0 items-center gap-1.5 rounded-control px-1.5 text-left hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
          overridden && 'border-l-2 border-accent-deep',
        )}
      >
        {display}
      </button>
    )
    return (
      <div className="flex min-w-0 flex-col pr-2">
        {editing === column ? (
          <div className="flex flex-col gap-1 py-0.5">
            {editor}
            {overridden && (
              <Button
                variant="ghost"
                size="sm"
                icon={RotateCcw}
                onClick={() => {
                  edits.forEach((edit) => edit.reset())
                  onClose()
                }}
              >
                Вернуть из плана
              </Button>
            )}
          </div>
        ) : overridden && planText !== undefined ? (
          <Tooltip content={`В плане: ${planText}`}>{button}</Tooltip>
        ) : (
          button
        )}
        {error && <span className="py-0.5 text-11 text-failed-text">{error}</span>}
      </div>
    )
  }

  const motion = { type: motionType.value, strength: strength.value }
  const planMotion =
    motionType.planValue !== undefined && strength.planValue !== undefined
      ? motionLabel({ type: motionType.planValue, strength: strength.planValue })
      : undefined

  return (
    <div role="row" data-shot={shot.id} className={cn(GRID, 'min-h-7 items-start border-b border-row-border px-3 pt-0.5 pb-px font-dense text-12')}>
      <div className={cn('flex h-6 items-center pr-2 font-script', shot.status === 'failed' ? 'text-failed-text' : 'text-muted')}>{shot.id}</div>
      <div className="flex h-6 min-w-0 items-center pr-2">
        <span className="truncate">{section}</span>
      </div>
      {cell(
        'vo',
        <span className="truncate font-ui">{vo.value || '— пусто —'}</span>,
        [vo],
        vo.planValue,
        <TextEditor label={`VO кадра ${shot.id}`} value={vo.value} onCommit={(v) => vo.set(v)} onClose={onClose} />,
      )}
      <div className="flex min-w-0 items-start pr-2">
        <div className="min-w-0 flex-1">
          {cell(
            'prompt',
            <span className="truncate font-script">{prompt.value}</span>,
            [prompt],
            prompt.planValue,
            <TextEditor label={`Промпт кадра ${shot.id}`} value={prompt.value} onCommit={(v) => prompt.set(v)} onClose={onClose} script />,
          )}
        </div>
        <button
          type="button"
          role="gridcell"
          data-cell={`${index}:${PREVIEW_COL}`}
          tabIndex={cursor.row === index && cursor.col === PREVIEW_COL ? 0 : -1}
          title={`Итоговый промпт кадра ${shot.id}`}
          aria-label={`Итоговый промпт кадра ${shot.id}`}
          onFocus={() => onFocusCell(PREVIEW_COL)}
          onClick={onPrompt}
          className="flex size-6 shrink-0 items-center justify-center rounded-control text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          <FileText className="size-icon" strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <div className="flex h-6 min-w-0 items-center pr-2 text-muted">
        <span className="truncate">{heroesLabel(shot.image.appearances)}</span>
      </div>
      {cell(
        'size',
        <span className="truncate">{shotSizeLabel(size.value)}</span>,
        [size],
        size.planValue && shotSizeLabel(size.planValue),
        <Select
          ariaLabel={`План кадра ${shot.id}`}
          size="sm"
          options={SHOT_SIZE_OPTIONS}
          value={size.value}
          onChange={(v) => {
            size.set(v as ShotSize)
            onClose()
          }}
        />,
      )}
      {cell(
        'motion',
        <>
          <span className="truncate">{motionName(motion.type)}</span>
          <span aria-hidden className="h-1 shrink-0 rounded-[1px] bg-track-shots" style={{ width: Math.round((motion.strength / 0.25) * 24) }} />
        </>,
        [motionType, strength],
        planMotion,
        <div className="flex flex-col gap-1">
          <Select
            ariaLabel={`Движение кадра ${shot.id}`}
            size="sm"
            options={MOTION_OPTIONS}
            value={motion.type}
            onChange={(v) => motionType.set(v as MotionType)}
          />
          {motion.type !== 'static' && (
            <NumberInput
              ariaLabel={`Сила движения кадра ${shot.id}`}
              size="sm"
              unit="%"
              min={3}
              max={25}
              value={Math.round(motion.strength * 100)}
              onChange={(v) => strength.set(Math.min(25, Math.max(3, v)) / 100)}
            />
          )}
        </div>,
      )}
      {cell(
        'transition',
        <span className="truncate">{transitionLabel(transition.value)}</span>,
        [transition],
        transition.planValue && transitionLabel(transition.planValue),
        <Select
          ariaLabel={`Переход в кадр ${shot.id}`}
          size="sm"
          options={TRANSITION_OPTIONS}
          value={transition.value.type}
          onChange={(v) => {
            const type = v as TransitionType
            const duration = type === 'cut' ? 0 : transition.value.duration || DEFAULT_TRANSITION_S
            transition.set({ type, duration })
            onClose()
          }}
        />,
      )}
      {cell(
        'animate',
        <span className={cn('truncate', animate.value ? 'text-accent' : 'text-muted')}>{animate.value ? 'да' : 'нет'}</span>,
        [animate],
        animate.planValue === undefined ? undefined : animate.planValue ? 'да' : 'нет',
        <Select
          ariaLabel={`Анимация кадра ${shot.id}`}
          size="sm"
          options={ANIMATE_OPTIONS}
          value={animate.value ? 'yes' : 'no'}
          onChange={(v) => {
            animate.set(v === 'yes')
            onClose()
          }}
        />,
      )}
      <div className={cn('flex h-6 items-center justify-end pr-2', shot.sfx.length ? 'text-track-sfx' : 'text-muted')}>{shot.sfx.length}</div>
      <div className={cn('flex h-6 items-center gap-1.5', STATUS_TEXT[status.status])}>
        <StatusGlyph status={status.status} label={status.label} />
        <span className="truncate">{status.label}</span>
      </div>
    </div>
  )
}

/** Поле поверх ячейки: Enter — принять, Esc — отмена (без записи), уход фокуса — принять */
function TextEditor({
  label,
  value,
  onCommit,
  onClose,
  script,
}: {
  label: string
  value: string
  onCommit: (value: string) => void
  onClose: () => void
  script?: boolean
}) {
  const [text, setText] = useState(value)
  const cancelled = useRef(false)
  const commit = () => {
    if (!cancelled.current && text !== value) onCommit(text)
  }
  return (
    <Input
      ariaLabel={label}
      value={text}
      onChange={setText}
      autoFocus
      className={script ? '[&_input]:font-script' : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
          cancelled.current = true
          onClose()
        } else if (e.key === 'Escape') {
          cancelled.current = true
        }
      }}
      onBlur={() => {
        commit()
        cancelled.current = true
        onClose()
      }}
    />
  )
}
