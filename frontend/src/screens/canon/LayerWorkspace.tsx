/* Рабочая зона слоя канона — одна механика для стиля, эпохи и персонажа (устав M5, решение 1; docs/canon_schema.md,
   «Черновик и публикация»): правка шапки — в черновик автосохранением (800 мс, один PUT), «Опубликовать vN» — с
   подтверждением и списком изменений, отказ 409 — построчно; старая версия — только чтение и «Создать vN из vM»;
   «Сбросить черновик» с «Отменить»; история и сравнение версий в правой колонке и центре. Что рисовать в форме,
   как сравнивать и что писать в статус-строке — решает слой. Локально живёт только несохранённая правка. */
import type { ReactNode } from 'react'
import { useState } from 'react'
import type { CanonVersionInfo } from '@/types/canon'
import { autosaver, useAutosave } from '../../app/autosave'
import { ScreenLayout, type LeftPanelKind, type RightPanelKind, type SidePanel } from '../../app/ScreenLayout'
import { useStatusNote } from '../../app/useStatusNote'
import { ApiError } from '../../api/client'
import {
  useCanonDoc,
  useCanonDraftFrom,
  useDiscardCanonDraft,
  usePublishCanon,
  useSaveCanonDraft,
  type CanonDataOf,
  type CanonPath,
  type ChannelId,
} from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import { Skeleton } from '../../ui'
import { messageOf, nextVersion, type DiffRow, type LayerHead } from './canonFields'
import { PublishDialog, ReadOnlyBar, VersionBar, VersionDiff, VersionHistory } from './VersionBar'

/** Принцип 14 — в статус-строке на каждом слое */
export const LEVEL_NOTE = 'Канон уровня канала: правка не задевает выпуски, пока их не перевели на новую версию'

export interface LayerBodyProps<T> {
  data: T
  /** Есть — форма правится; нет — открыта старая версия, только чтение */
  onChange?: (data: T) => void
  /** Шапка — черновик: главная кнопка экрана — «Опубликовать vN» */
  draft: boolean
  /** Записать несохранённое сейчас — перед действием, которое бэкенд применяет к черновику на диске (ответ моста,
   *  копия облика). false — записать не вышло, действие делать нельзя. */
  flush: () => Promise<boolean>
  /** Бэкенд прислал новый черновик целиком: локальная правка устарела, форма берёт ответ */
  replaced: () => void
}

export interface LayerWorkspaceProps<P extends CanonPath> {
  channel: ChannelId
  path: P
  /** Опубликованные версии из сводки */
  versions: CanonVersionInfo[]
  /** По сводке у слоя есть черновик или версия: без этого шапку не запрашиваем — был бы лишний 404 */
  exists: boolean
  /** Переключатель слоёв в заголовке */
  view: ReactNode
  /** Сущность в тостах: «стиля», «эпохи caribbean-1716» */
  of: string
  /** «первая версия стиля канала» — в подтверждении первой публикации */
  first: string
  diff: (before: CanonDataOf<P>, after: CanonDataOf<P>) => DiffRow[]
  body: (props: LayerBodyProps<CanonDataOf<P>>) => ReactNode
  /** Статус-строка: начало фразы, дальше — `LEVEL_NOTE` */
  status: (state: { head: LayerHead; viewing: string | null; data: CanonDataOf<P> }) => string
  /** Шапки нет (слоя ещё нет или черновик скелета сброшен) */
  empty: ReactNode
  /** Статус-строка без шапки */
  emptyStatus?: string
  left?: SidePanel & { kind: LeftPanelKind }
  /** Правая колонка слоя; история версий — под её содержимым */
  right: Omit<SidePanel, 'collapsible'> & { kind?: RightPanelKind }
  /** «Опубликовать vN» — главная кнопка, если слой не назначил главным другое */
  publishPrimary?: (data: CanonDataOf<P>) => boolean
  /** Дополнение подтверждения публикации */
  publishExtra?: ReactNode
}

