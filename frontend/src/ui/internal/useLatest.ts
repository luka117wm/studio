import { useEffect, useRef, type RefObject } from 'react'

/** Ссылка на последнее значение — чтобы эффекты с подписками не пересоздавались на каждый рендер. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}
