/* Слои: диалог, поповер, меню, подсказка — живые, открываются кнопкой. */
import { Settings, Trash2 } from 'lucide-react'
import { Button, DropdownMenu, Tooltip } from '../../../ui'
import type { Demo } from '../registry'
import { Row } from './helpers'
import { DialogDemo, PopoverDemo } from './live'

const MENU = [
  { id: 'redo', label: 'Перерисовать', keys: ['R'], onSelect: () => {} },
  { id: 'animate', label: 'Оживить', keys: ['A'], onSelect: () => {} },
  { id: 'sep', separator: true as const },
  { id: 'lock', label: 'Заблокировать длину', disabled: true, onSelect: () => {} },
  { id: 'delete', label: 'Удалить', icon: Trash2, danger: true, onSelect: () => {} },
]

export const layers: Demo[] = [
  {
    component: 'Dialog',
    state: 'sm, md, lg — с шапкой и подвалом',
    node: (
      <Row>
        <DialogDemo size="sm" title="Диалог sm" />
        <DialogDemo size="md" title="Диалог md" />
        <DialogDemo size="lg" title="Диалог lg" />
      </Row>
    ),
  },
  { component: 'Popover', state: 'у кнопки, Esc и клик вне закрывают', node: <PopoverDemo /> },
  {
    component: 'DropdownMenu',
    state: 'кнопка с подписью и иконка; пункты с клавишами, disabled и danger',
    node: (
      <Row>
        <DropdownMenu label="Действия" items={MENU} />
        <DropdownMenu label="Ещё" trigger="icon" icon={Settings} items={MENU} placement="bottom-end" />
      </Row>
    ),
  },
  {
    component: 'Tooltip',
    state: 'по фокусу сразу, по наведению с задержкой',
    node: (
      <Row>
        <Tooltip content="Сохранить (Ctrl+S)">
          <Button>С подсказкой</Button>
        </Tooltip>
        <Tooltip content="Подсказка снизу" placement="bottom">
          <Button variant="ghost">Снизу</Button>
        </Tooltip>
      </Row>
    ),
  },
]
