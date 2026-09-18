import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { NumberInput } from './NumberInput'
import { cn } from './cn'
import { clamp, snap } from './internal/number'

export interface SliderProps {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  /** Засечка пресета/голоса (accent-deep); ⌥-клик возвращает к нему */
  defaultValue?: number
  /** Засечки разброса значений в мультивыделении (line-strong) */
  spread?: number[]
  ariaLabel: string
  /** Числовое поле в той же строке; unit — суффикс единицы */
  input?: { unit?: string }
  disabled?: boolean
  className?: string
}

/** Рельс 2px, ручка 12×12. ←→ шаг, с Shift ×10, Home/End к краям. */
export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  defaultValue,
  spread,
  ariaLabel,
  input,
  disabled,
  className,
}: SliderProps) {
  const railRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLButtonElement>(null)
  const dragging = useRef(false)

  const set = (next: number) => {
    const normalized = clamp(snap(next, step, min), min, max)
    if (normalized !== value) onChange(normalized)
  }
  const percent = (v: number) => (max === min ? 0 : ((clamp(v, min, max) - min) / (max - min)) * 100)

  const fromPointer = (e: PointerEvent<HTMLElement>) => {
    const rail = railRef.current
    if (!rail) return
    const rect = rail.getBoundingClientRect()
    if (rect.width === 0) return
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1)
    set(min + ratio * (max - min))
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return
    e.preventDefault()
    thumbRef.current?.focus()
    if (e.altKey && defaultValue !== undefined) {
      set(defaultValue)
      return
    }
    dragging.current = true
    e.currentTarget.setPointerCapture?.(e.pointerId)
    fromPointer(e)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) fromPointer(e)
  }
  const endDrag = () => {
    dragging.current = false
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const big = e.shiftKey ? 10 : 1
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        set(value + step * big)
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        set(value - step * big)
        break
      case 'Home':
        set(min)
        break
      case 'End':
        set(max)
        break
      default:
        return
    }
    e.preventDefault()
  }

  return (
    <div className={cn('flex items-center gap-2', disabled && 'pointer-events-none opacity-50', className)}>
      <div
        ref={railRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative h-control-md min-w-0 flex-1 touch-none select-none"
      >
        {/* позиции по рельсу — вычисляемая геометрия, поэтому style, а не класс */}
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-clip bg-line" />
        <div className="absolute top-1/2 left-0 h-0.5 -translate-y-1/2 rounded-clip bg-accent" style={{ width: `${percent(value)}%` }} />
        {spread?.map((v, i) => (
          <span
            key={`${v}-${i}`}
            aria-hidden
            className="absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-line-strong"
            style={{ left: `${percent(v)}%` }}
          />
        ))}
        {defaultValue !== undefined && (
          <span
            aria-hidden
            data-testid="slider-default-tick"
            className="absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-accent-deep"
            style={{ left: `${percent(defaultValue)}%` }}
          />
        )}
        <button
          ref={thumbRef}
          type="button"
          role="slider"
          aria-label={ariaLabel}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-orientation="horizontal"
          disabled={disabled}
          onKeyDown={onKeyDown}
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-clip bg-accent hover:bg-accent-hover"
          style={{ left: `${percent(value)}%` }}
        />
      </div>
      {input && (
        <NumberInput
          value={value}
          onChange={set}
          min={min}
          max={max}
          step={step}
          unit={input.unit}
          size="sm"
          ariaLabel={`${ariaLabel}, число`}
          disabled={disabled}
          className="w-16 shrink-0"
        />
      )}
    </div>
  )
}
