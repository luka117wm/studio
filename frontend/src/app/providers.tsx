/* Провайдеры приложения. TanStack Query подключён без единого запроса — чтобы на M2 не переписывать дерево.
   Тема одна, тёмная (color-scheme в base.css), провайдер темы не нужен. Тосты — из стора оболочки. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useUiStore } from '../store/uiStore'
import { ToastStack } from '../ui'

function Toasts() {
  const toasts = useUiStore((s) => s.toasts)
  const dismissToast = useUiStore((s) => s.dismissToast)
  return <ToastStack toasts={toasts} onDismiss={dismissToast} />
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }),
  )
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toasts />
    </QueryClientProvider>
  )
}
