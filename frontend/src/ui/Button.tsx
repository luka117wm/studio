import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from './cn'
import { formatPrice } from './format'
import { buttonClass, type ButtonSize, type ButtonStatus, type ButtonVariant } from './internal/classes'
import { HATCH_AFTER } from './internal/hatch'
import { ICON_CLASS, ICON_STROKE } from './internal/icon'
import './kit.css'

export type { ButtonSize, ButtonStatus, ButtonVariant }

export interface ButtonProps {
  children: ReactNode
  /** primary — одна на экран. По умолчанию secondary. */
  variant?: ButtonVariant
  /** md — 28px, sm — компакт 24px */
  size?: ButtonSize
  icon?: LucideIcon
  /** Цена платного действия в USD, рендерится в подпись: «Сгенерировать 24 кадра (~$1.61)» */
  price?: number
  /** Пояснение перед ценой в тех же скобках: «Обновить радар (38 запросов квоты, ~$0.12)» */
  priceNote?: string
  loading?: boolean
  /** Подпись на время loading: «Генерирую 14 из 24» */
  loadingLabel?: string
  disabled?: boolean
  /** Цвет контура и текста для statusOutline */
  status?: ButtonStatus
  type?: 'button' | 'submit'
  title?: string
  onClick?: () => void
  className?: string
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  price,
  priceNote,
  loading = false,
  loadingLabel,
  disabled = false,
  status = 'failed',
  type = 'button',
  title,
  onClick,
  className,
}: ButtonProps) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={onClick}
      className={cn(
        buttonClass({ variant, size, status, disabled, loading }),
        // loading: нижняя кромка 2px бегущей штриховкой
        loading && ['relative overflow-hidden after:absolute after:inset-x-0 after:bottom-0 after:h-0.5', HATCH_AFTER],
        className,
      )}
    >
      {Icon && <Icon className={ICON_CLASS} strokeWidth={ICON_STROKE} aria-hidden />}
      <span>
        {loading && loadingLabel !== undefined ? loadingLabel : children}
        {price !== undefined && !loading && ` (${priceNote ? `${priceNote}, ` : ''}${formatPrice(price)})`}
      </span>
    </button>
  )
}
