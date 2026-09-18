/* Каркас: TopBar 44 / (StageRail 56 + экран) / StatusBar 24. Прокручивается только содержимое панелей.
   Порядок Tab совпадает с визуальным: skip-link → верхняя панель → рельс → левая панель → рабочая зона →
   правая колонка → нижняя панель. Кольцо фокуса — глобальное из base.css. */
import type { MouseEvent } from 'react'
import { KeyboardHelp } from './KeyboardHelp'
import { Router } from './router'
import { StageRail } from './StageRail'
import { StatusBar } from './StatusBar'
import { TopBar } from './TopBar'
import { useKeyboardDispatcher } from './useHotkey'

const MAIN_ID = 'main'

export function AppShell() {
  useKeyboardDispatcher()
  // Skip-link фокусирует рабочую область напрямую, без hash-навигации (роутер живёт на pathname)
  const skipToMain = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    document.getElementById(MAIN_ID)?.focus()
  }
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-app text-13 text-ink">
      <a
        href={`#${MAIN_ID}`}
        onClick={skipToMain}
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-accent focus:px-3 focus:py-1 focus:text-13 focus:font-medium focus:text-accent-ink"
      >
        Перейти к рабочей области
      </a>
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <StageRail />
        <main id={MAIN_ID} tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col outline-none">
          <Router />
        </main>
      </div>
      <StatusBar />
      <KeyboardHelp />
    </div>
  )
}
