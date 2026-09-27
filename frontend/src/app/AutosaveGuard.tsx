/* Страж автосохранения: смена маршрута пишет несохранённое сразу, не дожидаясь дебаунса; уход со страницы —
   тоже, и браузер предупреждает, только если несохранённое есть и запись не успела. */
import { useEffect, useRef } from 'react'
import { autosaver } from './autosave'
import { usePathname } from './navigation'

export function AutosaveGuard() {
  const pathname = usePathname()
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    void autosaver.flushAll()
  }, [pathname])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!autosaver.hasUnsaved()) return
      void autosaver.flushAll()
      event.preventDefault()
      event.returnValue = '' // старые браузеры показывают вопрос только с returnValue
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  return null
}
