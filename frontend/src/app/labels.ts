// Подписи кодов бэкенда: API отдаёт коды, тексты интерфейса — только во фронте.
import type { Episode } from '@/types/episode'
import type { SlotRisk } from '@/types/slot'

/** Стадия выпуска строчными — рядом с названием в шапке */
export const STAGE_LABEL: Record<Episode['stage'], string> = {
  idea: 'идея',
  script: 'сценарий',
  generate: 'генерация',
  edit: 'монтаж',
  export: 'экспорт',
  publish: 'публикация',
}

/** Причина риска слота (`docs/slots.md`) — продолжение фразы «Слот 13 сентября, Pirate Ship: …» */
export const RISK_REASON: Record<SlotRisk['reason'], string> = {
  script_not_ready: 'сценарий не готов',
  shots_incomplete: 'кадры не готовы',
  shots_failed: 'есть неудачные кадры',
  not_exported: 'экспорт не запускался',
}

/** Вид джоба в статус-строке. Неизвестный вид показывается как есть — новый обработчик не ломает строку. */
const JOB_KIND: Record<string, string> = {
  images: 'Генерация кадров',
  voice: 'Озвучка',
  script: 'Сценарий',
  research: 'Исследование',
  animate: 'Анимация кадров',
  render: 'Рендер',
  sleep_job: 'Проверочный джоб',
}

export function jobKindLabel(kind: string): string {
  return JOB_KIND[kind] ?? kind
}
