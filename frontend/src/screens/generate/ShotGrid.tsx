/* Сетка кадров экрана 4 по разделам плана (артборд 4, `ShotGrid` в components.md): заголовок раздела прилипает
   (layout.md, «Скролл и прилипание»), справа — сводка раздела; плитки 5 в ряд на 1536, 6 на 1920, 8 на 2560.
   Прокручивается только сетка. Мультивыделение и полоса групповых действий — M6.8. */
import { cn } from '../../ui'
import { statusTextClass } from '../../ui/status'
import { plural } from '../episodes/board'
import { ShotTile } from './ShotTile'
import { SHOTS, sectionNote, type GridSection } from './grid'

export function ShotGrid({ episodeId, sections }: { episodeId: string; sections: GridSection[] }) {
  return (
    <div data-testid="shot-grid" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      {sections.map(({ section, shots }) => {
        const note = sectionNote(shots)
        return (
          <section key={section.id} aria-label={section.title}>
            <header className="sticky top-0 z-10 flex h-7 items-center gap-2 border-b border-line bg-app px-1">
              <h2 className="text-13 font-semibold text-ink">{section.title}</h2>
              <span className="text-12 text-muted">
                {shots.length} {plural(shots.length, SHOTS)}
              </span>
              <span className={cn('ml-auto font-dense text-11', note.status ? statusTextClass[note.status] : 'text-muted')}>{note.text}</span>
            </header>
            <ul aria-label={`Кадры: ${section.title}`} className="grid grid-cols-5 gap-2 px-1 pt-2 pb-3 min-[1920px]:grid-cols-6 min-[2560px]:grid-cols-8">
              {shots.map((shot) => (
                <ShotTile key={shot.id} episodeId={episodeId} shot={shot} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
