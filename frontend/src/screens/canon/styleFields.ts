// Слой «Стиль» без React: группы и поля артборда 12, чтение и запись поля по пути, сравнение двух версий построчно.
// Поля — по `docs/canon_schema.md` («Стиль»); текст полей — английский, он уходит в промпт картинки.
import type { AnchorSetState, CanonVersionInfo, Style, Swatch } from '@/types/canon'
import { plural } from '../episodes/board'

export type TextField =
  | 'render'
  | 'material'
  | 'processing'
  | 'optics.focal'
  | 'optics.depth'
  | 'optics.distortion'
  | 'light.character'
  | 'light.contrast'
  | 'light.direction'
  | 'palette.rule'
  | 'grain'
  | 'composition'

export interface StyleRow {
  field: TextField
  label: string
  /** Подпись строки в сравнении, где нет заголовка группы */
  diffLabel: string
}

export interface StyleGroup {
  title: string
  note: string
  rows: StyleRow[]
  palette?: true
  negative?: true
}

const row = (field: TextField, label: string, diffLabel = label): StyleRow => ({ field, label, diffLabel })

export const STYLE_GROUPS: StyleGroup[] = [
  {
    title: 'Рендер и материал',
    note: 'как выглядит сама картинка',
    rows: [row('render', 'Рендер'), row('material', 'Материал'), row('processing', 'Обработка')],
  },
  {
    title: 'Оптика',
    note: 'как снято',
    rows: [row('optics.focal', 'Фокусное'), row('optics.depth', 'Глубина'), row('optics.distortion', 'Дисторсия')],
  },
  {
    title: 'Свет',
    note: 'откуда и какой',
    rows: [
      row('light.character', 'Характер', 'Характер света'),
      row('light.contrast', 'Контраст', 'Контраст света'),
      row('light.direction', 'Направление', 'Направление света'),
    ],
  },
  { title: 'Палитра', note: 'образцы с ролями', rows: [row('palette.rule', 'Правило', 'Правило палитры')], palette: true },
  { title: 'Зерно и композиция', note: 'что делает кадр узнаваемым', rows: [row('grain', 'Зерно'), row('composition', 'Композиция')] },
  { title: 'Глобальный negative', note: 'поверх запретов периода', rows: [], negative: true },
]

export const SWATCHES_MIN = 3
export const SWATCHES_MAX = 5
export const HEX_RE = /^#[0-9a-fA-F]{6}$/
const CYRILLIC_RE = /[Ѐ-ӿ]/

/** Пустой стиль — скелет черновика «Создать стиль канала» */
export const EMPTY_STYLE: Style = {
  render: '',
  material: '',
  processing: '',
  optics: { focal: '', depth: '', distortion: '' },
  light: { character: '', contrast: '', direction: '' },
  palette: { rule: '', swatches: [] },
  grain: '',
  composition: '',
  negative_global: [],
}

export function getField(style: Style, field: TextField): string {
  const [group, key] = field.split('.') as [string, string | undefined]
  if (key === undefined) return style[group as 'render'] as string
  return (style[group as 'optics'] as unknown as Record<string, string>)[key] ?? ''
}

export function setField(style: Style, field: TextField, value: string): Style {
  const [group, key] = field.split('.') as [string, string | undefined]
  if (key === undefined) return { ...style, [group]: value }
  const nested = style[group as 'optics' | 'light' | 'palette']
  return { ...style, [group]: { ...nested, [key]: value } }
}

/** Текст поля промпта по-русски: публикация такой стиль отклонит */
export const isCyrillic = (text: string): boolean => CYRILLIC_RE.test(text)

/** Ключ повтора запрета: без регистра и лишних пробелов */
export const negativeKey = (text: string): string => text.toLowerCase().split(/\s+/).filter(Boolean).join(' ')

/** Следующий номер версии слоя: за последней опубликованной */
export function nextVersion(versions: CanonVersionInfo[]): string {
  const last = versions.reduce((max, v) => Math.max(max, Number(v.version.slice(1))), 0)
  return `v${String(last + 1).padStart(3, '0')}`
}

export interface DiffRow {
  label: string
  before: string
  after: string
  changed: boolean
}

const swatchesText = (swatches: Swatch[]) =>
  swatches.length ? swatches.map((s) => `${s.role || 'без роли'} ${s.hex}`).join(', ') : 'нет образцов'

const positions = (n: number) => `${n} ${plural(n, ['позиция', 'позиции', 'позиций'])}`

/** Negative сводкой: число позиций, у новой стороны — что добавлено и убрано */
function negativeRow(before: string[], after: string[]): DiffRow {
  const had = new Set(before.map(negativeKey))
  const has = new Set(after.map(negativeKey))
  const added = after.filter((item) => !had.has(negativeKey(item)))
  const removed = before.filter((item) => !has.has(negativeKey(item)))
  const quote = (items: string[]) => items.map((item) => `«${item}»`).join(', ')
  const notes = [added.length ? `добавлены ${quote(added)}` : '', removed.length ? `убраны ${quote(removed)}` : ''].filter(Boolean)
  return {
    label: 'Глобальный negative',
    before: positions(before.length),
    after: positions(after.length) + (notes.length ? `: ${notes.join('; ')}` : ''),
    changed: added.length > 0 || removed.length > 0 || before.length !== after.length,
  }
}

/** Построчное сравнение двух версий стиля: поля по порядку групп, палитра и negative — сводкой */
export function diffStyle(before: Style, after: Style): DiffRow[] {
  const rows: DiffRow[] = []
  for (const group of STYLE_GROUPS) {
    for (const { field, diffLabel } of group.rows) {
      const a = getField(before, field)
      const b = getField(after, field)
      rows.push({ label: diffLabel, before: a || '—', after: b || '—', changed: a !== b })
    }
    if (group.palette) {
      const a = swatchesText(before.palette.swatches)
      const b = swatchesText(after.palette.swatches)
      rows.push({ label: 'Образцы палитры', before: a, after: b, changed: a !== b })
    }
    if (group.negative) rows.push(negativeRow(before.negative_global, after.negative_global))
  }
  return rows
}

export const changedCount = (rows: DiffRow[]) => rows.filter((r) => r.changed).length

export function diffSummary(rows: DiffRow[]): string {
  const changed = changedCount(rows)
  return `${changed} ${plural(changed, ['поле', 'поля', 'полей'])} из ${rows.length} ${plural(changed, ['изменено', 'изменены', 'изменены'])}`
}

/** Что открыто: шапка (черновик или последняя версия) или версия только для чтения */
export interface StyleHead {
  draft: boolean
  /** Версия шапки без черновика; у черновика — null */
  version: string | null
  based_on: string | null
}

export const headLabel = (head: StyleHead) =>
  head.draft ? (head.based_on ? `Черновик из ${head.based_on}` : 'Черновик') : `${head.version} · текущая`

/** Подпись панели опорных: «6 кадров, версия v003» или сколько выбрано */
export function anchorsNote(state: AnchorSetState | undefined): string | undefined {
  if (!state || state.chosen === 0) return undefined
  const version = state.slots.find((s) => s.chosen)?.chosen?.version
  return state.chosen === state.total ? `${state.total} кадров, версия ${version}` : `${state.chosen} из ${state.total}, версия ${version}`
}
