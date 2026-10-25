/* Адреса экрана 3 на канон канала (экран 12, M5.10) и строка канона для заголовка секции и статус-строки. Адреса —
   как у экрана 12 (M5.8, M5.9): `?layer=periods&period=…`, `?layer=characters&character=…&appearance=…`, лист
   опорных портретов — ещё `&sheet=…`. Канал экрана 12 — канал открытого выпуска (`openEpisode`), в адрес не идёт.
   Сама ссылка — `CanonLink.tsx`. Статус ссылки и листа — общие с каноном выпуска экрана 4 (M6.7). */
import type { AnchorSheet, CanonTarget, EpisodeCanon, EpisodeCanonItem } from '@/types/plan'
import { paths } from '../../app/routes'
import type { Status } from '../../ui'
import { plural } from '../episodes/board'

type CanonKind = CanonTarget['kind']
type CanonIssue = CanonTarget['issue']

const SHEET_ISSUES: ReadonlySet<CanonIssue> = new Set(['no_sheet', 'sheet_incomplete', 'sheet_outdated'])

/** Адрес сущности на экране 12; `sheet` — сразу лист опорных портретов облика */
export function canonHref(kind: CanonKind, id: string, sheet = false): string {
  if (kind === 'style') return paths.canon
  const params = new URLSearchParams(
    kind === 'period' ? { layer: 'periods', period: id } : { layer: 'characters', character: id.split('@')[0] ?? id, appearance: id },
  )
  if (sheet && kind === 'appearance') params.set('sheet', id)
  return `${paths.canon}?${params.toString()}`
}

/** Проблема канона ведёт туда, где её чинят: лист — на лист облика, остальное — на сущность */
export const problemHref = (target: CanonTarget) => canonHref(target.kind, target.id, SHEET_ISSUES.has(target.issue))

/** Чего не хватает канону выпуска: «1 эпоха не опубликована», «2 из 5 обликов без листа»; готов — пусто */
export function canonIssues(canon: EpisodeCanon): string[] {
  const counted = (kind: CanonKind | null, issue: CanonIssue) =>
    canon.problems.filter((p) => (kind === null || p.kind === kind) && p.issue === issue).length
  const parts: string[] = []
  if (counted('style', 'unpublished')) parts.push('стиль не опубликован')
  const periods = counted('period', 'unpublished')
  if (periods) parts.push(`${periods} ${plural(periods, ['эпоха', 'эпохи', 'эпох'])} не ${plural(periods, ['опубликована', 'опубликованы', 'опубликованы'])}`)
  const looks = counted('appearance', 'unpublished')
  if (looks) parts.push(`${looks} ${plural(looks, ['облик', 'облика', 'обликов'])} не ${plural(looks, ['опубликован', 'опубликованы', 'опубликованы'])}`)
  const unresolved = counted(null, 'unresolved')
  if (unresolved) parts.push(`${unresolved} ${plural(unresolved, ['ссылка', 'ссылки', 'ссылок'])} не ${plural(unresolved, ['находит', 'находят', 'находят'])} версию`)
  const sheets = canon.problems.filter((p) => SHEET_ISSUES.has(p.issue)).length
  const total = canon.appearances.length
  if (sheets) parts.push(`${sheets} из ${total} ${plural(total, ['облика', 'обликов', 'обликов'])} без листа`)
  return parts
}

/** Строка статус-строки экрана 3, пока канон не готов: «Канон: 2 из 5 обликов без листа» */
export function canonNote(canon: EpisodeCanon | null | undefined): string | null {
  if (!canon || canon.ready) return null
  const parts = canonIssues(canon)
  return parts.length ? `Канон: ${parts.join(', ')}` : 'Канон не готов'
}

/** Статус ссылки плана: прибита последняя версия, есть новее, версия не находится, только черновик, нет версии */
export function refState(item: EpisodeCanonItem): { status: Status; label: string } {
  if (item.status === 'ready') return { status: 'ready', label: 'готов' }
  if (item.status === 'draft_only') return { status: 'warning', label: 'только черновик' }
  if (item.status === 'missing') return { status: 'failed', label: 'нет версии' }
  return item.resolved ? { status: 'warning', label: `есть ${item.latest}` } : { status: 'failed', label: `не находится, есть ${item.latest}` }
}

export const SHEET_STATUS: Record<AnchorSheet['status'], Status> = { ready: 'ready', partial: 'warning', outdated: 'warning', missing: 'failed' }

export function sheetLabel(sheet: AnchorSheet): string {
  if (sheet.status === 'missing') return 'листа нет'
  if (sheet.status === 'outdated') return 'лист устарел'
  return `лист ${sheet.chosen}/${sheet.total}`
}
