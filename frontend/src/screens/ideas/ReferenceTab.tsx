/* Вкладка «Референс» экрана 2 (артборд 2): слева 420 — ввод ссылки и субтитров, мост разбора, плашка сходства; справа —
   «Карта структуры»: полоса сегментов, метрики, приёмы, «Что сделать с этой структурой». Состояния: референсов нет —
   ввод; сохранён — мост; разобран — карта. Выбранный референс — в адресе `?ref=`. Текст субтитров после сохранения на
   экране только превью: материал чужой (принцип 11). Метрики считает бэкенд. */
import { FileSearch, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ReferenceVideo } from '@/types/reference'
import {
  useApplyReferenceAnswer,
  useChannelName,
  useCreateReference,
  useReferenceEpisodes,
  useReferencePrompt,
  useReferences,
  useSimilarity,
  type ChannelId,
} from '../../api/queries'
import { formatDuration } from '../../app/format'
import { setSearchParam, useSearchParam } from '../../app/navigation'
import { PanelHeader } from '../../app/PanelHeader'
import { ScreenLayout } from '../../app/ScreenLayout'
import { useStatusNote } from '../../app/useStatusNote'
import { useUiStore } from '../../store/uiStore'
import { Button, EmptyState, Input, Select, Skeleton, Textarea } from '../../ui'
import { CopyPrompt } from '../bridge/CopyPrompt'
import { PasteAnswer, type AppliedAnswer } from '../bridge/PasteAnswer'
import { plural } from '../episodes/board'
import { ReferenceActions, ReferenceSimilarity } from './ReferenceActions'
import { ReferenceMetrics } from './ReferenceMetrics'
import { analyzedNote, percent, referenceHeading, savedToast, subtitlesPreview } from './referenceView'
import { StructureMap } from './StructureMap'
import { Techniques } from './Techniques'

const SEGMENTS = ['сегмент', 'сегмента', 'сегментов'] as const

export function ReferenceTab({ channel, view }: { channel: ChannelId; view: ReactNode }) {
  const references = useReferences(channel)
  const refParam = useSearchParam('ref')
  const [creating, setCreating] = useState(false)
  const list = references.data
  const selected = creating ? null : (list?.find((r) => r.id === refParam) ?? list?.[0] ?? null)
  const showForm = creating || (list !== undefined && list.length === 0)
  useStatusNote(useStatusLine(channel, selected))

  const pick = (id: string) => {
    setCreating(false)
    setSearchParam('ref', id)
  }

  return (
    <ScreenLayout
      header={{
        title: 'Идеи',
        view,
        actions: selected ? <span className="text-12 text-muted">{analyzedNote(selected)}</span> : undefined,
      }}
    >
      <div className="flex min-h-0 min-w-0 flex-1">
        <aside aria-label="Ввод референса" className="flex w-105 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line p-3">
          {references.error ? (
            <p role="alert" className="text-13 text-failed-text">
              {references.error.message}
            </p>
          ) : !list ? (
            <Skeleton variant="text" lines={4} />
          ) : (
            <>
              {list.length > 0 && (
                <div className="flex items-center gap-2">
                  {!creating && (
                    <Select
                      ariaLabel="Референс канала"
                      className="min-w-0 flex-1"
                      value={selected?.id ?? null}
                      onChange={pick}
                      options={list.map((r) => ({ value: r.id, label: referenceHeading(r) }))}
                    />
                  )}
                  {creating ? (
                    <Button variant="ghost" onClick={() => setCreating(false)}>
                      Отмена
                    </Button>
                  ) : (
                    <Button variant="ghost" icon={Plus} onClick={() => setCreating(true)}>
                      Новый референс
                    </Button>
                  )}
                </div>
              )}
              {showForm ? (
                <NewReference channel={channel} onSaved={pick} />
              ) : (
                selected && (
                  <>
                    <SavedReference reference={selected} />
                    <ReferenceBridge reference={selected} />
                    <ReferenceSimilarity channel={channel} referenceId={selected.id} />
                  </>
                )
              )}
            </>
          )}
        </aside>
        <section aria-label="Карта структуры" className="flex min-w-0 flex-1 flex-col">
          <PanelHeader title="Карта структуры" note={selected ? referenceHeading(selected) : undefined} />
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            {!list ? null : !selected ? (
              <EmptyState
                icon={FileSearch}
                title={creating ? 'Новый референс' : 'Референса нет'}
                description="Вставьте субтитры ролика слева — SRT, VTT или расшифровку с YouTube. Чат разберёт структуру: сегменты, темп, приёмы подачи. Текст ролика в сценарий не переносится."
              />
            ) : (
              <Structure reference={selected} />
            )}
          </div>
        </section>
      </div>
    </ScreenLayout>
  )
}

/** «Референс: 22:41, 10 сегментов, сходство 3 %; текст референса в сценарий не переносится» */
function useStatusLine(channel: ChannelId, reference: ReferenceVideo | null): string | null {
  const episodes = useReferenceEpisodes(channel, reference?.id ?? null)
  const similarity = useSimilarity(episodes[0]?.id ?? null).data?.similarity
  if (!reference) return null
  const tail = 'текст референса в сценарий не переносится'
  const metrics = reference.metrics
  if (!metrics) return `Референс: ${formatDuration(reference.duration_s)}, не разобран; ${tail}`
  const share = similarity ? `, сходство ${percent(similarity.ratio)}` : ''
  return `Референс: ${formatDuration(metrics.duration_s)}, ${metrics.segments_total} ${plural(metrics.segments_total, SEGMENTS)}${share}; ${tail}`
}

