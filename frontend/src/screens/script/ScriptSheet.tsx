/* Лист сценария 760 (режим «Сценарий», components.md: ScriptSheet): разделы sluglines прописными, номера кадров на левом
   поле, VO правится на месте, правое поле — плейсхолдер миниатюры (картинок до M6 нет), движение с входом в
   предпросмотр промпта кадра (M5.10), анимация, SFX, статус. Данные — действующий план бэкенда; правка VO —
   `useShotEdit` (автосохранение в `user_override`). */
import {
  FileText,
  Film,
  Maximize2,
  Minimize2,
  Move,
  MoveHorizontal,
  MoveVertical,
  RotateCcw,
  Square,
  Volume1,
  type LucideIcon,
} from 'lucide-react'
import { useId, useMemo } from 'react'
import type { Shot } from '@/types/director'
import type { EffectivePlan, PlanShot } from '@/types/plan'
import { useDirectorVersion } from '../../api/queries'
import { Button, StatusGlyph, Tooltip } from '../../ui'
import { motionLabel, periodYears, statusOf, type MotionType } from './shotLabels'
import { useShotEdit } from './useShotEdit'

const MOTION_ICON: Record<MotionType, LucideIcon> = {
  push_in: Maximize2,
  pull_out: Minimize2,
  pan_left: MoveHorizontal,
  pan_right: MoveHorizontal,
  tilt_up: MoveVertical,
  tilt_down: MoveVertical,
  static: Square,
  drift: Move,
}

export interface ScriptSheetProps {
  episodeId: string
  /** «Cursus» — первая часть шапки листа */
  channelName: string
  plan: EffectivePlan
  /** Открыть предпросмотр итогового промпта кадра */
  onPrompt: (shotId: string) => void
}

export function ScriptSheet({ episodeId, channelName, plan, onPrompt }: ScriptSheetProps) {
  const version = useDirectorVersion(episodeId, plan.version)
  const planShots = useMemo(() => new Map((version.data?.shots ?? []).map((shot) => [shot.id, shot])), [version.data])
  // Убранные кадры на лист не выводятся: их больше нет в плане
  const shots = plan.shots.filter((shot) => shot.status !== 'removed')
  const years = periodYears(shots)

  return (
    <article aria-label="Лист сценария" className="flex w-190 shrink-0 flex-col self-start rounded-panel border border-line bg-panel px-4 pt-5 pb-7">
      <header className="mb-2 flex items-baseline gap-2 border-b border-line pb-3">
        <h2 className="font-script text-13 font-bold tracking-wide uppercase">
          {channelName} — {plan.meta.working_title}
        </h2>
        <span className="flex-1" />
        <span className="font-script text-11 text-muted">{[plan.version, years].filter(Boolean).join(' · ')}</span>
      </header>
      {plan.sections.map((section) => {
        const inSection = shots.filter((shot) => shot.section === section.id)
        if (!inSection.length) return null
        return (
          <section key={section.id} aria-label={section.title} className="flex flex-col">
            <h3 className="mt-2 ml-15 border-b border-line pb-0.5 font-script text-13 leading-5 font-bold tracking-wider uppercase">
              {section.title}
            </h3>
            {inSection.map((shot) => (
              <SheetShot key={shot.id} episodeId={episodeId} shot={shot} planShot={planShots.get(shot.id)} onPrompt={onPrompt} />
            ))}
          </section>
        )
      })}
    </article>
  )
}

function SheetShot({
  episodeId,
  shot,
  planShot,
  onPrompt,
}: {
  episodeId: string
  shot: PlanShot
  planShot: Shot | undefined
  onPrompt: (shotId: string) => void
}) {
  const vo = useShotEdit(episodeId, shot, planShot, 'vo')
  const errorId = useId()
  return (
    <div data-shot={shot.id} className="-mx-2 flex gap-3 rounded-control px-2 py-1.5 hover:bg-hover">
      <span className="w-12 shrink-0 pt-0.5 font-script text-11 leading-5 text-muted">{shot.id}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <textarea
          aria-label={`VO кадра ${shot.id}`}
          aria-invalid={vo.error ? true : undefined}
          aria-describedby={vo.error ? errorId : undefined}
          value={vo.value}
          onChange={(e) => vo.set(e.target.value)}
          rows={1}
          spellCheck
          className="w-full resize-none rounded-control bg-transparent font-script text-13 leading-5 text-ink field-sizing-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
        {vo.error && (
          <span id={errorId} className="text-11 text-failed-text">
            {vo.error}
          </span>
        )}
        {vo.overridden && (
          <div className="flex items-center gap-2">
            <span className="text-11 text-accent">правка</span>
            <Tooltip content={vo.planValue === undefined ? 'Значение из плана загружается' : `В плане: ${vo.planValue}`}>
              <Button variant="ghost" size="sm" icon={RotateCcw} onClick={vo.reset}>
                Вернуть из плана
              </Button>
            </Tooltip>
          </div>
        )}
      </div>
      <ShotMargin shot={shot} onPrompt={() => onPrompt(shot.id)} />
    </div>
  )
}

/** Правое поле листа, 132: миниатюра-плейсхолдер 120×68, движение с предпросмотром промпта, анимация, SFX, статус */
function ShotMargin({ shot, onPrompt }: { shot: PlanShot; onPrompt: () => void }) {
  const MotionIcon = MOTION_ICON[shot.motion.type]
  const status = statusOf(shot.status)
  const glyph = <StatusGlyph status={status.status} label={`Статус: ${status.label}`} />
  return (
    <div className="flex w-33 shrink-0 flex-col gap-1">
      <div aria-hidden className="flex h-17 w-30 items-end justify-end rounded-clip border border-dashed border-line p-1">
        <span className="font-script text-11 leading-3 text-muted">{shot.id.slice(1)}</span>
      </div>
      <div className="flex items-center gap-1.5 text-muted">
        <MotionIcon className="size-icon shrink-0" strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-11 leading-3.5">{motionLabel(shot.motion)}</span>
        {/* Не IconButton 24: в поле 132 он съедает подпись движения («отъезд 1.12×») — кнопка размером с иконку,
            к глифу статуса вплотную (2px) */}
        <button
          type="button"
          title={`Итоговый промпт кадра ${shot.id}`}
          aria-label={`Итоговый промпт кадра ${shot.id}`}
          onClick={onPrompt}
          className="-mr-1 inline-flex shrink-0 rounded-control text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          <FileText className="size-icon" strokeWidth={1.5} aria-hidden />
        </button>
        {shot.status === 'stale' && shot.stale_reasons.length > 0 ? (
          <Tooltip content={shot.stale_reasons.join('; ')}>
            <span tabIndex={0} className="inline-flex rounded-control focus-visible:outline-2 focus-visible:outline-accent">
              {glyph}
            </span>
          </Tooltip>
        ) : (
          glyph
        )}
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap">
        {shot.animate.recommended && (
          <span title="Рекомендована анимация кадра" className="flex items-center gap-1 text-accent">
            <Film className="size-icon" strokeWidth={1.5} aria-hidden />
            <span className="text-11">анимация</span>
          </span>
        )}
        {shot.sfx.length > 0 && (
          <span title="Звуковые эффекты в кадре" className="flex items-center gap-1 text-track-sfx">
            <Volume1 className="size-icon" strokeWidth={1.5} aria-hidden />
            <span className="text-11">{shot.sfx.length} SFX</span>
          </span>
        )}
      </div>
    </div>
  )
}
