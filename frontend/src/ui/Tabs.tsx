import type { KeyboardEvent } from 'react'
import { cn } from './cn'
import { cycle } from './internal/focus'

export interface TabItem<T extends string> {
  id: T
  label: string
  disabled?: boolean
}

export interface TabsProps<T extends string> {
  tabs: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  ariaLabel: string
  /** Нижняя граница списка; false — внутри заголовка экрана, где граница уже есть */
  border?: boolean
  className?: string
}

/** Список вкладок; панели — TabPanel с тем же id. ←→ Home End переключают сразу. */
export function Tabs<T extends string>({ tabs, value, onChange, ariaLabel, border = true, className }: TabsProps<T>) {
  const enabled = tabs.filter((t) => !t.disabled)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = enabled.findIndex((t) => t.id === value)
    let next = index
    if (e.key === 'ArrowRight') next = cycle(index, 1, enabled.length)
    else if (e.key === 'ArrowLeft') next = cycle(index, -1, enabled.length)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = enabled.length - 1
    else return
    e.preventDefault()
    const tab = enabled[next]
    if (!tab) return
    onChange(tab.id)
    e.currentTarget.querySelector<HTMLElement>(`#${CSS.escape(`${tab.id}-tab`)}`)?.focus()
  }

  return (
    <div role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown} className={cn('flex h-control-md items-stretch', border && 'border-b border-line', className)}>
      {tabs.map((tab) => {
        const selected = tab.id === value
        return (
          <button
            key={tab.id}
            id={`${tab.id}-tab`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${tab.id}-panel`}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={cn(
              '-mb-px border-b-2 px-3 text-13 font-medium whitespace-nowrap disabled:text-disabled',
              selected ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
