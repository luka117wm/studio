/* Каркас: TopBar 44 / (StageRail 56 + экран) / StatusBar 24. Прокручивается только содержимое панелей. */
import { Router } from './router'
import { StageRail } from './StageRail'
import { StatusBar } from './StatusBar'
import { TopBar } from './TopBar'

export function AppShell() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-app text-13 text-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <StageRail />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Router />
        </main>
      </div>
      <StatusBar />
    </div>
  )
}
