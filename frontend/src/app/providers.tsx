/* Провайдеры приложения: кэш запросов TanStack Query и живые обновления из SSE (`api/live.ts`).
   Тема одна, тёмная (color-scheme в base.css), провайдер темы не нужен. Тосты — из стора оболочки. */
import { QueryClientProvider, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { startLive } from '../api/live'
import { createQueryClient } from '../api/queryClient'
import { useUiStore } from '../store/uiStore'
import { ToastStack } from '../ui'

function LiveUpdates() {
  const client = useQueryClient()
  useEffect(() => startLive(client), [client])
  return null
}

function Toasts() {
  const toasts = useUiStore((s) => s.toasts)
  const dismissToast = useUiStore((s) => s.dismissToast)
  return <ToastStack toasts={toasts} onDismiss={dismissToast} />
}

/** `client` — для тестов: свой кэш на тест, без повторов по времени */
export function Providers({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [own] = useState(() => client ?? createQueryClient())
  return (
    <QueryClientProvider client={own}>
      <LiveUpdates />
      {children}
      <Toasts />
    </QueryClientProvider>
  )
}
