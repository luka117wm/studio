const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Фокусируемые потомки в порядке DOM (без проверки видимости — jsdom не считает раскладку). */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex >= 0,
  )
}

/** Кольцевой переход по списку: index + delta с заворотом. */
export function cycle(index: number, delta: number, length: number): number {
  if (length === 0) return -1
  return (((index + delta) % length) + length) % length
}
