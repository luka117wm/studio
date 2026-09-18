/* Экран 3 «Сценарий и план»: лист 760 по центру + инспектор 320; на 2560 — колонка раскадровки 320. Содержимое — M4. */
import { FileText, Image, LayoutGrid } from 'lucide-react'
import { EpisodeScreen } from '../../app/EpisodeScreen'
import { PanelHeader } from '../../app/PanelHeader'
import { ScreenLayout } from '../../app/ScreenLayout'
import type { RouteParams } from '../../app/routes'
import { estimates } from '../../mocks/fixtures'
import { EmptyState } from '../../ui'

export function ScriptScreen({ params }: { params: RouteParams }) {
  return (
    <EpisodeScreen params={params}>
      {(episode) => (
        <ScreenLayout
          header={{ title: 'Сценарий и план', note: `${episode.words.toLocaleString('ru-RU')} слов · ${episode.shots} кадра · ${episode.duration}` }}
          right={{
            title: 'Кадр',
            icon: Image,
            collapsible: true,
            children: <EmptyState icon={Image} title="Кадр не выбран" description="Выделите текст на листе — здесь появятся промпт, движение и звук кадра." />,
          }}
        >
          {/* Лист 760 по центру; на 2560 справа от листа — колонка раскадровки 320 (layout.md) */}
          <div className="flex min-h-0 flex-1 justify-center gap-4 overflow-y-auto p-4">
            <section aria-label="Лист сценария" className="flex w-190 shrink-0 items-center justify-center rounded-panel border border-line bg-panel">
              <EmptyState
                icon={FileText}
                title="Сценария пока нет"
                description={`Три режима: свой текст, структура референса, генерация из идеи. Целевая длина — ${episode.duration}.`}
                primary={{ label: 'Написать сценарий', price: estimates.scriptUsd, onClick: () => {} }}
                secondary={{ label: 'Вставить свой', onClick: () => {} }}
              />
            </section>
            <aside aria-label="Раскадровка" className="hidden w-80 shrink-0 flex-col rounded-panel border border-line bg-panel min-[2560px]:flex">
              <PanelHeader title="Раскадровка" note="2 в ряд" />
              <EmptyState icon={LayoutGrid} title="Кадров пока нет" description="Миниатюры 16:9 появятся после генерации." />
            </aside>
          </div>
        </ScreenLayout>
      )}
    </EpisodeScreen>
  )
}
