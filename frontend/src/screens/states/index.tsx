/* Экран 10 «Состояния» — каталог кита и продуктовых состояний. Только dev-сборка (см. app/routes.ts).
   Секции: шесть групп компонентов из реестра, продуктовые состояния (тексты артборда 10), клавиатура из реестра M1.4. */
import { useState, type ReactNode } from 'react'
import { formatKeys, isEnabled } from '../../app/keyboard'
import type { RouteParams } from '../../app/routes'
import { ScreenLayout } from '../../app/ScreenLayout'
import { useRegisteredHotkeys } from '../../app/useHotkey'
import { KeyHint, ScrollArea, TabPanel, Tabs, cn } from '../../ui'
import { allDemos, groups, productSections, productStates, type Demo, type DemoGroupId } from './registry'

type SectionId = DemoGroupId | 'product' | 'keyboard'

const TABS: { id: SectionId; label: string }[] = [
  ...groups.map((g) => ({ id: g.id, label: g.title })),
  { id: 'product', label: 'Продукт' },
  { id: 'keyboard', label: 'Клавиатура' },
]

export function StatesScreen(_props: { params: RouteParams }) {
  const [section, setSection] = useState<SectionId>('controls')
  return (
    <ScreenLayout
      header={{
        title: 'Состояния',
        note: `${allDemos().length} демонстраций · ${productStates.length} продуктовых · оверлей клавиш по «?»`,
        actions: <Tabs ariaLabel="Разделы каталога" value={section} onChange={setSection} tabs={TABS} className="border-b-0" />,
      }}
    >
      <ScrollArea className="flex-1 p-4">
        {groups.map((g) => (
          <TabPanel key={g.id} id={g.id} active={section === g.id}>
            <DemoGrid demos={g.demos} />
          </TabPanel>
        ))}
        <TabPanel id="product" active={section === 'product'}>
          <ProductSection />
        </TabPanel>
        <TabPanel id="keyboard" active={section === 'keyboard'}>
          <KeyboardSection />
        </TabPanel>
      </ScrollArea>
    </ScreenLayout>
  )
}

function Card({ title, note, noteWarning, children, className }: { title: string; note?: string; noteWarning?: boolean; children: ReactNode; className?: string }) {
  return (
    <article className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-12 font-semibold text-ink">{title}</h2>
        {note && <span className={cn('text-11', noteWarning ? 'text-warning' : 'text-muted')}>{note}</span>}
      </div>
      {children}
    </article>
  )
}

function DemoGrid({ demos }: { demos: Demo[] }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {demos.map((d, i) => (
        <Card key={`${d.component}-${i}`} title={d.component} note={d.state} className={d.component === 'Slider' || d.component === 'Textarea' ? 'col-span-2' : undefined}>
          <div className="flex min-h-16 flex-col justify-center rounded-panel border border-line bg-panel p-3">{d.node}</div>
          {d.note && <span className="text-11 text-muted">{d.note}</span>}
        </Card>
      ))}
    </div>
  )
}

function ProductSection() {
  return (
    <div className="flex flex-col gap-6">
      {productSections.map((s) => {
        const items = productStates.filter((p) => p.section === s.id)
        return (
          <section key={s.id} aria-label={s.title} className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-13 font-semibold text-ink">{s.title}</h2>
              <span className="text-11 text-muted">{s.status}</span>
            </div>
            <div className={cn('grid gap-4', s.id === 'empty' ? 'grid-cols-3' : s.id === 'conflict' ? 'grid-cols-1' : 'grid-cols-2')}>
              {items.map((p) => (
                <Card key={p.id} title={p.where} note={p.note} noteWarning={p.noteWarning} className={p.section === 'empty' && (p.id === 'no-shots' || p.id === 'no-voice') ? 'col-span-3' : undefined}>
                  {p.section === 'empty' && !(p.id === 'no-shots' || p.id === 'no-voice') ? (
                    <div className="flex h-75 items-center justify-center rounded-panel border border-line bg-panel p-6">{p.node}</div>
                  ) : (
                    p.node
                  )}
                </Card>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function KeyboardSection() {
  const hotkeys = useRegisteredHotkeys()
  const groupsOf = new Map<string, typeof hotkeys>()
  for (const h of hotkeys) {
    const list = groupsOf.get(h.group)
    if (list) list.push(h)
    else groupsOf.set(h.group, [h])
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-12 text-muted">Список строится из реестра `app/keyboard.ts`: что зарегистрировано сейчас, то и работает. Выключенные по условию помечены.</p>
      <div className="grid grid-cols-3 gap-4">
        {Array.from(groupsOf.entries()).map(([group, items]) => (
          <section key={group} aria-label={group} className="flex flex-col gap-1">
            <h2 className="flex h-6 items-center text-12 font-semibold text-muted">{group}</h2>
            {items.map((h) => {
              const enabled = isEnabled(h)
              return (
                <div key={h.id} className={cn('flex min-h-7 items-center gap-2 rounded-control border border-line bg-raised px-2', !enabled && 'opacity-60')}>
                  <span className="min-w-0 flex-1 truncate text-12 text-ink">{h.description}</span>
                  <span className="text-11 text-muted">{h.scope}</span>
                  {!enabled && <span className="text-11 text-muted">сейчас недоступно</span>}
                  <KeyHint keys={formatKeys(h.keys)} />
                </div>
              )
            })}
          </section>
        ))}
      </div>
    </div>
  )
}
