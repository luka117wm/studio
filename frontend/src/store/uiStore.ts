/* Состояние оболочки: активный канал, открытый выпуск, свёрнутость панелей, тосты.
   Доменных данных здесь нет — они в фикстурах (до M2) и в TanStack Query (с M2). */
import { create } from 'zustand'
import type { ToastItem } from '../ui'
import type { ChannelId } from '../types/fixtures'

/** Сворачиваемые панели по layout.md: библиотека/канон слева (⌥1), инспектор справа (⌥3) */
export type PanelId = 'left' | 'right'

export interface UiState {
  channel: ChannelId
  episodeId: string | null
  /** true — панель свёрнута в полосу с иконкой */
  collapsed: Record<PanelId, boolean>
  toasts: ToastItem[]
  /** Окно горячих клавиш («?» и кнопка в шапке) */
  helpOpen: boolean
  setChannel: (channel: ChannelId) => void
  openEpisode: (id: string) => void
  closeEpisode: () => void
  togglePanel: (panel: PanelId) => void
  pushToast: (toast: ToastItem) => void
  dismissToast: (id: string) => void
  setHelpOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>()((set) => ({
  channel: 'cursus',
  episodeId: null,
  collapsed: { left: false, right: false },
  toasts: [],
  helpOpen: false,
  setChannel: (channel) => set({ channel }),
  openEpisode: (id) => set({ episodeId: id }),
  closeEpisode: () => set({ episodeId: null }),
  togglePanel: (panel) => set((s) => ({ collapsed: { ...s.collapsed, [panel]: !s.collapsed[panel] } })),
  pushToast: (toast) => set((s) => ({ toasts: [...s.toasts.filter((t) => t.id !== toast.id), toast] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
}))
