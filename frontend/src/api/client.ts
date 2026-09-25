// Клиент бэкенда: fetch только к `/api`, JSON, таймаут, ошибки в виде {status, message} для UI.
// Текст ошибки приходит с бэкенда (что случилось и что сделать); клиент пишет свой только когда
// ответа нет вовсе — сеть или таймаут. Провайдеров и очередей во фронте нет (CLAUDE.md, «Стек»).
import type { BudgetRefusal } from '@/types/cost'

export const API_BASE = '/api'
export const DEFAULT_TIMEOUT_MS = 15_000

/** Ошибка запроса к бэкенду. `status` 0 — ответа не было (бэкенд не запущен, таймаут). */
export class ApiError extends Error {
  readonly status: number
  /** `detail` ответа как есть: для 409 бюджета — `{code, level, …, message}` (docs/providers.md) */
  readonly detail: unknown

  constructor(status: number, message: string, detail: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

export type Query = Record<string, string | number | boolean | null | undefined>

export interface RequestOptions {
  query?: Query
  /** Отмена вызывающим (TanStack Query): пробрасывается как AbortError, не как ApiError */
  signal?: AbortSignal
  timeoutMs?: number
}

type Method = 'GET' | 'POST' | 'PATCH'

function buildUrl(path: string, query: Query = {}): string {
  if (!path.startsWith('/')) throw new Error(`api path must start with "/": ${path}`)
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value))
  }
  const search = params.toString()
  return `${API_BASE}${path}${search ? `?${search}` : ''}`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Строка ошибки валидации FastAPI/Pydantic: `payload.steps: Input should be greater than 0`. */
function validationLine(item: unknown): string {
  if (typeof item === 'string') return item
  if (!isRecord(item)) return String(item)
  const text = typeof item.msg === 'string' ? item.msg : String(item.message ?? '')
  const loc = Array.isArray(item.loc) ? item.loc.filter((part) => part !== 'body').join('.') : ''
  return loc ? `${loc}: ${text}` : text
}

/** Текст ошибки из тела ответа FastAPI: `detail` строкой, `detail.message` (409 бюджета),
 *  список ошибок валидации (422) или `detail.errors` (импорт плана). */
export function errorMessage(status: number, body: unknown): string {
  const detail = isRecord(body) ? body.detail : undefined
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail) && detail.length) return detail.map(validationLine).join('; ')
  if (isRecord(detail)) {
    if (typeof detail.message === 'string' && detail.message) return detail.message
    if (Array.isArray(detail.errors) && detail.errors.length) {
      return detail.errors.map(validationLine).join('; ')
    }
  }
  return `Бэкенд ответил ${status} без описания ошибки — подробности в логе бэкенда.`
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  const type = response.headers.get('Content-Type') ?? ''
  if (!type.includes('json')) return text
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

async function request<T>(
  method: Method,
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const { query, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const cancel = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  let payload: unknown
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    payload = await readBody(response)
  } catch (error) {
    if (timedOut) {
      throw new ApiError(
        0,
        `Бэкенд не ответил за ${Math.round(timeoutMs / 1000)} с. Проверьте, что он запущен (./run.sh), и повторите.`,
      )
    }
    if (signal?.aborted) throw error
    throw new ApiError(0, 'Бэкенд недоступен. Запустите ./run.sh и повторите.')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }

  if (!response.ok) {
    const detail = isRecord(payload) ? (payload.detail ?? null) : payload
    throw new ApiError(response.status, errorMessage(response.status, payload), detail)
  }
  return payload as T
}

/** Отказ по бюджету (409, docs/providers.md, «Бюджеты») из ошибки запроса; иначе null. */
export function budgetRefusal(error: unknown): BudgetRefusal | null {
  if (!(error instanceof ApiError) || error.status !== 409 || !isRecord(error.detail)) return null
  return error.detail.code === 'budget_exceeded' ? (error.detail as unknown as BudgetRefusal) : null
}

/** Типизированный доступ к `/api`: тип ответа — из `@/types/*` (сгенерированы из Pydantic). */
export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body, options),
  patch: <T>(path: string, body: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),
}
