// «Начать выпуск» из идеи (экран 2): «предложенная» сначала идёт в бэклог, потом выпуск с `idea_id` в ближайшем
// свободном слоте — заявка и название из идеи делает бэкенд (docs/research.md, «Выпуск из идеи»). После создания —
// экран 3 выпуска и тот же тост, что у диалога «Новый выпуск» (M3.6). Ошибка — тост с текстом бэкенда.
import { useState } from 'react'
import type { Idea } from '@/types/idea'
import { useChannelName, useCreateEpisode, usePatchIdea, type ChannelId } from '../../api/queries'
import { navigate } from '../../app/navigation'
import { paths } from '../../app/routes'
import { useUiStore } from '../../store/uiStore'
import { createdToast } from '../episodes/board'

export function useStartEpisode(channel: ChannelId) {
  const patch = usePatchIdea(channel)
  const create = useCreateEpisode()
  const channelName = useChannelName(channel)
  const pushToast = useUiStore((s) => s.pushToast)
  const openEpisode = useUiStore((s) => s.openEpisode)
  // Идея, по которой сейчас создаётся выпуск: её кнопка — в состоянии загрузки, остальные ждут
  const [busyId, setBusyId] = useState<string | null>(null)

  const start = async (idea: Idea) => {
    setBusyId(idea.id)
    try {
      if (idea.status === 'proposed') await patch.mutateAsync({ id: idea.id, patch: { status: 'backlog' } })
      const episode = await create.mutateAsync({ channel, origin: 'backlog', idea_id: idea.id, slot: 'next_free' })
      pushToast({ id: `created-${episode.id}`, message: createdToast(channelName, episode.slot_date), status: 'ready' })
      openEpisode(episode)
      navigate(paths.stage(episode.id, 'script'))
    } catch (error) {
      pushToast({ id: 'idea-start', message: error instanceof Error ? error.message : String(error), status: 'failed' })
    } finally {
      setBusyId(null)
    }
  }

  return { start, busyId }
}
