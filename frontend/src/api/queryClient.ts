// Кэш запросов приложения: политика повторов и свежести. Один клиент на приложение (`app/providers.tsx`),
// в тестах — свой на тест.
import { QueryClient } from '@tanstack/react-query'
import { isNetworkError } from './queries'

/** Повторяем только запрос, на который не пришло ответа (бэкенд перезапускается), и не больше двух раз.
 *  4xx и 5xx — ответ бэкенда с текстом «что сделать»: повтор его не изменит. */
export const RETRY_LIMIT = 2
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return isNetworkError(error) && failureCount < RETRY_LIMIT
}

/** `retryDelay` — для тестов: повтор без ожидания */
export function createQueryClient(options: { retryDelay?: number } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // Свежесть держат мутации и поток SSE — опроса и перезапроса по фокусу нет
      queries: {
        retry: shouldRetry,
        ...(options.retryDelay !== undefined && { retryDelay: options.retryDelay }),
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  })
}
