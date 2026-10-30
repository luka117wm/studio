/* Действия кадра поверх плитки при наведении и фокусе (артборд 4; устав M6, решение 8): «Перерисовать» — следующий
   вариант выбранной в полосе моделью, цена в подсказке из сметы бэкенда; «С правкой…» — диалог правки действия;
   «Открыть в монтаже» — экран монтажа с кадром. У отказа сверху причина целиком, «С правкой…» — первым: отказ фильтра
   лечится правкой действия. Фон слоя пропускает указатель к кнопке выбора плитки: слой встаёт по наведению, и клик,
   начатый до него, иначе ушёл бы общему предку и выбор бы не сработал. «Сделать опорным» и «Смягчить через Claude» —
   вне M6 (решение пользователя). */
import { useRedrawEstimate } from '../../api/queries'
import { Tooltip, formatPrice } from '../../ui'
import type { TileShot } from './grid'

export interface ShotActionHandlers {
  onRedraw: (shotId: string) => void
  onEdit: (shotId: string) => void
  onOpen: (shotId: string) => void
}

export interface ShotActionsProps extends ShotActionHandlers {
  episodeId: string
  shot: TileShot
  model: string | null
}

const ACTION =
  'pointer-events-auto flex h-4.5 max-w-full items-center truncate rounded-control px-2 text-left text-11 font-medium text-ink hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent'

export function ShotActions({ episodeId, shot, model, onRedraw, onEdit, onOpen }: ShotActionsProps) {
  const estimate = useRedrawEstimate(episodeId, shot.id, model, true)
  const failed = shot.status === 'failed'
  const price = estimate.data
    ? `Вариант ${estimate.data.variant} — ${formatPrice(estimate.data.usd.usd_micro / 1_000_000)}`
    : estimate.error
      ? estimate.error.message
      : 'Считаю цену…'

  const redraw = (
    <Tooltip key="redraw" content={price}>
      <button type="button" className={ACTION} onClick={() => onRedraw(shot.id)}>
        Перерисовать
      </button>
    </Tooltip>
  )
  const edit = (
    <button key="edit" type="button" className={ACTION} onClick={() => onEdit(shot.id)}>
      С правкой…
    </button>
  )
  const open = (
    <button key="open" type="button" className={ACTION} onClick={() => onOpen(shot.id)}>
      Открыть в монтаже
    </button>
  )

  return (
    <div
      role="group"
      aria-label={`Действия кадра ${shot.id}`}
      className="pointer-events-none absolute inset-0 flex flex-col items-start justify-center gap-0.5 bg-app/90 p-1"
    >
      {failed && shot.error && (
        <p className="line-clamp-2 px-2 text-11 text-failed-text">
          {shot.error}
        </p>
      )}
      {failed ? [edit, redraw, open] : [redraw, edit, open]}
    </div>
  )
}
