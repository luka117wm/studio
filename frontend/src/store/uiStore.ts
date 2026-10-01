/* Состояние оболочки: канал или «Все каналы», открытый выпуск, свёрнутость панелей, тосты, состояние автосохранения.
   Доменных данных здесь нет — они в кэше TanStack Query (`api/queries.ts`, решение 6 устава M3). */
import { create } from 'zustand'
import type { ChannelId, ChannelScope } from '../api/queries'
import type { ToastItem } from '../ui'

/** Сворачиваемые панели по layout.md: библиотека/канон слева (⌥1), инспектор справа (⌥3) */
export type PanelId = 'left' | 'right'

/** Автосохранение приложения (`app/autosave.ts`): ждёт дебаунса, пишет, сохранено в `at` (ISO сервера), ошибка */
export type SaveState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'error'; message: string }

export interface UiState {
  /** Канал или режим просмотра «Все каналы» */
  channel: ChannelScope
  episodeId: string | null
  /** true — панель свёрнута в полосу с иконкой */
  collapsed: Record<PanelId, boolean>
  toasts: ToastItem[]
  /** Окно горячих клавиш («?» и кнопка в шапке) */
  helpOpen: boolean
  save: SaveState
  setChannel: (channel: ChannelScope) => void
  /** Открытие выпуска ставит его канал: каналы изолированы (правило 6 handoff). Единственное место правила. */
  openEpisode: (episode: { id: string; channel: ChannelId }) => void
  closeEpisode: () => void
  togglePanel: (panel: PanelId) => void
  pushToast: (toast: ToastItem) => void
  dismissToast: (id: string) => void
  setHelpOpen: (open: boolean) => void
  setSave: (save: SaveState) => void
}

export const useUiStore = create<UiState>()((set) => ({
  channel: 'cursus',
  episodeId: null,
  collapsed: { left: false, right: false },
  toasts: [],
  helpOpen: false,
  save: { kind: 'idle' },
  setChannel: (channel) => set({ channel }),
  openEpisode: (episode) => set({ episodeId: episode.id, channel: episode.channel }),
  closeEpisode: () => set({ episodeId: null }),
  togglePanel: (panel) => set((s) => ({ collapsed: { ...s.collapsed, [panel]: !s.collapsed[panel] } })),
  pushToast: (toast) => set((s) => ({ toasts: [...s.toasts.filter((t) => t.id !== toast.id), toast] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setSave: (save) => set({ save }),
}))
