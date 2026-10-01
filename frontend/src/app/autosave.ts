// Автосохранение — один механизм на приложение (решение 6 устава M3): изменения копятся по ключу
// (`episode:c01:title`) и пишутся через 800 мс тишины. На ключ одна запись за раз: новое значение во время записи
// ждёт её конца, пишется последнее. Сеть не ответила — повтор с паузой; ответ с ошибкой (4xx, 5xx) — без
// повтора, текст в индикаторе, «Повторить» пишет снова. Общее состояние — в `uiStore.save`.
import { useEffect, useRef } from 'react'
import { ApiError } from '../api/client'
import { isNetworkError } from '../api/queries'
import { useUiStore, type SaveState } from '../store/uiStore'

export const DEBOUNCE_MS = 800
/** Паузы перед повторами записи, когда сеть не ответила; потом — ошибка с «Повторить» */
export const RETRY_DELAYS_MS = [1_000, 2_000]

/** Запись значения; возвращает время сохранения по серверу (ISO), если ответ его несёт */
export type SaveFn<T> = (value: T) => Promise<string | void>

export interface ScheduleOptions {
  /** Запись не удалась окончательно (повторы кончились или ответ с ошибкой) — откатить оптимистичное */
  onFail?: (error: unknown) => void
}

interface Entry {
  value: unknown
  save: SaveFn<unknown>
  onFail?: (error: unknown) => void
  /** Есть значение, которое ещё не записано */
  dirty: boolean
  timer: ReturnType<typeof setTimeout> | null
  retry: ReturnType<typeof setTimeout> | null
  attempt: number
  flight: Promise<void> | null
  error: string | null
}

export interface AutosaverOptions {
  debounceMs?: number
  retryDelaysMs?: number[]
  onState: (state: SaveState) => void
  /** Время сохранения, если сервер его не вернул */
  now?: () => string
}

export function createAutosaver(options: AutosaverOptions) {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS
  const retryDelays = options.retryDelaysMs ?? RETRY_DELAYS_MS
  const now = options.now ?? (() => new Date().toISOString())
  const entries = new Map<string, Entry>()
  let savedAt: string | null = null

  const publish = () => {
    const all = [...entries.values()]
    const failed = all.find((entry) => entry.error !== null)
    if (failed?.error) options.onState({ kind: 'error', message: failed.error })
    else if (all.some((entry) => entry.flight !== null)) options.onState({ kind: 'saving' })
    else if (all.some((entry) => entry.dirty)) options.onState({ kind: 'pending' })
    else options.onState(savedAt ? { kind: 'saved', at: savedAt } : { kind: 'idle' })
  }

  const clearTimers = (entry: Entry) => {
    if (entry.timer !== null) clearTimeout(entry.timer)
    if (entry.retry !== null) clearTimeout(entry.retry)
    entry.timer = null
    entry.retry = null
  }

  /** Записать значение ключа сейчас. Запись уже идёт — новое значение запишется после неё. */
  const write = (key: string): Promise<void> => {
    const entry = entries.get(key)
    if (!entry) return Promise.resolve()
    if (entry.flight) return entry.flight
    if (!entry.dirty) return Promise.resolve()
    clearTimers(entry)
    const value = entry.value
    entry.dirty = false
    entry.flight = (async () => {
      let failure: unknown = null
      try {
        savedAt = (await entry.save(value)) || now()
        entry.attempt = 0
      } catch (error) {
        failure = error
      }
      entry.flight = null
      if (failure !== null) {
        entry.dirty = true // значение не записано; если пришло новее — запишется новее
        if (isNetworkError(failure) && entry.attempt < retryDelays.length) {
          const delay = retryDelays[entry.attempt] ?? 0
          entry.attempt += 1
          entry.retry = setTimeout(() => {
            entry.retry = null
            void write(key)
          }, delay)
        } else {
          entry.attempt = 0
          entry.error = failure instanceof ApiError ? failure.message : 'Не удалось сохранить — повторите.'
          entry.onFail?.(failure)
        }
        publish()
        return
      }
      publish()
      // Новое значение пришло, пока шла запись, и его таймер уже сработал — пишем его сразу
      if (entry.dirty && entry.timer === null) await write(key)
    })()
    publish()
    return entry.flight
  }

  return {
    /** Новое значение ключа: таймер дебаунса начинается заново */
    schedule<T>(key: string, value: T, save: SaveFn<T>, scheduleOptions: ScheduleOptions = {}) {
      const entry: Entry = entries.get(key) ?? {
        value,
        save: save as SaveFn<unknown>,
        dirty: false,
        timer: null,
        retry: null,
        attempt: 0,
        flight: null,
        error: null,
      }
      entries.set(key, entry)
      entry.value = value
      entry.save = save as SaveFn<unknown>
      entry.onFail = scheduleOptions.onFail
      entry.dirty = true
      entry.error = null
      entry.attempt = 0
      clearTimers(entry)
      entry.timer = setTimeout(() => {
        entry.timer = null
        void write(key)
      }, debounceMs)
      publish()
    },
    /** Записать всё несохранённое сейчас: уход со страницы, смена маршрута */
    flushAll(): Promise<void> {
      return Promise.all([...entries.keys()].map((key) => write(key))).then(() => undefined)
    },
    /** «Повторить» в индикаторе: записать ключи с ошибкой */
    retry(): Promise<void> {
      const failed = [...entries.entries()].filter(([, entry]) => entry.error !== null)
      for (const [, entry] of failed) entry.error = null
      return Promise.all(failed.map(([key]) => write(key))).then(() => undefined)
    },
    /** Есть что терять: значение ждёт записи или пишется */
    hasUnsaved(): boolean {
      return [...entries.values()].some((entry) => entry.dirty || entry.flight !== null)
    },
    /** Забыть всё без записи — только для изоляции тестов */
    reset(): void {
      for (const entry of entries.values()) clearTimers(entry)
      entries.clear()
      savedAt = null
      publish()
    },
  }
}

export type Autosaver = ReturnType<typeof createAutosaver>

/** Автосохранение приложения; состояние — в `uiStore.save` для `SaveIndicator` */
export const autosaver: Autosaver = createAutosaver({ onState: (state) => useUiStore.getState().setSave(state) })

/** Сохранить `value` по ключу через дебаунс. `undefined` — сохранять нечего (исходное значение с сервера);
 *  новое значение — запись. Функция записи и откат берутся свежие на каждый рендер. */
export function useAutosave<T>(key: string, value: T | undefined, save: SaveFn<T>, options: ScheduleOptions = {}) {
  const latest = useRef({ save, options })
  // Свежие функции — до эффекта записи ниже: эффекты идут по порядку объявления
  useEffect(() => {
    latest.current = { save, options }
  })
  useEffect(() => {
    if (value === undefined) return
    autosaver.schedule(key, value, (v: T) => latest.current.save(v), {
      onFail: (error) => latest.current.options.onFail?.(error),
    })
  }, [key, value])
}
