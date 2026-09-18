import { X } from 'lucide-react'
import { cn } from './cn'
import { HATCH } from './internal/hatch'
import { statusLabel, type Status } from './status'
import './kit.css'

export interface StatusGlyphProps {
  status: Status
  /** Доступное имя; по умолчанию — подпись статуса */
  label?: string
  className?: string
}

/** 16×16, форма обязательна: queued — полый круг, generating — штриховка,
    ready — сплошная точка, warning — треугольник, failed — квадрат с крестом. */
export function StatusGlyph({ status, label, className }: StatusGlyphProps) {
  return (
    <span
      role="img"
      aria-label={label ?? statusLabel[status]}
      data-status={status}
      className={cn('inline-flex size-icon shrink-0 items-center justify-center', className)}
    >
      {status === 'queued' && <span className="size-2.5 rounded-full border-[1.5px] border-queued" />}
      {status === 'generating' && <span className={cn('size-2.5 rounded-full', HATCH)} />}
      {status === 'ready' && <span className="size-2.5 rounded-full bg-ready" />}
      {status === 'warning' && (
        <span className="size-3 bg-warning [clip-path:polygon(50%_0,100%_100%,0_100%)]" />
      )}
      {status === 'failed' && (
        <span className="flex size-2.5 items-center justify-center rounded-[1px] bg-failed text-accent-ink">
          <X className="size-2" strokeWidth={3} />
        </span>
      )}
    </span>
  )
}
