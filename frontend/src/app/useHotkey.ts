import { useEffect, useRef, useSyncExternalStore } from 'react'
import { dispatch, list, popModal, pushModal, register, subscribe, type Hotkey } from './keyboard'

/** Регистрация на маунт, снятие на анмаунт. Обработчик и when читаются через ref — без перерегистрации на каждый рендер. */
export function useHotkey(hotkey: Hotkey): void {
  useHotkeySet([hotkey])
}

/** То же для набора сочетаний (например, ⌘1…⌘6) */
export function useHotkeySet(hotkeys: Hotkey[]): void {
  const latest = useRef(hotkeys)
  useEffect(() => {
    latest.current = hotkeys
  })
  // Перерегистрация только при смене статических полей; handler и when — всегда последние
  const signature = JSON.stringify(hotkeys.map((h) => [h.id, h.keys, h.scope, h.group, h.description, h.inInputs, h.inModal, h.hint]))
  useEffect(() => {
    const unregister = latest.current.map((h, i) =>
      register({
        ...h,
        handler: (e) => latest.current[i]?.handler(e),
        when: () => latest.current[i]?.when?.() ?? true,
      }),
    )
    return () => unregister.forEach((u) => u())
  }, [signature])
}

/** Список зарегистрированных сочетаний — для окна помощи и статус-строки */
export function useRegisteredHotkeys(): Hotkey[] {
  return useSyncExternalStore(subscribe, list)
}

/** Пока open — открыт модальный слой: глобальные и экранные сочетания молчат */
export function useModalScope(open: boolean): void {
  useEffect(() => {
    if (!open) return
    pushModal()
    return popModal
  }, [open])
}

/** Один слушатель keydown на документе; вызывается один раз в AppShell */
export function useKeyboardDispatcher(): void {
  useEffect(() => {
    document.addEventListener('keydown', dispatch)
    return () => document.removeEventListener('keydown', dispatch)
  }, [])
}
