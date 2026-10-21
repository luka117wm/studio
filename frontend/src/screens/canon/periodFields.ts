// Слой «Периоды» без React: группы карточки эпохи (артборд 12), подписи строки списка и статус-строки, сравнение двух
// версий, скелет и копия близкой эпохи. Поля — по `docs/canon_schema.md` («Эпоха»): всё, кроме подписи `label`, —
// английский текст, он уходит в промпт картинки и negative.
import type { CanonPeriodItem, Period, Years } from '@/types/canon'
import { plural } from '../episodes/board'
import { listRow, textRow, type DiffRow } from './canonFields'

export type PeriodList = 'palette_shift' | 'materials' | 'light_sources' | 'architecture' | 'clothing' | 'props'

/** Шесть групп карточки эпохи чипами, в порядке артборда; запреты — отдельным блоком */
export const PERIOD_GROUPS: { field: PeriodList; title: string }[] = [
  { field: 'palette_shift', title: 'Сдвиг палитры' },
  { field: 'materials', title: 'Материалы' },
  { field: 'light_sources', title: 'Источники света' },
  { field: 'architecture', title: 'Архитектура' },
  { field: 'clothing', title: 'Одежда' },
  { field: 'props', title: 'Предметы' },
]

/** id эпохи — как у бэкенда: строчные латинские буквы, цифры и дефис */
export const PERIOD_ID_RE = /^[a-z0-9][a-z0-9-]*$/

export const yearsText = (years: Years | null) => (!years ? 'годы не заданы' : years.from === years.to ? `${years.from}` : `${years.from}–${years.to}`)

export const episodesText = (n: number) => (n ? `${n} ${plural(n, ['выпуск', 'выпуска', 'выпусков'])}` : 'нет выпусков')

export const forbiddenText = (n: number) => `${n} ${plural(n, ['запрет', 'запрета', 'запретов'])}`

export const positionsText = (n: number) => (n ? `${n} ${plural(n, ['позиция', 'позиции', 'позиций'])}` : 'пусто')

/** Вторая строка в списке эпох: без запретов эпоху нельзя использовать (L-007) */
export function periodRowNote(item: CanonPeriodItem): { blocked: boolean; text: string } {
  if (item.forbidden_count === 0) return { blocked: true, text: 'нельзя использовать: нет запретов' }
  return { blocked: false, text: [forbiddenText(item.forbidden_count), item.region].filter(Boolean).join(' · ') }
}

/** Статус-строка слоя: «Карибы, 1716 · 14 запретов» */
export const periodStatus = (period: Period) =>
  `${period.label || period.id} · ${period.forbidden.length ? forbiddenText(period.forbidden.length) : 'запреты не заполнены'}`

/** Подпись под названием карточки: «1716–1726 · Caribbean Sea, Nassau · 3 выпуска» */
export const periodMeta = (period: Period, episodes: number) =>
  [yearsText(period.years), period.region || 'регион не задан', episodesText(episodes)].join(' · ')

/** Скелет эпохи: один id, остальное пусто — годный черновик, но не публикуемый */
export const emptyPeriod = (id: string): Period => ({
  id,
  label: '',
  region: '',
  years: null,
  palette_shift: [],
  materials: [],
  light_sources: [],
  architecture: [],
  clothing: [],
  props: [],
  forbidden: [],
})

/** Черновик пуст — главное действие «Скопировать промпт эпохи»: чат заполнит его по заявкам выпусков. Пустота — по
 *  спискам: набранные подпись, регион и годы содержимого эпохи не дают, и блок моста не сворачивается под рукой */
export const isEmptyPeriod = (period: Period) => PERIOD_GROUPS.every((g) => !period[g.field].length) && !period.forbidden.length

/** «Новый период» с близкой эпохи: шесть списков и запреты переносятся, подпись, регион и годы — заново */
export function copyPeriod(source: Period | null, id: string, label: string): Period {
  const skeleton = { ...emptyPeriod(id), label }
  if (!source) return skeleton
  const lists = Object.fromEntries(PERIOD_GROUPS.map((g) => [g.field, [...source[g.field]]])) as Pick<Period, PeriodList>
  return { ...skeleton, ...lists, forbidden: [...source.forbidden] }
}

const yearsRowText = (years: Years | null) => (years ? yearsText(years) : '')

/** Сравнение двух версий эпохи: подпись, регион, годы, шесть списков и запреты сводкой */
export function diffPeriod(before: Period, after: Period): DiffRow[] {
  return [
    textRow('Подпись', before.label, after.label),
    textRow('Регион', before.region, after.region),
    textRow('Годы', yearsRowText(before.years), yearsRowText(after.years)),
    ...PERIOD_GROUPS.map((g) => listRow(g.title, before[g.field], after[g.field])),
    listRow('Не должно появляться в кадре', before.forbidden, after.forbidden),
  ]
}

/** Подпись поля в ответе моста: `light_sources` → «Источники света» */
export function periodFieldLabel(field: string): string {
  const group = PERIOD_GROUPS.find((g) => g.field === field)
  if (group) return group.title
  return { label: 'Подпись', region: 'Регион', years: 'Годы', forbidden: 'Запреты' }[field] ?? field
}

/** Значение поля из ответа моста для показа: список — через запятую, годы — «1716–1726» */
export function periodValueText(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : '—'
  if (value && typeof value === 'object' && 'from' in value && 'to' in value) return yearsText(value as Years)
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}
