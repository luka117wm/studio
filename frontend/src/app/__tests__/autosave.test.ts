// Ядро автосохранения на фейковых таймерах: дебаунс, одна запись на ключ, повтор сети, ошибка без повтора.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { SaveState } from '../../store/uiStore'
import { DEBOUNCE_MS, RETRY_DELAYS_MS, createAutosaver } from '../autosave'

const AT = '2026-09-26T09:41:00+00:00'

function setup() {
  const states: SaveState[] = []
  const saver = createAutosaver({ onState: (state) => states.push(state), now: () => 'now' })
  const last = () => states.at(-1)
  return { saver, states, last }
}

/** Запись, которую тест завершает сам: ответ или ошибка в нужный момент */
function controlled() {
  const calls: { value: string; resolve: (at?: string) => void; reject: (error: unknown) => void }[] = []
  const save = vi.fn(
    (value: string) =>
      new Promise<string | void>((resolve, reject) => {
        calls.push({ value, resolve: (at) => resolve(at), reject })
      }),
  )
  return { save, calls }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('дебаунс', () => {
  test('5 изменений за 500 мс — один PATCH через 800 мс после последнего', async () => {
    const { saver, last } = setup()
    const save = vi.fn(async (_value: string) => AT)
    for (let i = 1; i <= 5; i += 1) {
      saver.schedule('episode:c01:title', `v${i}`, save)
      vi.advanceTimersByTime(100)
    }
    expect(last()).toEqual({ kind: 'pending' })
    vi.advanceTimersByTime(DEBOUNCE_MS - 100 - 1)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('v5')
    expect(last()).toEqual({ kind: 'saved', at: AT })
  })

  test('смена маршрута (flushAll) до таймера — запись сразу, таймер больше не пишет', async () => {
    const { saver } = setup()
    const save = vi.fn(async (_value: string) => AT)
    saver.schedule('k', 'draft', save)
    vi.advanceTimersByTime(200)
    await saver.flushAll()
    expect(save).toHaveBeenCalledWith('draft')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2)
    expect(save).toHaveBeenCalledTimes(1)
    expect(saver.hasUnsaved()).toBe(false)
  })

  test('без времени от сервера — время машины; ключи независимы', async () => {
    const { saver, last } = setup()
    const a = vi.fn(async (_value: string) => undefined)
    const b = vi.fn(async (_value: string) => undefined)
    saver.schedule('a', '1', a)
    saver.schedule('b', '2', b)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(a).toHaveBeenCalledWith('1')
    expect(b).toHaveBeenCalledWith('2')
    expect(last()).toEqual({ kind: 'saved', at: 'now' })
  })
})

describe('одна запись на ключ', () => {
  test('изменение во время записи ждёт её конца; пишется последнее значение, не параллельно', async () => {
    const { saver, last } = setup()
    const { save, calls } = controlled()
    saver.schedule('k', 'first', save)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(calls).toHaveLength(1)
    expect(last()).toEqual({ kind: 'saving' })

    saver.schedule('k', 'second', save)
    saver.schedule('k', 'third', save)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS) // таймер сработал, пока первая запись в полёте
    expect(calls).toHaveLength(1)
    expect(saver.hasUnsaved()).toBe(true)

    calls[0]?.resolve(AT)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.map((c) => c.value)).toEqual(['first', 'third'])
    calls[1]?.resolve(AT)
    await vi.advanceTimersByTimeAsync(0)
    expect(last()).toEqual({ kind: 'saved', at: AT })
    expect(saver.hasUnsaved()).toBe(false)
  })
})

describe('ошибки', () => {
  test('сеть не ответила — повторы с паузой, потом успех', async () => {
    const { saver, last } = setup()
    let failures = 2
    const save = vi.fn(async (_value: string) => {
      if (failures-- > 0) throw new ApiError(0, 'Бэкенд недоступен. Запустите ./run.sh и повторите.')
      return AT
    })
    saver.schedule('k', 'v', save)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(save).toHaveBeenCalledTimes(1)
    expect(last()).toEqual({ kind: 'pending' }) // ждёт повтора, это не ошибка
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] ?? 0)
    expect(save).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1] ?? 0)
    expect(save).toHaveBeenCalledTimes(3)
    expect(last()).toEqual({ kind: 'saved', at: AT })
  })

  test('сеть не отвечает и после повторов — ошибка с текстом и откатом', async () => {
    const { saver, last } = setup()
    const onFail = vi.fn()
    const save = vi.fn(async (_value: string) => {
      throw new ApiError(0, 'Бэкенд недоступен. Запустите ./run.sh и повторите.')
    })
    saver.schedule('k', 'v', save, { onFail })
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + RETRY_DELAYS_MS.reduce((a, b) => a + b, 0))
    expect(save).toHaveBeenCalledTimes(1 + RETRY_DELAYS_MS.length)
    expect(last()).toEqual({ kind: 'error', message: 'Бэкенд недоступен. Запустите ./run.sh и повторите.' })
    expect(onFail).toHaveBeenCalledTimes(1)
  })

  test('422 — ошибка в индикаторе без повтора; «Повторить» пишет снова', async () => {
    const { saver, last } = setup()
    const onFail = vi.fn()
    let reject = true
    const save = vi.fn(async (_value: string) => {
      if (reject) throw new ApiError(422, 'Название не может быть пустым — введите текст.')
      return AT
    })
    saver.schedule('k', 'v', save, { onFail })
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(last()).toEqual({ kind: 'error', message: 'Название не может быть пустым — введите текст.' })
    expect(onFail).toHaveBeenCalledOnce()
    expect(saver.hasUnsaved()).toBe(true)

    reject = false
    await saver.retry()
    expect(save).toHaveBeenCalledTimes(2)
    expect(last()).toEqual({ kind: 'saved', at: AT })
  })

  test('новое изменение после ошибки снимает её и пишется по дебаунсу', async () => {
    const { saver, last } = setup()
    const save = vi.fn(async (value: string) => {
      if (value === 'bad') throw new ApiError(422, 'Нельзя.')
      return AT
    })
    saver.schedule('k', 'bad', save)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(last()).toEqual({ kind: 'error', message: 'Нельзя.' })
    saver.schedule('k', 'good', save)
    expect(last()).toEqual({ kind: 'pending' })
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(last()).toEqual({ kind: 'saved', at: AT })
  })
})
