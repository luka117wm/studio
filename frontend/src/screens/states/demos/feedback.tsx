/* Обратная связь: прогресс, скелетоны, статусы, тосты, прокрутка. */
import { ProgressBar, STATUSES, ScrollArea, Skeleton, StatusBadge, StatusGlyph, Toast } from '../../../ui'
import type { Demo } from '../registry'
import { Col, Row } from './helpers'
import { ToastStackDemo } from './live'

export const feedback: Demo[] = [
  {
    component: 'ProgressBar',
    state: 'значение, неопределённый, ready, warning, failed, md',
    node: (
      <Col>
        <ProgressBar value={37} ariaLabel="Генерация" className="w-80" />
        <ProgressBar value={null} ariaLabel="Ожидание" className="w-80" />
        <ProgressBar value={100} status="ready" ariaLabel="Готово" className="w-80" />
        <ProgressBar value={60} status="warning" ariaLabel="Предупреждение" className="w-80" />
        <ProgressBar value={60} status="failed" ariaLabel="Ошибка" className="w-80" />
        <ProgressBar value={63} size="md" ariaLabel="Рендер" className="w-80" />
      </Col>
    ),
  },
  {
    component: 'Skeleton',
    state: 'text, block, circle',
    node: (
      <Row>
        <Skeleton variant="text" lines={3} className="w-60" />
        <Skeleton variant="block" className="h-16 w-28" />
        <Skeleton variant="circle" className="size-8" />
      </Row>
    ),
  },
  {
    component: 'StatusGlyph',
    state: 'пять статусов: форма + цвет',
    node: (
      <Row>
        {STATUSES.map((s) => (
          <StatusGlyph key={s} status={s} />
        ))}
      </Row>
    ),
  },
  {
    component: 'StatusBadge',
    state: 'пять статусов и своя подпись',
    node: (
      <Row>
        {STATUSES.map((s) => (
          <StatusBadge key={s} status={s} />
        ))}
        <StatusBadge status="generating" label="Генерирую 14 из 24" />
      </Row>
    ),
  },
  {
    component: 'Toast',
    state: 'пять статусов, с действием',
    node: (
      <Col>
        <Toast item={{ id: 't1', message: 'Перерисовано', status: 'ready', action: { label: 'Отменить', onClick: () => {} } }} onDismiss={() => {}} />
        <Toast item={{ id: 't2', message: 'Кадр s047 не сгенерирован', status: 'failed' }} onDismiss={() => {}} />
        <Toast item={{ id: 't3', message: 'Лимит выпуска близко: $18.20 из $20.00', status: 'warning' }} onDismiss={() => {}} />
        <Toast item={{ id: 't4', message: 'Генерирую 78 из 104', status: 'generating' }} onDismiss={() => {}} />
        <Toast item={{ id: 't5', message: 'В очереди: 26 кадров', status: 'queued' }} onDismiss={() => {}} />
      </Col>
    ),
  },
  {
    component: 'ToastStack',
    state: 'живой стек: до трёх, дальше «и ещё N», автоскрытие 4 с',
    note: 'стек смонтирован в Providers',
    node: <ToastStackDemo />,
  },
  {
    component: 'ScrollArea',
    state: 'вертикальная и с именем (фокусируется с клавиатуры)',
    node: (
      <Row>
        <ScrollArea className="h-24 w-56 rounded-control border border-line p-2 text-12">
          {Array.from({ length: 12 }, (_, i) => (
            <p key={i}>Строка {i + 1}</p>
          ))}
        </ScrollArea>
        <ScrollArea ariaLabel="Список кадров" className="h-24 w-56 rounded-control border border-line p-2 text-12">
          {Array.from({ length: 12 }, (_, i) => (
            <p key={i}>s{String(i + 1).padStart(3, '0')}</p>
          ))}
        </ScrollArea>
      </Row>
    ),
  },
]
