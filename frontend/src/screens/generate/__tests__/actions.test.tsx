// Выбор кадров и действия экрана 4 на моках артборда 4: ⇧-клик s035 → s050 — 16 кадров и «из них 1 с ошибкой»;
// сумма кнопки — смета бэкенда для выбранных и модели, пока идёт новая — прежняя пара и кнопка недоступна; «Перерисовать
// выбранные» — пачка `redraw`, отказ бюджета — текст без тоста; действия плитки по фокусу и их порядок у отказа;
// «Перерисовать» и R — `redraw` моделью полосы, тост по концу джоба, у сбоя — причина без типа ошибки; «С правкой…» —
// стоп-лист у поля без джоба, правка — кадр в очереди; клавиатура сетки, ⌘A, Esc.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { EffectivePlan } from '@/types/plan'
import { autosaver } from '../../../app/autosave'
import { setPlatform } from '../../../app/keyboard'
import { SAFETY_REFUSAL } from '../../../mocks/api'
import { useUiStore } from '../../../store/uiStore'
import { INITIAL, artboardApi, openGenerate, shotEvent, stream } from './harness'

beforeEach(() => {
  useUiStore.setState(INITIAL)
  setPlatform('other')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  autosaver.reset()
})

type Call = [string, RequestInit | undefined]
const posts = (fetch: ReturnType<typeof vi.fn>, path: string) =>
  (fetch.mock.calls as Call[])
    .filter(([url, init]) => init?.method === 'POST' && String(url) === path)
    .map(([, init]) => JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
const gets = (fetch: ReturnType<typeof vi.fn>, prefix: string) =>
  (fetch.mock.calls as Call[]).filter(([url, init]) => (init?.method ?? 'GET') === 'GET' && String(url).startsWith(prefix)).map(([url]) => String(url))

const toasts = () => useUiStore.getState().toasts.map((t) => t.message)
const bar = () => screen.getByRole('region', { name: 'Выбор кадров' })
const redrawSelected = () => within(bar()).getByRole('button', { name: /^Перерисовать выбранные/ })
const tileButton = (shot: string) => screen.getByRole('button', { name: `Выбрать ${shot}` })
const actions = (shot: string) => screen.getByRole('group', { name: `Действия кадра ${shot}` })
const actionLabels = (shot: string) => within(actions(shot)).getAllByRole('button').map((b) => b.textContent)

async function shiftClick(user: ReturnType<typeof userEvent.setup>, element: HTMLElement) {
  await user.keyboard('{Shift>}')
  await user.click(element)
  await user.keyboard('{/Shift}')
}

describe('выбор и полоса выбора', () => {
  test('⇧-клик s035 → s050 — 16 кадров, из них 1 с ошибкой; сумма — смета бэкенда; смена модели меняет сумму', async () => {
    const user = userEvent.setup()
    const { stub } = await openGenerate(artboardApi())
    expect(within(bar()).getByText('Клик выбирает кадр, ⇧-клик — диапазон. Наведение открывает действия кадра')).toBeTruthy()
    expect(redrawSelected()).toHaveProperty('disabled', true)

    await user.click(tileButton('s035'))
    await shiftClick(user, tileButton('s050'))
    expect(within(bar()).getByText('Выбрано 16 кадров, из них 1 с ошибкой')).toBeTruthy()
    expect(tileButton('s040').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('listitem', { name: 's040, готов' }).className).toContain('border-accent')
    await waitFor(() => expect(redrawSelected().textContent).toBe('Перерисовать выбранные (16, ~$1.07)'))
    const estimate = gets(stub.fetch, '/api/projects/pirate/generate/estimate?').at(-1)!
    expect(new URL(estimate, 'http://x').searchParams.get('model')).toBe('nb2')
    expect(new URL(estimate, 'http://x').searchParams.get('shots')?.split(',')).toHaveLength(16)

    const models = within(bar()).getByRole('radiogroup', { name: 'Модель перерисовки' })
    expect(within(models).getAllByRole('radio').map((r) => r.textContent)).toEqual(['2 Lite', '2', '2 · 2K', 'Pro'])
    expect(within(models).getByRole('radio', { name: '2' }).getAttribute('aria-checked')).toBe('true')
    await user.click(within(models).getByRole('radio', { name: '2 Lite' }))
    await waitFor(() => expect(redrawSelected().textContent).toBe('Перерисовать выбранные (16, ~$0.54)'))
    expect(new URL(gets(stub.fetch, '/api/projects/pirate/generate/estimate?').at(-1)!, 'http://x').searchParams.get('model')).toBe('nb2-lite')
    // Цена единицы — из каталога, в подсказке сегмента
    await user.hover(within(models).getByRole('radio', { name: 'Pro' }))
    expect((await screen.findByRole('tooltip')).textContent).toBe('Nano Banana Pro — $0.134 за кадр')
  })

  test('пока идёт смета нового выбора — прежние число и сумма из одной сметы, кнопка недоступна', async () => {
    const user = userEvent.setup()
    const { stub } = await openGenerate(artboardApi())
    await user.click(tileButton('s035'))
    await waitFor(() => expect(redrawSelected().textContent).toBe('Перерисовать выбранные (1, ~$0.07)'))
    expect(redrawSelected()).toHaveProperty('disabled', false)
    // Смета диапазона отвечает только после `release`
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const passthrough = stub.fetch.getMockImplementation() as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    stub.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/generate/estimate?') && String(input).includes('s050')) await held
      return passthrough(input, init)
    })
    await shiftClick(user, tileButton('s050'))
    expect(within(bar()).getByText('Выбрано 16 кадров, из них 1 с ошибкой')).toBeTruthy()
    expect(redrawSelected().textContent).toBe('Перерисовать выбранные (1, ~$0.07)')
    expect(redrawSelected()).toHaveProperty('disabled', true)
    release()
    await waitFor(() => expect(redrawSelected().textContent).toBe('Перерисовать выбранные (16, ~$1.07)'))
    expect(redrawSelected()).toHaveProperty('disabled', false)
  })

  test('«Перерисовать выбранные» — пачка redraw моделью полосы, тост, кадры в очереди, выбор снят', async () => {
    const user = userEvent.setup()
    const { stub } = await openGenerate(artboardApi())
    await user.click(tileButton('s001'))
    await user.click(tileButton('s002'))
    await user.click(within(bar()).getByRole('radio', { name: '2 Lite' }))
    await waitFor(() => expect(redrawSelected().textContent).toBe('Перерисовать выбранные (2, ~$0.07)'))
    await user.click(redrawSelected())
    expect(posts(stub.fetch, '/api/projects/pirate/generate')).toEqual([{ shots: ['s001', 's002'], model: 'nb2-lite', redraw: true }])
    await waitFor(() => expect(toasts()).toContain('Поставлено 2 кадра, ~$0.07'))
    await screen.findByRole('listitem', { name: 's001, в очереди' }, { timeout: 3000 })
    expect(screen.getByRole('listitem', { name: 's002, в очереди' })).toBeTruthy()
    expect(within(bar()).getByText(/^Клик выбирает кадр/)).toBeTruthy()
  })

  test('отказ бюджета — текст бэкенда в полосе, тоста об успехе нет, выбор на месте', async () => {
    const user = userEvent.setup()
    const api = artboardApi()
    api.canon.monthlyLimit.cursus = 61_000_000
    await openGenerate(api)
    await user.click(tileButton('s001'))
    await waitFor(() => expect(redrawSelected()).toHaveProperty('disabled', false))
    await user.click(redrawSelected())
    expect((await within(bar()).findByRole('alert')).textContent).toMatch(/^Месячный лимит \$61 исчерпан/)
    expect(toasts().some((t) => t.startsWith('Поставлено'))).toBe(false)
    expect(tileButton('s001').getAttribute('aria-pressed')).toBe('true')
    // Другой выбор — отказ снят
    await user.click(tileButton('s002'))
    expect(within(bar()).queryByRole('alert')).toBeNull()
  })
})

