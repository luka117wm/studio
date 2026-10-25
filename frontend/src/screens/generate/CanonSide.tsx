/* «Канон выпуска · только чтение» — левая панель экрана 4 (артборд 4; устав M6, решение 8): к каким версиям канона
   прибит выпуск и готовы ли листы обликов, без которых кадр с персонажем не рисуется. Данные — `GET …/canon` (M5.10),
   фас облика — выбранный кандидат его листа (`…/anchors`, те же запросы, что у карточек экрана 12). Править канон —
   на экране 12: ссылки и статусы ссылок — `screens/script/canonLinks.ts`, общие с каноном выпуска экрана 3. */
import type { AnchorSetState } from '@/types/canon'
import type { EpisodeAppearanceItem, EpisodeCanonItem } from '@/types/plan'
import { anchorThumb, useAppearanceSheets, useEpisodeCanon, type ChannelId } from '../../api/queries'
import { paths } from '../../app/routes'
import { Skeleton, StatusGlyph, cn, type Status } from '../../ui'
import { CanonLink } from '../script/CanonLink'
import { canonHref, canonIssues, refState, sheetLabel } from '../script/canonLinks'

export interface CanonSideProps {
  channel: ChannelId
  episodeId: string
  /** Текущая версия плана; без плана канона выпуска нет */
  version: string | null
}

export function CanonSide({ channel, episodeId, version }: CanonSideProps) {
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
