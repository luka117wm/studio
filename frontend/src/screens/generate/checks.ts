/* Пометки проверок на экране 4 (M6.10; устав M6, решение 7; docs/generation.md, «Проверка лица», «Проверка
   анахронизмов»): у выбранной версии кадра лицо `low` — «лицо не похоже на фас», анахронизм `suspect` — найденное
   из `forbidden` эпохи. Только пометки: ни выбор, ни перерисовка, ни стадия выпуска от них не зависят. `no_face`,
   `skipped`, `failed` и `off` пометок не дают — это «не проверено», а не подозрение.
   «Подозрительные» — выбранные версии с пометками по возрастанию сходства лица: меньше — выше, без сходства (только
   анахронизм, лица нет) — в конце; первые десять человек смотрит первыми (черновик B2A.5, пункт 3). */
import type { Section } from '@/types/plan'
import type { Asset } from '@/types/project'
import type { GridSection, TileShot } from './grid'

export interface ShotMarks {
  /** Лицо `low`: худшее сходство облика ниже порога; `null` — пометки нет */
  face: { score: number | null } | null
  /** Найденное проверкой анахронизмов (`suspect`), формулировкой канона; пусто — пометки нет */
  found: string[]
  /** Худшее сходство среди проверенных обликов — порядок «Подозрительных»; `null` — в конец */
  score: number | null
}

export const NO_MARKS: ShotMarks = { face: null, found: [], score: null }

/** Сколько подозрительных человек смотрит первыми */
export const FIRST_LOOK = 10

/** Пометки версии кадра — выбранной: она идёт в монтаж */
export function marksOf(asset: Asset | undefined): ShotMarks {
  const face = asset?.checks?.face
  const anachronism = asset?.checks?.anachronism
  const scored = (face?.appearances ?? []).filter((match) => typeof match.score === 'number')
  const worst = (status?: string) => {
    const scores = scored.filter((match) => !status || match.status === status).map((match) => match.score!)
    return scores.length ? Math.min(...scores) : null
  }
  return {
    face: face?.status === 'low' ? { score: worst('low') } : null,
    found: anachronism?.status === 'suspect' ? anachronism.found : [],
    score: worst(),
  }
}

export const isSuspect = (marks: ShotMarks) => marks.face !== null || marks.found.length > 0

/** «Лицо не похоже на фас (0.21)» — подсказка и имя треугольника для экранного диктора */
export const faceMarkLabel = (face: { score: number | null }) =>
  face.score === null ? 'Лицо не похоже на фас' : `Лицо не похоже на фас (${face.score.toFixed(2)})`

/** «Анахронизм: zipper, wristwatch»; проверка выключена — пометка старая: «— проверено раньше» */
export const anachronismMarkLabel = (found: readonly string[], checkedEarlier: boolean) =>
  `Анахронизм: ${found.join(', ')}${checkedEarlier ? ' — проверено раньше' : ''}`

/** Подписи пометок кадра по порядку: лицо, затем анахронизм */
export function markLabels(marks: ShotMarks, checkedEarlier: boolean): string[] {
  return [
    ...(marks.face ? [faceMarkLabel(marks.face)] : []),
    ...(marks.found.length ? [anachronismMarkLabel(marks.found, checkedEarlier)] : []),
  ]
}

export interface Suspect {
  shot: TileShot
  section: Section
}

/** «Подозрительные»: кадры с пометками по возрастанию сходства, без сходства — в конце, при равенстве — по плану */
export function suspects(sections: readonly GridSection[]): Suspect[] {
  const list = sections.flatMap(({ section, shots }) => shots.filter((shot) => isSuspect(shot.marks)).map((shot) => ({ shot, section })))
  const key = (item: Suspect) => item.shot.marks.score ?? Number.POSITIVE_INFINITY
  // sort устойчив: равные (и все без сходства) остаются в порядке плана
  return list.sort((a, b) => (key(a) === key(b) ? 0 : key(a) < key(b) ? -1 : 1))
}
