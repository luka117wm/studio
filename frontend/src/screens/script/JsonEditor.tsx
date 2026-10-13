/* Режим «JSON» экрана 3 (components.md: JsonEditor; артборд 3, `mode: JSON`): текст текущей версии плана с номерами
   строк и подсветкой, строки с ошибками — фоном failed, справа — панель проверки со ссылками на строку, внизу —
   «Сохранить как версию». Синтаксис ловится здесь, без запроса; остальное проверяет бэкенд (`director/validate`)
   через 800 мс после ввода. Подсветка — слой `pre` под прозрачной `textarea`: каретка, выделение и прокрутка
   нативные, слой и номера строк двигаются вслед за прокруткой. Несохранённый текст живёт в памяти по выпуску до
   сохранения или явного «Уйти без сохранения»: переход на другой экран его не теряет. */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { EffectivePlan, ValidationItem } from '@/types/plan'
import { DEBOUNCE_MS } from '../../app/autosave'
import { PanelHeader } from '../../app/PanelHeader'
import { planRejection } from '../../api/client'
import { useDirectorVersion, useSaveDirectorVersion, useValidateDirector } from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import { Button, Skeleton, StatusGlyph, cn } from '../../ui'
import { plural } from '../episodes/board'
import { discardJsonDraft, readJsonDraft, writeJsonDraft } from './jsonDrafts'
import { locate, parsePlanJson, pathLine, shotLine, tokenizeLine, type TokenKind } from './jsonHighlight'

/** Высота строки кода, px: `leading-5` у слоя, номеров и `textarea` */
const LINE_PX = 20
const NO_ITEMS: ValidationItem[] = []
const ERRORS = ['ошибка', 'ошибки', 'ошибок'] as const

const TOKEN_CLASS: Record<TokenKind, string> = {
  key: 'text-track-subtitles',
  string: 'text-accent',
  number: 'text-accent',
  literal: 'text-ink',
  punct: 'text-disabled',
  space: '',
  error: 'text-failed-text',
}

// --- редактор ---------------------------------------------------------------------------------

export interface JsonEditorProps {
  episodeId: string
  plan: EffectivePlan
  /** Сохранена новая версия или план переключён на прежнюю — экран уходит в «Сценарий» */
  onSaved: () => void
}

export function JsonEditor({ episodeId, plan, onSaved }: JsonEditorProps) {
  const file = useDirectorVersion(episodeId, plan.version)
  if (file.error) {
    return (
      <p role="alert" className="m-4 text-13 text-failed-text">
        {file.error.message}
      </p>
    )
  }
  if (!file.data) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4">
        <Skeleton variant="text" lines={12} />
      </div>
    )
  }
  return (
    <Editor
      key={plan.version}
      episodeId={episodeId}
      plan={plan}
      base={JSON.stringify(file.data, null, 2)}
      onSaved={onSaved}
    />
  )
}

interface Problem {
  key: string
  /** Строка с 1; null — места в тексте не нашлось */
  line: number | null
  column: number
  /** Кадр или адрес поля — моноширинно перед текстом */
  where: string
  text: string
  detail?: string
}

