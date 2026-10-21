// Слой «Стиль» без React: группы и поля артборда 12, чтение и запись поля по пути, сравнение двух версий построчно.
// Поля — по `docs/canon_schema.md` («Стиль»); текст полей — английский, он уходит в промпт картинки.
import type { AnchorSetState, Style, Swatch } from '@/types/canon'
import { listRow, textRow, type DiffRow } from './canonFields'

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

const swatchesText = (swatches: Swatch[]) =>
  swatches.length ? swatches.map((s) => `${s.role || 'без роли'} ${s.hex}`).join(', ') : 'нет образцов'

/** Построчное сравнение двух версий стиля: поля по порядку групп, палитра и negative — сводкой */
export function diffStyle(before: Style, after: Style): DiffRow[] {
  const rows: DiffRow[] = []
  for (const group of STYLE_GROUPS) {
    for (const { field, diffLabel } of group.rows) {
      rows.push(textRow(diffLabel, getField(before, field), getField(after, field)))
    }
    if (group.palette) {
      const a = swatchesText(before.palette.swatches)
      const b = swatchesText(after.palette.swatches)
      rows.push({ label: 'Образцы палитры', before: a, after: b, changed: a !== b })
    }
    if (group.negative) rows.push(listRow('Глобальный negative', before.negative_global, after.negative_global))
  }
  return rows
}

/** Подпись панели опорных: «6 кадров, версия v003» или сколько выбрано */
export function anchorsNote(state: AnchorSetState | undefined): string | undefined {
  if (!state || state.chosen === 0) return undefined
  const version = state.slots.find((s) => s.chosen)?.chosen?.version
  return state.chosen === state.total ? `${state.total} кадров, версия ${version}` : `${state.chosen} из ${state.total}, версия ${version}`
}
