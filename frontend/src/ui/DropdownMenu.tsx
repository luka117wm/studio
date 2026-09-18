import { ChevronDown, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { KeyHint } from './KeyHint'
import { cn } from './cn'
import { Portal } from './internal/Portal'
import { buttonClass, iconButtonClass } from './internal/classes'
import { cycle } from './internal/focus'
import { ICON_CLASS, ICON_STROKE } from './internal/icon'
import { layerStyle, useAnchorPosition, type Placement } from './internal/useAnchorPosition'
import { useOutsidePointer } from './internal/useOutsidePointer'

export type MenuItem =
  | {
      id: string
      label: string
      icon?: LucideIcon
      /** Горячие клавиши справа: ['⌘', 'D'] */
      keys?: string[]
      danger?: boolean
      disabled?: boolean
      onSelect: () => void
    }
  | { id: string; separator: true }

export interface DropdownMenuProps {
  /** Доступное имя триггера; для icon-триггера — ещё и title */
  label: string
  items: MenuItem[]
  /** icon — кнопка 24×24 только с иконкой; button — secondary-кнопка с подписью и шевроном */
  trigger?: 'icon' | 'button'
  icon?: LucideIcon
  placement?: Placement
  disabled?: boolean
  className?: string
}

/** Пункты меню держат tabIndex=-1 (фокус ходит стрелками), поэтому не focusables(). */
function menuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'))
}

/** Триггер + role=menu в портале. ↑↓ по пунктам, Home/End, Enter/Space выбирают,
    Esc и Tab закрывают с возвратом фокуса на триггер, клик вне закрывает. */
export function DropdownMenu({
  label,
  items,
  trigger = 'button',
  icon: Icon,
  placement = 'bottom-start',
  disabled,
  className,
}: DropdownMenuProps) {
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [initial, setInitial] = useState<'first' | 'last'>('first')
  const position = useAnchorPosition(triggerRef, menuRef, open, placement)
  useOutsidePointer(open, () => setOpen(false), [triggerRef, menuRef])

  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    if (!menu) return
    const list = menuItems(menu)
    ;(initial === 'first' ? list[0] : list[list.length - 1])?.focus()
  }, [open, initial])

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }
  const openWith = (at: 'first' | 'last') => {
    setInitial(at)
    setOpen(true)
  }

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openWith('first')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      openWith('last')
    }
  }

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current
    if (!menu) return
    const list = menuItems(menu)
    const index = list.findIndex((el) => el === document.activeElement)
    switch (e.key) {
      case 'ArrowDown':
        list[cycle(index, 1, list.length)]?.focus()
        break
      case 'ArrowUp':
        list[cycle(index, -1, list.length)]?.focus()
        break
      case 'Home':
        list[0]?.focus()
        break
      case 'End':
        list[list.length - 1]?.focus()
        break
      case 'Escape':
        e.stopPropagation()
        close()
        break
      case 'Tab':
        close(false)
        return
      default:
        return
    }
    e.preventDefault()
  }

  const isIcon = trigger === 'icon'
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={isIcon ? label : undefined}
        title={isIcon ? label : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : openWith('first'))}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          isIcon
            ? iconButtonClass('ghost')
            : buttonClass({ variant: 'secondary', size: 'md', status: 'failed', disabled: Boolean(disabled), loading: false }),
          className,
        )}
      >
        {Icon && <Icon className={ICON_CLASS} strokeWidth={ICON_STROKE} aria-hidden />}
        {!isIcon && (
          <>
            <span>{label}</span>
            <ChevronDown className="size-icon text-muted" strokeWidth={ICON_STROKE} aria-hidden />
          </>
        )}
      </button>
      {open && (
        <Portal>
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            style={layerStyle(position)}
            className="z-40 min-w-44 rounded-panel border border-line bg-raised py-1 shadow-overlay"
          >
            {items.map((item) =>
              'separator' in item ? (
                <div key={item.id} role="separator" className="my-1 h-px bg-rule-inner" />
              ) : (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  disabled={item.disabled}
                  onClick={() => {
                    item.onSelect()
                    close()
                  }}
                  className={cn(
                    'flex h-control-md w-full items-center gap-2 px-2 text-left text-13 outline-none',
                    item.danger ? 'text-failed-text hover:bg-surface-failed focus-visible:bg-surface-failed' : 'text-ink hover:bg-hover focus-visible:bg-hover',
                    'disabled:pointer-events-none disabled:text-disabled',
                  )}
                >
                  {item.icon && <item.icon className={cn(ICON_CLASS, !item.danger && 'text-muted')} strokeWidth={ICON_STROKE} aria-hidden />}
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.keys && <KeyHint keys={item.keys} />}
                </button>
              ),
            )}
          </div>
        </Portal>
      )}
    </>
  )
}
