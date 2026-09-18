import { useEffect, type RefObject } from 'react'
import { useLatest } from './useLatest'

/** pointerdown вне перечисленных узлов закрывает слой. Escape слои ловят сами через onKeyDown:
    так вложенные слои (Select внутри Dialog) закрываются по одному, изнутри наружу. */
export function useOutsidePointer(
  active: boolean,
  onOutside: () => void,
  inside: RefObject<HTMLElement | null>[],
): void {
  const latest = useLatest({ onOutside, inside })
  useEffect(() => {
    if (!active) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (latest.current.inside.some((ref) => ref.current?.contains(target))) return
      latest.current.onOutside()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [active, latest])
}
