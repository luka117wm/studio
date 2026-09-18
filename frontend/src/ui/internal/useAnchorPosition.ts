import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'

/** Координаты всплывающего слоя в viewport (position: fixed) плюс ширина якоря. */
export interface AnchorPosition {
  top: number
  left: number
  anchorWidth: number
}

const GAP = 4

/** Позиция слоя относительно якоря; пересчёт при открытии, ресайзе и скролле.
    Слой переворачивается вверх, если снизу не помещается. */
export function useAnchorPosition(
  anchorRef: RefObject<HTMLElement | null>,
  layerRef: RefObject<HTMLElement | null>,
  active: boolean,
  placement: Placement = 'bottom-start',
): AnchorPosition | null {
  const [position, setPosition] = useState<AnchorPosition | null>(null)

  useLayoutEffect(() => {
    if (!active) return
    const update = () => {
      const anchor = anchorRef.current
      const layer = layerRef.current
      if (!anchor || !layer) return
      const a = anchor.getBoundingClientRect()
      const l = layer.getBoundingClientRect()
      const wantTop = placement.startsWith('top')
      const fitsBelow = a.bottom + GAP + l.height <= window.innerHeight
      const fitsAbove = a.top - GAP - l.height >= 0
      const above = wantTop ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove
      const top = above ? a.top - GAP - l.height : a.bottom + GAP
      const alignEnd = placement.endsWith('end')
      const rawLeft = alignEnd ? a.right - l.width : a.left
      const left = Math.max(GAP, Math.min(rawLeft, window.innerWidth - l.width - GAP))
      setPosition({ top, left, anchorWidth: a.width })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [active, placement, anchorRef, layerRef])

  return active ? position : null
}

/** Инлайн-стиль слоя: координаты — вычисляемая геометрия, поэтому style, а не класс.
    До первого замера слой стоит в (0, 0), а не visibility: hidden — скрытый слой нельзя сфокусировать,
    а замер идёт в layout-эффекте до отрисовки, так что мигания нет. */
export function layerStyle(position: AnchorPosition | null, matchAnchorWidth = false): CSSProperties {
  if (!position) return { position: 'fixed', top: 0, left: 0 }
  return {
    position: 'fixed',
    top: position.top,
    left: position.left,
    minWidth: matchAnchorWidth ? position.anchorWidth : undefined,
  }
}
