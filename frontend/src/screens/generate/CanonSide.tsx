/* «Канон выпуска · только чтение» — левая панель экрана 4 (артборд 4; устав M6, решение 8): к каким версиям канона
   прибит выпуск и готовы ли листы обликов, без которых кадр с персонажем не рисуется. Данные — `GET …/canon` (M5.10),
   фас облика — выбранный кандидат его листа (`…/anchors`, те же запросы, что у карточек экрана 12). Править канон —
   на экране 12: ссылки и статусы ссылок — `screens/script/canonLinks.ts`, общие с каноном выпуска экрана 3.
   M6.10: блок «Проверка» — выключатель проверки анахронизмов канала с ценой вопроса из сметы бэкенда и «Перепроверить
   выбранные» для кадров, выбранных в сетке. Проверки только помечают: ничего не блокируют. */
import type { AnchorSetState } from '@/types/canon'
import type { EpisodeAppearanceItem, EpisodeCanonItem } from '@/types/plan'
import {
  CheckRefused,
  anchorThumb,
  useAppearanceSheets,
  useChannels,
  useCheckEstimate,
  useCheckShots,
  useEpisodeCanon,
  usePatchChannelChecks,
  type ChannelId,
} from '../../api/queries'
import { paths } from '../../app/routes'
import { useUiStore } from '../../store/uiStore'
import { Button, Skeleton, StatusGlyph, Toggle, cn, type Status } from '../../ui'
import { plural } from '../episodes/board'
import { CanonLink } from '../script/CanonLink'
import { canonHref, canonIssues, refState, sheetLabel } from '../script/canonLinks'
import { SHOTS } from './grid'

export interface CanonSideProps {
  channel: ChannelId
  episodeId: string
  /** Текущая версия плана; без плана канона выпуска нет */
  version: string | null
  /** Кадры, выбранные в сетке: их перепроверяет «Перепроверить выбранные»; `null` — картинок ещё нет, блока проверки
   *  тоже */
  selected: readonly string[] | null
}

export function CanonSide({ channel, episodeId, version, selected }: CanonSideProps) {
  const canon = useEpisodeCanon(channel, episodeId, version)
  const sheets = useAppearanceSheets(channel, canon.data?.appearances.map((item) => item.id) ?? [])
  if (version === null) return <p className="p-3 text-12 text-muted">Плана ещё нет — канон выпуска появится с первой версией плана.</p>
  if (canon.error) {
    return (
      <p role="alert" className="p-3 text-12 text-failed-text">
        {canon.error.message}
      </p>
    )
  }
  if (!canon.data) return <Skeleton variant="text" lines={4} className="p-3" />
  const issues = canonIssues(canon.data)
  return (
    <div className="flex flex-col gap-3 p-3">
      {issues.length > 0 && <p className="text-12 text-warning">Канон не готов: {issues.join(', ')}</p>}
      <dl aria-label="Версии канона" className="flex flex-col gap-1.5">
        <PinnedRow label="Стиль канала" href={canonHref('style', 'style')} item={canon.data.style} />
        {canon.data.periods.map((item) => (
          <PinnedRow
            key={item.id}
            label={canon.data!.periods.length === 1 ? 'Период выпуска' : 'Эпоха'}
            href={canonHref('period', item.id)}
            item={item}
            name={item.id}
          />
        ))}
      </dl>
      {canon.data.appearances.length > 0 && (
        <section aria-label="Облики персонажей" className="flex flex-col gap-1.5 border-t border-line pt-3">
          <h3 className="text-12 font-medium text-muted">Облики персонажей</h3>
          <ul className="flex flex-col gap-1">
            {canon.data.appearances.map((item, i) => (
              <AppearanceRow key={item.id} channel={channel} item={item} sheet={sheets[i]} />
            ))}
          </ul>
        </section>
      )}
      {selected !== null && <ChecksBlock channel={channel} episodeId={episodeId} selected={selected} />}
      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <CanonLink href={paths.canon} className="self-start text-12 font-medium text-accent">
          Открыть канон
        </CanonLink>
        <p className="text-11 text-muted">Правка облика меняет опорные портреты и требует перерисовки затронутых кадров.</p>
      </div>
    </div>
  )
}

/** Строка «что — к какой версии прибито»; версия новее или ссылка не находится — подпись в цвете статуса */
function PinnedRow({ label, href, item, name }: { label: string; href: string; item: EpisodeCanonItem; name?: string }) {
  const state = refState(item)
  return (
    <div className="flex items-baseline justify-between gap-2 text-12">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="flex min-w-0 items-baseline gap-1">
        <CanonLink href={href} className="truncate font-medium text-ink">
          {name ? `${name} ${item.pinned ?? '—'}` : (item.pinned ?? '—')}
        </CanonLink>
        {item.status !== 'ready' && <span className={cn('shrink-0', state.status === 'failed' ? 'text-failed-text' : 'text-warning')}>{state.label}</span>}
      </dd>
    </div>
  )
}

/** Лист облика на экране 4: готов или нет — как в артборде; неготовый лист — warning, кадры облика не рисуются */
function sheetState(item: EpisodeAppearanceItem): { status: Status; label: string } {
  const ref = refState(item)
  if (!item.resolved) return ref
  if (item.sheet.status === 'ready') return ref.status === 'ready' ? { status: 'ready', label: 'лист опорных портретов готов' } : ref
  return { status: 'warning', label: item.sheet.status === 'missing' ? 'лист не собран' : sheetLabel(item.sheet) }
}

