/* Зоны экрана по layout.md: заголовок 52 · [левая панель | центр | широкая колонка ≥2560 | правая панель] · нижняя панель.
   Ширины — токены оболочки и шкала 4px; поведение по ширине окна — только брейкпоинты из layout.md:
   <1440 инспектор 280 и библиотека 240; <1280 боковые панели свёрнуты в полосу с иконкой, таймлайн 160;
   ≥2560 центр получает вторую колонку, таймлайн 320. Боковые панели не растут — плотность важнее заполнения. */
import { PanelLeft, PanelLeftOpen, PanelRight, PanelRightOpen, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useUiStore, type PanelId } from '../store/uiStore'
import { IconButton, cn } from '../ui'
import { PanelHeader } from './PanelHeader'
import { formatKeys } from './keyboard'
import { useHotkey } from './useHotkey'

export type LeftPanelKind = 'library' | 'metadata' | 'presets' | 'settingsNav' | 'seeds'
export type RightPanelKind = 'inspector' | 'clusters'

export interface SidePanel {
  title: string
  note?: string
  /** Иконка свёрнутой полосы */
  icon: LucideIcon
  children: ReactNode
  /** Сворачивается (⌥1 / ⌥3) и автоматически ниже 1280 */
  collapsible?: boolean
}

export interface ScreenLayoutProps {
  /** Заголовок экрана 52px: title 18/600, note 12, действия справа */
  header?: { title: string; note?: string; actions?: ReactNode }
  /** Полоса под заголовком на всю ширину, 72 (очереди генерации) */
  strip?: { title: string; children: ReactNode }
  left?: SidePanel & { kind: LeftPanelKind }
  /** Правая колонка: inspector 320 (по умолчанию) · clusters 340 (идеи) */
  right?: SidePanel & { kind?: RightPanelKind }
  /** Третья колонка только ≥2560 (лог экспорта 420); ниже лог открывается кнопкой поверх центра */
  wide?: { title: string; kind: 'log'; children: ReactNode }
  /** Нижняя панель на всю ширину: timeline — 260 с ручкой 4 (160 ниже 1280, 320 на 2560) · queue — 216 с шапкой 28 */
  bottom?: { title: string; kind: 'timeline' | 'queue'; children: ReactNode }
  children: ReactNode
}

/* Ширины: библиотека 280 (→240 <1440), метаданные 380, пресеты 320, навигация настроек 224 фикс.,
   семена ниши (идеи) 300 — из артборда 2, в layout.md не описано. */
const LEFT_WIDTH: Record<LeftPanelKind, string> = {
  library: 'w-shell-library max-[1439px]:w-60',
  metadata: 'w-95',
  presets: 'w-80',
  settingsNav: 'w-shell-settings-nav',
  seeds: 'w-75',
}
/* Правая колонка: инспектор 320 (→280 <1440); кластеры идей 340 — из артборда 2, в диапазоне 280–420 layout.md */
const RIGHT_WIDTH: Record<RightPanelKind, string> = {
  inspector: 'w-shell-inspector max-[1439px]:w-70',
  clusters: 'w-85',
}
const WIDE_WIDTH = { log: 'w-105' } as const
const STRIP = 'w-10'

