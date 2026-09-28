import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { JobEventData } from '@/types/job'
import { FakeEventSource, stubApi } from '../../api/__tests__/fakes'
import { useUiStore } from '../../store/uiStore'
import { routes } from '../routes'
import { stageStates } from '../stages'
import { renderApp } from './harness'

const INITIAL = { channel: 'cursus' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [] }

/** Путь с параметрами для каждого экрана */
const pathFor = (pattern: string) => pattern.replace(':episodeId', 'pirate').replace(':shotId', 's004')
const banner = () => screen.getByRole('banner', { name: 'Верхняя панель' })
const rail = () => screen.findByRole('navigation', { name: 'Этапы выпуска' })

beforeEach(() => useUiStore.setState(INITIAL))
// Сначала размонтировать (остановить подписку), потом снять фейки: иначе снимок джобов, пришедший между ними,
// подпишется на уже снятый EventSource
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('маршруты', () => {
  test.each(routes)('$pattern открывается по прямому URL: заголовок вкладки «$title»', ({ pattern, title }) => {
    renderApp(pathFor(pattern))
    expect(document.title).toBe(`${title} — Studio`)
    expect(screen.getByRole('main')).toBeTruthy()
  })

  test('корень ведёт к выпускам', () => {
    renderApp('/')
    expect(window.location.pathname).toBe('/episodes')
    expect(document.title).toBe('Выпуски — Studio')
  })

  test('неизвестный путь — экран «Нет такого экрана» со ссылкой к выпускам', async () => {
    renderApp('/nope')
    expect(screen.getByRole('heading', { name: 'Нет такого экрана' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'К выпускам' }))
    expect(window.location.pathname).toBe('/episodes')
    expect(screen.getByRole('heading', { name: 'Выпуски' })).toBeTruthy()
  })

  test('неизвестный выпуск — 404 бэкенда: «Выпуск не найден», рельса нет', async () => {
    renderApp('/episodes/ghost/edit')
    expect(await screen.findByRole('heading', { name: 'Выпуск не найден' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Этапы выпуска' })).toBeNull()
  })

  test('данные — только из /api: пути запросов из queries.ts', async () => {
    const { stub } = renderApp('/episodes/pirate/edit')
    await rail()
    const urls = stub.fetch.mock.calls.map(([url]) => String(url))
    expect(urls.every((url) => url.startsWith('/api/'))).toBe(true)
    expect(urls).toEqual(
      expect.arrayContaining(['/api/channels', '/api/jobs', '/api/slots', '/api/episodes/pirate', '/api/cost/summary?channel=cursus']),
    )
  })
})

describe('оболочка', () => {
  test('открытие выпуска: рельс по стадии и статусу, название и стадия в шапке, переход по рельсу', async () => {
    renderApp('/episodes/pirate/edit')
    const nav = await rail()
    const stages = within(nav).getAllByRole('link')
    expect(stages.map((s) => s.getAttribute('aria-label'))).toEqual(['Идея', 'Сценарий', 'Генерация', 'Монтаж', 'Экспорт', 'Публикация'])
    expect(within(nav).getByRole('link', { name: 'Монтаж' }).getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('link', { name: 'Генерация' }).getAttribute('title')).toBe('Генерация — готово')
    expect(within(nav).getByRole('link', { name: 'Экспорт' }).getAttribute('title')).toBe('Экспорт — не начат')
    expect(banner().textContent).toContain('Pirate Ship: Powder Monkey to Captain')
    expect(banner().textContent).toContain('монтаж')
    expect(useUiStore.getState().episodeId).toBe('pirate')

    await userEvent.click(within(nav).getByRole('link', { name: 'Экспорт' }))
    expect(window.location.pathname).toBe('/episodes/pirate/export')
    expect(document.title).toBe('Экспорт — Studio')
    expect(within(nav).getByRole('link', { name: 'Экспорт' }).getAttribute('aria-current')).toBe('page')
  })

  test('без выпуска: «Выпуск не открыт», рельса нет', () => {
    renderApp('/episodes')
    expect(screen.getByText('Выпуск не открыт')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Этапы выпуска' })).toBeNull()
  })

  test('переключение канала: расход из /api/cost/summary, выпуск другого канала закрывается', async () => {
    renderApp('/episodes/pirate/script')
    await waitFor(() => expect(banner().textContent).toContain('$61.40'))
    expect(banner().textContent).toContain('из $150')
    await rail()
    await userEvent.click(within(banner()).getByRole('button', { name: 'Канал: Cursus' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Otto's Timeline/ }))
    expect(useUiStore.getState().channel).toBe('otto')
    expect(useUiStore.getState().episodeId).toBeNull()
    expect(window.location.pathname).toBe('/episodes')
    await waitFor(() => expect(banner().textContent).toContain('$23.15'))
    expect(screen.getByText('Выпуск не открыт')).toBeTruthy()
  })

  test('«Все каналы»: сумма расходов, разбивка в подсказке; выпуск Cursus переключает канал на Cursus', async () => {
    useUiStore.setState({ channel: 'all' })
    renderApp('/episodes')
    await waitFor(() => expect(banner().textContent).toContain('$84.55'))
    expect(banner().textContent).toContain('из $250')
    const spend = within(banner()).getByText('$84.55').closest('[title]')
    expect(spend?.getAttribute('title')).toBe(
      "Расход месяца по каналам: Cursus $61.40 из $150, Otto's Timeline $23.15 из $100",
    )
    // Список обоих каналов — без параметра channel
    await screen.findByText('Market Day in the Aztec Empire')

    act(() => window.history.pushState(null, '', '/episodes/monastery/generate'))
    window.dispatchEvent(new PopStateEvent('popstate'))
    await rail()
    await waitFor(() => expect(useUiStore.getState().channel).toBe('cursus'))
    expect(useUiStore.getState().episodeId).toBe('monastery')
  })

  test('панели монтажа: ширины из токенов, инспектор сворачивается и разворачивается', async () => {
    renderApp('/episodes/pirate/edit')
    expect((await rail()).className).toContain('w-shell-stage-rail')
    const left = screen.getByRole('complementary', { name: 'Библиотека' })
    const right = screen.getByRole('complementary', { name: 'Инспектор' })
    const bottom = screen.getByRole('contentinfo', { name: 'Таймлайн' })
    expect(left.className).toContain('w-shell-library')
    expect(right.className).toContain('w-shell-inspector')
    expect(bottom.className).toContain('h-shell-timeline')

    await userEvent.click(within(right).getByRole('button', { name: /Свернуть: Инспектор/ }))
    expect(useUiStore.getState().collapsed.right).toBe(true)
    expect(right.getAttribute('data-collapsed')).toBe('true')
    expect(right.className).toContain('w-10')
    await userEvent.click(within(right).getByRole('button', { name: /Развернуть: Инспектор/ }))
    expect(right.hasAttribute('data-collapsed')).toBe(false)
    expect(right.className).toContain('w-shell-inspector')
  })

  test('статус-строка: процесс из /api/jobs, риск ближайшего слота, клавиши; тосты из стора', async () => {
    renderApp('/episodes')
    const status = screen.getByRole('status')
    await waitFor(() => expect(status.textContent).toContain('Генерация кадров: Medieval Monastery, 78 из 104'))
    expect(status.textContent).toContain('75%')
    await waitFor(() => expect(status.textContent).toContain('Слот 13 сентября, Pirate Ship: экспорт не запускался'))
    expect(status.textContent).toContain('горячие клавиши')
    act(() => useUiStore.getState().pushToast({ id: 't1', message: 'Перерисовано', status: 'ready' }))
    expect(screen.getAllByRole('status').some((el) => el.textContent?.startsWith('Перерисовано'))).toBe(true)
  })
})

describe('живые обновления', () => {
  const monastery = (status: JobEventData['status'], progress: number, message: string | null): JobEventData => ({
    job_id: 'job-monastery-images',
    kind: 'images',
    status,
    progress,
    message,
    attempts: 1,
    cancel_requested: false,
    episode_id: 'monastery',
    batch_id: 'batch-monastery',
    error: null,
  })

  test('событие джоба меняет статус-строку, конечное — очищает её и перезапрашивает выпуск', async () => {
    const { stub } = renderApp('/episodes')
    await waitFor(() => expect(FakeEventSource.active()).toHaveLength(1))
    const source = FakeEventSource.last()
    expect(source.url).toBe('/api/events?last_event_id=1200')
    act(() => source.open())

    // Кэш запросов рассылает изменения через setTimeout(0), не синхронно с act
    act(() => source.emit('job.progress', monastery('running', 0.8, '83 из 104'), 1201))
    const status = screen.getByRole('status')
    await waitFor(() => expect(status.textContent).toContain('83 из 104'))
    expect(status.textContent).toContain('80%')

    const before = stub.fetch.mock.calls.length
    act(() => source.emit('job.done', monastery('done', 1, '104 из 104'), 1202))
    await waitFor(() => expect(status.textContent).toContain('Готово'))
    await waitFor(() => {
      const urls = stub.fetch.mock.calls.slice(before).map(([url]) => String(url))
      expect(urls).toEqual(expect.arrayContaining(['/api/episodes', '/api/slots']))
    })
  })

  test('StrictMode монтирует провайдер дважды — поток всё равно один', async () => {
    renderApp('/episodes', { strict: true })
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0))
    await waitFor(() => expect(FakeEventSource.active()).toHaveLength(1))
  })
})

describe('бэкенд недоступен', () => {
  test('«Бэкенд недоступен» на месте экрана, шапка без расхода; «Повторить» возвращает экран', async () => {
    const stub = stubApi()
    stub.setDown(true)
    renderApp('/episodes', { stub })
    expect(await screen.findByText('Бэкенд недоступен')).toBeTruthy()
    expect(screen.getByText('Сервер не отвечает. Запустите ./run.sh и повторите.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Выпуски' })).toBeNull()
    expect(banner().textContent).not.toContain('из $')
    // Скелетонов, которые никогда не загрузятся, нет: переключатель канала и расход просто скрыты
    expect(banner().querySelector('[aria-hidden].animate-pulse')).toBeNull()

    stub.setDown(false)
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('heading', { name: 'Выпуски' })).toBeTruthy()
    await waitFor(() => expect(banner().textContent).toContain('$61.40'))
    expect(screen.queryByText('Бэкенд недоступен')).toBeNull()
  })

  test('бэкенд упал при открытом экране: обрыв потока → «Бэкенд недоступен»; поднялся — экран вернулся сам', async () => {
    const stub = stubApi()
    renderApp('/episodes', { stub })
    await waitFor(() => expect(FakeEventSource.active()).toHaveLength(1))
    const source = FakeEventSource.last()
    act(() => source.open())
    await waitFor(() => expect(banner().textContent).toContain('$61.40'))

    stub.setDown(true)
    act(() => source.fail(false))
    expect(await screen.findByText('Бэкенд недоступен')).toBeTruthy()

    stub.setDown(false)
    act(() => source.open())
    expect(await screen.findByRole('heading', { name: 'Выпуски' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Бэкенд недоступен')).toBeNull())
  })

  test('ошибка конкретного запроса — её текст в зоне, остальное работает', async () => {
    renderApp('/episodes/ghost/script')
    expect(await screen.findByText(/нет в этом канале/)).toBeTruthy()
    expect(screen.queryByText('Бэкенд недоступен')).toBeNull()
  })
})

describe('рельс этапов', () => {
  test('пройденные — done, текущий — active, при failed — error; опубликованный прошёл все', () => {
    expect(stageStates({ stage: 'generate', status: 'failed' })).toEqual({
      idea: 'done',
      script: 'done',
      generate: 'error',
      edit: 'todo',
      export: 'todo',
      publish: 'todo',
    })
    expect(stageStates({ stage: 'script', status: 'generating' }).script).toBe('active')
    expect(Object.values(stageStates({ stage: 'publish', status: 'published' }))).toEqual(Array(6).fill('done'))
  })
})