function Editor({ episodeId, plan, base, onSaved }: JsonEditorProps & { base: string }) {
  const pushToast = useUiStore((s) => s.pushToast)
  const [text, setTextState] = useState(() => readJsonDraft(episodeId, plan.version) ?? base)
  const setText = (next: string) => {
    setTextState(next)
    writeJsonDraft(episodeId, plan.version, next, base)
  }
  const dirty = text !== base
  const parsed = useMemo(() => parsePlanJson(text), [text])

  // Ответ проверки — для того текста, на который он пришёл; ответ на устаревший текст не применяется
  const [check, setCheck] = useState<{ text: string; items: ValidationItem[] } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const validate = useValidateDirector(episodeId)
  const run = useRef({ seq: 0, first: true, validate: validate.mutateAsync })
  useEffect(() => {
    run.current.validate = validate.mutateAsync
  })
  useEffect(() => {
    if (!parsed.ok) return
    const seq = ++run.current.seq
    // Открытая версия проверяется сразу, правка — после паузы ввода
    const delay = run.current.first ? 0 : DEBOUNCE_MS
    run.current.first = false
    const timer = setTimeout(() => {
      run.current.validate(parsed.value).then(
        (result) => {
          if (seq !== run.current.seq) return
          setCheck({ text, items: result.items })
          setFailure(null)
        },
        (error: unknown) => {
          if (seq === run.current.seq) setFailure(error instanceof Error ? error.message : String(error))
        },
      )
    }, delay)
    return () => clearTimeout(timer)
  }, [parsed, text])

  const checking = parsed.ok && check?.text !== text && failure === null
  // Пока идёт новая проверка, видны ошибки прошлой — строки пересчитываются по текущему тексту
  const items = useMemo(() => (parsed.ok ? (check?.items ?? NO_ITEMS) : NO_ITEMS), [parsed, check])

  const problems = useMemo<Problem[]>(() => {
    if (!parsed.ok) {
      const { line, column, message, detail } = parsed.problem
      return [{ key: 'syntax', line, column, where: `строка ${line}:${column}`, text: message, detail }]
    }
    const where = locate(text)
    return items.map((item, i) => {
      const line = item.shot_id ? shotLine(where, item.shot_id, item.path) : pathLine(where, item.path)
      const prefix = item.shot_id ? `кадр ${item.shot_id}: ` : ''
      return {
        key: `${i}:${item.message}`,
        line,
        column: 1,
        where: item.shot_id ?? (item.path || 'план'),
        text: prefix && item.message.startsWith(prefix) ? item.message.slice(prefix.length) : item.message,
      }
    })
  }, [parsed, items, text])
  const errorLines = useMemo(() => new Set(problems.map((p) => p.line).filter((l): l is number => l !== null)), [problems])

  // Уход со страницы с несохранённым JSON — вопрос браузера (как AutosaveGuard, M3.4)
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // --- прокрутка и переход к строке ---
  const area = useRef<HTMLTextAreaElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const gutter = useRef<HTMLDivElement>(null)
  const sync = () => {
    const el = area.current
    if (!el) return
    if (layer.current) layer.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`
    if (gutter.current) gutter.current.style.transform = `translateY(${-el.scrollTop}px)`
  }
  const goTo = (line: number, column: number) => {
    const el = area.current
    if (!el) return
    const lines = text.split('\n')
    const offset = lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0) + Math.max(0, column - 1)
    el.focus()
    el.setSelectionRange(offset, offset)
    el.scrollTop = Math.max(0, (line - 1) * LINE_PX - el.clientHeight / 3)
    sync()
  }

  // --- сохранение ---
  const save = useSaveDirectorVersion(episodeId)
  const canSave = dirty && parsed.ok && !checking && failure === null && items.length === 0 && !save.isPending
  const submit = async () => {
    if (!parsed.ok) return
    try {
      const result = await save.mutateAsync(parsed.value)
      discardJsonDraft(episodeId)
      if (result.created) {
        pushToast({ id: 'plan-json', message: `Сохранено как ${result.version}`, status: 'ready' })
        onSaved()
      } else if (result.version === plan.version) {
        pushToast({ id: 'plan-json', message: `Совпадает с ${result.version}, новая версия не создана`, status: 'queued' })
        setTextState(base)
      } else {
        pushToast({ id: 'plan-json', message: `Совпадает с ${result.version} — план переключён на эту версию`, status: 'ready' })
        onSaved()
      }
    } catch (error) {
      const rejected = planRejection(error)
      if (rejected) setCheck({ text, items: rejected })
      else setFailure(error instanceof Error ? error.message : String(error))
    }
  }

  const lines = useMemo(() => text.split('\n'), [text])
  const note = !parsed.ok
    ? 'ошибка синтаксиса'
    : failure
      ? 'проверка не прошла'
      : checking
        ? 'проверяю…'
        : items.length
          ? `${items.length} ${plural(items.length, ERRORS)}`
          : 'ошибок нет'

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 bg-app">
        <div aria-hidden className="w-11 shrink-0 overflow-hidden">
          <div ref={gutter} data-line-numbers className="py-3 font-script text-12 leading-5">
            {lines.map((_, i) => (
              <div
                key={i}
                data-failed={errorLines.has(i + 1) || undefined}
                className={cn('h-5 pr-2.5 text-right', errorLines.has(i + 1) ? 'bg-surface-failed text-failed-text' : 'text-queued-text')}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <div ref={layer} aria-hidden className="pointer-events-none absolute top-0 left-0 min-w-full py-3 font-script text-12 leading-5">
            {lines.map((line, i) => (
              <CodeLine key={i} text={line} failed={errorLines.has(i + 1)} />
            ))}
          </div>
          <textarea
            ref={area}
            aria-label="JSON плана"
            aria-invalid={problems.length > 0 || undefined}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onScroll={sync}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="absolute inset-0 resize-none overflow-auto bg-transparent py-3 pr-3 pl-2 font-script text-12 leading-5 whitespace-pre text-transparent caret-ink outline-none selection:bg-accent-deep/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          />
        </div>
      </div>

      <aside aria-label="Проверка плана" className="flex w-75 shrink-0 flex-col border-l border-line bg-panel">
        <PanelHeader title="Проверка" note={note} />
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          {failure && (
            <p role="alert" className="text-12 text-failed-text">
              {failure}
            </p>
          )}
          {problems.length > 0 ? (
            <ul aria-label="Ошибки плана" className="flex flex-col gap-1">
              {problems.map((problem) => (
                <li key={problem.key}>
                  <ProblemRow problem={problem} onGo={goTo} />
                </li>
              ))}
            </ul>
          ) : (
            !failure &&
            !checking && (
              <p className="p-1 text-12 text-muted">
                {dirty
                  ? 'Ошибок нет — правку можно сохранить новой версией.'
                  : `Версия ${plan.version} проходит проверку. Правка проверяется через 0.8 с после паузы ввода.`}
              </p>
            )
          )}
        </div>
        <div className="flex flex-col gap-1.5 border-t border-line p-2">
          <Button
            variant="secondary"
            className="w-full"
            disabled={!canSave}
            loading={save.isPending}
            loadingLabel="Сохраняю версию"
            onClick={() => void submit()}
          >
            Сохранить как версию
          </Button>
          <p className="text-11 leading-3.5 text-muted">{saveHint(dirty, problems.length > 0, checking, plan)}</p>
        </div>
      </aside>
    </div>
  )
}

function saveHint(dirty: boolean, hasProblems: boolean, checking: boolean, plan: EffectivePlan): string {
  if (!dirty) return `Сохранять нечего: текст совпадает с ${plan.version}.`
  if (hasProblems) return 'Сначала исправьте ошибки — план с ошибками версией не сохраняется.'
  if (checking) return 'Дождитесь проверки.'
  const again = plan.approved_version ? ' Утверждённый план придётся утвердить снова.' : ''
  return `Станет новой версией плана; правки кадров на листе останутся.${again}`
}

function ProblemRow({ problem, onGo }: { problem: Problem; onGo: (line: number, column: number) => void }) {
  const { line } = problem
  return (
    <button
      type="button"
      disabled={line === null}
      onClick={() => line !== null && onGo(line, problem.column)}
      title={line === null ? 'Место в тексте не найдено' : `Перейти к строке ${line}`}
      className="flex w-full gap-2 rounded-control border border-line bg-panel p-1.5 text-left enabled:hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
    >
      <StatusGlyph status="failed" label="Ошибка" className="mt-0.5 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-12 leading-4">
          <span className="font-script text-failed-text">{problem.where}</span> {problem.text}
        </span>
        {line !== null && <span className="text-11 leading-3.5 text-muted">строка {line}</span>}
        {problem.detail && <span className="font-script text-11 leading-3.5 break-words text-muted">{problem.detail}</span>}
      </span>
    </button>
  )
}

/** Строка кода: токены цветом по виду. Мемо — при вводе перерисовывается только изменившаяся строка */
const CodeLine = memo(function CodeLine({ text, failed }: { text: string; failed: boolean }) {
  return (
    <div
      className={cn(
        'h-5 pr-3 pl-2 whitespace-pre',
        failed && 'bg-surface-failed shadow-[inset_2px_0_0_var(--status-failed)]',
      )}
    >
      {text === ''
        ? '​'
        : tokenizeLine(text).map((token, i) => (
            <span key={i} className={TOKEN_CLASS[token.kind] || undefined}>
              {token.text}
            </span>
          ))}
    </div>
  )
})
