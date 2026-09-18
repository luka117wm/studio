import { cn } from './cn'

export interface SkeletonProps {
  /** text — строки текста; block — прямоугольник (размер классами); circle — аватар/глиф */
  variant?: 'text' | 'block' | 'circle'
  lines?: number
  className?: string
}

/** Заглушка загрузки. Контейнер с данными помечает aria-busy сам. */
export function Skeleton({ variant = 'block', lines = 3, className }: SkeletonProps) {
  const pulse = 'animate-pulse bg-raised motion-reduce:animate-none'
  if (variant === 'text') {
    return (
      <div aria-hidden className={cn('flex flex-col gap-2', className)}>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className={cn(pulse, 'h-3 rounded-clip', i === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full')} />
        ))}
      </div>
    )
  }
  return <div aria-hidden className={cn(pulse, variant === 'circle' ? 'rounded-full' : 'rounded-control', className)} />
}
