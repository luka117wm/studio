/* Статус-строка 24px: слева — что происходит сейчас (при процессе — глиф штриховки), в середине — предупреждение,
   справа — 2–3 горячие клавиши экрана. */
import { statusLine } from '../mocks/fixtures'
import { KeyHint, StatusGlyph } from '../ui'
import { useRoute } from './navigation'
import type { ScreenId } from './routes'

const HINTS: Partial<Record<ScreenId, { keys: string[]; label: string }[]>> = {
  episodes: [
    { keys: ['⌘', 'K'], label: 'команды' },
    { keys: ['⌘', 'N'], label: 'новый выпуск' },
  ],
  edit: [
    { keys: ['Space'], label: 'воспроизведение' },
    { keys: ['S'], label: 'лезвие' },
    { keys: ['?'], label: 'горячие клавиши' },
  ],
  inspector: [
    { keys: ['A'], label: 'оживить' },
    { keys: ['R'], label: 'перерисовать' },
    { keys: ['?'], label: 'горячие клавиши' },
  ],
  generate: [
    { keys: ['R'], label: 'перерисовать' },
    { keys: ['?'], label: 'горячие клавиши' },
  ],
}
const DEFAULT_HINTS = [{ keys: ['?'], label: 'горячие клавиши' }]

export function StatusBar() {
  const route = useRoute()
  const hints = (route && HINTS[route.route.screen]) ?? DEFAULT_HINTS
  return (
    <footer role="status" className="flex h-shell-statusbar shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-11 text-muted">
      {statusLine.process ? (
        <span className="flex items-center gap-1.5">
          <StatusGlyph status="generating" className="size-3" />
          {statusLine.process}
        </span>
      ) : (
        <span>Готово</span>
      )}
      <span aria-hidden className="h-3 w-px bg-line" />
      <span className="truncate">{statusLine.note}</span>
      <span className="flex-1" />
      {hints.map((h) => (
        <KeyHint key={h.label} keys={h.keys} label={h.label} />
      ))}
    </footer>
  )
}
