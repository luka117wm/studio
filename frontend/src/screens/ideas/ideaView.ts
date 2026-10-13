// Порядок и подписи идей экрана 2: общие для бэклога, «Идей из чата» и диалога «Новый выпуск».
import type { Idea, SkippedIdea } from '@/types/idea'

/** По оценке (без оценки — в конце), при равной — новые первыми */
export function byScore(a: Idea, b: Idea): number {
  const score = (b.score ?? -1) - (a.score ?? -1)
  return score || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
}

/** Бэклог канала по оценке — источник «Начать выпуск» и списка в диалоге */
export const backlogOf = (ideas: Idea[] | undefined): Idea[] =>
  (ideas ?? []).filter((idea) => idea.status === 'backlog').sort(byScore)

/** Строка отчёта приёма: «Идея 2 «Mongol Tumen»: нет поля «angle»»; если причина уже называет идею — без повтора */
export function skippedLine(skipped: SkippedIdea): string {
  const named = skipped.title && !skipped.reason.includes(skipped.title) ? ` «${skipped.title}»` : ''
  return `Идея ${skipped.index}${named}: ${skipped.reason}`
}
