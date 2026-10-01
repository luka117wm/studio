// Подписи кодов бэкенда: API отдаёт коды, тексты интерфейса — только во фронте.
import type { Episode } from '@/types/episode'

/** Стадия выпуска строчными — рядом с названием в шапке */
export const STAGE_LABEL: Record<Episode['stage'], string> = {
  idea: 'идея',
  script: 'сценарий',
  generate: 'генерация',
  edit: 'монтаж',
  export: 'экспорт',
  publish: 'публикация',
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
