import { useState, type ReactNode } from 'react'

/** Локальное состояние для интерактивных демонстраций: значение и сеттер отдаются в render-функцию. */
export function Stateful<T>({ initial, children }: { initial: T; children: (value: T, set: (value: T) => void) => ReactNode }) {
  const [value, setValue] = useState(initial)
  return <>{children(value, setValue)}</>
}

/** Несколько демонстраций в ряд */
export function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>
}

/** Демонстрации столбиком */
export function Col({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>
}
