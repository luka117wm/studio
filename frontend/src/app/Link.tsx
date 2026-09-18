import type { MouseEvent, ReactNode } from 'react'
import { cn } from '../ui'
import { navigate } from './navigation'

export interface LinkProps {
  to: string
  children: ReactNode
  title?: string
  ariaLabel?: string
  /** Текущая страница — aria-current="page" */
  current?: boolean
  className?: string
}

/** Ссылка внутри приложения: клик без модификаторов — pushState, иначе обычная ссылка. */
export function Link({ to, children, title, ariaLabel, current, className }: LinkProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} title={title} aria-label={ariaLabel} aria-current={current ? 'page' : undefined} onClick={onClick} className={cn(className)}>
      {children}
    </a>
  )
}
