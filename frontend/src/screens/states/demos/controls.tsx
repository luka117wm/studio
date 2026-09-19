/* Управление: кнопки, чипы, переключатели, слайдер, вкладки, подсказки клавиш, разделители. */
import { LayoutGrid, List, Plus, Settings, Trash2 } from 'lucide-react'
import {
  Button, Checkbox, Chip, Divider, IconButton, KeyHint, Radio, SegmentedControl, Slider, TabPanel, Tabs, Toggle,
} from '../../../ui'
import type { Demo } from '../registry'
import { Col, Row, Stateful } from './helpers'

export const controls: Demo[] = [
  {
    component: 'Button',
    state: 'пять вариантов',
    node: (
      <Row>
        <Button variant="primary">Утвердить план</Button>
        <Button>Открыть план</Button>
        <Button variant="ghost">Отмена</Button>
        <Button variant="danger" icon={Trash2}>Удалить</Button>
        <Button variant="statusOutline" status="warning">Поднять лимит</Button>
        <Button variant="statusOutline" status="failed">Указать файл</Button>
      </Row>
    ),
  },
  {
    component: 'Button',
    state: 'с иконкой и ценой',
    node: (
      <Row>
        <Button variant="primary" icon={Plus} price={1.61}>Сгенерировать 24 кадра</Button>
        <Button icon={Plus} price={0.07}>Перерисовать</Button>
      </Row>
    ),
  },
  {
    component: 'Button',
    state: 'loading, disabled, компакт',
    node: (
      <Row>
        <Button loading loadingLabel="Генерирую 14 из 24" price={1.61}>Сгенерировать</Button>
        <Button variant="primary" disabled>Недоступно</Button>
        <Button disabled>Недоступно</Button>
        <Button size="sm">Компакт</Button>
        <Button size="sm" variant="primary">Озвучить всё</Button>
      </Row>
    ),
  },
  {
    component: 'IconButton',
    state: 'ghost, dangerHover, disabled',
    node: (
      <Row>
        <IconButton icon={Settings} label="Настройки" />
        <IconButton icon={Trash2} label="Удалить" variant="dangerHover" />
        <IconButton icon={Settings} label="Недоступно" disabled />
      </Row>
    ),
  },
  {
    component: 'Chip',
    state: 'filter вкл / выкл, tag, add, disabled',
    node: (
      <Stateful initial={true}>
        {(on, set) => (
          <Row>
            <Chip variant="filter" label="Только failed" selected={on} onToggle={() => set(!on)} />
            <Chip variant="filter" label="Все" selected={!on} onToggle={() => set(!on)} />
            <Chip variant="tag" label="caribbean-1716" onRemove={() => {}} />
            <Chip variant="add" label="Период" onClick={() => {}} />
            <Chip variant="tag" label="disabled" onRemove={() => {}} disabled />
          </Row>
        )}
      </Stateful>
    ),
  },
  {
    component: 'Toggle',
    state: 'вкл, выкл, с подписью, disabled',
    node: (
      <Stateful initial={true}>
        {(on, set) => (
          <Row>
            <Toggle checked={on} onChange={set} ariaLabel="Субтитры" />
            <Toggle checked={!on} onChange={(v) => set(!v)} ariaLabel="Музыка" />
            <Toggle checked={on} onChange={set} label="Не подгонять под голос" />
            <Toggle checked disabled onChange={() => {}} label="Недоступно" />
          </Row>
        )}
      </Stateful>
    ),
  },
  {
    component: 'Checkbox',
    state: 'выкл, вкл, indeterminate, disabled',
    node: (
      <Stateful initial={false}>
        {(on, set) => (
          <Row>
            <Checkbox checked={on} onChange={set} label="Кадр s001" />
            <Checkbox checked onChange={() => {}} label="Кадр s002" />
            <Checkbox checked="indeterminate" onChange={() => {}} label="Все кадры" />
            <Checkbox checked={false} disabled onChange={() => {}} label="Недоступно" />
          </Row>
        )}
      </Stateful>
    ),
  },
  {
    component: 'Radio',
    state: 'группа',
    node: (
      <Stateful initial="api">
        {(v, set) => (
          <Row>
            <Radio name="demo-mode" value="api" checked={v === 'api'} onChange={set} label="API" />
            <Radio name="demo-mode" value="bridge" checked={v === 'bridge'} onChange={set} label="Мост через чат" />
            <Radio name="demo-mode" value="off" checked={false} disabled onChange={set} label="Недоступно" />
          </Row>
        )}
      </Stateful>
    ),
  },
  {
    component: 'SegmentedControl',
    state: 'md, sm, с иконками, disabled',
    node: (
      <Stateful initial={'grid' as 'grid' | 'list'}>
        {(v, set) => (
          <Row>
            <SegmentedControl ariaLabel="Вид" value={v} onChange={set} options={[{ value: 'grid', label: 'Сетка' }, { value: 'list', label: 'Список' }]} />
            <SegmentedControl ariaLabel="Вид компакт" size="sm" value={v} onChange={set} options={[{ value: 'grid', label: 'Сетка' }, { value: 'list', label: 'Список' }]} />
            <SegmentedControl ariaLabel="Вид с иконками" value={v} onChange={set} options={[{ value: 'grid', label: 'Сетка', icon: LayoutGrid }, { value: 'list', label: 'Список', icon: List }]} />
            <SegmentedControl ariaLabel="Недоступно" disabled value={v} onChange={set} options={[{ value: 'grid', label: 'Сетка' }, { value: 'list', label: 'Список' }]} />
          </Row>
        )}
      </Stateful>
    ),
  },
  {
    component: 'Slider',
    state: 'базовый, с засечкой дефолта и разбросом, с полем, disabled',
    node: (
      <Stateful initial={8}>
        {(v, set) => (
          <Col>
            <Slider ariaLabel="Сила" value={v} onChange={set} min={3} max={25} className="w-80" />
            <Slider ariaLabel="Сила с засечками" value={v} onChange={set} min={3} max={25} defaultValue={8} spread={[5, 12, 20]} className="w-80" />
            <Slider ariaLabel="Сила с полем" value={v} onChange={set} min={3} max={25} input={{ unit: '%' }} className="w-80" />
            <Slider ariaLabel="Недоступно" value={v} onChange={set} min={3} max={25} disabled className="w-80" />
          </Col>
        )}
      </Stateful>
    ),
  },
  {
    component: 'Tabs',
    state: 'вкладки с панелями и disabled',
    node: (
      <Stateful initial={'shot' as 'shot' | 'vo' | 'sfx'}>
        {(v, set) => (
          <div className="w-80">
            <Tabs ariaLabel="Инспектор" value={v} onChange={set} tabs={[{ id: 'shot', label: 'Кадр' }, { id: 'vo', label: 'Голос', disabled: true }, { id: 'sfx', label: 'SFX' }]} />
            <TabPanel id="shot" active={v === 'shot'} className="p-2 text-12 text-muted">Панель кадра</TabPanel>
            <TabPanel id="sfx" active={v === 'sfx'} className="p-2 text-12 text-muted">Панель SFX</TabPanel>
          </div>
        )}
      </Stateful>
    ),
  },
  {
    component: 'TabPanel',
    state: 'панель активной вкладки',
    node: (
      <TabPanel id="demo-panel" active className="rounded-control border border-line p-2 text-12 text-muted">
        Содержимое панели, фокусируется с клавиатуры
      </TabPanel>
    ),
  },
  {
    component: 'KeyHint',
    state: 'сочетание и с подписью',
    node: (
      <Row>
        <KeyHint keys={['Ctrl', '1']} />
        <KeyHint keys={['Alt', '3']} label="инспектор" />
        <KeyHint keys={['?']} label="горячие клавиши" />
      </Row>
    ),
  },
  {
    component: 'Divider',
    state: 'горизонтальный, вертикальный, inset',
    node: (
      <Col>
        <Divider />
        <Divider inset />
        <div className="flex h-6 items-center gap-3 text-12 text-muted">
          слева
          <Divider orientation="vertical" />
          справа
        </div>
      </Col>
    ),
  },
]
