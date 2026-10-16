// Общее трёх слоёв экрана 12 без React: шапка слоя и номер следующей версии, сравнение двух версий построчно,
// списки чипов (повтор без регистра, кириллица, похожие позиции), выбор слоя и сущности в адресе. Слой «Стиль» —
// `styleFields.ts`, эпоха — `periodFields.ts`, персонаж — `characterFields.ts`.
import type { CanonVersionInfo } from '@/types/canon'
import { setSearchParam } from '../../app/navigation'
import { plural } from '../episodes/board'

const CYRILLIC_RE = /[Ѐ-ӿ]/

/** Текст поля промпта по-русски: публикация такой канон отклонит */
export const isCyrillic = (text: string): boolean => CYRILLIC_RE.test(text)

/** Подсказка у поля промпта с кириллицей */
export const CYRILLIC_HINT = 'Пишите по-английски: текст канона уходит в промпт картинки, публикация кириллицу не примет.'

/** Ключ повтора позиции списка: без регистра и лишних пробелов */
export const negativeKey = (text: string): string => text.toLowerCase().split(/\s+/).filter(Boolean).join(' ')

/** Следующий номер версии слоя: за последней опубликованной */
export function nextVersion(versions: CanonVersionInfo[]): string {
  const last = versions.reduce((max, v) => Math.max(max, Number(v.version.slice(1))), 0)
  return `v${String(last + 1).padStart(3, '0')}`
}

/** Что открыто: шапка (черновик или последняя версия) или версия только для чтения */
export interface LayerHead {
  draft: boolean
  /** Версия шапки без черновика; у черновика — null */
  version: string | null
  based_on: string | null
}

export const headLabel = (head: LayerHead) =>
  head.draft ? (head.based_on ? `Черновик из ${head.based_on}` : 'Черновик') : `${head.version} · текущая`

export interface DiffRow {
  label: string
  before: string
  after: string
  changed: boolean
}

export const changedCount = (rows: DiffRow[]) => rows.filter((r) => r.changed).length

export function diffSummary(rows: DiffRow[]): string {
  const changed = changedCount(rows)
  return `${changed} ${plural(changed, ['поле', 'поля', 'полей'])} из ${rows.length} ${plural(changed, ['изменено', 'изменены', 'изменены'])}`
}

/** Строка сравнения текстового поля: пустое — прочерк */
export const textRow = (label: string, before: string, after: string): DiffRow => ({
  label,
  before: before || '—',
  after: after || '—',
  changed: before !== after,
})

const positions = (n: number) => `${n} ${plural(n, ['позиция', 'позиции', 'позиций'])}`

/** Список сводкой: число позиций, у новой стороны — что добавлено и убрано (без учёта регистра) */
export function listRow(label: string, before: string[], after: string[]): DiffRow {
  const had = new Set(before.map(negativeKey))
  const has = new Set(after.map(negativeKey))
  const added = after.filter((item) => !had.has(negativeKey(item)))
  const removed = before.filter((item) => !has.has(negativeKey(item)))
  const quote = (items: string[]) => items.map((item) => `«${item}»`).join(', ')
  const notes = [added.length ? `добавлены ${quote(added)}` : '', removed.length ? `убраны ${quote(removed)}` : ''].filter(Boolean)
  return {
    label,
    before: positions(before.length),
    after: positions(after.length) + (notes.length ? `: ${notes.join('; ')}` : ''),
    changed: added.length > 0 || removed.length > 0 || before.length !== after.length,
  }
}

/* ---- Похожие позиции списка: смысловой повтор, который текстовое сравнение моста не ловит (M5.6, L-036) ---- */

const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'with', 'in', 'on', 'and', 'or', 'for', 'to', 'from', 'by'])

const words = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w && !STOP_WORDS.has(w)),
  )

/** Пары позиций, где все значимые слова одной входят в другую: «Rialto stone bridge» и «Rialto stone arch bridge».
 *  Точные повторы список не принимает, это — подсказка человеку, а не отказ. */
export function similarPairs(items: string[]): [number, number][] {
  const sets = items.map(words)
  const pairs: [number, number][] = []
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const [a, b] = [sets[i]!, sets[j]!]
      if (!a.size || !b.size) continue
      const [small, large] = a.size <= b.size ? [a, b] : [b, a]
      if ([...small].every((w) => large.has(w))) pairs.push([i, j])
    }
  }
  return pairs
}

/** Слой и сущность экрана 12 — в адресе: `?layer=periods&period=…`, `?layer=characters&character=…&appearance=…` */
export function selectCanon(layer: 'periods' | 'characters', params: Record<string, string | null>): void {
  setSearchParam('layer', layer)
  for (const [name, value] of Object.entries(params)) setSearchParam(name, value)
}

export type NeededKind = 'periods' | 'appearances'

/** Перейти к сущности из «нужно каналу»: эпоха — на слое «Периоды», облик — у своего персонажа */
export function openNeeded(kind: NeededKind, id: string): void {
  if (kind === 'periods') selectCanon('periods', { period: id })
  else selectCanon('characters', { character: id.split('@')[0]!, appearance: id })
}

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
