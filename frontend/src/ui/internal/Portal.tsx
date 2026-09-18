import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Всплывающие слои рендерятся в body, чтобы их не резал overflow панелей. */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}