describe('действия кадра', () => {
  test('по фокусу: «Перерисовать» с ценой следующего варианта в подсказке, «С правкой…», «Открыть в монтаже»', async () => {
    const user = userEvent.setup()
    await openGenerate(artboardApi())
    expect(screen.queryByRole('group', { name: 'Действия кадра s003' })).toBeNull()
    fireEvent.focus(tileButton('s003'))
    expect(actionLabels('s003')).toEqual(['Перерисовать', 'С правкой…', 'Открыть в монтаже'])
    await user.hover(within(actions('s003')).getByRole('button', { name: 'Перерисовать' }))
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe('Вариант 4 — ~$0.07'))
    await user.click(within(actions('s003')).getByRole('button', { name: 'Открыть в монтаже' }))
    expect(window.location.pathname).toBe('/episodes/pirate/edit/s003')
  })

  test('отказ фильтра — причина целиком и «С правкой…» первым; номер в цвете fail', async () => {
    await openGenerate(artboardApi())
    const tile = screen.getByRole('listitem', { name: 's047, ошибка' })
    expect(within(tile).getAllByText(SAFETY_REFUSAL)).toHaveLength(1)
    fireEvent.focus(tileButton('s047'))
    // Причина — в слое действий, полоса внизу под ним не дублирует; целиком — подсказкой кнопки, она под всем фоном слоя
    expect(within(tile).getAllByText(SAFETY_REFUSAL)).toHaveLength(1)
    expect(within(actions('s047')).getByText(SAFETY_REFUSAL)).toBeTruthy()
    expect(tileButton('s047').title).toBe(SAFETY_REFUSAL)
    expect(actionLabels('s047')).toEqual(['С правкой…', 'Перерисовать', 'Открыть в монтаже'])
    expect(within(screen.getByRole('listitem', { name: 's047, ошибка' })).getByText('s047').className).toContain('text-failed-text')
  })

  test('«Перерисовать» и R — redraw моделью полосы; конец джоба по SSE — тост со списанной суммой и расходы шапки', async () => {
    const user = userEvent.setup()
    const api = artboardApi()
    const { stub } = await openGenerate(api)
    const emit = stream()
    await user.click(within(bar()).getByRole('radio', { name: '2 Lite' }))
    fireEvent.focus(tileButton('s003'))
    await user.click(within(actions('s003')).getByRole('button', { name: 'Перерисовать' }))
    expect(posts(stub.fetch, '/api/projects/pirate/shots/s003/redraw')).toEqual([{ model: 'nb2-lite' }])
    await screen.findByRole('listitem', { name: 's003, в очереди' }, { timeout: 3000 })

    const costBefore = gets(stub.fetch, '/api/cost/summary').length
    const job = api.generation.drawShot('pirate', 's003')!
    emit('job.done', shotEvent('s003', 'done', { job_id: job.id, batch_id: null }))
    await waitFor(() => expect(toasts()).toContain('Перерисовано: s003, версия 4, списано $0.03'))
    await waitFor(() => expect(gets(stub.fetch, '/api/cost/summary').length).toBeGreaterThan(costBefore))

    tileButton('s005').focus()
    await user.keyboard('r')
    expect(posts(stub.fetch, '/api/projects/pirate/shots/s005/redraw')).toEqual([{ model: 'nb2-lite' }])
  })

  test('сбой перерисовки — тост с причиной, как на плитке: тип ошибки из `error` джоба не показывается', async () => {
    const user = userEvent.setup()
    const api = artboardApi()
    await openGenerate(api)
    const emit = stream()
    fireEvent.focus(tileButton('s003'))
    await user.click(within(actions('s003')).getByRole('button', { name: 'Перерисовать' }))
    await screen.findByRole('listitem', { name: 's003, в очереди' }, { timeout: 3000 })
    const job = api.generation.refuseShot('pirate', 's003')!
    expect(job.error).toBe(`ProviderError: ${SAFETY_REFUSAL}`)
    emit('job.failed', shotEvent('s003', 'failed', { job_id: job.id, batch_id: null, error: job.error }))
    await waitFor(() => expect(toasts()).toContain(`s003 не перерисован: ${SAFETY_REFUSAL}`))
  })

  test('«С правкой…»: действие и пометка «правка»; стилевой токен — текст у поля, диалог открыт, джоба нет; правка — кадр в очереди', async () => {
    const user = userEvent.setup()
    const api = artboardApi()
    expect(api.handle('PATCH', '/api/projects/pirate', { shots: { s047: { user_override: { image: { prompt: 'a boy with a cutlass' } } } } }).status).toBe(200)
    const { stub } = await openGenerate(api)
    fireEvent.focus(tileButton('s047'))
    await user.click(within(actions('s047')).getByRole('button', { name: 'С правкой…' }))
    const dialog = await screen.findByRole('dialog', { name: 'С правкой: s047' })
    const field = within(dialog).getByRole('textbox')
    expect((field as HTMLTextAreaElement).value).toBe('a boy with a cutlass')
    expect(within(dialog).getByText('правка')).toBeTruthy()
    expect(within(dialog).getByText(SAFETY_REFUSAL)).toBeTruthy()
    expect(within(dialog).getByText('Только действие, композиция и ракурс — стиль задаёт канон.')).toBeTruthy()
    const submit = within(dialog).getByRole('button', { name: /^Перерисовать с правкой/ })
    await waitFor(() => expect(submit.textContent).toBe('Перерисовать с правкой (~$0.07)'))

    await user.type(field, ', cinematic lighting')
    await user.click(submit)
    expect(await within(dialog).findByText(/стилевой токен «cinematic lighting»/)).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'С правкой: s047' })).toBeTruthy()
    const queued = () => api.generation.jobs.filter((job) => job.payload.shot_id === 's047' && job.status === 'queued')
    expect(queued()).toHaveLength(0)
    const plan = () => api.handle('GET', '/api/projects/pirate/plan').body as EffectivePlan
    expect(plan().shots.find((shot) => shot.id === 's047')?.image.prompt).toBe('a boy with a cutlass')

    await user.clear(field)
    await user.type(field, 'a boy ducks behind a powder barrel')
    await user.click(submit)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(posts(stub.fetch, '/api/projects/pirate/shots/s047/redraw').at(-1)).toEqual({ model: 'nb2', prompt: 'a boy ducks behind a powder barrel' })
    expect(toasts()).toContain('s047: правка записана, новая версия в очереди')
    expect(queued()).toHaveLength(1)
    expect(plan().shots.find((shot) => shot.id === 's047')?.image.prompt).toBe('a boy ducks behind a powder barrel')
    await screen.findByRole('listitem', { name: 's047, в очереди' }, { timeout: 3000 })
  })

  test('пока открыт диалог, Esc закрывает его, а выбор на сетке остаётся', async () => {
    const user = userEvent.setup()
    await openGenerate(artboardApi())
    await user.click(tileButton('s001'))
    fireEvent.focus(tileButton('s047'))
    await user.click(within(actions('s047')).getByRole('button', { name: 'С правкой…' }))
    await screen.findByRole('dialog', { name: 'С правкой: s047' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(bar()).getByText('Выбран 1 кадр')).toBeTruthy()
  })
})

describe('клавиатура сетки', () => {
  test('Space выбирает, ←/→ двигают фокус по плану, ⇧+Space — диапазон, Ctrl+A — все, Esc — снять', async () => {
    const user = userEvent.setup()
    await openGenerate(artboardApi())
    // В сетку — один Tab: tabbable только первая плитка
    expect(tileButton('s001').tabIndex).toBe(0)
    expect(tileButton('s002').tabIndex).toBe(-1)
    tileButton('s001').focus()
    await user.keyboard(' ')
    expect(tileButton('s001').getAttribute('aria-pressed')).toBe('true')
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
    expect(document.activeElement).toBe(tileButton('s004'))
    expect(tileButton('s004').tabIndex).toBe(0)
    await user.keyboard('{Shift>} {/Shift}')
    expect(within(bar()).getByText('Выбрано 4 кадра')).toBeTruthy()
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(tileButton('s003'))

    await user.keyboard('{Control>}a{/Control}')
    expect(within(bar()).getByText('Выбрано 104 кадра, из них 2 с ошибкой')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(within(bar()).getByText(/^Клик выбирает кадр/)).toBeTruthy()
  })
})
