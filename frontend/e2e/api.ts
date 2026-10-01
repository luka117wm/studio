/* Моки API для e2e: `page.route` на все пути `/api` отвечает из `src/mocks/api.ts` (решение 7 устава M3) — снимки
   детерминированы, в настоящий бэкенд e2e не ходит. Мок свой у каждого теста: записи (POST, PUT, PATCH) меняют его
   состояние только до конца теста. Незамоканный путь валит тест с именем пути, а не молчаливым 404. */
import { test as base, expect, type Page } from '@playwright/test'
import { createMockApi, type MockApi } from '../src/mocks/api'

/** Начало ответа `createMockApi` на путь, которого мок не знает, — законный 404 («выпуск не найден») им не считается */
const UNMOCKED = 'Мок API не знает'

export interface ApiMock {
  api: MockApi
  /** «МЕТОД /api/путь» запросов, на которые у мока нет ответа */
  unmocked: string[]
}

export async function mockApi(page: Page): Promise<ApiMock> {
  const api = createMockApi()
  const unmocked: string[] = []
  // Предикат, а не glob: шаблон с `api` в середине ловит и модули dev-сервера (`/src/api/queries.ts`)
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/api/events') {
      // Поток без событий: закрывается сразу, `retry` откладывает переподключение браузера на 10 минут
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'retry: 600000\n\n' })
      return
    }
    const text = request.postData()
    const response = api.handle(request.method(), `${url.pathname}${url.search}`, text ? (JSON.parse(text) as unknown) : undefined)
    const detail = (response.body as { detail?: unknown } | null)?.detail
    if (response.status === 404 && typeof detail === 'string' && detail.startsWith(UNMOCKED)) {
      const name = `${request.method()} ${url.pathname}`
      unmocked.push(name)
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: `e2e: нет мока для ${name}` }) })
      return
    }
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) })
  })
  return { api, unmocked }
}

/** `test` с моком API у каждого теста; после теста — ни одного запроса без мока */
export const test = base.extend<{ apiMock: ApiMock }>({
  apiMock: [
    async ({ page }, use) => {
      const mock = await mockApi(page)
      await use(mock)
      expect(mock.unmocked, 'запросы без мока API — добавьте ответ в src/mocks/api.ts').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
