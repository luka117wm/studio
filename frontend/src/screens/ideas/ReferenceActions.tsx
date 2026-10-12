/* «Что сделать с этой структурой» (артборд 2): «Новая тема по этой структуре» (`structure_clone`) и «Своя версия этой
   темы» (`own_version`) создают выпуск по референсу и ведут на экран 3 с тостом, как диалог «Новый выпуск» (M3.6).
   Без разбора кнопки выключены. Плашка сходства — текст референса в сценарий не переносится, по выпускам этого
   референса — сходство плана (принцип 11). */
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { EpisodeListItem } from '@/types/episode'
import type { ReferenceVideo } from '@/types/reference'
import {
  useChannelName,
  useCreateEpisodeFromReference,
  useReferenceEpisodes,
  useSimilarity,
  type ChannelId,
} from '../../api/queries'
import { navigate } from '../../app/navigation'
import { paths } from '../../app/routes'
import { useUiStore } from '../../store/uiStore'
import { Button } from '../../ui'
import { createdToast } from '../episodes/board'
import { SimilarityBadge } from './SimilarityBadge'

type Mode = 'structure_clone' | 'own_version'

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'structure_clone', label: 'Новая тема по этой структуре' },
  { mode: 'own_version', label: 'Своя версия этой темы' },
]

export function ReferenceActions({ reference }: { reference: ReferenceVideo }) {
  const create = useCreateEpisodeFromReference(reference.id)
  const channelName = useChannelName(reference.channel)
  const pushToast = useUiStore((s) => s.pushToast)
  const openEpisode = useUiStore((s) => s.openEpisode)
  const [busy, setBusy] = useState<Mode | null>(null)
  const analyzed = reference.analysis !== null

  const start = async (mode: Mode) => {
    setBusy(mode)
    try {
      const episode = await create.mutateAsync(mode)
      pushToast({ id: `created-${episode.id}`, message: createdToast(channelName, episode.slot_date), status: 'ready' })
      openEpisode(episode)
      navigate(paths.stage(episode.id, 'script'))
    } catch (error) {
      pushToast({ id: 'reference-episode', message: error instanceof Error ? error.message : String(error), status: 'failed' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label="Что сделать с этой структурой" className="flex w-75 shrink-0 flex-col gap-2">
      <h3 className="text-12 font-medium text-muted">Что сделать с этой структурой</h3>
      {MODES.map(({ mode, label }) => (
        <Button
          key={mode}
          variant="secondary"
          disabled={!analyzed || (busy !== null && busy !== mode)}
          loading={busy === mode}
          loadingLabel="Создаю выпуск"
          onClick={() => void start(mode)}
        >
          {label}
        </Button>
      ))}
      <p className="text-11 leading-3.5 text-muted">
        {analyzed
          ? 'Переносятся только длительности сегментов и темп. Формулировки пишутся с нуля.'
          : 'Сначала разберите референс: скопируйте промпт разбора слева и вставьте ответ чата.'}
      </p>
    </section>
  )
}

/** Плашка под вводом (артборд 2): правило переноса и сходство планов выпусков, сделанных по этому референсу */
export function ReferenceSimilarity({ channel, referenceId }: { channel: ChannelId; referenceId: string }) {
  const episodes = useReferenceEpisodes(channel, referenceId)
  return (
    <section aria-label="Сходство с референсом" className="flex flex-col gap-2 rounded-panel border border-line bg-panel p-2">
      <p className="flex gap-2 text-12 leading-4 text-ink">
        <TriangleAlert className="mt-px size-icon shrink-0 text-warning" strokeWidth={1.5} aria-hidden />
        Текст референса не переносится в сценарий. Перед утверждением проверяется сходство.
      </p>
      {episodes.length === 0 ? (
        <p className="text-11 text-muted">Выпусков по этому референсу ещё нет.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {episodes.map((episode) => (
            <li key={episode.id}>
              <EpisodeSimilarity episode={episode} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function EpisodeSimilarity({ episode }: { episode: EpisodeListItem }) {
  const similarity = useSimilarity(episode.id)
  return (
    <div className="flex flex-col gap-1">
      <span className="truncate text-11 text-muted">
        <span className="font-script">{episode.id}</span> {episode.title}
      </span>
      <SimilarityBadge report={similarity.data} error={similarity.error} />
    </div>
  )
}
