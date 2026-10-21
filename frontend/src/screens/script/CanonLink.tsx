/* Ссылка экрана 3 на экран 12 (M5.10): адрес — `canonLinks.ts`. Клик без модификаторов — переход без перезагрузки,
   с модификатором — как у обычной ссылки (новая вкладка), как у карточки выпуска. */
import type { MouseEvent, ReactNode } from 'react'
import { navigate } from '../../app/navigation'
import { cn } from '../../ui'

export function CanonLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(href)
  }
  return (
    <a
      href={href}
      onClick={onClick}
      className={cn('rounded-control hover:underline focus-visible:outline-2 focus-visible:outline-accent', className)}
    >
      {children}
    </a>
  )
}
