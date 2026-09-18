import { useEffect, type RefObject } from 'react'
import { focusables } from './focus'

/** Ловушка фокуса модального слоя: фокус внутрь при открытии, Tab по кольцу, возврат на триггер при закрытии. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const root = ref.current
    if (!root) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ;(focusables(root)[0] ?? root).focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = focusables(root)
      const current = document.activeElement
      if (items.length === 0) {
        e.preventDefault()
        root.focus()
        return
      }
      const first = items[0]!
      const last = items[items.length - 1]!
      if (!(current instanceof Node) || !root.contains(current)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && (current === first || current === root)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && current === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [ref, active])
}