export function ScreenLayout({ header, strip, left, right, wide, bottom, children }: ScreenLayoutProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {header && (
        <header className="flex h-shell-screen-header shrink-0 items-center gap-3 border-b border-line px-4">
          <h1 className="text-18 font-semibold text-ink">{header.title}</h1>
          {header.note && <span className="text-12 text-muted">{header.note}</span>}
          {header.actions && <div className="ml-auto flex items-center gap-2">{header.actions}</div>}
        </header>
      )}
      {strip && (
        <section data-zone="strip" aria-label={strip.title} className="flex h-18 shrink-0 border-b border-line">
          {strip.children}
        </section>
      )}
      <div className="flex min-h-0 flex-1">
        {left && <SideZone side="left" panel={left} widthClass={LEFT_WIDTH[left.kind]} />}
        <section aria-label="Рабочая зона" className="flex min-h-0 min-w-160 flex-1 flex-col bg-app">
          {children}
        </section>
        {wide && (
          <aside
            data-zone="wide"
            aria-label={wide.title}
            className={cn('hidden shrink-0 flex-col border-l border-line bg-panel min-[2560px]:flex', WIDE_WIDTH[wide.kind])}
          >
            <PanelHeader title={wide.title} />
            <div className="min-h-0 flex-1 overflow-y-auto">{wide.children}</div>
          </aside>
        )}
        {right && <SideZone side="right" panel={right} widthClass={RIGHT_WIDTH[right.kind ?? 'inspector']} />}
      </div>
      {bottom?.kind === 'timeline' && (
        <>
          {/* Ручка изменения высоты таймлайна, 4px (артборд 5); перетаскивание — модуль монтажа */}
          <div data-zone="handle" aria-hidden className="h-1 shrink-0 border-y border-line bg-panel" />
          <footer
            data-zone="bottom"
            aria-label={bottom.title}
            className="flex h-shell-timeline shrink-0 flex-col bg-app max-[1279px]:h-shell-timeline-min min-[2560px]:h-80"
          >
            {bottom.children}
          </footer>
        </>
      )}
      {bottom?.kind === 'queue' && (
        <footer data-zone="bottom" aria-label={bottom.title} className="flex h-54 shrink-0 flex-col border-t border-line bg-panel">
          <PanelHeader title={bottom.title} />
          <div className="min-h-0 flex-1 overflow-y-auto">{bottom.children}</div>
        </footer>
      )}
    </div>
  )
}

function SideZone({ side, panel, widthClass }: { side: PanelId; panel: SidePanel; widthClass: string }) {
  const collapsed = useUiStore((s) => s.collapsed[side]) && panel.collapsible === true
  const togglePanel = useUiStore((s) => s.togglePanel)
  const Icon = panel.icon
  const OpenIcon = side === 'left' ? PanelLeftOpen : PanelRightOpen
  const CloseIcon = side === 'left' ? PanelLeft : PanelRight
  const keys = side === 'left' ? 'Alt+1' : 'Alt+3'
  const hotkey = formatKeys(keys).join('')
  // ⌥1 / ⌥3 (layout.md) — только пока на экране есть сворачиваемая панель
  useHotkey({
    id: `panel-${side}`,
    keys,
    scope: 'screen',
    group: 'Панели',
    description: `Свернуть или развернуть: ${panel.title.toLowerCase()}`,
    hint: panel.title.toLowerCase(),
    when: () => panel.collapsible === true,
    handler: () => togglePanel(side),
  })

  const strip = (
    <div className="flex flex-col items-center gap-1 py-2">
      {panel.collapsible ? (
        <IconButton icon={OpenIcon} label={`Развернуть: ${panel.title} (${hotkey})`} onClick={() => togglePanel(side)} />
      ) : (
        <span className="flex size-6 items-center justify-center text-muted" title={panel.title}>
          <Icon className="size-icon" strokeWidth={1.5} aria-hidden />
        </span>
      )}
    </div>
  )

  return (
    <aside
      data-zone={side}
      data-collapsed={collapsed || undefined}
      aria-label={panel.title}
      className={cn(
        'flex shrink-0 flex-col bg-panel',
        side === 'left' ? 'border-r border-line' : 'border-l border-line',
        collapsed ? STRIP : cn(widthClass, panel.collapsible && 'max-[1279px]:w-10'),
      )}
    >
      {collapsed ? (
        strip
      ) : (
        <>
          <div className={cn('flex min-h-0 flex-1 flex-col', panel.collapsible && 'max-[1279px]:hidden')}>
            <PanelHeader
              title={panel.title}
              note={panel.note}
              actions={
                panel.collapsible ? (
                  <IconButton icon={CloseIcon} label={`Свернуть: ${panel.title} (${hotkey})`} onClick={() => togglePanel(side)} />
                ) : undefined
              }
            />
            <div className="min-h-0 flex-1 overflow-y-auto">{panel.children}</div>
          </div>
          {panel.collapsible && <div className="hidden max-[1279px]:flex">{strip}</div>}
        </>
      )}
    </aside>
  )
}
