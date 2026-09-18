/* Статус-строка 24px: слева — что происходит сейчас (при процессе — глиф штриховки), в середине — предупреждение,
   справа — 2–3 горячие клавиши из реестра (записи с hint, включённые сейчас). */
import { statusLine } from '../mocks/fixtures'
import { KeyHint, StatusGlyph } from '../ui'
import { formatKeys, isEnabled } from './keyboard'
import { useRegisteredHotkeys } from './useHotkey'

const MAX_HINTS = 3

export function StatusBar() {
  const hotkeys = useRegisteredHotkeys()
  const hints = hotkeys.filter((h) => h.hint && h.scope !== 'modal' && isEnabled(h)).slice(-MAX_HINTS)
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
        <KeyHint key={h.id} keys={formatKeys(h.keys)} label={h.hint} />
      ))}
    </footer>
  )
}
