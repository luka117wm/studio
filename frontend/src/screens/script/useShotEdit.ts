/* Правка одного поля кадра (устав M4, решение 6): черновик на экране → автосохранение 800 мс →
   PATCH `{shots: {id: {user_override: …}}}` → действующий план перезапрашивается с бэкенда (M4.3).
   Ключ автосохранения — `shot:<id>:<путь>`: тип и сила движения, поправленные подряд, пишутся каждое своей записью.
   «Вернуть из плана» — `null` у поля правки. Ошибка 422 (стоп-лист, диапазон) — текстом под полем, значение остаётся. */
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Shot } from '@/types/director'
import type { PlanShot, Transition } from '@/types/plan'
import type { Project } from '@/types/project'
import type { ProjectPatch } from '@/types/project_patch'
import { ApiError, api } from '../../api/client'
import { qk } from '../../api/queries'
import { useAutosave } from '../../app/autosave'
import type { MotionType, ShotSize } from './shotLabels'

/** Что правится на листе и в таблице: путь листа правки кадра */
export interface EditValues {
  vo: string
  'image.prompt': string
  'image.shot_size': ShotSize
  'motion.type': MotionType
  'motion.strength': number
  transition_in: Transition
  'animate.recommended': boolean
}
export type EditPath = keyof EditValues

type OverrideField = PlanShot['overridden'][number]

/** Поле правки бэкенда, к которому относится путь: его сбрасывает «Вернуть из плана» и его отмечает `overridden` */
export const OVERRIDE_OF: Record<EditPath, OverrideField> = {
  vo: 'vo',
  'image.prompt': 'image.prompt',
  'image.shot_size': 'image.shot_size',
  'motion.type': 'motion',
  'motion.strength': 'motion',
  transition_in: 'transition_in',
  'animate.recommended': 'animate',
}

export const EMPTY_VO = 'VO не может быть пустым'

type ShotFields = Pick<Shot, 'vo' | 'image' | 'motion' | 'transition_in' | 'animate'>

export function readPath<P extends EditPath>(shot: ShotFields, path: P): EditValues[P] {
  const values: EditValues = {
    vo: shot.vo,
    'image.prompt': shot.image.prompt,
    'image.shot_size': shot.image.shot_size,
    'motion.type': shot.motion.type,
    'motion.strength': shot.motion.strength,
    // В файле версии поля со значением по умолчанию могут отсутствовать
    transition_in: { type: shot.transition_in?.type ?? 'cut', duration: shot.transition_in?.duration ?? 0 },
    'animate.recommended': shot.animate?.recommended ?? false,
  }
  return values[path]
}

/** `motion.strength` и 0.12 → `{motion: {strength: 0.12}}`; поле правки и null → сброс этого поля */
export function nested(path: string, value: unknown): Record<string, unknown> {
  return path
    .split('.')
    .reverse()
    .reduce<unknown>((inner, key) => ({ [key]: inner }), value) as Record<string, unknown>
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Текст ошибки для подписи под полем: `msg` из `detail[]` PATCH, без пути `shots.s003.…` */
export function fieldMessage(error: unknown): string {
  if (error instanceof ApiError && Array.isArray(error.detail)) {
    const lines = error.detail
      .map((item: unknown) => (typeof item === 'object' && item !== null && 'msg' in item ? String(item.msg) : ''))
      .filter(Boolean)
    if (lines.length) return lines.join('; ')
  }
  return error instanceof Error ? error.message : String(error)
}

const RESET = Symbol('reset')
/** Что записать и что при этом показано на экране: после записи черновик, равный показанному, снимается */
type Pending<T> = { value: T | typeof RESET; shown: T | undefined }

export interface ShotEdit<T> {
  value: T
  set: (value: T) => void
  /** Вернуть значение версии плана: на экране сразу, на бэкенд — `null` у поля правки */
  reset: () => void
  /** Поле поправлено (по бэкенду или черновиком, отличным от плана) */
  overridden: boolean
  /** Значение в версии плана; `undefined`, пока версия не загружена */
  planValue: T | undefined
  error: string | null
}

export function useShotEdit<P extends EditPath>(
  episodeId: string,
  shot: PlanShot,
  planShot: Shot | undefined,
  path: P,
): ShotEdit<EditValues[P]> {
  const client = useQueryClient()
  const server = readPath(shot, path)
  const planValue = planShot ? readPath(planShot, path) : undefined
  const [draft, setDraft] = useState<EditValues[P] | undefined>(undefined)
  const [pending, setPending] = useState<Pending<EditValues[P]> | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useAutosave(
    `shot:${episodeId}:${shot.id}:${path}`,
    pending,
    async ({ value, shown }) => {
      const override = value === RESET ? nested(OVERRIDE_OF[path], null) : nested(path, value)
      const body: ProjectPatch = { shots: { [shot.id]: { user_override: override } } }
      const project = await api.patch<Project>(`/projects/${encodeURIComponent(episodeId)}`, body, { keepalive: true })
      setError(null)
      await client.invalidateQueries({ queryKey: qk.plan(episodeId), exact: true })
      // Действующий план уже с записанным значением — черновик больше не нужен, если его не успели поменять
      setDraft((current) => (same(current, shown) ? undefined : current))
      return project.updated_at
    },
    { onFail: (failure) => setError(fieldMessage(failure)) },
  )

  const value = draft ?? server
  return {
    value,
    set: (next) => {
      setDraft(next)
      if (path === 'vo' && typeof next === 'string' && !next.trim()) {
        setError(EMPTY_VO)
        return
      }
      setError(null)
      setPending({ value: next, shown: next })
    },
    reset: () => {
      setError(null)
      setDraft(planValue)
      setPending({ value: RESET, shown: planValue })
    },
    overridden:
      shot.overridden.includes(OVERRIDE_OF[path]) || (draft !== undefined && planValue !== undefined && !same(draft, planValue)),
    planValue,
    error,
  }
}
