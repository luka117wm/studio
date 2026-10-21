/* «Канон выпуска» в правой панели экрана 3 (M5.10; устав M5, решения 3 и 8): к каким версиям канона прибит выпуск и
   чего не хватает для утверждения. Стиль, эпохи и облики плана — прибитая версия и статус, у облика — лист опорных
   портретов; сущность и лист — ссылки на экран 12. «Перевести на новые версии» — новая версия плана с последними
   версиями канона, только после подтверждения (принцип 14). Статусы и проблемы считает бэкенд (`GET …/canon`). */
import { useState } from 'react'
import type { AnchorSheet, EpisodeCanon, EpisodeCanonItem } from '@/types/plan'
import { useUpdateEpisodeCanon } from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import { Button, Dialog, Skeleton, StatusGlyph, cn, type Status } from '../../ui'
import { plural } from '../episodes/board'
import { CanonLink } from './CanonLink'
import { canonHref, canonIssues } from './canonLinks'

type CanonKind = 'style' | 'period' | 'appearance'

const SHOTS = ['кадр', 'кадра', 'кадров'] as const

/** Статус ссылки плана: прибита последняя версия, есть новее, версия не находится, только черновик, нет версии */
function refState(item: EpisodeCanonItem): { status: Status; label: string } {
  if (item.status === 'ready') return { status: 'ready', label: 'готов' }
  if (item.status === 'draft_only') return { status: 'warning', label: 'только черновик' }
  if (item.status === 'missing') return { status: 'failed', label: 'нет версии' }
  return item.resolved ? { status: 'warning', label: `есть ${item.latest}` } : { status: 'failed', label: `не находится, есть ${item.latest}` }
}

const SHEET: Record<AnchorSheet['status'], Status> = { ready: 'ready', partial: 'warning', outdated: 'warning', missing: 'failed' }

function sheetLabel(sheet: AnchorSheet): string {
  if (sheet.status === 'missing') return 'листа нет'
  if (sheet.status === 'outdated') return 'лист устарел'
  return `лист ${sheet.chosen}/${sheet.total}`
}

const WORST: Status[] = ['failed', 'warning', 'ready']
const worst = (...statuses: Status[]) => WORST.find((s) => statuses.includes(s)) ?? 'ready'

const TEXT: Partial<Record<Status, string>> = { ready: 'text-muted', warning: 'text-warning', failed: 'text-failed-text' }

export interface CanonPanelProps {
  episodeId: string
  canon: EpisodeCanon | null | undefined
  error: Error | null
  /** Текущая версия плана утверждена — перевод вернёт выпуск в «Сценарий» */
  approved: boolean
}

export function CanonPanel({ episodeId, canon, error, approved }: CanonPanelProps) {
  const [confirm, setConfirm] = useState(false)
  const issues = canon ? canonIssues(canon) : []
  return (
    <section aria-label="Канон выпуска" className="flex flex-col gap-2 border-t border-line p-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="shrink-0 text-13 font-semibold text-ink">Канон выпуска</h2>
        {canon && (
          <span className={cn('text-12', canon.ready ? 'text-muted' : 'text-warning')}>
            {canon.ready ? 'готов' : issues.length ? issues.join(', ') : 'не готов'}
          </span>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-12 text-failed-text">
          {error.message}
        </p>
      ) : canon === undefined ? (
        <Skeleton variant="text" lines={3} />
      ) : canon === null ? null : (
        <>
          <ul aria-label="Версии канона" className="flex flex-col gap-1">
            <CanonRow kind="style" item={canon.style} title="Стиль канала" />
            {canon.periods.map((item) => (
              <CanonRow key={item.id} kind="period" item={item} title={item.id} />
            ))}
            {canon.appearances.map((item) => (
              <CanonRow key={item.id} kind="appearance" item={item} title={item.id} sheet={item.resolved ? item.sheet : null} />
            ))}
          </ul>
          {canon.updatable && (
            <Button variant="secondary" size="sm" className="self-start" onClick={() => setConfirm(true)}>
              Перевести на новые версии
            </Button>
          )}
          <UpdateDialog
            open={confirm}
            onClose={() => setConfirm(false)}
            episodeId={episodeId}
            canon={canon}
            approved={approved}
          />
        </>
      )}
    </section>
  )
}

