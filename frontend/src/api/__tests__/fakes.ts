// Фейки сети для тестов: EventSource с ручным управлением потоком и fetch поверх мока API (`mocks/api.ts`).
import { vi } from 'vitest'
import { createMockApi, type MockApi } from '../../mocks/api'

type Listener = (event: MessageEvent<string>) => void

export class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly url: string
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  private listeners = new Map<string, Listener[]>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  static last(): FakeEventSource {
    const source = FakeEventSource.instances.at(-1)
    if (!source) throw new Error('no EventSource')
    return source
  }

  /** Потоки, которые не закрыты: у приложения должен быть ровно один */
  static active(): FakeEventSource[] {
    return FakeEventSource.instances.filter((source) => source.readyState !== 2)
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close() {
    this.readyState = 2
  }

  open() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }

  /** Обрыв: `closed` — EventSource сдался (бэкенд лежал при подключении), иначе браузер переподключается сам */
  fail(closed: boolean) {
    this.readyState = closed ? 2 : 0
    this.onerror?.(new Event('error'))
  }

  emit(type: string, data: unknown, id?: number) {
    const text = typeof data === 'string' ? data : JSON.stringify(data)
    const event = new MessageEvent(type, { data: text, lastEventId: id === undefined ? '' : String(id) })
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

export function stubEventSource() {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
}

export interface ApiStub {
  api: MockApi
  fetch: ReturnType<typeof vi.fn>
  /** Бэкенд «лежит»: ответ как у прокси Vite при остановленном uvicorn — 502 с пустым text/plain (L-023) */
  setDown: (down: boolean) => void
}

/** `fetch` → мок API; запросы не к `/api` — ошибка теста, а не тихий пропуск */
export function stubApi(api: MockApi = createMockApi()): ApiStub {
  let down = false
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith('/api/')) throw new Error(`запрос мимо /api: ${url}`)
    if (down) return new Response('', { status: 502, headers: { 'Content-Type': 'text/plain' } })
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined
    const response = api.handle(init?.method ?? 'GET', url, body)
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { api, fetch: fetchMock, setDown: (value) => (down = value) }
}
