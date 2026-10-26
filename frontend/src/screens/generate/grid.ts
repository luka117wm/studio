/* Сетка кадров экрана 4 (M6.7): разделы действующего плана, плитка кадра, сводка раздела, шапка и строка экрана.
   Статус и выбранная версия — из project.json (`shots`), номера версий — из его `assets`: одна загрузка на экран, а не
   запрос версий каждого кадра. Кадра нет в `shots` (его ещё не трогали) — статус из плана. */
import type { EffectivePlan, Section } from '@/types/plan'
import type { Project, ShotState } from '@/types/project'
import type { Status } from '../../ui'
import { failedShots, plural } from '../episodes/board'

export type ShotStatus = ShotState['status']

export interface TileShot {
  id: string
  status: ShotStatus
  /** Выбранная версия — она в миниатюре; null — картинки нет */
  version: number | null
  /** Номера версий кадра по возрастанию */
  versions: number[]
  /** Причина сбоя: одна строка, что случилось и что сделать */
  error: string | null
  staleReasons: string[]
}

export interface GridSection {
  section: Section
  shots: TileShot[]
}

export const SHOTS = ['кадр', 'кадра', 'кадров'] as const
const SECTIONS = ['раздел', 'раздела', 'разделов'] as const
const ERRORS = ['ошибка', 'ошибки', 'ошибок'] as const
const READY = ['готов', 'готовы', 'готовы'] as const

/** Глиф плитки по design/CLAUDE.md; у кадра без картинки и работы (`todo`) глифа нет */
export const TILE_GLYPH: Partial<Record<ShotStatus, Status>> = {
  done: 'ready',
  queued: 'queued',
  generating: 'generating',
  failed: 'failed',
  stale: 'warning',
}

export const TILE_LABEL: Record<ShotStatus, string> = {
  todo: 'не нарисован',
  queued: 'в очереди',
  generating: 'рисуется',
  done: 'готов',
  failed: 'ошибка',
  stale: 'устарел',
  removed: 'убран',
}

/** Разделы плана по порядку, в каждом — его кадры по порядку плана; убранные кадры и пустые разделы не видны */
export function gridSections(plan: EffectivePlan, project: Project | undefined): GridSection[] {
  const versions = new Map<string, number[]>()
  for (const asset of Object.values(project?.assets ?? {})) {
    if (asset.kind !== 'image' || asset.shot_id === null) continue
    versions.set(asset.shot_id, [...(versions.get(asset.shot_id) ?? []), asset.version])
  }
  const bySection = new Map<string, TileShot[]>()
  for (const shot of plan.shots) {
    const state = project?.shots[shot.id]
    const status = state?.status ?? shot.status
    if (status === 'removed') continue
    const tile: TileShot = {
      id: shot.id,
      status,
      version: state?.image_version ?? null,
      versions: (versions.get(shot.id) ?? []).sort((a, b) => a - b),
      error: state?.error ?? null,
      staleReasons: state?.stale_reasons ?? shot.stale_reasons,
    }
    bySection.set(shot.section, [...(bySection.get(shot.section) ?? []), tile])
  }
  return plan.sections.flatMap((section) => {
    const shots = bySection.get(section.id)
    return shots ? [{ section, shots }] : []
  })
}

const count = (shots: TileShot[], status: ShotStatus) => shots.filter((shot) => shot.status === status).length

/** Сводка раздела справа в заголовке: ошибки важнее работы, работа — готовности */
export function sectionNote(shots: TileShot[]): { text: string; status: Status | null } {
  const done = count(shots, 'done')
  const failed = count(shots, 'failed')
  if (failed) return { text: `${failed} ${plural(failed, ERRORS)}, ${done} ${plural(done, READY)}`, status: 'failed' }
  if (count(shots, 'generating')) return { text: 'рисуется', status: 'generating' }
  if (count(shots, 'queued')) return { text: 'в очереди', status: 'queued' }
  if (done === shots.length) return { text: 'все готовы', status: null }
  const stale = count(shots, 'stale')
  if (stale) return { text: `${stale} ${plural(stale, ['устарел', 'устарели', 'устарели'])}`, status: 'warning' }
  return { text: done ? `${done} из ${shots.length} ${plural(shots.length, READY)}` : 'не нарисованы', status: null }
}

/** Приписка заголовка экрана: «104 кадра, 8 разделов» */
export function headerNote(sections: GridSection[]): string {
  const shots = sections.reduce((sum, { shots }) => sum + shots.length, 0)
  return `${shots} ${plural(shots, SHOTS)}, ${sections.length} ${plural(sections.length, SECTIONS)}`
}

const LISTED = 5

/** Строка экрана в статус-строке: «Кадры 78 из 104», сбои — «2 кадра не удались: s047, s071» */
export function statusNote(sections: GridSection[]): string {
  const shots = sections.flatMap((section) => section.shots)
  const failed = shots.filter((shot) => shot.status === 'failed').map((shot) => shot.id)
  const line = `Кадры ${count(shots, 'done')} из ${shots.length}`
  if (!failed.length) return line
  const ids = failed.length > LISTED ? `${failed.slice(0, LISTED).join(', ')} и ещё ${failed.length - LISTED}` : failed.join(', ')
  return `${line}, ${failed.length} ${failedShots(failed.length)}: ${ids}`
}

/** Нарисована ли у выпуска хоть одна версия: до первой пачки вместо сетки — пустое состояние с ценой */
export const hasImages = (project: Project | undefined) => Object.values(project?.assets ?? {}).some((asset) => asset.kind === 'image')

/** Подписи сегментов модели: без общего для всех моделей каталога начала («Nano Banana 2 Lite» → «2 Lite»); хотя бы
 *  слово у каждой остаётся, одна модель — подпись целиком */
export function shortLabels(labels: readonly string[]): string[] {
  if (labels.length < 2) return [...labels]
  const words = labels.map((label) => label.split(' '))
  let common = 0
  while (words.every((w) => w.length > common + 1 && w[common] === words[0]![common])) common += 1
  return words.map((w) => w.slice(common).join(' '))
}