function AppearanceRow({ channel, item, sheet }: { channel: ChannelId; item: EpisodeAppearanceItem; sheet: AnchorSetState | undefined }) {
  const state = sheetState(item)
  const front = sheet?.slots.find((slot) => slot.slot === 'front')?.chosen ?? null
  const missing = !item.resolved || item.sheet.status === 'missing'
  return (
    <li className="flex items-center gap-2 rounded-control p-1">
      <span
        className={cn(
          'relative size-9 shrink-0 overflow-hidden rounded-clip border',
          missing ? 'border-dashed border-warning' : 'border-line bg-hover',
        )}
      >
        {front && (
          <img src={anchorThumb(channel, item.id, front.candidate, 160)} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <CanonLink href={canonHref('appearance', item.id, true)} className="truncate text-12 font-medium text-ink">
          {item.id}
        </CanonLink>
        <span className={cn('text-11', state.status === 'ready' ? 'text-muted' : state.status === 'failed' ? 'text-failed-text' : 'text-warning')}>
          {state.label}
        </span>
      </span>
      <StatusGlyph status={state.status} label={state.label} />
    </li>
  )
}

/** «Проверка»: лицо — всегда, локально и бесплатно; анахронизмы — вопрос к VLM, выключатель профиля канала. Цена вопроса
 *  и сумма перепроверки — из сметы бэкенда (`GET …/check/estimate`), число и сумма в кнопке — из одного ответа (L-056) */
function ChecksBlock({ channel, episodeId, selected }: { channel: ChannelId; episodeId: string; selected: readonly string[] }) {
  const profile = useChannels().data?.find((item) => item.id === channel)
  const vlm = profile?.checks?.anachronism ?? true
  const estimate = useCheckEstimate(episodeId, selected)
  const patch = usePatchChannelChecks(channel)
  const recheck = useCheckShots(episodeId)
  const pushToast = useUiStore((s) => s.pushToast)
  const question = estimate.data?.question

  const toggle = async (next: boolean) => {
    try {
      await patch.mutateAsync({ anachronism: next })
      pushToast({
        id: 'checks-anachronism',
        message: next ? 'Проверка анахронизмов включена' : 'Проверка анахронизмов выключена: новые кадры не проверяются',
        status: 'ready',
      })
    } catch (error) {
      pushToast({ id: 'checks-anachronism-failed', message: (error as Error).message, status: 'failed' })
    }
  }

  // Смета ещё про прежний выбор — ни числа, ни суммы из неё (L-056)
  const current = estimate.data && !estimate.isPlaceholderData ? estimate.data : null
  const count = current?.count ?? 0
  const paid = current !== null && current.vlm && current.total.usd_micro > 0
  // Панель 240–280: «Перепроверить выбранные (104, ~$0.111)» в неё не влезает — что перепроверяются выбранные кадры,
  // говорит подсказка под кнопкой
  const label = !selected.length || !current ? 'Перепроверить' : `Перепроверить (${count}${paid ? `, ~${current.total.usd}` : ''})`
  const skipped = current?.skipped ?? []
  const hint = !selected.length
    ? 'Перепроверяются кадры, выбранные в сетке — выберите их'
    : skipped.length
      ? `Не встанут: ${skipped.length} ${plural(skipped.length, SHOTS)} — ${skipped[0]!.reason}`
      : `Выбранные в сетке: ${selected.length} ${plural(selected.length, SHOTS)}`

  const run = async () => {
    if (!current || recheck.isPending) return
    try {
      const jobs = await recheck.mutateAsync(current.shots.map((shot) => shot.shot_id))
      pushToast({ id: 'recheck', message: `Перепроверка в очереди: ${jobs.length} ${plural(jobs.length, SHOTS)}`, status: 'ready' })
    } catch (error) {
      const refused = error instanceof CheckRefused ? error : null
      const queued = refused?.queued.length ? `Поставлено ${refused.queued.length}, дальше отказ — ` : ''
      pushToast({ id: 'recheck-refused', message: `${queued}${refused ? `${refused.shotId}: ` : ''}${(error as Error).message}`, status: 'failed' })
    }
  }

  return (
    <section aria-label="Проверка" className="flex flex-col gap-1.5 border-t border-line pt-3">
      <h3 className="text-12 font-medium text-muted">Проверка</h3>
      <p className="text-12 text-muted">Сходство лица с фасом облика — локально, бесплатно</p>
      <Toggle
        checked={vlm}
        onChange={(next) => void toggle(next)}
        disabled={!profile || patch.isPending}
        label={`Анахронизмы через VLM${question ? ` (~${question.usd} за кадр)` : ''}`}
      />
      <p className="text-11 text-muted">Только пометки, ничего не блокирует</p>
      <Button
        size="sm"
        className="self-start"
        disabled={!current || count === 0}
        loading={recheck.isPending}
        loadingLabel="Ставлю в очередь"
        onClick={() => void run()}
      >
        {label}
      </Button>
      {hint && <p className="text-11 text-muted">{hint}</p>}
      {estimate.error && (
        <p role="alert" className="text-11 text-failed-text">
          {estimate.error.message}
        </p>
      )}
    </section>
  )
}
