/** Пять статусов кадра/задачи; цвет и форма — в StatusGlyph, подпись — в StatusBadge. */
export type Status = 'queued' | 'generating' | 'ready' | 'warning' | 'failed'

export const STATUSES: readonly Status[] = ['queued', 'generating', 'ready', 'warning', 'failed']

export const statusLabel: Record<Status, string> = {
  queued: 'В очереди',
  generating: 'Генерируется',
  ready: 'Готово',
  warning: 'Предупреждение',
  failed: 'Ошибка',
}

/** Парный светлый цвет подписи и полос статуса. */
export const statusTextClass: Record<Status, string> = {
  queued: 'text-queued-text',
  generating: 'text-generating',
  ready: 'text-ink',
  warning: 'text-warning',
  failed: 'text-failed-text',
}
