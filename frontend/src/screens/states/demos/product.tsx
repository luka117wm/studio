/* Продуктовые состояния — тексты и числа из артборда 10 (карточки — в productCards.tsx). */
import { Calendar, FileText, Lightbulb } from 'lucide-react'
import { EmptyState } from '../../../ui'
import type { ProductState } from '../registry'
import { ConflictBar, DraftTimelineCard, EmptyShotsCard, ErrorCard, ProcessCard, StaleTable } from './productCards'
export const productStates: ProductState[] = [
  {
    id: 'no-episodes', section: 'empty', where: 'Выпуски — пусто', note: 'первый запуск',
    node: (
      <EmptyState
        icon={Calendar}
        title="Выпусков пока нет"
        description="Выпуск — это один ролик от идеи до публикации. Начните с пустого или возьмите тему из радара трендов."
        primary={{ label: 'Новый выпуск', onClick: () => {} }}
        secondary={{ label: 'Открыть идеи', onClick: () => {} }}
        hint="Слот публикации: 15 сентября"
      />
    ),
  },
  {
    id: 'no-ideas', section: 'empty', where: 'Идеи — пусто', note: 'радар не запускался',
    node: (
      <EmptyState
        icon={Lightbulb}
        title="Радар ещё не собран"
        description="Семена ниши заданы: every rank, medieval life, pirates, ancient jobs. Запустите радар — найдутся выбросы и кластеры тем."
        primary={{ label: 'Обновить радар (38 запросов квоты)', price: 0.12, onClick: () => {} }}
        secondary={{ label: 'Разобрать референс', onClick: () => {} }}
        hint="Квота дня: 0 из 10 000"
      />
    ),
  },
  {
    id: 'no-plan', section: 'empty', where: 'Сценарий и план — плана нет', note: 'сценарий готов',
    node: (
      <EmptyState
        icon={FileText}
        title="План кадров не загружен"
        description="Сценарий на 3 060 слов есть. План собирает кадры, промпты, движение и звук — частями по 26 кадров."
        primary={{ label: 'Собрать план', price: 0.98, onClick: () => {} }}
        secondary={{ label: 'Вставить план из чата', onClick: () => {} }}
        hint="Оценка: 104 кадра, 8 разделов"
      />
    ),
  },
  { id: 'no-shots', section: 'empty', where: 'Генерация — кадры не сгенерированы', note: 'план утверждён, очередь пуста', node: <EmptyShotsCard /> },
  { id: 'no-voice', section: 'empty', where: 'Монтаж — нет озвучки', note: 'таймлайн по оценочным длительностям', noteWarning: true, node: <DraftTimelineCard /> },

  {
    id: 'process-shots', section: 'process', where: 'Генерация — пакет кадров', note: 'очередь не блокирует работу',
    node: (
      <ProcessCard
        title="Генерирую кадры: 78 из 104"
        pct={75}
        steps={[{ label: 'Раздел 1–4', pct: 100, state: 'done' }, { label: 'Boatswain', pct: 62, state: 'run' }, { label: 'Quartermaster', pct: 0, state: 'todo' }, { label: 'Captain', pct: 0, state: 'todo' }]}
        current="Кадр s079 · параллельно 3 запроса"
        eta="осталось ~9 мин"
        footnote="Потрачено $5.23 из $6.97 по смете. Отмена оставит уже нарисованные кадры."
      />
    ),
  },
  {
    id: 'process-voice', section: 'process', where: 'Генерация — озвучка', note: 'голос ведёт тайминг',
    node: (
      <ProcessCard
        title="Озвучиваю: 4 из 8 разделов"
        pct={57}
        steps={[{ label: 'Cold open', pct: 100, state: 'done' }, { label: 'Able seaman', pct: 100, state: 'done' }, { label: 'Boatswain', pct: 34, state: 'run' }, { label: 'Captain и Outro', pct: 0, state: 'todo' }]}
        current="Раздел Boatswain, 2 140 из 6 300 знаков"
        eta="осталось ~4 мин"
        footnote="После каждого раздела кадры сдвигаются под его длительность."
      />
    ),
  },
  {
    id: 'process-render', section: 'process', where: 'Экспорт — рендер', note: 'локально, без расходов',
    node: (
      <ProcessCard
        title="Рендер YouTube 1080p"
        pct={63}
        steps={[{ label: 'Кадры', pct: 100, state: 'done' }, { label: 'Склейка', pct: 100, state: 'done' }, { label: 'Звук', pct: 42, state: 'run' }, { label: 'Субтитры и финал', pct: 0, state: 'todo' }]}
        current="Кадр 22 836 из 35 640 · s063 дополнен последним кадром"
        currentWarning
        eta="осталось ~5 мин"
        footnote="NVENC, 61 fps. Лог ffmpeg открывается по кнопке «Показать лог»."
      />
    ),
  },
  {
    id: 'process-upload', section: 'process', where: 'Публикация — загрузка', note: 'возобновляемая',
    node: (
      <ProcessCard
        title="Загружаю на YouTube"
        pct={68}
        steps={[{ label: 'Видео', pct: 68, state: 'run' }, { label: 'Обложка', pct: 0, state: 'todo' }, { label: 'Субтитры', pct: 0, state: 'todo' }, { label: 'Расписание', pct: 0, state: 'todo' }]}
        current="843 МБ из 1.24 ГБ · 11.4 МБ/с"
        eta="осталось ~1 мин"
        footnote="После обрыва связи загрузка продолжится с 843 МБ."
      />
    ),
  },

  {
    id: 'error-key', section: 'errors', where: 'Настройки — провайдеры', note: 'ключ недействителен',
    node: (
      <ErrorCard
        kind="failed"
        title="Ключ ElevenLabs отклонён"
        body="Провайдер ответил 401: ключ отозван или скопирован не полностью. Озвучка приостановлена, кадры генерируются дальше."
        detail="POST /v1/text-to-speech → 401 invalid_api_key"
        primary="Открыть провайдеры"
        secondary="Отключить озвучку"
        aside="ключ хранится локально"
      />
    ),
  },
  {
    id: 'error-rate', section: 'errors', where: 'Генерация — кадры', note: 'лимит провайдера',
    node: (
      <ErrorCard
        kind="warning"
        title="Лимит запросов Gemini, повтор через 40 с"
        body="Провайдер держит 60 запросов в минуту. Очередь ждёт сама, 26 кадров останутся в очереди, уже нарисованные не пропадут."
        countdown={40}
        primary="Повторить сейчас"
        secondary="Снизить параллельность до 1"
        aside="78 из 104 готовы"
      />
    ),
  },
  {
    id: 'error-budget', section: 'errors', where: 'Любое платное действие', note: 'бюджет превышен',
    node: (
      <ErrorCard
        kind="warning"
        title="Лимит выпуска исчерпан: $20.00 из $20.00"
        body="Перерисовка 12 кадров стоит $0.80 — выйдет за лимит выпуска. Поднимите лимит или отложите действие на следующий период."
        primary="Поднять лимит выпуска"
        secondary="Отложить действие"
        aside="месяц: $61.40 из $150"
      />
    ),
  },
  {
    id: 'error-net', section: 'errors', where: 'Оболочка', note: 'нет сети',
    node: (
      <ErrorCard
        kind="failed"
        title="Сети нет — платные этапы недоступны"
        body="Монтаж, правка плана и экспорт работают локально. Генерация и загрузка возобновятся сами, когда связь вернётся."
        primary="Проверить соединение"
        secondary="Работать локально"
        aside="последняя синхронизация 12:41"
      />
    ),
  },
  {
    id: 'error-file', section: 'errors', where: 'Монтаж — кадр', note: 'файл не найден',
    node: (
      <ErrorCard
        kind="failed"
        title="Файл кадра s047 не найден"
        body="Файл переименован или удалён вне приложения. Укажите его заново или перерисуйте кадр — промпт и параметры движения сохранились."
        detail="~/Studio/cursus/pirate-ship/shots/s047.png"
        primary="Указать файл"
        secondary="Перерисовать (~$0.07)"
        aside="ещё 2 файла не найдены"
      />
    ),
  },

  { id: 'conflict-bar', section: 'conflict', where: 'Монтаж и генерация — план изменён после генерации', note: 'полоса под лентой этапов, живёт до решения', node: <ConflictBar /> },
  { id: 'conflict-table', section: 'conflict', where: 'Что именно разошлось', note: '6 кадров, изменения из плана от 12:38', node: <StaleTable /> },
]
