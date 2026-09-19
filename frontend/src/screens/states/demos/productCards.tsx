/* Карточки продуктовых состояний, собранные из примитивов кита: ProcessCard / ErrorCard / ConflictBar
   в ките нет (см. docs/m1_review_list.md). Данные и тексты — в product.tsx. */
import { Pause, Play, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Checkbox, IconButton, ProgressBar, StatusGlyph, cn } from '../../../ui'

/* ---- Пустые ---- */

export function EmptyShotsCard() {
  return (
    <div className="flex flex-col gap-3 rounded-panel border border-line bg-panel p-4">
      <div className="grid grid-cols-6 gap-1.5">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="flex aspect-video items-end rounded-clip border border-dashed border-line bg-app px-1 py-0.5 font-script text-11 text-muted">
            s{String(i + 1).padStart(3, '0')}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-13 font-semibold text-ink">104 кадра ждут генерации</span>
          <span className="text-12 text-muted">Промпты и движение уже в плане. Голос готов, поэтому длительности известны — кадры встанут точно под озвучку.</span>
        </div>
        <Button variant="primary" price={6.97}>Сгенерировать 104 кадра</Button>
        <Button>Только первый раздел (6)</Button>
      </div>
    </div>
  )
}

export function DraftTimelineCard() {
  const tracks = [
    { label: 'Субтитры', chip: 'bg-track-subtitles', text: 'text-muted' },
    { label: 'Кадры', chip: 'bg-warning', text: 'text-warning' },
    { label: 'Голос', chip: 'bg-line', text: 'text-warning' },
  ]
  return (
    <div className="flex flex-col overflow-hidden rounded-panel border border-line bg-panel">
      <div className="flex h-7 items-center gap-2 border-b border-line bg-strip px-3">
        <StatusGlyph status="warning" />
        <span className="text-12 font-medium text-warning">Черновой тайминг</span>
        <span className="truncate text-12 text-muted">Длительности посчитаны по тексту: 152 слова в минуту. После озвучки кадры сдвинутся.</span>
        <span className="flex-1" />
        <Button variant="primary" size="sm">Озвучить всё (23 400 символов, ~$2.34)</Button>
      </div>
      <div className="flex">
        <div className="flex w-shell-track-labels shrink-0 flex-col border-r border-line">
          {tracks.map((t) => (
            <span key={t.label} className={cn('flex h-8 items-center gap-1.5 border-b border-row-border px-2 font-dense text-11 font-medium', t.text)}>
              <span className={cn('h-3 w-[3px] rounded-[1px]', t.chip)} />
              {t.label}
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col bg-app">
          <div className="relative h-8 border-b border-row-border">
            {Array.from({ length: 14 }, (_, i) => (
              <span key={i} className="absolute inset-y-1 rounded-clip bg-track-subtitles opacity-55" style={{ left: `${i * 7.1 + 0.4}%`, width: `${5.4 + (i % 3) * 0.6}%` }} />
            ))}
          </div>
          <div className="relative h-8 border-b border-row-border">
            {Array.from({ length: 11 }, (_, i) => (
              <span key={i} className="absolute inset-y-1 rounded-clip border border-dashed border-warning bg-hover px-1 font-script text-11 text-warning" style={{ left: `${i * 9.05 + 0.3}%`, width: '8.5%' }}>
                s{String(i + 1).padStart(3, '0')}
              </span>
            ))}
          </div>
          <div className="flex h-8 items-center px-2">
            <span className="rounded-clip border border-dashed border-warning bg-panel px-2 font-dense text-11 text-warning">Дорожка голоса пуста — длительности оценочные</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---- Процесс ---- */

interface Step {
  label: string
  pct: number
  state: 'done' | 'run' | 'todo'
}

export function ProcessCard({ title, pct, steps, current, currentWarning, eta, footnote }: {
  title: string
  pct: number
  steps: Step[]
  current: string
  currentWarning?: boolean
  eta: string
  footnote: string
}) {
  const [paused, setPaused] = useState(false)
  return (
    <div className="flex flex-col gap-2.5 rounded-panel border border-line bg-panel p-3">
      <div className="flex items-center gap-2">
        <StatusGlyph status={paused ? 'warning' : 'generating'} />
        <span className="min-w-0 flex-1 truncate text-13 font-medium text-ink">{title}</span>
        <span className={cn('font-dense text-13', paused ? 'text-warning' : 'text-generating')}>{paused ? 'на паузе' : `${pct} %`}</span>
        <IconButton icon={paused ? Play : Pause} label={paused ? 'Продолжить' : 'Пауза'} onClick={() => setPaused(!paused)} />
        <IconButton icon={X} label="Отменить" variant="dangerHover" />
      </div>
      <div className="flex items-start gap-0.5">
        {steps.map((s) => (
          <div key={s.label} className="flex min-w-0 flex-1 flex-col gap-1" title={`${s.label}: ${s.state === 'done' ? 'готово' : s.state === 'run' ? `${s.pct} %` : 'в очереди'}`}>
            <ProgressBar value={s.state === 'done' ? 100 : s.state === 'run' ? s.pct : 0} status={s.state === 'done' ? 'ready' : 'generating'} ariaLabel={s.label} />
            <span className={cn('truncate text-11', s.state === 'done' ? 'text-ink' : s.state === 'run' ? 'text-generating' : 'text-queued-text')}>{s.label}</span>
          </div>
        ))}
      </div>
      <div className="flex items-baseline gap-3 text-11 text-muted">
        <span className={cn(currentWarning && 'text-warning')}>{current}</span>
        <span className="flex-1" />
        <span>{paused ? 'пауза' : eta}</span>
      </div>
      <p className="text-11 text-muted">{footnote}</p>
    </div>
  )
}

/* ---- Ошибки ---- */

function useCountdown(from: number): number {
  const [left, setLeft] = useState(from)
  useEffect(() => {
    const t = window.setInterval(() => setLeft((v) => (v > 1 ? v - 1 : from)), 1000)
    return () => window.clearInterval(t)
  }, [from])
  return left
}

export function ErrorCard({ kind, title, body, detail, countdown, primary, secondary, aside }: {
  kind: 'warning' | 'failed'
  title: string
  body: string
  detail?: string
  countdown?: number
  primary: string
  secondary: string
  aside: string
}) {
  const warn = kind === 'warning'
  return (
    <div className={cn('flex flex-col gap-2.5 rounded-panel border p-3', warn ? 'border-warning bg-surface-warning' : 'border-failed bg-surface-failed')}>
      <div className="flex gap-2.5">
        <StatusGlyph status={kind} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn('text-13 font-medium', warn ? 'text-warning' : 'text-failed-text')}>{title}</span>
          <span className="text-12 text-muted">{body}</span>
          {detail && <code className="mt-0.5 rounded-clip border border-line bg-app px-1.5 py-1 font-script text-11 text-muted">{detail}</code>}
        </div>
        {countdown !== undefined && <Countdown from={countdown} />}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="statusOutline" status={kind}>{primary}</Button>
        <Button variant="ghost">{secondary}</Button>
        <span className="flex-1" />
        <span className="text-11 text-muted">{aside}</span>
      </div>
    </div>
  )
}

function Countdown({ from }: { from: number }) {
  const left = useCountdown(from)
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="font-dense text-15 font-semibold text-warning">{left} с</span>
      <ProgressBar value={(left / from) * 100} status="warning" ariaLabel="До повтора" className="w-12" />
    </div>
  )
}

/* ---- Конфликт ---- */

const STALE = [
  { num: 's044', section: 'Powder monkey', change: 'Промпт: добавлен фонарь в руке юнги', drawn: '11 сентября, 11:12', price: '$0.07' },
  { num: 's045', section: 'Powder monkey', change: 'VO переписан, длительность 4.0 → 5.2 с', drawn: '11 сентября, 11:12', price: '$0.07' },
  { num: 's058', section: 'Boatswain', change: 'Герой: добавлен боцман во втором плане', drawn: '11 сентября, 11:26', price: '$0.07' },
  { num: 's059', section: 'Boatswain', change: 'План: detail → action', drawn: '11 сентября, 11:26', price: '$0.07' },
  { num: 's071', section: 'Quartermaster', change: 'Промпт: убраны стилевые слова', drawn: '11 сентября, 11:41', price: '$0.07' },
  { num: 's072', section: 'Quartermaster', change: 'Раздел разбит, кадр перенесён', drawn: '11 сентября, 11:41', price: '$0.07' },
]

export function ConflictBar() {
  return (
    <div className="flex items-center gap-3 rounded-panel border border-warning bg-surface-warning px-4 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-13 font-medium text-warning">План изменён после генерации — 6 кадров устарели</span>
        <span className="text-12 text-muted">После генерации в плане поменялись промпты, длительности и герои. Кадры нарисованы по старой версии.</span>
      </div>
      <Button variant="primary" price={0.4}>Перегенерировать 6</Button>
      <Button variant="ghost">Оставить старые</Button>
    </div>
  )
}

export function StaleTable() {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(STALE.map((s) => s.num)))
  const toggle = (num: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(num)) next.delete(num)
      else next.add(num)
      return next
    })
  const count = picked.size
  return (
    <div className="flex flex-col overflow-hidden rounded-panel border border-line bg-panel">
      <div className="flex h-6 items-center border-b border-line px-3 font-dense text-11 font-medium text-muted">
        <span className="w-10 shrink-0" />
        <span className="w-16 shrink-0">Кадр</span>
        <span className="w-33 shrink-0">Раздел</span>
        <span className="min-w-0 flex-1">Что изменилось в плане</span>
        <span className="w-37 shrink-0">Кадр нарисован</span>
        <span className="w-21 shrink-0 text-right">Цена</span>
      </div>
      {STALE.map((s) => {
        const on = picked.has(s.num)
        return (
          <div key={s.num} className={cn('flex h-8 items-center border-b border-row-border px-3', on && 'shadow-[inset_2px_0_0_var(--status-warning)]')}>
            <span className="w-10 shrink-0">
              <Checkbox checked={on} onChange={() => toggle(s.num)} ariaLabel={`Кадр ${s.num}`} />
            </span>
            <span className="w-16 shrink-0 font-script text-12 text-warning">{s.num}</span>
            <span className="w-33 shrink-0 truncate pr-2 font-dense text-12 text-ink">{s.section}</span>
            <span className="min-w-0 flex-1 truncate pr-3 text-12 text-ink">{s.change}</span>
            <span className="w-37 shrink-0 font-dense text-12 text-muted">{s.drawn}</span>
            <span className="w-21 shrink-0 text-right font-dense text-12 text-ink">{s.price}</span>
          </div>
        )
      })}
      <div className="flex h-9 items-center gap-2 border-t border-line bg-strip px-3">
        <span className="text-12 text-muted">{count ? `Выбрано ${count} из 6 кадров` : 'Кадры не выбраны'}</span>
        <span className="flex-1" />
        <Button variant="primary" disabled={count === 0} price={count ? count * 0.067 : undefined}>
          {count ? `Перегенерировать ${count}` : 'Перегенерировать выбранные'}
        </Button>
      </div>
    </div>
  )
}
