// Строка экрана в статус-строке: экран ставит её, пока смонтирован, и снимает при уходе.
import { useEffect } from 'react'
import { useUiStore } from '../store/uiStore'

/** `null` — экрану нечего сказать; при размонтировании строка снимается */
export function useStatusNote(note: string | null): void {
  const setStatusNote = useUiStore((s) => s.setStatusNote)
  useEffect(() => {
    setStatusNote(note)
    return () => setStatusNote(null)
  }, [note, setStatusNote])
}
