/* Состояния ошибок на компонентах кита: поля с ошибкой, статусные кнопки, бейджи и тосты. */
import { Button, Input, NumberInput, Select, StatusBadge, Textarea, Toast } from '../../../ui'
import type { Demo } from '../registry'
import { Col, Row } from './helpers'

export const errors: Demo[] = [
  {
    component: 'Input',
    state: 'ошибка: подпись 11 в цвете failed, aria-invalid',
    node: <Input value="Pirate Ship" onChange={() => {}} ariaLabel="Название" error="Уже есть такой выпуск" className="w-72" />,
  },
  {
    component: 'Textarea',
    state: 'ошибка валидатора промпта',
    node: <Textarea value="oil painting, 8k" onChange={() => {}} variant="prompt" ariaLabel="Промпт" error="Стилевые слова в промпте: oil painting, 8k" className="w-96" />,
  },
  {
    component: 'NumberInput',
    state: 'значение вне диапазона',
    node: <NumberInput value={30} onChange={() => {}} min={3} max={25} unit="%" ariaLabel="Сила" error="Не больше 25 %" className="w-24" />,
  },
  {
    component: 'Select',
    state: 'обязательное поле не заполнено',
    node: <Select options={[{ value: 'a', label: 'Adam' }]} value={null} onChange={() => {}} ariaLabel="Голос" placeholder="Выберите голос" error="Нужен голос" className="w-56" />,
  },
  {
    component: 'Button',
    state: 'кнопки действия в карточке ошибки: контур в цвете статуса, не мятная',
    node: (
      <Row>
        <Button variant="statusOutline" status="failed">Указать файл</Button>
        <Button variant="statusOutline" status="warning">Повторить сейчас</Button>
        <Button variant="danger">Удалить кадр</Button>
      </Row>
    ),
  },
  {
    component: 'StatusBadge',
    state: 'warning и failed с текстом причины',
    node: (
      <Row>
        <StatusBadge status="warning" label="Низкая уверенность тайминга" />
        <StatusBadge status="failed" label="12 кадров не удались" />
      </Row>
    ),
  },
  {
    component: 'Toast',
    state: 'ошибка и предупреждение',
    node: (
      <Col>
        <Toast item={{ id: 'e1', message: 'Ключ ElevenLabs отклонён', status: 'failed', action: { label: 'Открыть провайдеры', onClick: () => {} } }} onDismiss={() => {}} />
        <Toast item={{ id: 'e2', message: 'Лимит запросов Gemini, повтор через 40 с', status: 'warning' }} onDismiss={() => {}} />
      </Col>
    ),
  },
]