/** Строка сущности: ссылка, прибитая версия, статус; у облика с найденной версией — ещё лист, ссылкой на лист */
function CanonRow({ kind, item, title, sheet }: { kind: CanonKind; item: EpisodeCanonItem; title: string; sheet?: AnchorSheet | null }) {
  const state = refState(item)
  const glyph = sheet ? worst(state.status, SHEET[sheet.status]) : state.status
  return (
    <li className="flex min-w-0 items-center gap-2 text-12 leading-4">
      <StatusGlyph status={glyph} label={sheet ? `${state.label}, ${sheetLabel(sheet)}` : state.label} className="shrink-0" />
      <CanonLink href={canonHref(kind, item.id)} className="min-w-0 flex-1 truncate text-ink">
        {title}
      </CanonLink>
      <span className="shrink-0 font-dense text-muted">{item.pinned ?? '—'}</span>
      {(item.status !== 'ready' || !sheet) && <span className={cn('shrink-0', TEXT[state.status])}>{state.label}</span>}
      {sheet && (
        <CanonLink href={canonHref(kind, item.id, true)} className={cn('shrink-0', TEXT[SHEET[sheet.status]])}>
          {sheetLabel(sheet)}
        </CanonLink>
      )}
    </li>
  )
}

/** Подтверждение перевода: что на что сменится и сколько кадров станут `stale`; картинки остаются (принцип 8) */
function UpdateDialog({
  open,
  onClose,
  episodeId,
  canon,
  approved,
}: {
  open: boolean
  onClose: () => void
  episodeId: string
  canon: EpisodeCanon
  approved: boolean
}) {
  const update = useUpdateEpisodeCanon(episodeId)
  const pushToast = useUiStore((s) => s.pushToast)
  const moves = [
    { subject: 'стиль канала', item: canon.style },
    ...canon.periods.map((item) => ({ subject: `эпоха ${item.id}`, item })),
    ...canon.appearances.map((item) => ({ subject: `облик ${item.id}`, item })),
  ].filter(({ item }) => item.latest !== null && item.latest !== item.pinned)

  const close = () => {
    update.reset()
    onClose()
  }
  const submit = async () => {
    try {
      const result = await update.mutateAsync()
      const stale = result.changes.filter((change) => change.stale).length
      pushToast({
        id: 'canon-update',
        message: result.created
          ? `План ${result.version} на новых версиях канона: ${stale} ${plural(stale, SHOTS)} stale`
          : 'Переводить нечего: план уже на последних версиях канона',
        status: 'ready',
      })
      close()
    } catch {
      // Показ — из update.error
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Перевести на новые версии"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Отмена
          </Button>
          <Button variant="primary" loading={update.isPending} loadingLabel="Перевожу план" onClick={() => void submit()}>
            Перевести
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <p>Новая версия плана получит последние опубликованные версии канона:</p>
        <ul aria-label="Что сменится" className="flex flex-col gap-1">
          {moves.map(({ subject, item }) => (
            <li key={subject} className="text-12">
              {subject}: {item.pinned} → {item.latest}
              <span className="text-muted">
                , {item.shots} {plural(item.shots, SHOTS)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-12 text-warning">Затронутые кадры станут stale, картинки останутся.</p>
        {approved && <p className="text-12 text-muted">План утверждён — после перевода утвердить его нужно будет снова.</p>}
        {update.error && (
          <p role="alert" className="text-12 text-failed-text">
            {update.error.message}
          </p>
        )}
      </div>
    </Dialog>
  )
}
