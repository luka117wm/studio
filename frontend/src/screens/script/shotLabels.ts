/* Подписи полей кадра для листа и таблицы плана (экран 3) — без JSX, случаи в `shotLabels.test.ts`.
   Значения — из действующего плана (`@/types/plan`), подписи — по-русски, как в артборде 3. */
import type { Motion, PlanShot, Transition } from '@/types/plan'
import type { Status } from '../../ui'

/** Частота кадров для «наплыв 12 к». Пресета с fps ещё нет — его даст модуль рендера (хвост M4.5). */
export const PREVIEW_FPS = 30

export type MotionType = Motion['type']
export type TransitionType = Transition['type']
export type ShotSize = PlanShot['image']['shot_size']

const MOTION_NAME: Record<MotionType, string> = {
  push_in: 'наезд',
  pull_out: 'отъезд',
  pan_left: 'панорама ←',
  pan_right: 'панорама →',
  tilt_up: 'панорама ↑',
  tilt_down: 'панорама ↓',
  static: 'статика',
  drift: 'дрейф',
}

/** Наезд и отъезд — с масштабом конца движения: «наезд 1.08×» = 1 + strength. Панорамы и дрейф — без числа. */
export function motionLabel(motion: Pick<Motion, 'type' | 'strength'>): string {
  const name = MOTION_NAME[motion.type]
  if (motion.type !== 'push_in' && motion.type !== 'pull_out') return name
  return `${name} ${(1 + motion.strength).toFixed(2)}×`
}

/** Только название движения — колонка «Движение» таблицы, где сила показана полоской */
export const motionName = (type: MotionType): string => MOTION_NAME[type].split(' ')[0] ?? type

const TRANSITION_NAME: Record<TransitionType, string> = { cut: 'встык', crossfade: 'наплыв', dip: 'через чёрное' }

/** «встык», «наплыв 12 к» — длительность в кадрах при `PREVIEW_FPS` */
export function transitionLabel(transition: Transition): string {
  if (transition.type === 'cut') return TRANSITION_NAME.cut
  return `${TRANSITION_NAME[transition.type]} ${Math.round(transition.duration * PREVIEW_FPS)} к`
}

/** Переход в наплыв или через чёрное из «встык» (длина 0) получает эту длину, с. */
export const DEFAULT_TRANSITION_S = 0.4

const SHOT_SIZE: Record<ShotSize, string> = {
  establishing: 'общий',
  action: 'действие',
  reaction: 'реакция',
  detail: 'деталь',
}

export const shotSizeLabel = (size: ShotSize): string => SHOT_SIZE[size]

/** `you@powder-monkey-11` → «Powder monkey» (в Cursus «ты» проходит ранги — важен облик);
 *  у остальных персонажей — имя: `otto@england-1347` → «Otto». */
export function heroLabel(appearance: string): string {
  const [character = '', look = ''] = appearance.split('@')
  const raw = character === 'you' && look ? look.replace(/-\d+$/, '') : character
  const text = raw.replace(/-/g, ' ')
  return text ? text[0]!.toUpperCase() + text.slice(1) : appearance
}

export const heroesLabel = (appearances: string[]): string => appearances.map(heroLabel).join(', ')

const STATUS: Record<PlanShot['status'], { status: Status; label: string }> = {
  todo: { status: 'queued', label: 'в очереди' },
  queued: { status: 'queued', label: 'в очереди' },
  generating: { status: 'generating', label: 'генерация' },
  done: { status: 'ready', label: 'готов' },
  stale: { status: 'warning', label: 'проверить' },
  failed: { status: 'failed', label: 'ошибка' },
  removed: { status: 'queued', label: 'убран' },
}

/** Статус кадра → глиф кита и подпись таблицы */
export const statusOf = (status: PlanShot['status']) => STATUS[status]

/** Годы эпох кадров: `caribbean-1716` и `caribbean-1726` → «1716–1726»; одна эпоха — «1716»; без года — пусто */
export function periodYears(shots: Pick<PlanShot, 'image'>[]): string {
  const years = shots
    .map((shot) => Number(/(\d{3,4})$/.exec(shot.image.period)?.[1]))
    .filter((year) => Number.isFinite(year) && year > 0)
  if (!years.length) return ''
  const first = Math.min(...years)
  const last = Math.max(...years)
  return first === last ? String(first) : `${first}–${last}`
}

export const SHOT_SIZE_OPTIONS = (Object.keys(SHOT_SIZE) as ShotSize[]).map((value) => ({ value, label: SHOT_SIZE[value] }))
export const MOTION_OPTIONS = (Object.keys(MOTION_NAME) as MotionType[]).map((value) => ({ value, label: MOTION_NAME[value] }))
export const TRANSITION_OPTIONS = (Object.keys(TRANSITION_NAME) as TransitionType[]).map((value) => ({
  value,
  label: TRANSITION_NAME[value],
}))
export const ANIMATE_OPTIONS = [
  { value: 'yes', label: 'да' },
  { value: 'no', label: 'нет' },
]
