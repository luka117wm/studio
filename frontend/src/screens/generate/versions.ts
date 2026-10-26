/* Версии кадра для режима «Сравнение версий» экрана 4 (M6.9; устав M6, решения 1, 8): карточки собираются из
   project.json — строки `assets` кадра с метаданными отрисовки и проверками, выбранная — `ShotState.image_version`.
   Как и сетка, экран не запрашивает версии каждого кадра: project.json уже живёт от потока SSE. Новые — справа.
   Сходство лица словами (решение пользователя 2026-10-26): «высокое» — от порога проверки плюс запас 0.10, ниже до
   порога — «среднее»; тёплый цвет — только у `low`, его же помечает бэкенд (`consistency_low`). */
import type { JobEventData } from '@/types/job'
import type { FaceCheck, Project } from '@/types/project'
import type { Status } from '../../ui'
import { formatClock, formatSlotDate } from '../../app/format'
import type { ShotStatus } from './grid'

export interface VersionCard {
  version: number
  variant: number
  /** Ключ каталога `images`, каким нарисована версия */
  model: string | null
  modelId: string | null
  seed: number | null
  createdAt: string | null
  usdMicro: number
  cached: boolean
  face: FaceWord
  /** Найденное проверкой анахронизмов — формулировкой канона; пусто — ничего или проверки не было */
  found: string[]
}

export interface FaceWord {
  word: 'высокое' | 'среднее' | 'низкое' | 'лицо не найдено' | 'не проверено'
  /** Глиф и цвет; `null` — нейтральный текст */
  status: Status | null
  /** Сходство по обликам или причина пропуска — в подсказку */
  detail: string | null
}

/** Запас над порогом проверки, с которого сходство «высокое»: на своих картинках канала профиль того же лица — 0.53,
 *  кадр в сцене — 0.63, три четверти — 0.77 при пороге 0.47 (docs/generation.md, «Порог») */
export const FACE_HIGH_MARGIN = 0.1

/** Сходство лица версии словами: слово даёт худший из обликов кадра */
export function faceWord(face: FaceCheck | null | undefined): FaceWord {
  if (!face || face.status === 'skipped') return { word: 'не проверено', status: null, detail: face?.reason ?? null }
  if (face.status === 'no_face') return { word: 'лицо не найдено', status: null, detail: 'в кадре нет лиц, которые можно проверить' }
  const detail = face.appearances
    .map((match) => (typeof match.score === 'number' ? `${match.id} — ${match.score.toFixed(2)}` : `${match.id} — ${match.reason ?? 'не проверен'}`))
    .join('; ')
  if (face.status === 'low') return { word: 'низкое', status: 'warning', detail }
  const scores = face.appearances.flatMap((match) => (match.status === 'ok' && typeof match.score === 'number' ? [match.score] : []))
  const worst = scores.length ? Math.min(...scores) : null
  const high = typeof face.threshold === 'number' && worst !== null ? worst >= face.threshold + FACE_HIGH_MARGIN : true
  return high ? { word: 'высокое', status: 'ready', detail } : { word: 'среднее', status: null, detail }
}

/** Версии кадра по возрастанию номера: старые слева, новые справа */
export function versionCards(project: Project | undefined, shotId: string): VersionCard[] {
  return Object.values(project?.assets ?? {})
    .filter((asset) => asset.kind === 'image' && asset.shot_id === shotId)
    .sort((a, b) => a.version - b.version)
    .map((asset) => {
      const anachronism = asset.checks?.anachronism
      return {
        version: asset.version,
        variant: asset.variant ?? asset.version,
        model: asset.model ?? null,
        modelId: asset.model_id ?? null,
        seed: asset.seed ?? null,
        createdAt: asset.created_at ?? null,
        usdMicro: asset.usd_micro ?? 0,
        cached: asset.cached === true,
        face: faceWord(asset.checks?.face),
        found: anachronism?.status === 'suspect' ? anachronism.found : [],
      }
    })
}

/** Джоб «Добавить версию», поставленный из режима: вариант — из его payload */
export interface TrackedJob {
  jobId: string
  variant: number
}

export interface PendingCard {
  key: string
  label: 'в очереди' | 'рисуется'
}

const ACTIVE: ReadonlySet<string> = new Set(['queued', 'running'])

/** Карточки «рисуется» справа от версий. Свой джоб держит карточку, пока версии его варианта нет в project.json: конец
 *  джоба приходит по SSE раньше перезапроса project.json, и штриховка не должна мигнуть пустотой. Сбой и отмена
 *  карточку снимают (причина — тостом и на плитке). Кадр в работе без своих джобов (рисует пачка) — одна карточка. */
export function pendingCards(tracked: readonly TrackedJob[], jobs: readonly JobEventData[] | undefined, cards: readonly VersionCard[], status: ShotStatus): PendingCard[] {
  const pending = tracked.flatMap((job): PendingCard[] => {
    if (cards.some((card) => card.variant === job.variant)) return []
    const state = jobs?.find((item) => item.job_id === job.jobId)
    if (state && !ACTIVE.has(state.status) && state.status !== 'done') return []
    return [{ key: job.jobId, label: state?.status === 'running' || state?.status === 'done' ? 'рисуется' : 'в очереди' }]
  })
  if (pending.length || (status !== 'queued' && status !== 'generating')) return pending
  return [{ key: 'shot', label: status === 'generating' ? 'рисуется' : 'в очереди' }]
}

const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** «Создана»: сегодня — «11:41», раньше — «11 сент 11:41» (по часам машины) */
export function formatCreated(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const day = localDay(date)
  return day === localDay(now) ? formatClock(iso) : `${formatSlotDate(day)} ${formatClock(iso)}`
}
