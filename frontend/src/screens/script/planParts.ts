/* Недособранный набор частей моста (M4.2): любой импорт новой версии плана — перевод на новые версии канона
   (M5.10) или «Сохранить как версию» (M4.8) — сбрасывает принятые части на бэкенде (`_clear_parts`). Предупреждаем
   до клика, а не теряем молча. */
import type { PlanParts } from '@/types/plan'

/** «Набор частей из чата не закончен (приняты 1, 2 из 4) — …»; набора нет или он собран — null */
export function pendingPartsNote(parts: PlanParts | undefined, action: string): string | null {
  if (!parts || !parts.received.length || parts.next_part === null) return null
  return `Набор частей из чата не закончен (${parts.received.length === 1 ? 'принята' : 'приняты'} ${parts.received.join(', ')} из ${parts.parts_total}) — ${action} его сбросит, части придётся вставить заново.`
}
