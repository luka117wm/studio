import type { ReactNode } from 'react'
import { cn } from './cn'

export interface TabPanelProps {
  /** id вкладки из Tabs */
  id: string
  active: boolean
  children: ReactNode
  className?: string
}

/** Панель вкладки: скрыта, пока не активна; связана с вкладкой через id. */
export function TabPanel({ id, active, children, className }: TabPanelProps) {
  return (
    <div
      id={`${id}-panel`}
      role="tabpanel"
      aria-labelledby={`${id}-tab`}
      hidden={!active}
      tabIndex={0}
      className={cn('outline-none', className)}
    >
      {children}
    </div>
  )
}
