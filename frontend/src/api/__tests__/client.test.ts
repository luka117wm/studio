// @vitest-environment node
// Клиент /api на замоканном fetch: URL и тело, разбор ответа, ошибки бэкенда как {status, message}.
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Episode } from '@/types/episode'
import { api, ApiError } from '../client'

type Handler = (url: string, init: RequestInit) => Promise<Response>

function mockFetch(handler: Handler) {
  const fetchMock = vi.fn(handler)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('api', () => {
  test('GET: путь под /api, query без пустых значений, типизированный JSON', async () => {
    const episode = { id: 'pirate', channel: 'cursus', title: 'Pirate' }
    const fetchMock = mockFetch(async () => json(200, [episode]))
    const items = await api.get<Episode[]>('/episodes', { query: { channel: 'cursus', x: undefined } })
    expect(items[0]?.channel).toBe('cursus')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/episodes?channel=cursus')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(new Headers(init.headers).get('Accept')).toBe('application/json')
  })

  test('POST и PATCH шлют JSON', async () => {
    const fetchMock = mockFetch(async () => json(201, { id: 'j1' }))
    await api.post('/jobs', { kind: 'sleep_job' })
    await api.patch('/projects/pirate', { shots: {} })
    const [post, patch] = fetchMock.mock.calls.map(([, init]) => init)
    expect(post?.method).toBe('POST')
    expect(post?.body).toBe('{"kind":"sleep_job"}')
    expect(new Headers(post?.headers).get('Content-Type')).toBe('application/json')
    expect(patch?.method).toBe('PATCH')
  })

  test('204 и пустое тело — null', async () => {
    mockFetch(async () => new Response(null, { status: 204 }))
    expect(await api.post('/jobs/j1/cancel')).toBeNull()
  })

  test('detail строкой — текст бэкенда как есть', async () => {
    mockFetch(async () => json(404, { detail: 'Выпуск «ghost» не найден.' }))
    const error = await failure(api.get('/episodes/ghost'))
    expect(error.status).toBe(404)
    expect(error.message).toBe('Выпуск «ghost» не найден.')
  })

  test('409 бюджета: message из detail, числа — в detail', async () => {
    const detail = {
      code: 'budget_exceeded',
      level: 'month',
      cost_usd_micro: 67000,
      message: 'Месячный лимит $150 исчерпан, потрачено $151.20; поднять лимит можно в настройках канала.',
    }
    mockFetch(async () => json(409, { detail }))
    const error = await failure(api.post('/jobs', { kind: 'image_job' }))
    expect(error.status).toBe(409)
    expect(error.message).toBe(detail.message)
    expect(error.detail).toEqual(detail)
  })

  test('422 валидации: строки по полям без "body"', async () => {
    const detail = [
      { type: 'greater_than', loc: ['body', 'payload', 'steps'], msg: 'Input should be greater than 0' },
      { type: 'missing', loc: ['body', 'kind'], msg: 'Field required' },
    ]
    mockFetch(async () => json(422, { detail }))
    const error = await failure(api.post('/jobs', {}))
    expect(error.message).toBe('payload.steps: Input should be greater than 0; kind: Field required')
  })

  test('422 импорта плана: detail.errors', async () => {
    mockFetch(async () => json(422, { detail: { errors: ['s001: пустой vo', 's002: нет раздела'] } }))
    const error = await failure(api.post('/projects/pirate/director', {}))
    expect(error.message).toBe('s001: пустой vo; s002: нет раздела')
  })

  test('ответ без описания — статус и куда смотреть', async () => {
    mockFetch(async () => new Response('Internal Server Error', { status: 500 }))
    const error = await failure(api.get('/health'))
    expect(error.status).toBe(500)
    expect(error.message).toBe('Бэкенд ответил 500 без описания ошибки — подробности в логе бэкенда.')
  })

  test('нет сети — status 0 и что сделать', async () => {
    mockFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const error = await failure(api.get('/health'))
    expect(error.status).toBe(0)
    expect(error.message).toBe('Бэкенд недоступен. Запустите ./run.sh и повторите.')
  })

  test('таймаут — status 0, запрос прерван', async () => {
    vi.useFakeTimers()
    let aborted = false
    mockFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            aborted = true
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    )
    const pending = failure(api.get('/health', { timeoutMs: 2_000 }))
    await vi.advanceTimersByTimeAsync(2_000)
    const error = await pending
    expect(aborted).toBe(true)
    expect(error.status).toBe(0)
    expect(error.message).toBe('Бэкенд не ответил за 2 с. Проверьте, что он запущен (./run.sh), и повторите.')
  })

  test('отмена вызывающим — AbortError, не ApiError', async () => {
    mockFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const controller = new AbortController()
    const pending = api.get('/health', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
