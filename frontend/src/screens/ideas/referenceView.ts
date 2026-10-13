// Подписи вкладки «Референс»: метрики, шапка, сходство. Числа — из ответа бэкенда, здесь только текст.
import type { ReferenceMetrics as Metrics, ReferenceVideo } from '@/types/reference'
import { formatClock, formatDuration, formatSlotDate } from '../../app/format'
import { plural } from '../episodes/board'

/** Отклонение темпа от нормы меньше этой доли — «как у канала» */
const PACE_SAME = 0.05

export const decimal = (value: number) => value.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** «3:53 и 11:09», «0:20, 3:53 и 11:09» */
export function listTimes(seconds: number[]): string {
  const times = seconds.map((s) => formatDuration(s))
  return times.length > 1 ? `${times.slice(0, -1).join(', ')} и ${times[times.length - 1]}` : (times[0] ?? '')
}

export function paceHint(metrics: Metrics, channelName: string): string {
  const delta = metrics.pace_delta
  if (Math.abs(delta) < PACE_SAME) return `Как у ${channelName}: ${metrics.norm_wpm} слов/мин`
  return `У ${channelName} ${metrics.norm_wpm}, ${delta > 0 ? 'быстрее' : 'медленнее'} на ${Math.round(Math.abs(delta) * 100)} %`
}

export function densityHint(metrics: Metrics): string {
  if (metrics.holds_until_s === null) return 'Фактов в разборе нет'
  if (metrics.holds_until_s >= metrics.duration_s - 1) return 'Держится до конца ролика'
  return `Держится до ${Math.ceil(metrics.holds_until_s / 60)}-й минуты`
}

export function hooksHint(metrics: Metrics): string {
  const hooks = metrics.retention_hooks_s
  if (!hooks.length) return 'Крючков удержания нет'
  if (hooks.length === 1) return `Крючок удержания: ${listTimes(hooks)}`
  return `${hooks.length} ${plural(hooks.length, ['крючок', 'крючка', 'крючков'])} удержания: ${listTimes(hooks)}`
}

/** 0.03 → «3 %», 0.104 → «10.4 %» — как `percent` бэкенда */
export const percent = (value: number) => `${Number((value * 100).toFixed(1))} %`

/** Шапка вкладки: «Референс разобран 11 сентября, 11:54» по часам машины; не разобран — так и сказано */
export function analyzedNote(reference: ReferenceVideo): string {
  if (!reference.analyzed_at) return 'Референс не разобран'
  const day = new Date(reference.analyzed_at)
  const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
  return `Референс разобран ${formatSlotDate(iso, { long: true })}, ${formatClock(reference.analyzed_at)}`
}

/** «Every Rank on a Roman Warship — Gradus, 22:41»; названия нет (до разбора или чат его не узнал) — ссылка, без
 *  ссылки — id: «ref0001, 3:00» */
export function referenceHeading(reference: ReferenceVideo): string {
  const title = reference.title || reference.url || reference.id
  const by = reference.author ? ` — ${reference.author}` : ''
  return `${title}${by}, ${formatDuration(reference.duration_s)}`
}

/** Тост сохранения: «Референс сохранён: 22:41, 412 реплик» */
export function savedToast(reference: ReferenceVideo): string {
  return `Референс сохранён: ${formatDuration(reference.duration_s)}, ${reference.cues} ${plural(reference.cues, ['реплика', 'реплики', 'реплик'])}`
}

/** Превью субтитров: материал чужой, после сохранения на экране — только начало текста реплик, без номеров блоков,
 *  строк времени, заголовка VTT и таймкодов расшифровки. Это подпись, не разбор: реплики считает бэкенд. */
export const PREVIEW_CHARS = 160
const SERVICE_LINE = /^(\d+|WEBVTT.*|NOTE.*|.*-->.*)$/
const LEADING_STAMP = /^(\d+:)?\d{1,2}:\d{2}\s*/
export function subtitlesPreview(subtitles: string): string {
  const flat = subtitles
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !SERVICE_LINE.test(line))
    .map((line) => line.replace(LEADING_STAMP, '').replace(/<[^>]*>/g, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat
}
