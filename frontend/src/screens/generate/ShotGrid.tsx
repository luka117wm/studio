/* Сетка кадров экрана 4 по разделам плана (артборд 4, `ShotGrid` в components.md): заголовок раздела прилипает
   (layout.md, «Скролл и прилипание»), справа — сводка раздела; плитки 5 в ряд на 1536, 6 на 1920, 8 на 2560.
   Прокручивается только сетка. Клавиатура (M6.8): в сетку — один Tab (roving tabindex), ←/→ — соседний кадр по
   порядку плана, ↑/↓ — ближайшая плитка соседнего ряда по раскладке, Space и Enter — выбор, с ⇧ — диапазон. */
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '../../ui'
import { statusTextClass } from '../../ui/status'
import { plural } from '../episodes/board'
import type { ShotActionHandlers } from './ShotActions'
import { ShotTile } from './ShotTile'
import { SHOTS, sectionNote, type GridSection } from './grid'

export interface ShotGridProps extends ShotActionHandlers {
  episodeId: string
  sections: GridSection[]
  selected: ReadonlySet<string>
  model: string | null
  onSelect: (id: string, shift: boolean) => void
  /** Плитка получила фокус: экран помнит последний кадр под фокусом — его открывает «Сравнить версии кадра» */
  onFocusShot?: (id: string) => void
}

/** Ближайшая плитка в соседнем ряду: ряды — по раскладке, а не по счёту колонок (у разделов неполные ряды) */
function verticalNeighbour(container: HTMLElement, current: HTMLElement, down: boolean): string | null {
  const rect = current.getBoundingClientRect()
  const center = rect.left + rect.width / 2
  let best: { id: string; dy: number; dx: number } | null = null
  for (const tile of container.querySelectorAll<HTMLElement>('[data-shot]')) {
    if (tile === current) continue
    const r = tile.getBoundingClientRect()
    const dy = down ? r.top - rect.bottom : rect.top - r.bottom
    if (dy < -1) continue
    const dx = Math.abs(r.left + r.width / 2 - center)
    if (!best || dy < best.dy - 1 || (Math.abs(dy - best.dy) <= 1 && dx < best.dx)) best = { id: tile.dataset.shot!, dy, dx }
  }
  return best?.id ?? null
}

export function ShotGrid({ episodeId, sections, selected, model, onSelect, onFocusShot, onRedraw, onEdit, onOpen }: ShotGridProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const order = useMemo(() => sections.flatMap((section) => section.shots.map((shot) => shot.id)), [sections])
  const tabbable = focusId !== null && order.includes(focusId) ? focusId : (order[0] ?? null)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (!target.matches('[data-tile]') || e.altKey || e.metaKey || e.ctrlKey) return
    const tile = target.closest<HTMLElement>('[data-shot]')
    if (!tile || !ref.current) return
    const index = order.indexOf(tile.dataset.shot!)
    const next =
      e.key === 'ArrowRight'
        ? order[index + 1]
        : e.key === 'ArrowLeft'
          ? order[index - 1]
          : e.key === 'ArrowDown' || e.key === 'ArrowUp'
            ? verticalNeighbour(ref.current, tile, e.key === 'ArrowDown')
            : undefined
    if (!next) return
    e.preventDefault()
    ref.current.querySelector<HTMLButtonElement>(`[data-shot="${next}"] [data-tile]`)?.focus()
  }

  return (
    <div ref={ref} data-testid="shot-grid" onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      {sections.map(({ section, shots }) => {
        const note = sectionNote(shots)
        return (
          <section key={section.id} aria-label={section.title}>
            <header className="sticky top-0 z-10 flex h-7 items-center gap-2 border-b border-line bg-app px-1">
              <h2 className="text-13 font-semibold text-ink">{section.title}</h2>
              <span className="text-12 text-muted">
                {shots.length} {plural(shots.length, SHOTS)}
              </span>
              <span className={cn('ml-auto font-dense text-11', note.status ? statusTextClass[note.status] : 'text-muted')}>{note.text}</span>
            </header>
            <ul aria-label={`Кадры: ${section.title}`} className="grid grid-cols-5 gap-2 px-1 pt-2 pb-3 min-[1920px]:grid-cols-6 min-[2560px]:grid-cols-8">
              {shots.map((shot) => (
                <ShotTile
                  key={shot.id}
                  episodeId={episodeId}
                  shot={shot}
                  selected={selected.has(shot.id)}
                  model={model}
                  tabbable={shot.id === tabbable}
                  onSelect={onSelect}
                  onFocusShot={(id) => {
                    setFocusId(id)
                    onFocusShot?.(id)
                  }}
                  onRedraw={onRedraw}
                  onEdit={onEdit}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
