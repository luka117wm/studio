/* Плитка кадра в сетке экрана 4 (артборд 4, `ShotCard` в components.md): 16:9, миниатюра 320 выбранной версии или фон
   статуса, номер кадра (у сбоя — цвет fail), глиф статуса по design/CLAUDE.md, точки версий («Версия 2 из 3,
   выбрана»), у сбоя — причина внизу, целиком — в подсказке кнопки выбора (под слоем действий полосу не дублируем).
   Вся площадь — кнопка выбора (клик, ⇧-клик — диапазон, Space с клавиатуры); выбранная — рамка accent и галочка.
   Наведение и фокус с клавиатуры открывают действия кадра (`ShotActions`, M6.8): они монтируются только у активной
   плитки — у сотни плиток нет сотни смет. Фокус от нажатия мышью слоя не держит: иначе действия закрывали бы картинку
   выбранного кадра и после ухода мыши (артборд 4 — только наведение; найдено сверкой M6.12). Пометки проверок выбранной версии (M6.10) — warning-треугольники перед глифом статуса, текст —
   в подсказке плитки и имени треугольника; выбор и действия от них не зависят. */
import { Check } from 'lucide-react'
import { useRef, useState, type FocusEvent } from 'react'
import { shotThumb } from '../../api/queries'
import { StatusGlyph, cn } from '../../ui'
import { ICON_STROKE } from '../../ui/internal/icon'
import { ShotActions, type ShotActionHandlers } from './ShotActions'
import { markLabels } from './checks'
import { TILE_GLYPH, TILE_LABEL, type TileShot } from './grid'

export interface ShotTileProps extends ShotActionHandlers {
  episodeId: string
  shot: TileShot
  selected: boolean
  /** Модель перерисовки — выбранная в полосе выбора */
  model: string | null
  /** Tab попадает в сетку только на этот кадр (roving tabindex) */
  tabbable: boolean
  /** Проверка анахронизмов выключена в профиле: её пометки — «проверено раньше» */
  checkedEarlier: boolean
  onSelect: (id: string, shift: boolean) => void
  onFocusShot: (id: string) => void
}

export function ShotTile({ episodeId, shot, selected, model, tabbable, checkedEarlier, onSelect, onFocusShot, onRedraw, onEdit, onOpen }: ShotTileProps) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  // Клик с клавиатуры (Space, Enter) — без координат и без ⇧ в событии: ⇧ помним с keydown
  const shift = useRef(false)
  // Фокус пришёл от нажатия указателем — у мыши для действий есть наведение
  const pressed = useRef(false)
  const glyph = TILE_GLYPH[shot.status]
  const failed = shot.status === 'failed'
  const generating = shot.status === 'generating'
  const pictured = shot.version !== null
  const active = hovered || focused
  // Подпись над картинкой читается на подложке, на пустом кадре подложка не нужна
  const backing = pictured ? 'rounded-control bg-app/70 px-1' : undefined
  const marks = markLabels(shot.marks, checkedEarlier)
  const stale = shot.status === 'stale' ? shot.staleReasons : []
  const hint = [...stale, ...marks].join('; ')

  const onFocus = () => {
    setFocused(!pressed.current)
    pressed.current = false
  }
  const onBlur = (e: FocusEvent<HTMLLIElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    pressed.current = false
    setFocused(false)
  }

  return (
    <li
      aria-label={`${shot.id}, ${TILE_LABEL[shot.status]}`}
      data-shot={shot.id}
      data-status={shot.status}
      data-selected={selected || undefined}
      title={hint || undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={() => {
        pressed.current = true
      }}
      onFocus={onFocus}
      onBlur={onBlur}
      className={cn(
        'relative aspect-video overflow-hidden rounded-clip border',
        shot.status === 'queued' ? 'bg-strip' : 'bg-hover',
        failed ? 'border-failed' : selected ? 'border-accent' : generating ? 'border-accent/50' : 'border-line',
      )}
    >
      {pictured && (
        <img
          src={shotThumb(episodeId, shot.id, shot.version!)}
          alt=""
          loading="lazy"
          decoding="async"
          className="pointer-events-none absolute inset-0 size-full object-cover"
        />
      )}
      <button
        type="button"
        data-tile
        aria-label={`Выбрать ${shot.id}`}
        aria-pressed={selected}
        title={failed && shot.error ? shot.error : undefined}
        tabIndex={tabbable ? 0 : -1}
        onKeyDown={(e) => {
          shift.current = e.shiftKey
        }}
        onFocus={() => onFocusShot(shot.id)}
        onClick={(e) => onSelect(shot.id, e.shiftKey || (e.detail === 0 && shift.current))}
        className="absolute inset-0 cursor-pointer rounded-clip outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      />
      <span className={cn('pointer-events-none absolute top-1 left-1 font-script text-11', failed ? 'text-failed-text' : 'text-muted', backing)}>
        {shot.id}
      </span>
      {(glyph || marks.length > 0) && (
        <span className={cn('pointer-events-none absolute top-1 right-1 flex items-center gap-1', backing)}>
          {generating && <span className="text-11 text-generating">рисуется</span>}
          {marks.map((label) => (
            <StatusGlyph key={label} status="warning" label={label} />
          ))}
          {glyph && <StatusGlyph status={glyph} label={TILE_LABEL[shot.status]} />}
        </span>
      )}
      {selected && (
        <span aria-hidden className="pointer-events-none absolute bottom-1 left-1 flex size-3.5 items-center justify-center rounded-control bg-accent text-accent-ink">
          <Check className="size-3" strokeWidth={ICON_STROKE * 2} />
        </span>
      )}
      {shot.versions.length > 0 && (
        <span className="pointer-events-none absolute right-1 bottom-1 flex gap-0.75">
          {shot.versions.map((version) => {
            const chosen = version === shot.version
            const label = `Версия ${version} из ${shot.versions.length}${chosen ? ', выбрана' : ''}`
            return (
              <span key={version} role="img" aria-label={label} title={label} className={cn('size-1.25 rounded-full', chosen ? 'bg-accent' : 'bg-disabled')} />
            )
          })}
        </span>
      )}
      {failed && shot.error && !active && (
        <p className="pointer-events-none absolute inset-x-0 bottom-0 line-clamp-2 border-t border-failed bg-app/90 px-2 py-1 text-11 text-failed-text">
          {shot.error}
        </p>
      )}
      {generating && <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-0.75 bg-accent" />}
      {active && <ShotActions episodeId={episodeId} shot={shot} model={model} onRedraw={onRedraw} onEdit={onEdit} onOpen={onOpen} />}
    </li>
  )
}
