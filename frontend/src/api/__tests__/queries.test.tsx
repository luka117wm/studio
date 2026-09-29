// Хуки запросов на моке API: пути, «Все каналы» без параметра, что обновляет каждая мутация, повторы только для сети.
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createQueryClient, shouldRetry } from '../queryClient'
import { ApiError } from '../client'
import {
  qk,
  useBackendDown,
  useCostSummaries,
  useCreateEpisode,
  useEpisode,
  useEpisodes,
  usePatchEpisode,
  useSetSlot,
  useSlots,
} from '../queries'
import { stubApi } from './fakes'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setup() {
  const stub = stubApi()
  const client = createQueryClient({ retryDelay: 0 })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const urls = () => stub.fetch.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(url)}`)
  return { stub, client, wrapper, urls }
}

const since = (all: string[], from: number) => all.slice(from)

describe('чтение', () => {
  test('выпуски канала — с параметром, «Все каналы» — без', async () => {
    const { wrapper, urls } = setup()
    const cursus = renderHook(() => useEpisodes('cursus'), { wrapper })
    const all = renderHook(() => useEpisodes('all'), { wrapper })
    await waitFor(() => expect(all.result.current.data).toBeDefined())
    await waitFor(() => expect(cursus.result.current.data).toBeDefined())
    expect(urls()).toEqual(expect.arrayContaining(['GET /api/episodes?channel=cursus', 'GET /api/episodes']))
    expect(cursus.result.current.data?.every((e) => e.channel === 'cursus')).toBe(true)
    expect(all.result.current.data).toHaveLength(9)
  })

  test('выпуск: без id запроса нет; пока грузится — строка из списка', async () => {
    const { wrapper, urls, client } = setup()
    renderHook(() => useEpisode(null), { wrapper })
    expect(urls()).toEqual([])

    const list = renderHook(() => useEpisodes('all'), { wrapper })
    await waitFor(() => expect(list.result.current.data).toBeDefined())
    const one = renderHook(() => useEpisode('pirate'), { wrapper })
    expect(one.result.current.data?.title).toBe('Pirate Ship: Powder Monkey to Captain')
    expect(one.result.current.isPlaceholderData).toBe(true)
    await waitFor(() => expect(one.result.current.isPlaceholderData).toBe(false))
    expect(urls()).toContain('GET /api/episodes/pirate')
    expect(client.getQueryData(qk.episode('pirate'))).toBeDefined()
  })

  test('расход «Все каналы» — сводка каждого канала', async () => {
    const { wrapper, urls } = setup()
    const { result } = renderHook(() => useCostSummaries('all'), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(2))
    expect(result.current.data?.map((s) => s.channel)).toEqual(['cursus', 'otto'])
    expect(urls()).toEqual(expect.arrayContaining(['GET /api/cost/summary?channel=cursus', 'GET /api/cost/summary?channel=otto']))
  })
})

describe('мутации', () => {
  async function mounted(wrapper: ({ children }: { children: ReactNode }) => ReactNode) {
    const list = renderHook(() => useEpisodes('cursus'), { wrapper })
    const slots = renderHook(() => useSlots(), { wrapper })
    await waitFor(() => expect(list.result.current.data && slots.result.current.data).toBeDefined())
    return list
  }

  test('создание: POST, выпуск в кэше, списки и слоты перезапрошены', async () => {
    const { wrapper, urls, client } = setup()
    await mounted(wrapper)
    const before = urls().length
    const { result } = renderHook(() => useCreateEpisode(), { wrapper })
    const created = await act(() => result.current.mutateAsync({ channel: 'cursus' }))
    expect(created.title).toBe('Новый выпуск')
    expect(client.getQueryData(qk.episode(created.id))).toEqual(created)
    await waitFor(() =>
      expect(since(urls(), before)).toEqual(['POST /api/episodes', 'GET /api/episodes?channel=cursus', 'GET /api/slots']),
    )
  })

  test('переименование: PATCH, выпуск в кэше, списки перезапрошены, слоты — нет', async () => {
    const { wrapper, urls, client } = setup()
    await mounted(wrapper)
    const before = urls().length
    const { result } = renderHook(() => usePatchEpisode('pirate'), { wrapper })
    await act(() => result.current.mutateAsync({ title: 'Pirate Ship, final' }))
    expect(client.getQueryData<{ title: string }>(qk.episode('pirate'))?.title).toBe('Pirate Ship, final')
    await waitFor(() => expect(since(urls(), before)).toEqual(['PATCH /api/episodes/pirate', 'GET /api/episodes?channel=cursus']))
  })

  test('слот: PUT с датой, выпуск, списки и слоты перезапрошены', async () => {
    const { wrapper, urls, stub } = setup()
    await mounted(wrapper)
    const before = urls().length
    const { result } = renderHook(() => useSetSlot(), { wrapper })
    const episode = await act(() => result.current.mutateAsync({ id: 'janissary', channel: 'cursus', date: '2026-09-23' }))
    expect(episode.slot_date).toBe('2026-09-23')
    const [, init] = stub.fetch.mock.calls[before] ?? []
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ date: '2026-09-23' })
    await waitFor(() =>
      expect(since(urls(), before)).toEqual([
        'PUT /api/episodes/janissary/slot',
        'GET /api/episodes?channel=cursus',
        'GET /api/slots',
      ]),
    )
  })
})

describe('повторы и доступность', () => {
  test('повтор только для сети и не больше двух раз; 4xx и 5xx — сразу ошибка', () => {
    expect(shouldRetry(0, new ApiError(0, 'нет ответа'))).toBe(true)
    expect(shouldRetry(1, new ApiError(0, 'нет ответа'))).toBe(true)
    expect(shouldRetry(2, new ApiError(0, 'нет ответа'))).toBe(false)
    expect(shouldRetry(0, new ApiError(404, 'не найден'))).toBe(false)
    expect(shouldRetry(0, new ApiError(500, 'сломался'))).toBe(false)
  })

  test('бэкенд лежит: три попытки, потом «недоступен»; сброс запросов — снова доступен', async () => {
    const { wrapper, stub, client } = setup()
    stub.setDown(true)
    const down = renderHook(() => useBackendDown(), { wrapper })
    const slots = renderHook(() => useSlots(), { wrapper })
    await waitFor(() => expect(down.result.current).toBe(true))
    expect(stub.fetch).toHaveBeenCalledTimes(3)

    stub.setDown(false)
    await act(() => resetAll(client))
    await waitFor(() => expect(slots.result.current.data).toBeDefined())
    expect(down.result.current).toBe(false)
  })

  test('404 — ошибка запроса, а не «бэкенд недоступен»', async () => {
    const { wrapper, stub } = setup()
    const down = renderHook(() => useBackendDown(), { wrapper })
    const ghost = renderHook(() => useEpisode('ghost'), { wrapper })
    await waitFor(() => expect(ghost.result.current.error).toBeInstanceOf(ApiError))
    expect((ghost.result.current.error as ApiError).status).toBe(404)
    expect(stub.fetch).toHaveBeenCalledTimes(1)
    expect(down.result.current).toBe(false)
  })
})

const resetAll = (client: QueryClient) => client.resetQueries()
