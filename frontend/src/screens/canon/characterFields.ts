// Слой «Персонажи» без React: «Неизменяемое» и поля облика (артборд 12), подписи списка, карточки облика и статуса
// листа, сравнение двух версий, что переносит «Скопировать облик в другой период». Поля — по `docs/canon_schema.md`
// («Персонаж», «Облик», «Копия облика в другую эпоху»): всё, кроме подписей `label`, — английский текст промпта.
import type { AnchorSetState, Appearance, CanonCharacterItem, CanonPeriodItem, Character, Nature } from '@/types/canon'
import type { Status } from '../../ui'
import { plural } from '../episodes/board'
import { listRow, textRow, type DiffRow } from './canonFields'

/** Неизменяемое: одинаково во всех обликах и эпохах */
export const NATURE_ROWS: { field: keyof Nature; label: string }[] = [
  { field: 'personality', label: 'Характер' },
  { field: 'posture', label: 'Осанка' },
  { field: 'manner', label: 'Манера' },
  { field: 'face', label: 'Черты лица' },
]

export type AppearanceText = 'build' | 'face' | 'hair' | 'clothing' | 'wear'

/** Текстовые поля облика по порядку формы */
export const APPEARANCE_ROWS: { field: AppearanceText; label: string }[] = [
  { field: 'build', label: 'Телосложение' },
  { field: 'face', label: 'Лицо в облике' },
  { field: 'hair', label: 'Волосы' },
  { field: 'clothing', label: 'Одежда' },
  { field: 'wear', label: 'Износ' },
]

/** id облика — как у бэкенда: `<персонаж>@<облик>` */
export const APPEARANCE_ID_RE = /^[a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9-]*$/

export const ageText = (age: number) => `${age} ${plural(age, ['год', 'года', 'лет'])}`

export const appearancesText = (n: number) => `${n} ${plural(n, ['облик', 'облика', 'обликов'])}`

/** Короткое имя персонажа для подписи облика: «You — рассказчик-участник» → «You» */
export const shortName = (character: Character) => (character.label || character.id).split(' — ')[0]!

/** Подпись эпохи облика: «Карибы, 1716» → «Карибы 1716»; эпохи нет в каноне — её id */
export function periodName(periods: CanonPeriodItem[], id: string): string {
  const period = periods.find((p) => p.id === id)
  return period?.label ? period.label.replace(', ', ' ') : id || 'эпоха не выбрана'
}

