import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { stubApi } from '../../../api/__tests__/fakes'
import { renderApp } from '../../../app/__tests__/harness'
import { useUiStore } from '../../../store/uiStore'

const INITIAL = { channel: 'all' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [] }

beforeEach(() => useUiStore.setState(INITIAL))
// Сначала размонтировать, потом снять фейки (L-024)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Новый выпуск' }, { timeout: 3000 }))
  return screen.findByRole('dialog', { name: 'Новый выпуск' })
}

const posts = (fetch: ReturnType<typeof vi.fn>) =>
  fetch.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    .map(([url, init]) => ({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) as unknown }))

describe('диалог «Новый выпуск»', () => {
  test('в «Все каналы» выбран Cursus и на нём фокус; пресет и оценка меняются с каналом', async () => {
    renderApp('/episodes')
    const dialog = await openDialog()
    const cursus = within(dialog).getByRole('radio', { name: 'Cursus' })
    expect(cursus.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(cursus)
    expect(await within(dialog).findByText('Cursus: every rank, 18–25 мин')).toBeTruthy()
    expect(within(dialog).getByText('Рассказчик во втором лице, 8 разделов, ~100 кадров, ~$3.80 за выпуск')).toBeTruthy()

    await userEvent.click(within(dialog).getByRole('radio', { name: "Otto's Timeline" }))
    expect(within(dialog).getByRole('radio', { name: "Otto's Timeline" }).getAttribute('aria-checked')).toBe('true')
    expect(cursus.getAttribute('aria-checked')).toBe('false')
    expect(await within(dialog).findByText("Otto's Timeline: сутки в эпохе, 6–10 мин")).toBeTruthy()
    expect(within(dialog).getByText('Отто в кадре, 5 разделов, ~40 кадров, ~$2.10 за выпуск')).toBeTruthy()
  })

  test('канал по умолчанию — текущий; стрелки переключают канал', async () => {
    useUiStore.setState({ channel: 'otto' })
    renderApp('/episodes')
    const dialog = await openDialog()
    const otto = within(dialog).getByRole('radio', { name: "Otto's Timeline" })
    expect(otto.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(otto)
    await userEvent.keyboard('{ArrowRight}')
    const cursus = within(dialog).getByRole('radio', { name: 'Cursus' })
    expect(cursus.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(cursus)
  })

  test('«Из бэклога идей» выключен с пояснением, по умолчанию — «С нуля»', async () => {
    renderApp('/episodes')
    const dialog = await openDialog()
    const backlog = within(dialog).getByRole('radio', { name: 'Из бэклога идей' }) as HTMLInputElement
    expect(backlog.disabled).toBe(true)
    expect(within(dialog).getByText('появится с экраном идей')).toBeTruthy()
    expect((within(dialog).getByRole('radio', { name: 'С нуля' }) as HTMLInputElement).checked).toBe(true)
    expect(within(dialog).getByText('ссылку на ролик добавите в сценарии')).toBeTruthy()
  })

  test('«Создать выпуск» → POST с origin и slot: "next_free", тост с датой из ответа, переход на сценарий', async () => {
    const { stub } = renderApp('/episodes')
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Из референса' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать выпуск' }))

    await waitFor(() => expect(window.location.pathname).toBe('/episodes/c11/script'))
    expect(posts(stub.fetch)).toEqual([
      { url: '/api/episodes', body: { channel: 'cursus', origin: 'reference', slot: 'next_free' } },
    ])
    expect(screen.getAllByRole('status').some((el) => el.textContent?.startsWith('Выпуск создан: Cursus, слот 23 сентября'))).toBe(true)
    expect(useUiStore.getState()).toMatchObject({ channel: 'cursus', episodeId: 'c11' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('без слота в ответе — «слот не назначен»', async () => {
    const stub = stubApi()
    const handle = stub.api.handle
    stub.api.handle = (method, url, body) => {
      const response = handle(method, url, body)
      return method === 'POST' ? { ...response, body: { ...(response.body as object), slot_date: null } } : response
    }
    renderApp('/episodes', { stub })
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('radio', { name: "Otto's Timeline" }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать выпуск' }))
    await waitFor(() => expect(window.location.pathname).toBe('/episodes/o11/script'))
    expect(screen.getAllByRole('status').some((el) => el.textContent?.startsWith("Выпуск создан: Otto's Timeline, слот не назначен"))).toBe(true)
  })

  test('пока идёт запрос — «Создаю…»; ошибка — текст бэкенда в диалоге, диалог открыт', async () => {
    const stub = stubApi()
    const passthrough = stub.fetch.getMockImplementation() as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const detail = 'Не удалось создать каталог выпуска: диск заполнен. Освободите место и повторите.'
    stub.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'POST') return passthrough(input, init)
      await gate
      return new Response(JSON.stringify({ detail }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    })
    renderApp('/episodes', { stub })
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать выпуск' }))
    const busy = await within(dialog).findByRole('button', { name: 'Создаю…' })
    expect(busy.hasAttribute('disabled')).toBe(true)

    release()
    expect((await within(dialog).findByRole('alert')).textContent).toBe(detail)
    expect(screen.getByRole('dialog', { name: 'Новый выпуск' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Создать выпуск' }).hasAttribute('disabled')).toBe(false)
    expect(window.location.pathname).toBe('/episodes')
  })

  test('Esc и «Отмена» закрывают без запроса', async () => {
    const { stub } = renderApp('/episodes')
    await openDialog()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posts(stub.fetch)).toHaveLength(0)
    expect(document.activeElement?.textContent).toBe('Новый выпуск')
  })

  test('⌘1 при открытом диалоге молчит, после закрытия — снова работает', async () => {
    useUiStore.setState({ channel: 'cursus', episodeId: 'pirate' })
    renderApp('/episodes')
    // ⌘1…⌘6 регистрирует рельс этапов, когда выпуск загружен
    await screen.findByRole('navigation', { name: 'Этапы выпуска' }, { timeout: 3000 })
    await openDialog()
    await userEvent.keyboard('{Control>}1{/Control}')
    expect(window.location.pathname).toBe('/episodes')
    expect(screen.getByRole('dialog', { name: 'Новый выпуск' })).toBeTruthy()

    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Control>}1{/Control}')
    // Этап «Идея» ведёт в общий бэклог идей
    expect(window.location.pathname).toBe('/ideas')
  })
})
