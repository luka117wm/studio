/* Ввод: поля, textarea, числа, селект — пустое, заполненное, ошибка, disabled. */
import { Input, NumberInput, Select, Textarea } from '../../../ui'
import type { Demo } from '../registry'
import { Col, Row, Stateful } from './helpers'

const MOTION = [
  { value: 'push_in', label: 'Наезд' },
  { value: 'pull_out', label: 'Отъезд' },
  { value: 'pan', label: 'Панорама', disabled: true },
  { value: 'static', label: 'Статика' },
]

export const inputs: Demo[] = [
  {
    component: 'Input',
    state: 'пустое с подсказкой, заполнено, ошибка, disabled, readOnly',
    node: (
      <Stateful initial="">
        {(v, set) => (
          <Col>
            <Input value={v} onChange={set} placeholder="Название выпуска" ariaLabel="Название" className="w-72" />
            <Input value="Every Rank on a Pirate Ship" onChange={() => {}} ariaLabel="Заполнено" className="w-72" />
            <Input value="Pirate Ship" onChange={() => {}} ariaLabel="С ошибкой" error="Уже есть такой выпуск" className="w-72" />
            <Input value="Недоступно" onChange={() => {}} ariaLabel="Недоступно" disabled className="w-72" />
            <Input value="Только чтение" onChange={() => {}} ariaLabel="Только чтение" readOnly className="w-72" />
          </Col>
        )}
      </Stateful>
    ),
  },
  {
    component: 'Textarea',
    state: 'default, prompt (шрифт сценария, авторост), ошибка',
    node: (
      <Stateful initial="">
        {(v, set) => (
          <Col>
            <Textarea value={v} onChange={set} placeholder="Заметка к кадру" ariaLabel="Заметка" className="w-96" />
            <Textarea
              value="carries a leather cartridge case down the gun deck, glancing back over his shoulder"
              onChange={() => {}}
              variant="prompt"
              ariaLabel="Промпт"
              className="w-96"
            />
            <Textarea value="photorealistic, 8k, cinematic lighting" onChange={() => {}} variant="prompt" ariaLabel="Промпт с ошибкой" error="Стилевые слова в промпте: photorealistic, 8k, cinematic lighting" className="w-96" />
          </Col>
        )}
      </Stateful>
    ),
  },
  {
    component: 'NumberInput',
    state: 'с единицей, компакт, ошибка, disabled',
    node: (
      <Stateful initial={8}>
        {(v, set) => (
          <Row>
            <NumberInput value={v} onChange={set} min={3} max={25} unit="%" ariaLabel="Сила" className="w-20" />
            <NumberInput value={4} onChange={() => {}} min={1} max={10} step={0.5} unit="с" size="sm" ariaLabel="Секунды" className="w-20" />
            <NumberInput value={30} onChange={() => {}} min={3} max={25} unit="%" ariaLabel="С ошибкой" error="Не больше 25 %" className="w-24" />
            <NumberInput value={8} onChange={() => {}} unit="%" ariaLabel="Недоступно" disabled className="w-20" />
          </Row>
        )}
      </Stateful>
    ),
  },
  {
    component: 'Select',
    state: 'выбрано, плейсхолдер, ошибка, disabled, компакт',
    node: (
      <Stateful initial={'push_in' as string | null}>
        {(v, set) => (
          <Col>
            <Select options={MOTION} value={v} onChange={set} ariaLabel="Движение" className="w-56" />
            <Select options={MOTION} value={null} onChange={() => {}} ariaLabel="Голос" placeholder="Выберите голос" className="w-56" />
            <Select options={MOTION} value={null} onChange={() => {}} ariaLabel="Голос с ошибкой" placeholder="Выберите голос" error="Нужен голос" className="w-56" />
            <Select options={MOTION} value="static" onChange={() => {}} ariaLabel="Недоступно" disabled className="w-56" />
            <Select options={MOTION} value="pull_out" onChange={() => {}} ariaLabel="Компакт" size="sm" className="w-56" />
          </Col>
        )}
      </Stateful>
    ),
  },
]