/** Ввод (артборд 2): ссылка необязательна, субтитры обязательны; ошибка бэкенда — под полем */
function NewReference({ channel, onSaved }: { channel: ChannelId; onSaved: (id: string) => void }) {
  const create = useCreateReference(channel)
  const pushToast = useUiStore((s) => s.pushToast)
  const [url, setUrl] = useState('')
  const [subtitles, setSubtitles] = useState('')
  const [error, setError] = useState<string | null>(null)
  const words = subtitles.trim() ? subtitles.trim().split(/\s+/).length : 0

  const save = async () => {
    setError(null)
    try {
      const reference = await create.mutateAsync({ url, subtitles })
      pushToast({ id: 'reference-saved', message: savedToast(reference), status: 'ready' })
      onSaved(reference.id)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  return (
    <form aria-label="Новый референс" className="flex min-h-0 flex-1 flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
      <label className="flex flex-col gap-1">
        <span className="text-12 font-medium text-muted">Ссылка на ролик</span>
        <Input value={url} onChange={setUrl} type="url" placeholder="youtube.com/watch?v=… — необязательно" ariaLabel="Ссылка на ролик" />
      </label>
      <div className="flex min-h-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="text-12 font-medium text-muted">Или текст и субтитры</span>
          <span className="flex-1" />
          <span className="text-11 text-muted">{words ? `${words} ${plural(words, ['слово', 'слова', 'слов'])}` : 'пусто'}</span>
        </div>
        <Textarea
          value={subtitles}
          onChange={(next) => {
            setSubtitles(next)
            setError(null)
          }}
          variant="prompt"
          rows={14}
          ariaLabel="Субтитры"
          placeholder="SRT, VTT или расшифровка с YouTube с таймкодами"
          error={error ?? undefined}
        />
      </div>
      <Button variant="primary" disabled={!subtitles.trim()} loading={create.isPending} loadingLabel="Сохраняю" onClick={() => void save()}>
        Сохранить
      </Button>
      <p className="text-11 leading-3.5 text-muted">Ссылка только хранится: субтитры вставляются руками, сеть не используется.</p>
    </form>
  )
}

/** Сохранённый референс: ссылка, реплики и длительность, начало текста — не весь текст */
function SavedReference({ reference }: { reference: ReferenceVideo }) {
  return (
    <section aria-label="Субтитры референса" className="flex flex-col gap-1 rounded-panel border border-line bg-panel p-2">
      {reference.url && <span className="truncate text-12 text-ink">{reference.url}</span>}
      <span className="text-11 text-muted">
        {reference.cues} {plural(reference.cues, ['реплика', 'реплики', 'реплик'])}, {formatDuration(reference.duration_s)}
      </span>
      <p className="line-clamp-3 font-script text-11 leading-3.5 text-muted">{subtitlesPreview(reference.subtitles)}</p>
    </section>
  )
}

/** Мост разбора на общих компонентах экранов 2 и 3: промпт в буфер, ответ чата в поле */
function ReferenceBridge({ reference }: { reference: ReferenceVideo }) {
  const prompt = useReferencePrompt(reference.id)
  const answer = useApplyReferenceAnswer(reference.channel, reference.id)

  const request = async () => {
    const issued = await prompt.mutateAsync()
    return { text: issued.text, copied: 'Промпт разбора скопирован' }
  }
  const apply = async (text: string): Promise<AppliedAnswer> => {
    const analyzed = await answer.mutateAsync(text)
    const count = analyzed.analysis?.segments.length ?? 0
    return { toast: `Референс разобран: ${count} ${plural(count, SEGMENTS)}`, warnings: [] }
  }

  return (
    <section aria-label="Разбор через чат" className="flex flex-col gap-2">
      <CopyPrompt label="Скопировать промпт разбора" request={request} />
      {reference.analysis && <span className="text-11 text-muted">Разбор уже есть — новый ответ чата заменит его.</span>}
      <PasteAnswer apply={apply} />
    </section>
  )
}

/** Правая часть: карта, метрики, приёмы и действия; до разбора — пояснение и выключенные действия */
function Structure({ reference }: { reference: ReferenceVideo }) {
  const channelName = useChannelName(reference.channel)
  if (!reference.analysis || !reference.metrics) {
    return (
      <>
        <EmptyState
          icon={FileSearch}
          title="Разбора ещё нет"
          description="Скопируйте промпт разбора слева, вставьте его в чат и верните ответ — здесь появится карта структуры."
        />
        <ReferenceActions reference={reference} />
      </>
    )
  }
  return (
    <>
      <StructureMap metrics={reference.metrics} />
      <ReferenceMetrics metrics={reference.metrics} channelName={channelName} />
      <div className="flex items-start gap-4">
        <Techniques techniques={reference.analysis.techniques} />
        <ReferenceActions reference={reference} />
      </div>
    </>
  )
}
