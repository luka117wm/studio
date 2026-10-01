/* Индикатор автосохранения в шапке: «Сохраняю…» — изменение ждёт записи или пишется; «Сохранено ЧЧ:ММ» — по
   времени сервера; ошибка — текст цветом fail и «Повторить». До первого сохранения в сессии — ничего: время
   не выдумывается. */
import { useUiStore } from '../store/uiStore'
import { Button, StatusGlyph } from '../ui'
import { autosaver } from './autosave'
import { formatClock } from './format'

export function SaveIndicator() {
  const save = useUiStore((s) => s.save)
  if (save.kind === 'idle') return null
  if (save.kind === 'error') {
    return (
      <span data-testid="save-indicator" className="flex min-w-0 items-center gap-2 text-12">
        <span role="alert" className="truncate text-failed-text" title={save.message}>
          {save.message}
        </span>
        <Button variant="statusOutline" status="failed" size="sm" onClick={() => void autosaver.retry()}>
          Повторить
        </Button>
      </span>
    )
  }
  return (
    <span data-testid="save-indicator" aria-live="polite" className="flex items-center gap-1.5 whitespace-nowrap text-12 text-muted">
      {save.kind === 'saved' ? (
        <>
          <span className="size-1.5 rounded-full bg-accent-deep" aria-hidden />
          Сохранено {formatClock(save.at)}
        </>
      ) : (
        <>
          <StatusGlyph status="generating" className="size-3" />
          Сохраняю…
        </>
      )}
    </span>
  )
}