/** «You · пороховая обезьяна · 11 лет · Карибы 1716» */
export function appearanceTitle(character: Character, appearance: Appearance, periods: CanonPeriodItem[]): string {
  return [
    shortName(character),
    appearance.label || appearance.id.split('@')[1],
    appearance.age !== null ? ageText(appearance.age) : '',
    periodName(periods, appearance.period),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Пустой облик: id и эпоха — остальное заполняет человек */
export const emptyAppearance = (id: string, period: string): Appearance => ({
  id,
  label: '',
  period,
  age: null,
  build: '',
  face: '',
  hair: '',
  clothing: '',
  wear: '',
  props: [],
  negative_local: [],
})

/** Новый персонаж: id и имя; неизменяемое и облики — в черновике */
export const emptyCharacter = (id: string, label: string): Character => ({
  id,
  label,
  nature: { personality: '', posture: '', manner: '', face: '' },
  appearances: [],
})

/* ---- Лист опорных портретов облика: статус карточки (M5.4, «Устаревание») ---- */

export interface SheetView {
  status: Status
  text: string
  /** Ни одного ракурса: кадры с этим обликом не генерируются (CLAUDE.md, «Чего не делать») */
  blocked: boolean
}

export function sheetView(state: AnchorSetState | undefined): SheetView | null {
  if (!state) return null
  if (state.status === 'ready') return { status: 'ready', text: `готов ${state.chosen}/${state.total}`, blocked: false }
  if (state.status === 'outdated') return { status: 'warning', text: `устарел ${state.chosen}/${state.total}`, blocked: false }
  if (state.status === 'partial') return { status: 'warning', text: `собран наполовину ${state.chosen}/${state.total}`, blocked: false }
  return { status: 'failed', text: 'лист не собран', blocked: true }
}

/** Строка списка персонажей: «Cursus · 5 обликов · 3 листа готовы» */
export function characterMeta(item: CanonCharacterItem, channelName: string): string {
  const n = item.appearances_count
  const ready = item.sheets_ready
  const sheets = !n
    ? 'нет обликов'
    : ready === n
      ? n === 1
        ? 'лист готов'
        : 'все листы готовы'
      : !ready
        ? n === 1
          ? 'лист не собран'
          : 'листы не собраны'
        : `${ready} ${plural(ready, ['лист готов', 'листа готовы', 'листов готовы'])}`
  return [channelName, n ? appearancesText(n) : '', sheets].filter(Boolean).join(' · ')
}

export function characterStatus(item: CanonCharacterItem): Status {
  if (item.appearances_count > 0 && item.sheets_ready === item.appearances_count) return 'ready'
  return item.sheets_ready === 0 ? 'failed' : 'warning'
}

/** Статус-строка слоя: облики канала без полного листа — кадры с ними не сгенерируются */
export function charactersStatus(items: CanonCharacterItem[]): string {
  const missing = items.reduce((sum, c) => sum + Math.max(0, c.appearances_count - c.sheets_ready), 0)
  return missing ? `Персонажи: ${appearancesText(missing)} без полного листа` : 'Персонажи: у всех обликов лист собран'
}

/* ---- Копия облика в другую эпоху: что переносится побайтово, что пишется заново ---- */

export interface CopyRow {
  label: string
  value: string
}

export function copyKeeps(character: Character, appearance: Appearance): CopyRow[] {
  return [
    { label: 'Черты лица', value: [character.nature.face, appearance.face].filter(Boolean).join('; ') || '—' },
    { label: 'Телосложение', value: appearance.build || '—' },
    { label: 'Волосы', value: appearance.hair || '—' },
    { label: 'Возраст', value: appearance.age !== null ? ageText(appearance.age) : '—' },
    { label: 'Negative', value: appearance.negative_local.join(', ') || '—' },
    { label: 'Неизменяемое', value: 'характер, осанка и манера — общие у персонажа' },
  ]
}

export function copyResets(appearance: Appearance): CopyRow[] {
  return [
    { label: 'Подпись', value: appearance.label || '—' },
    { label: 'Одежда', value: appearance.clothing || '—' },
    { label: 'Износ', value: appearance.wear || '—' },
    { label: 'Предметы', value: appearance.props.join(', ') || '—' },
  ]
}

/** id копии по умолчанию: облик-источник с эпохой назначения — `you@powder-monkey-11-england` */
export function copyId(source: string, period: string): string {
  return `${source}-${period.split('-')[0]}`
}

/* ---- Сравнение двух версий персонажа ---- */

const APPEARANCE_KEYS: (keyof Appearance)[] = ['label', 'period', 'age', 'build', 'face', 'hair', 'clothing', 'wear', 'props', 'negative_local']

export function diffCharacter(before: Character, after: Character): DiffRow[] {
  const rows: DiffRow[] = [
    textRow('Имя', before.label, after.label),
    ...NATURE_ROWS.map(({ field, label }) => textRow(label, before.nature[field], after.nature[field])),
    listRow(
      'Облики',
      before.appearances.map((a) => a.id),
      after.appearances.map((a) => a.id),
    ),
  ]
  for (const appearance of after.appearances) {
    const old = before.appearances.find((a) => a.id === appearance.id)
    if (!old) continue
    const changed = APPEARANCE_KEYS.filter((key) => JSON.stringify(old[key]) !== JSON.stringify(appearance[key]))
    rows.push({
      label: `Облик ${appearance.id}`,
      before: 'как было',
      after: changed.length ? `изменены ${changed.join(', ')}` : 'без изменений',
      changed: changed.length > 0,
    })
  }
  return rows
}
