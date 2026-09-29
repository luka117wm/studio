/* Тексты полосы слотов: заметка ячейки, день недели, месяц окна, риск ближайшего слота для статус-строки.
   Состояние и риск слота считает бэкенд (`docs/slots.md`); здесь они только переводятся в слова по артборду 1.
   Заметка про SFX («Нет SFX и экспорта») требует данных монтажа — появится в M8 новым кодом риска. */
import type { EpisodeListItem } from '@/types/episode'
import type { Slot, SlotRisk } from '@/types/slot'
import { formatSlotDate } from '../../app/format'
import { STATUS_TONE, boardColumn, failedShots, type MetaTone } from './board'

export interface SlotNote {
  text: string
  tone: MetaTone
}

type Reason = SlotRisk['reason']

/** Что не готово — по стадии, тем же словарём, что коды риска бэкенда; `null` — выпуск готов к загрузке */
function stageReason(episode: EpisodeListItem): Reason | null {
  if (boardColumn(episode) === 'ready') return null
  switch (episode.stage) {
    case 'idea':
    case 'script':
      return 'script_not_ready'
    case 'generate':
      return episode.status === 'failed' ? 'shots_failed' : 'shots_incomplete'
    default:
      return 'not_exported'
  }
}

function reasonText(reason: Reason, { summary }: EpisodeListItem): string {
  switch (reason) {
    case 'script_not_ready':
      return 'Сценарий не готов'
    case 'shots_incomplete':
      return summary.shots_total > 0 ? `Кадры ${summary.shots_done} / ${summary.shots_total}` : 'Кадры не готовы'
    case 'shots_failed':
      return summary.shots_failed > 0 ? `${summary.shots_failed} ${failedShots(summary.shots_failed)}` : 'Кадры не удались'
    case 'not_exported':
      return 'Экспорт не запускался'
  }
}

/** Заметка занятой ячейки: риск бэкенда важнее статуса — и текстом, и цветом. Пустой слот — без заметки. */
export function slotNote(slot: Slot, episode: EpisodeListItem | undefined): SlotNote | null {
  if (!episode) return null
  if (slot.state === 'published') return { text: 'Опубликован', tone: 'muted' }
  if (slot.state === 'missed') return { text: 'Слот пропущен', tone: 'muted' }
  if (slot.risk) return { text: reasonText(slot.risk.reason, episode), tone: slot.risk.level }
  const reason = stageReason(episode)
  return { text: reason ? reasonText(reason, episode) : 'Готов к загрузке', tone: STATUS_TONE[episode.status] }
}

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

/** ISO-день недели бэкенда (1 — понедельник) → «пн» */
export const weekdayShort = (weekday: number): string => WEEKDAYS[weekday - 1] ?? ''

/** `2026-09-13` → «13» */
export const slotDay = (iso: string): string => String(Number(iso.slice(8, 10)))

const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
]

/** Месяц окна по датам крайних слотов: «сентябрь 2026», «сентябрь — октябрь 2026», «декабрь 2026 — январь 2027» */
export function windowMonths(slots: readonly Slot[]): string | null {
  const first = slots[0]?.date
  const last = slots.at(-1)?.date
  if (!first || !last) return null
  const [fromYear, fromMonth] = first.split('-').map(Number) as [number, number]
  const [toYear, toMonth] = last.split('-').map(Number) as [number, number]
  const from = MONTHS[fromMonth - 1]
  const to = MONTHS[toMonth - 1]
  if (fromYear !== toYear) return `${from} ${fromYear} — ${to} ${toYear}`
  if (fromMonth !== toMonth) return `${from} — ${to} ${toYear}`
  return `${from} ${fromYear}`
}

export interface SlotRiskLine {
  text: string
  level: SlotRisk['level']
}

/** Середина статус-строки — ближайший слот с риском, тем же текстом, что в ячейке:
 *  «Следующий слот 13 сентября, Pirate Ship: экспорт не запускался». */
export function slotRiskLine(slots: readonly Slot[], episodes: readonly EpisodeListItem[] | undefined): SlotRiskLine | null {
  const slot = slots.find((s) => s.risk !== null && s.state !== 'missed')
  if (!slot?.risk) return null
  const episode = episodes?.find((e) => e.id === slot.episode_id)
  const name = episode ? (episode.short_title ?? episode.title) : slot.episode_id
  const note = episode ? slotNote(slot, episode)?.text : undefined
  const reason = note ? note.charAt(0).toLowerCase() + note.slice(1) : null
  const when = slot.state === 'today' ? 'Сегодняшний слот' : `Следующий слот ${formatSlotDate(slot.date, { long: true })}`
  return { text: `${when}, ${name}${reason ? `: ${reason}` : ''}`, level: slot.risk.level }
}
