/* Версии слоя «Стиль» (артборд 12, правая часть заголовка): выбор версии, «История», «Сравнить с vN», «Опубликовать vN»
   с подтверждением и списком изменений; полоса «только чтение» у старой версии с «Создать vN из vM»; список версий.
   Опубликованная версия в интерфейсе не правится (принцип 14): правка — только в черновик. */
import { Lock } from 'lucide-react'
import type { CanonVersionInfo, Style } from '@/types/canon'
import { formatSlotDate } from '../../app/format'
import { Button, Dialog, DropdownMenu, cn, type MenuItem } from '../../ui'
import { diffStyle, diffSummary, headLabel, type StyleHead } from './styleFields'

const publishedOn = (info: CanonVersionInfo) =>
  `${formatSlotDate(info.published_at.slice(0, 10), { long: true })} ${info.published_at.slice(0, 4)}`

export interface VersionBarProps {
  head: StyleHead
  versions: CanonVersionInfo[]
  /** Открытая версия только для чтения; null — шапка */
  viewing: string | null
  onView: (version: string | null) => void
  /** С какой версией сравнить открытое: null — сравнивать не с чем */
  compareTarget: string | null
  comparing: boolean
  onToggleCompare: () => void
  historyOpen: boolean
  onToggleHistory: () => void
  /** Номер будущей версии — «Опубликовать v004» */
  next: string
  onPublish: () => void
  onDiscard: () => void
}

export function VersionBar(props: VersionBarProps) {
  const { head, versions, viewing } = props
  const latest = versions.at(-1)?.version ?? null
  const items: MenuItem[] = [
    { id: 'head', label: headLabel(head), onSelect: () => props.onView(null) },
    ...[...versions]
      .reverse()
      .filter((v) => head.draft || v.version !== latest)
      .map((v): MenuItem => ({ id: v.version, label: `${v.version} · ${publishedOn(v)}`, onSelect: () => props.onView(v.version) })),
    ...(head.draft ? ([{ id: 'sep', separator: true }, { id: 'discard', label: 'Сбросить черновик', danger: true, onSelect: props.onDiscard }] satisfies MenuItem[]) : []),
  ]
  const label = viewing ? `${viewing} · только чтение` : headLabel(head)
  return (
    <div className="flex items-center gap-2">
      <DropdownMenu trigger="button" label={label} items={items} className={cn(viewing && 'border-warning')} />
      <Button variant="ghost" onClick={props.onToggleHistory} className={cn(props.historyOpen && 'bg-line text-ink')}>
        История
      </Button>
      {props.compareTarget && (
        <Button onClick={props.onToggleCompare} className={cn(props.comparing && 'border-line-strong')}>
          {props.comparing ? 'Закрыть сравнение' : `Сравнить с ${props.compareTarget}`}
        </Button>
      )}
      {head.draft && viewing === null && (
        <Button variant="primary" onClick={props.onPublish}>
          {`Опубликовать ${props.next}`}
        </Button>
      )}
    </div>
  )
}

/** Старая версия: форма только для чтения, правка — новой версией из этой */
export function ReadOnlyBar({ version, next, onCreate, onBack, error }: { version: string; next: string; onCreate: () => void; onBack: () => void; error: string | null }) {
  return (
    <div role="note" aria-label="Только чтение" className="flex items-center gap-3 border-b border-warning bg-surface-warning px-4 py-2.5">
      <Lock className="size-icon shrink-0 text-warning" strokeWidth={1.5} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-13 font-medium text-warning">{`Версия ${version} — только чтение. Правка создаст ${next}`}</span>
        <span className="text-12 text-muted">
          {error ?? 'Опубликованная версия не меняется. Чтобы править, создайте новую версию — выпуски на старой останутся как есть.'}
        </span>
      </div>
      <Button variant="statusOutline" status="warning" onClick={onCreate}>
        {`Создать ${next} из ${version}`}
      </Button>
      <Button variant="ghost" onClick={onBack}>
        К текущей версии
      </Button>
    </div>
  )
}

/** История версий: номер, дата публикации, из какой версии начата; клик — открыть версию */
export function VersionHistory({
  versions,
  current,
  shown,
  onView,
  onCompare,
  onClose,
}: {
  versions: CanonVersionInfo[]
  /** Последняя опубликованная — «текущая» */
  current: string | null
  /** Открытая сейчас версия: её не с чем сравнивать */
  shown: string | null
  onView: (version: string) => void
  onCompare: (version: string) => void
  onClose: () => void
}) {
  return (
    <section aria-label="История версий" className="shrink-0 border-t border-line">
      <div className="flex h-shell-panel-header items-center gap-2 border-b border-line bg-strip px-3">
        <h2 className="text-13 font-semibold text-ink">История версий</h2>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onClose}>
          Скрыть
        </Button>
      </div>
      {versions.length === 0 ? (
        <p className="px-3 py-2 text-12 text-muted">Версий ещё нет: опубликуйте черновик — он станет v001.</p>
      ) : (
        <ul className="max-h-48 overflow-y-auto">
          {[...versions].reverse().map((v) => (
            <li key={v.version} className={cn('flex h-row-lg items-center gap-2 border-b border-row-border px-3', v.version === shown && 'bg-raised')}>
              <span aria-hidden className={cn('size-2 shrink-0 rounded-full', v.version === shown ? 'bg-accent' : 'border-[1.5px] border-line-strong')} />
              <button type="button" onClick={() => onView(v.version)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="w-11 shrink-0 font-dense text-12 font-medium text-ink">{v.version}</span>
                <span className="truncate text-12 text-muted">
                  {publishedOn(v)}
                  {v.based_on ? `, из ${v.based_on}` : ', первая версия'}
                </span>
              </button>
              {v.version === current && <span className="font-dense text-11 text-accent">текущая</span>}
              {v.version !== shown && (
                <Button size="sm" variant="ghost" onClick={() => onCompare(v.version)}>
                  Сравнить
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Подтверждение публикации: что изменилось к последней версии; отказ 409 — построчно */
export function PublishDialog({
  open,
  next,
  previous,
  draft,
  problems,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean
  next: string
  previous: { version: string; style: Style } | null
  draft: Style
  problems: string[]
  pending: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const rows = previous ? diffStyle(previous.style, draft).filter((r) => r.changed) : []
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Опубликовать ${next}`}
      note={previous ? `изменения к ${previous.version}` : 'первая версия стиля канала'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={onConfirm} loading={pending} loadingLabel="Публикую">
            {`Опубликовать ${next}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-13">
        {previous ? (
          <>
            <p className="text-muted">{diffSummary(diffStyle(previous.style, draft))}:</p>
            <ul aria-label="Изменения к прошлой версии" className="flex flex-col gap-1">
              {rows.map((r) => (
                <li key={r.label} className="flex gap-2">
                  <span className="w-37 shrink-0 font-medium text-warning">{r.label}</span>
                  <span className="min-w-0 text-ink">{r.after}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-muted">Черновик станет v001 — первой версией стиля канала.</p>
        )}
        <p className="text-12 text-muted">Выпуски на прежних версиях не меняются: перевести выпуск на новую версию — отдельное действие на экране «Сценарий и план».</p>
        {problems.length > 0 && (
          <ul aria-label="Что мешает опубликовать" className="flex flex-col gap-1 text-12 text-failed-text">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
