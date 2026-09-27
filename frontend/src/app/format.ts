// Форматирование данных API для показа. Деньги с бэкенда — целые микродоллары (L-001), округляются только
// здесь и в `format_usd` бэкенда, по одному правилу. `formatPrice` кита — другое: цена в кнопке с «~».
import type { EpisodeSummary } from '@/types/episode'

const MICRO_PER_CENT = 10_000

/** Микродоллары → «$61.40», «$150», «<$0.01» — как `format_usd` в `backend/app/cost/pricing.py`:
 *  до цента с округлением половины вверх, целые доллары без копеек. */
export function formatUsd(micro: number): string {
  const sign = micro < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(micro))
  const cents = Math.floor((abs + MICRO_PER_CENT / 2) / MICRO_PER_CENT)
  if (abs > 0 && cents === 0) return `${sign}<$0.01`
  if (cents % 100 === 0) return `${sign}$${cents / 100}`
  return `${sign}$${(cents / 100).toFixed(2)}`
}

/** Секунды → «19:48», «1:02:03»; оценка — с «~»: «~18:00». */
export function formatDuration(seconds: number, options: { estimate?: boolean } = {}): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  const clock = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
  return options.estimate ? `~${clock}` : clock
}

/** Длительность выпуска из сводки: по голосу — точная, иначе оценка; без плана — null. */
export function formatEpisodeDuration(summary: EpisodeSummary): string | null {
  if (summary.duration_s === null) return null
  return formatDuration(summary.duration_s, { estimate: summary.duration_source !== 'voice' })
}

const MONTHS_SHORT = ['янв', 'февр', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сент', 'окт', 'нояб', 'дек']
const MONTHS_LONG = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]

/** `2026-09-13` → «13 сент» (ячейка слота), `{ long: true }` → «13 сентября» (фраза). Дата без часового пояса —
 *  разбирается строкой, не через `Date`, чтобы полночь UTC не уехала на соседний день. */
export function formatSlotDate(iso: string, options: { long?: boolean } = {}): string {
  const [, month, day] = iso.split('-').map(Number)
  const months = options.long ? MONTHS_LONG : MONTHS_SHORT
  const name = month !== undefined ? months[month - 1] : undefined
  if (!day || !name) return iso
  return `${day} ${name}`
}
