// Экран 4 на моках API для тестов: открытие, вызовы fetch, фейковый поток SSE, событие джоба кадра.
import { act, screen } from '@testing-library/react'
import type { vi } from 'vitest'
import type { BatchSummary } from '@/types/batch'
import type { JobEventData } from '@/types/job'
import { FakeEventSource, stubApi } from '../../../api/__tests__/fakes'
import { renderApp } from '../../../app/__tests__/harness'
import { GEN_BATCH, createMockApi, type MockApi } from '../../../mocks/api'

export const INITIAL = { channel: 'cursus' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [], save: { kind: 'idle' as const } }

/** Экран 4 «Пиратов»; `ready` — чего дождаться, по умолчанию — первого раздела сетки артборда 4 */
export async function openGenerate(api: MockApi, ready: () => Promise<unknown> = () => screen.findByRole('region', { name: 'Cold open' }, { timeout: 3000 })) {
  const stub = stubApi(api)
  const app = renderApp('/episodes/pirate/generate', { stub })
  await ready()
  return { ...app, api }
}

/** Моки с «Пиратами» артборда 4: пачка 78 из 104 (`drawn`) или утверждённый план без картинок */
export function artboardApi(drawn = true): MockApi {
  const api = createMockApi()
  api.generateArtboard({ drawn })
  return api
}

type Call = [string, RequestInit | undefined]
export const calls = (fetch: ReturnType<typeof vi.fn>, method: string, path?: string) =>
  (fetch.mock.calls as Call[])
    .filter(([url, init]) => (init?.method ?? 'GET') === method && (!path || String(url).startsWith(path)))
    .map(([url]) => String(url))

export const strip = () => screen.getByRole('region', { name: 'Очереди генерации' })

/** Поток SSE приложения открыт; события — с id выше курсора снимка моков (1200) */
export function stream() {
  const source = FakeEventSource.last()
  act(() => source.open())
  let id = 1200
  return (type: string, data: JobEventData | BatchSummary) => {
    id += 1
    act(() => source.emit(type, data, id))
  }
}

export const shotEvent = (shot: string, status: JobEventData['status'], fields: Partial<JobEventData> = {}): JobEventData => ({
  job_id: `job-${GEN_BATCH}-${shot}`,
  kind: 'shot_image',
  status,
  progress: status === 'done' ? 1 : 0,
  message: null,
  attempts: 1,
  cancel_requested: false,
  episode_id: 'pirate',
  batch_id: GEN_BATCH,
  channel: null,
  error: null,
  ...fields,
})
