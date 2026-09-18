/* Окно горячих клавиш: открывается по «?» и кнопке в шапке, закрывается по «?» и Esc.
   Список строится из реестра — показываются только включённые сейчас сочетания. */
import { useUiStore } from '../store/uiStore'
import { Dialog, KeyHint } from '../ui'
import { formatKeys, isEnabled, type Hotkey } from './keyboard'
import { useHotkey, useModalScope, useRegisteredHotkeys } from './useHotkey'

export function KeyboardHelp() {
  const open = useUiStore((s) => s.helpOpen)
  const setHelpOpen = useUiStore((s) => s.setHelpOpen)

  // Одна запись на открытие и закрытие: «?» — единственное глобальное сочетание, живое в модальном слое
  useHotkey({
    id: 'help',
    keys: '?',
    scope: 'global',
    group: 'Помощь',
    description: 'Горячие клавиши',
    hint: 'горячие клавиши',
    inModal: true,
    handler: () => setHelpOpen(!open),
  })
  useHotkey({
    id: 'layer-close',
    keys: 'Escape',
    scope: 'modal',
    group: 'Помощь',
    description: 'Закрыть верхний слой',
    inInputs: true,
    handler: () => setHelpOpen(false),
  })
  useModalScope(open)

  const hotkeys = useRegisteredHotkeys()
  const groups = groupHotkeys(hotkeys.filter(isEnabled))

  return (
    <Dialog
      open={open}
      onClose={() => setHelpOpen(false)}
      title="Горячие клавиши"
      size="lg"
      footer={<span className="mr-auto text-11 text-muted">Esc или ? закрывает</span>}
    >
      <div className="grid grid-cols-2 gap-3">
        {groups.map(([group, items]) => (
          <section key={group} aria-label={group} className="flex min-w-0 flex-col gap-1">
            <h3 className="flex h-6 items-center text-12 font-semibold text-muted">{group}</h3>
            {items.map((h) => (
              <div key={h.id} className="flex min-h-7 items-center gap-2 rounded-control border border-line bg-raised px-2">
                <span className="min-w-0 flex-1 text-12 text-ink">{h.description}</span>
                <KeyHint keys={formatKeys(h.keys)} />
              </div>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  )
}

function groupHotkeys(hotkeys: Hotkey[]): [string, Hotkey[]][] {
  const map = new Map<string, Hotkey[]>()
  for (const h of hotkeys) {
    const list = map.get(h.group)
    if (list) list.push(h)
    else map.set(h.group, [h])
  }
  return Array.from(map.entries())
}
