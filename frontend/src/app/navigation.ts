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
