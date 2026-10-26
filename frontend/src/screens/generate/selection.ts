/* Выбор кадров на сетке экрана 4 (артборд 4; устав M6, решение 8): клик переключает кадр и ставит якорь, ⇧-клик
   добавляет диапазон от якоря по порядку плана (в обе стороны), ⌘A — все кадры плана, Esc — снять. Чистые функции над
   порядком кадров и хук экрана; выбранное, чего больше нет в плане (новая версия плана), отбрасывается. */
import { useMemo, useState } from 'react'

export interface Selection {
  ids: ReadonlySet<string>
  /** Кадр последнего клика без ⇧ — начало диапазона */
  anchor: string | null
}

export const EMPTY: Selection = { ids: new Set(), anchor: null }

export function clickShot(selection: Selection, order: readonly string[], id: string, shift: boolean): Selection {
  const from = selection.anchor === null ? -1 : order.indexOf(selection.anchor)
  const to = order.indexOf(id)
  if (shift && from !== -1 && to !== -1 && from !== to) {
    const ids = new Set(selection.ids)
    for (const shot of order.slice(Math.min(from, to), Math.max(from, to) + 1)) ids.add(shot)
    return { ids, anchor: selection.anchor }
  }
  const ids = new Set(selection.ids)
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  return { ids, anchor: id }
}

export function selectAll(selection: Selection, order: readonly string[]): Selection {
  return { ids: new Set(order), anchor: selection.anchor ?? order[0] ?? null }
}

/** Только кадры плана; ничего не выпало — тот же объект (без лишнего рендера) */
export function prune(selection: Selection, order: readonly string[]): Selection {
  const known = new Set(order)
  if ([...selection.ids].every((id) => known.has(id)) && (selection.anchor === null || known.has(selection.anchor))) return selection
  return {
    ids: new Set([...selection.ids].filter((id) => known.has(id))),
    anchor: selection.anchor !== null && known.has(selection.anchor) ? selection.anchor : null,
  }
}

/** Выбор экрана над порядком кадров плана; `order` — стабильный массив (useMemo у вызывающего) */
export function useSelection(order: readonly string[]) {
  const [state, setState] = useState<Selection>(EMPTY)
  const selection = useMemo(() => prune(state, order), [state, order])
  // Выбранные — по порядку плана: в таком порядке их ставит пачка
  const selected = useMemo(() => order.filter((id) => selection.ids.has(id)), [order, selection])
  return {
    selection,
    selected,
    click: (id: string, shift: boolean) => setState((current) => clickShot(prune(current, order), order, id, shift)),
    selectAll: () => setState((current) => selectAll(current, order)),
    clear: () => setState(EMPTY),
  }
}
