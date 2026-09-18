import { cn } from './cn'
import { HATCH } from './internal/hatch'
import './kit.css'

export type ProgressStatus = 'generating' | 'ready' | 'warning' | 'failed'

export interface ProgressBarProps {
  /** 0–100; null — неопределённый прогресс (бегущая штриховка на всю ширину) */
  value: number | null
  status?: ProgressStatus
  ariaLabel: string
  /** sm — 2px, md — 4px */
  size?: 'sm' | 'md'
  className?: string
}

const FILL: Record<ProgressStatus, string> = {
  generating: HATCH,
  ready: 'bg-accent',
  warning: 'bg-warning',
  failed: 'bg-failed',
}

export function ProgressBar({ value, status = 'generating', ariaLabel, size = 'sm', className }: ProgressBarProps) {
  const percent = value === null ? 100 : Math.min(100, Math.max(0, value))
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(percent)}
      className={cn('overflow-hidden rounded-clip bg-line', size === 'sm' ? 'h-0.5' : 'h-1', className)}
    >
      {/* ширина — вычисляемая геометрия, поэтому style, а не класс */}
      <div className={cn('h-full rounded-clip', FILL[status])} style={{ width: `${percent}%` }} />
    </div>
  )
}
