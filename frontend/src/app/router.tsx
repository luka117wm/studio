/* Рендер экрана по маршруту. Заголовок вкладки и открытый выпуск — из пути. */
import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import { episodeById } from '../mocks/fixtures'
import { CanonScreen } from '../screens/canon'
import { EditScreen } from '../screens/edit'
import { EpisodesScreen } from '../screens/episodes'
import { ExportScreen } from '../screens/export'
import { GenerateScreen } from '../screens/generate'
import { IdeasScreen } from '../screens/ideas'
import { InspectorScreen } from '../screens/inspector'
import { PublishScreen } from '../screens/publish'
import { ScriptScreen } from '../screens/script'
import { SettingsScreen } from '../screens/settings'
import { useUiStore } from '../store/uiStore'
import { NotFoundScreen } from './NotFoundScreen'
import { navigate, usePathname } from './navigation'
import { matchRoute, paths, type RouteParams, type ScreenId } from './routes'

// Каталог состояний не попадает в production-бандл: ветка с lazy-импортом вырезается сборкой
const LazyStatesScreen = import.meta.env.DEV ? lazy(() => import('../screens/states').then((m) => ({ default: m.StatesScreen }))) : null

function StatesScreen(props: { params: RouteParams }) {
  if (!LazyStatesScreen) return <NotFoundScreen pathname="/states" />
  return (
    <Suspense fallback={null}>
      <LazyStatesScreen {...props} />
    </Suspense>
  )
}

const SCREENS: Record<ScreenId, (props: { params: RouteParams }) => ReactNode> = {
  episodes: EpisodesScreen,
  ideas: IdeasScreen,
  script: ScriptScreen,
  generate: GenerateScreen,
  edit: EditScreen,
  inspector: InspectorScreen,
  export: ExportScreen,
  publish: PublishScreen,
  settings: SettingsScreen,
  states: StatesScreen,
  canon: CanonScreen,
}

/** Рендер экрана по пути; `/` → выпуски. Заголовок вкладки и открытый выпуск — из маршрута. */
export function Router() {
  const pathname = usePathname()
  const match = matchRoute(pathname)
  const openEpisode = useUiStore((s) => s.openEpisode)

  useEffect(() => {
    if (pathname === '/' || pathname === '') navigate(paths.episodes, { replace: true })
  }, [pathname])

  useEffect(() => {
    document.title = match ? `${match.route.title} — Studio` : 'Нет такого экрана — Studio'
  }, [match])

  const episodeId = match?.params.episodeId
  useEffect(() => {
    if (episodeId && episodeById(episodeId)) openEpisode(episodeId)
  }, [episodeId, openEpisode])

  if (pathname === '/' || pathname === '') return null
  if (!match) return <NotFoundScreen pathname={pathname} />
  const Screen = SCREENS[match.route.screen]
  return <Screen params={match.params} />
}
