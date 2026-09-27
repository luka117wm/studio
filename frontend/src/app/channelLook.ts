// Аватар канала в переключателе: инициал и цвет только через утилиты theme.css (hex — только в tokens.css).
// Cursus — цвет дорожки кадров, Otto — accent, оба с чёрным ink; «Все каналы» — line-strong со светлым «∗» (артборд 1).
import type { ChannelScope } from '../api/queries'

export interface ChannelLook {
  initial: string
  /** Фон и цвет инициала аватара */
  avatarClass: string
}

const LOOKS: Record<ChannelScope, ChannelLook> = {
  all: { initial: '∗', avatarClass: 'bg-line-strong text-ink' },
  cursus: { initial: 'C', avatarClass: 'bg-track-shots text-accent-ink' },
  otto: { initial: 'O', avatarClass: 'bg-accent text-accent-ink' },
}

export function channelLook(scope: ChannelScope): ChannelLook {
  return LOOKS[scope]
}
