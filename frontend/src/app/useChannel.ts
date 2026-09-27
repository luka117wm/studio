// Смена канала — одно правило для переключателя в шапке и фильтра экрана «Выпуски» (M3.5): одно состояние
// `uiStore.channel`. Выбор другого канала при открытом выпуске закрывает выпуск и уводит к «Выпускам» — каналы
// изолированы (правило 6 handoff, M1.3). «Все каналы» — режим просмотра, открытый выпуск в нём остаётся.
import { useEpisode, type ChannelScope } from '../api/queries'
import { useUiStore } from '../store/uiStore'
import { navigate, useRoute } from './navigation'
import { paths } from './routes'

export function useSwitchChannel(): (next: ChannelScope) => void {
  const setChannel = useUiStore((s) => s.setChannel)
  const closeEpisode = useUiStore((s) => s.closeEpisode)
  const episodeId = useUiStore((s) => s.episodeId)
  const episode = useEpisode(episodeId).data
  const route = useRoute()
  return (next) => {
    setChannel(next)
    if (next !== 'all' && episode && episode.channel !== next) {
      closeEpisode()
      if (route?.params.episodeId) navigate(paths.episodes)
    }
  }
}