export function LayerWorkspace<P extends CanonPath>(props: LayerWorkspaceProps<P>) {
  const { channel, path, versions, exists, view } = props
  const head = useCanonDoc(channel, path, null, exists)
  const pushToast = useUiStore((s) => s.pushToast)

  const [viewing, setViewing] = useState<string | null>(null)
  const viewed = useCanonDoc(channel, path, viewing ?? '', viewing !== null)
  // Несохранённая правка шапки: её видит форма, автосохранение пишет её в черновик
  const [draft, setDraft] = useState<CanonDataOf<P> | undefined>(undefined)
  const save = useSaveCanonDraft(channel, path)
  useAutosave(`canon:${channel}:${path}`, draft, async (data) => (await save.mutateAsync(data)).updated_at)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [compareWith, setCompareWith] = useState<string | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [readOnlyError, setReadOnlyError] = useState<string | null>(null)
  const publish = usePublishCanon(channel, path)
  const draftFrom = useCanonDraftFrom(channel, path)
  const discard = useDiscardCanonDraft(channel, path)

  const latest = versions.at(-1)?.version ?? null
  const next = nextVersion(versions)
  const doc = exists ? (head.data ?? null) : null
  const info: LayerHead | null = doc && { draft: doc.draft, version: doc.version, based_on: doc.based_on }

  // С чем сравнить открытое: выбранное в истории, иначе — версия до открытой (у черновика — та, из которой он начат)
  const shownVersion = viewing ?? (info?.draft ? null : (info?.version ?? null))
  const before = (v: string | null) => {
    const index = versions.findIndex((x) => x.version === v)
    return index > 0 ? versions[index - 1]!.version : null
  }
  const defaultTarget = viewing ? before(viewing) : info?.draft ? (info.based_on ?? latest) : before(info?.version ?? null)
  const target = compareWith && compareWith !== shownVersion ? compareWith : defaultTarget
  const compared = useCanonDoc(channel, path, target ?? '', comparing && target !== null)
  const previous = useCanonDoc(channel, path, latest ?? '', publishOpen && latest !== null)

  const shown = viewing ? viewed.data?.data : (draft ?? doc?.data)
  const loading = exists && head.isLoading

  useStatusNote(
    loading ? null : !doc || !info ? (props.emptyStatus ?? null) : shown ? `${props.status({ head: info, viewing, data: shown })}. ${LEVEL_NOTE}` : null,
  )

  const open = (version: string | null) => {
    setViewing(version === latest && !info?.draft ? null : version)
    setComparing(false)
    setCompareWith(null)
    setReadOnlyError(null)
  }

  const flush = async () => {
    await autosaver.flushAll()
    return !autosaver.hasUnsaved()
  }

  const onPublish = async () => {
    setProblems([])
    if (!(await flush())) {
      setProblems(['Черновик не сохранён — нажмите «Повторить» в шапке и опубликуйте снова.'])
      return
    }
    try {
      const published = await publish.mutateAsync()
      setDraft(undefined)
      setPublishOpen(false)
      setComparing(false)
      pushToast({ id: `canon-publish-${path}`, message: `Опубликована ${published.version}: выпуски на прежних версиях не затронуты`, status: 'ready' })
    } catch (error) {
      setProblems(messageOf(error).split('\n'))
    }
  }

  const onCreateFrom = async (from: string) => {
    setReadOnlyError(null)
    await autosaver.flushAll()
    try {
      await draftFrom.mutateAsync(from)
      setDraft(undefined)
      open(null)
      pushToast({ id: `canon-from-${path}`, message: `Черновик ${next} начат из ${from}: выпуски на ${from} не затронуты`, status: 'ready' })
    } catch (error) {
      setReadOnlyError(messageOf(error))
    }
  }

  const onDiscard = async () => {
    await autosaver.flushAll()
    const lost = draft ?? doc?.data
    try {
      await discard.mutateAsync()
      setDraft(undefined)
      setComparing(false)
      pushToast({
        id: `canon-discard-${path}`,
        message: `Черновик ${props.of} сброшен`,
        status: 'ready',
        action: lost ? { label: 'Отменить', onClick: () => void save.mutateAsync(lost) } : undefined,
      })
    } catch (error) {
      pushToast({ id: `canon-discard-${path}`, message: messageOf(error), status: 'failed' })
    }
  }

  const header = (actions?: ReactNode) => ({ title: 'Канон', titleHidden: true, view, actions })
  const skeleton = (
    <div className="flex flex-col gap-3 p-3">
      <Skeleton className="h-30 w-full" />
      <Skeleton className="h-30 w-full" />
    </div>
  )
  const right = (children: ReactNode): SidePanel & { kind?: RightPanelKind } => ({
    ...props.right,
    collapsible: true,
    children: (
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">{props.right.children}</div>
        {children}
      </div>
    ),
  })

  if (loading) {
    return (
      <ScreenLayout header={header()} left={props.left} right={right(null)}>
        {skeleton}
      </ScreenLayout>
    )
  }
  if (head.error) {
    return (
      <ScreenLayout header={header()} left={props.left} right={right(null)}>
        <p role="alert" className="p-4 text-13 text-failed-text">
          {head.error instanceof ApiError ? head.error.message : 'Канон не загрузился — обновите страницу.'}
        </p>
      </ScreenLayout>
    )
  }
  if (!doc || !info) {
    return (
      <ScreenLayout header={header()} left={props.left} right={right(null)}>
        {props.empty}
      </ScreenLayout>
    )
  }

  const editable = viewing === null
  const afterLabel = viewing ?? (info.draft ? 'черновик' : `${info.version} · текущая`)
  const current = draft ?? doc.data

  return (
    <ScreenLayout
      header={header(
        <VersionBar
          head={info}
          versions={versions}
          viewing={viewing}
          onView={open}
          compareTarget={target}
          comparing={comparing}
          onToggleCompare={() => setComparing((c) => !c)}
          historyOpen={historyOpen}
          onToggleHistory={() => setHistoryOpen((h) => !h)}
          next={next}
          publishPrimary={props.publishPrimary?.(current) ?? true}
          onPublish={() => {
            setProblems([])
            setPublishOpen(true)
            void autosaver.flushAll()
          }}
          onDiscard={() => void onDiscard()}
        />,
      )}
      left={props.left}
      right={right(
        historyOpen && (
          <VersionHistory
            versions={versions}
            current={latest}
            shown={shownVersion}
            onView={open}
            onCompare={(version) => {
              setCompareWith(version)
              setComparing(true)
            }}
            onClose={() => setHistoryOpen(false)}
          />
        ),
      )}
    >
      {viewing && <ReadOnlyBar version={viewing} next={next} onCreate={() => void onCreateFrom(viewing)} onBack={() => open(null)} error={readOnlyError} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!shown ? (
          skeleton
        ) : comparing && target ? (
          compared.data ? (
            <VersionDiff before={target} after={afterLabel} rows={props.diff(compared.data.data as CanonDataOf<P>, shown)} onClose={() => setComparing(false)} />
          ) : (
            skeleton
          )
        ) : (
          props.body({
            data: shown,
            onChange: editable ? setDraft : undefined,
            draft: info.draft || draft !== undefined,
            flush,
            replaced: () => setDraft(undefined),
          })
        )}
      </div>
      <PublishDialog
        open={publishOpen}
        next={next}
        previous={latest}
        rows={latest && previous.data ? props.diff(previous.data.data as CanonDataOf<P>, current) : null}
        first={props.first}
        extra={props.publishExtra}
        problems={problems}
        pending={publish.isPending}
        onConfirm={() => void onPublish()}
        onClose={() => setPublishOpen(false)}
      />
    </ScreenLayout>
  )
}
