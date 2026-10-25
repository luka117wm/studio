/* Плитка кадра в сетке экрана 4 (артборд 4, `ShotCard` в components.md): 16:9, миниатюра 320 выбранной версии или фон
   статуса, номер кадра (у сбоя — цвет fail), глиф статуса по design/CLAUDE.md, точки версий («Версия 2 из 3,
   выбрана»), у сбоя — причина внизу. Наведение, выбор и действия кадра — M6.8, пометки проверок — M6.10. */
import { shotThumb } from '../../api/queries'
import { StatusGlyph, cn } from '../../ui'
import { TILE_GLYPH, TILE_LABEL, type TileShot } from './grid'

export function ShotTile({ episodeId, shot }: { episodeId: string; shot: TileShot }) {
  const glyph = TILE_GLYPH[shot.status]
  const failed = shot.status === 'failed'
  const generating = shot.status === 'generating'
  const pictured = shot.version !== null
  // Подпись над картинкой читается на подложке, на пустом кадре подложка не нужна
  const backing = pictured ? 'rounded-control bg-app/70 px-1' : undefined
  return (
    <li
      aria-label={`${shot.id}, ${TILE_LABEL[shot.status]}`}
      data-status={shot.status}
      title={shot.status === 'stale' && shot.staleReasons.length ? shot.staleReasons.join('; ') : undefined}
      className={cn(
        'relative aspect-video overflow-hidden rounded-clip border',
        shot.status === 'queued' ? 'bg-strip' : 'bg-hover',
        failed ? 'border-failed' : generating ? 'border-accent/50' : 'border-line',
      )}
    >
      {pictured && (
        <img
          src={shotThumb(episodeId, shot.id, shot.version!)}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      )}
      <span className={cn('absolute top-1 left-1 font-script text-11', failed ? 'text-failed-text' : 'text-muted', backing)}>{shot.id}</span>
      {glyph && (
        <span className={cn('absolute top-1 right-1 flex items-center gap-1', backing)}>
          {generating && <span className="text-11 text-generating">рисуется</span>}
          <StatusGlyph status={glyph} label={TILE_LABEL[shot.status]} />
        </span>
      )}
      {shot.versions.length > 0 && (
        <span className="absolute right-1 bottom-1 flex gap-0.75">
          {shot.versions.map((version) => {
            const chosen = version === shot.version
            const label = `Версия ${version} из ${shot.versions.length}${chosen ? ', выбрана' : ''}`
            return (
              <span key={version} role="img" aria-label={label} title={label} className={cn('size-1.25 rounded-full', chosen ? 'bg-accent' : 'bg-disabled')} />
            )
          })}
        </span>
      )}
      {failed && shot.error && (
        <p className="absolute inset-x-0 bottom-0 line-clamp-2 border-t border-failed bg-app/90 px-2 py-1 text-11 text-failed-text">{shot.error}</p>
      )}
      {generating && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.75 bg-accent" />}
    </li>
  )
}
