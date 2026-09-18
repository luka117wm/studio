import type { ReactNode } from 'react'
import { cn } from '../ui'

export interface PanelHeaderProps {
  title: string
  note?: string
  /** Правый слот: кнопки-иконки, переключатели */
  actions?: ReactNode
  className?: string
}

/** Шапка панели 28px: strip-фон, нижняя граница, title 13/600 + note 12 secondary. */
export function PanelHeader({ title, note, actions, className }: PanelHeaderProps) {
  return (
    <div className={cn('flex h-shell-panel-header shrink-0 items-center gap-2 border-b border-line bg-strip px-2', className)}>
      <span className="truncate text-13 font-semibold text-ink">{title}</span>
      {note && <span className="truncate text-12 text-muted">{note}</span>}
      {actions && <span className="ml-auto flex shrink-0 items-center gap-1">{actions}</span>}
    </div>
  )
}
