/* Таблица маршрутов: экран → шаблон пути → заголовок вкладки → этап рельса.
   Экраны 1–10 и 12 артбордов; артборд 11 («Прототип и передача») — служебный, маршрута нет. */
import type { StageId } from '../types/fixtures'

export type ScreenId =
  | 'episodes'
  | 'ideas'
  | 'script'
  | 'generate'
  | 'edit'
  | 'inspector'
  | 'export'
  | 'publish'
  | 'settings'
  | 'states'
  | 'canon'

export interface Route {
  screen: ScreenId
  pattern: string
  title: string
  /** Этап рельса, который подсвечивает этот экран */
  stage: StageId | null
}

export const routes: Route[] = [
  { screen: 'episodes', pattern: '/episodes', title: 'Выпуски', stage: null },
  { screen: 'ideas', pattern: '/ideas', title: 'Идеи', stage: 'idea' },
  { screen: 'script', pattern: '/episodes/:episodeId/script', title: 'Сценарий и план', stage: 'script' },
  { screen: 'generate', pattern: '/episodes/:episodeId/generate', title: 'Генерация', stage: 'generate' },
  { screen: 'edit', pattern: '/episodes/:episodeId/edit', title: 'Монтаж', stage: 'edit' },
  { screen: 'inspector', pattern: '/episodes/:episodeId/edit/:shotId', title: 'Инспектор', stage: 'edit' },
  { screen: 'export', pattern: '/episodes/:episodeId/export', title: 'Экспорт', stage: 'export' },
  { screen: 'publish', pattern: '/episodes/:episodeId/publish', title: 'Публикация', stage: 'publish' },
  { screen: 'settings', pattern: '/settings', title: 'Настройки и расходы', stage: null },
  { screen: 'canon', pattern: '/canon', title: 'Канон', stage: null },
  // Каталог состояний (экран 10) — только в dev-сборке; в production маршрута нет
  ...(import.meta.env.DEV ? [{ screen: 'states', pattern: '/states', title: 'Состояния', stage: null } satisfies Route] : []),
]

export interface RouteParams {
  episodeId?: string
  shotId?: string
}

export interface RouteMatch {
  route: Route
  params: RouteParams
}

/** Сопоставление пути с таблицей: сегменты `:name` — параметры, остальное — точное совпадение. */
export function matchRoute(pathname: string): RouteMatch | null {
  const segments = split(pathname)
  for (const route of routes) {
    const parts = split(route.pattern)
    if (parts.length !== segments.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]!
      const segment = segments[i]!
      if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(segment)
      else if (part !== segment) {
        ok = false
        break
      }
    }
    if (ok) return { route, params }
  }
  return null
}

function split(path: string): string[] {
  return path.split('/').filter(Boolean)
}

/** Пути по имени — чтобы строки маршрутов не расползались по экранам. */
export const paths = {
  episodes: '/episodes',
  ideas: '/ideas',
  settings: '/settings',
  states: '/states',
  canon: '/canon',
  /** Экран этапа выпуска; этап «Идея» ведёт в общий бэклог идей */
  stage: (episodeId: string, stage: StageId): string =>
    stage === 'idea' ? '/ideas' : `/episodes/${encodeURIComponent(episodeId)}/${stage}`,
  shot: (episodeId: string, shotId: string): string =>
    `/episodes/${encodeURIComponent(episodeId)}/edit/${encodeURIComponent(shotId)}`,
} as const
