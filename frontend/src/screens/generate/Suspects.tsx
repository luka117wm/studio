/* Вид «Подозрительные» экрана 4 (M6.10; устав M6, решение 7; черновик B2A.5, пункт 3): выбранные версии с пометками
   проверок — лицо не похоже на фас, анахронизм — по возрастанию сходства лица; первые десять — «Смотреть первыми».
   Плитка ведёт в «Сравнение версий» кадра: там выбирают другую версию или добавляют новую. Кадр с пометкой ничем не
   ограничен — пометка только поднимает его наверх. Сетка — как у кадров: 5 в ряд на 1536, 6 на 1920, 8 на 2560. */
import { ShieldCheck } from 'lucide-react'
import { shotThumb } from '../../api/queries'
import { EmptyState, StatusGlyph } from '../../ui'
import { plural } from '../episodes/board'
import { FIRST_LOOK, anachronismMarkLabel, suspects, type Suspect } from './checks'
import { SHOTS, type GridSection } from './grid'

export interface SuspectsProps {
  episodeId: string
  sections: GridSection[]
  /** Проверка анахронизмов выключена в профиле: её пометки — «проверено раньше» */
  checkedEarlier: boolean
  onOpen: (shotId: string) => void
  onGrid: () => void
}

export function Suspects({ episodeId, sections, checkedEarlier, onOpen, onGrid }: SuspectsProps) {
  const list = suspects(sections)
  if (!list.length) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-4">
        <EmptyState
          icon={ShieldCheck}
          title="Подозрительных кадров нет"
          description="Пометки ставят проверки новых версий: лицо не похоже на фас облика или в кадре анахронизм эпохи. Кадры без пометок — в сетке."
          secondary={{ label: 'К сетке кадров', onClick: onGrid }}
        />
      </div>
    )
  }
  const groups = [
    { title: 'Смотреть первыми', items: list.slice(0, FIRST_LOOK) },
    { title: 'Остальные', items: list.slice(FIRST_LOOK) },
  ].filter((group) => group.items.length > 0)
  return (
    <div data-testid="suspects" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      {groups.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <header className="sticky top-0 z-10 flex h-7 items-center gap-2 border-b border-line bg-app px-1">
            <h2 className="text-13 font-semibold text-ink">{group.title}</h2>
            <span className="text-12 text-muted">
              {group.items.length} {plural(group.items.length, SHOTS)}
            </span>
          </header>
          <ul aria-label={`Подозрительные: ${group.title}`} className="grid grid-cols-5 gap-2 px-1 pt-2 pb-3 min-[1920px]:grid-cols-6 min-[2560px]:grid-cols-8">
            {group.items.map((item) => (
              <SuspectTile key={item.shot.id} episodeId={episodeId} item={item} checkedEarlier={checkedEarlier} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function SuspectTile({ episodeId, item, checkedEarlier, onOpen }: { episodeId: string; item: Suspect; checkedEarlier: boolean; onOpen: (shotId: string) => void }) {
  const { shot, section } = item
  const { face, found } = shot.marks
  return (
    <li data-shot={shot.id} className="flex min-w-0 flex-col overflow-hidden rounded-clip border border-line bg-panel">
      <button
        type="button"
        data-tile
        aria-label={`Версии кадра ${shot.id}`}
        title="Сравнить версии кадра"
        onClick={() => onOpen(shot.id)}
        className="relative aspect-video cursor-pointer bg-hover outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        {shot.version !== null && (
          <img src={shotThumb(episodeId, shot.id, shot.version)} alt="" loading="lazy" decoding="async" className="pointer-events-none absolute inset-0 size-full object-cover" />
        )}
        <span className="pointer-events-none absolute top-1 left-1 rounded-control bg-app/70 px-1 font-script text-11 text-muted">{shot.id}</span>
      </button>
      <div className="flex flex-col gap-0.5 px-1.5 py-1 text-11">
        <span className="truncate text-muted">{section.title}</span>
        {face && (
          <span className="flex items-center gap-1 text-warning">
            <StatusGlyph status="warning" label="Лицо не похоже на фас" />
            Лицо {face.score === null ? 'не похоже' : face.score.toFixed(2)}
          </span>
        )}
        {found.length > 0 && (
          <span title={anachronismMarkLabel(found, checkedEarlier)} className="flex min-w-0 items-center gap-1 text-warning">
            <StatusGlyph status="warning" label="Анахронизм" />
            <span className="truncate">
              {anachronismMarkLabel(found, checkedEarlier)}
            </span>
          </span>
        )}
      </div>
    </li>
  )
}
