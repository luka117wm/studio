/* Навигация на History API: библиотеки маршрутизации в стеке нет (stack.md).
   Путь — внешнее хранилище (useSyncExternalStore), переходы — pushState + событие. */
import { useSyncExternalStore } from 'react'
import { matchRoute, type RouteMatch } from './routes'

const NAVIGATE_EVENT = 'studio:navigate'

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAVIGATE_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAVIGATE_EVENT, onChange)
  }
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname)
}

export function useRoute(): RouteMatch | null {
  return matchRoute(usePathname())
}

/** Параметр адреса (`?mode=plan`); нет — null. Меняется вместе с переходами и `setSearchParam`. */
export function useSearchParam(name: string): string | null {
  return useSyncExternalStore(subscribe, () => new URLSearchParams(window.location.search).get(name))
}

/** Поставить или убрать (`null`) параметр адреса без новой записи в истории: вид экрана, а не переход. */
export function setSearchParam(name: string, value: string | null): void {
  setSearchParams({ [name]: value })
}

/** То же для нескольких параметров одной записью: вид и его предмет (`?view=compare&shot=s061`) меняются вместе. */
export function setSearchParams(values: Record<string, string | null>): void {
  const url = new URL(window.location.href)
  for (const [name, value] of Object.entries(values)) {
    if (value === null) url.searchParams.delete(name)
    else url.searchParams.set(name, value)
  }
  navigate(`${url.pathname}${url.search}${url.hash}`, { replace: true })
}
