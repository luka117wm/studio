// Правая панель экрана 3 на моках: факт-чек (три статуса, ссылка, переход к кадру), смета (строки, итог, остаток,
// предупреждение), «Утвердить план» (нет плана, 409 со ссылками на кадры, успех со стадией, «Утвердить снова»).
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ApprovalRefusal } from '@/types/plan'
import { renderApp } from '../../../app/__tests__/harness'
import { autosaver } from '../../../app/autosave'
import { stubApi } from '../../../api/__tests__/fakes'
import { channels, createMockApi, type MockApi } from '../../../mocks/api'
import { useUiStore } from '../../../store/uiStore'
import { discardJsonDraft } from '../jsonDrafts'

const INITIAL = { channel: 'cursus' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [] }
const cursus = channels.find((c) => c.id === 'cursus')!
const BUDGETS = structuredClone(cursus.budgets)

beforeEach(() => useUiStore.setState(INITIAL))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  autosaver.reset()
  discardJsonDraft('pirate')
  cursus.budgets = structuredClone(BUDGETS)
})

/** Мок, где «Пираты» ещё на стадии «Сценарий» — утверждать можно (в артборде 1 они на монтаже) */
function scriptStage(): MockApi {
  const api = createMockApi()
  api.episodes.find((e) => e.id === 'pirate')!.stage = 'script'
  return api
}

async function open(path = '/episodes/pirate/script', api: MockApi = createMockApi()) {
  const app = renderApp(path, { stub: stubApi(api) })
  const side = await screen.findByRole('complementary', { name: 'Источник плана' }, { timeout: 3000 })
  return { ...app, side }
}

const approveButton = (side: HTMLElement) => within(side).getByRole('button', { name: /Утвердить|утверждён/ })
const voOf = (id: string) => screen.getByRole('textbox', { name: `VO кадра ${id}` })

describe('факт-чек', () => {
  test('три статуса, сводка, источник ссылкой, переход к кадру из JSON на лист', async () => {
    const { side } = await open('/episodes/pirate/script?mode=json')
    const facts = await within(side).findByRole('region', { name: 'Факт-чек' }, { timeout: 3000 })
    expect(within(facts).getByText('2 подтверждено, 1 спорно, 1 без источника')).toBeTruthy()
    expect(within(facts).getAllByText('подтверждено')).toHaveLength(2)
    expect(within(facts).getByText('спорно').className).toContain('text-warning')
    expect(within(facts).getByText('источник не найден').className).toContain('text-failed-text')
    const link = within(facts).getByRole('link', { name: 'example.org/rediker/villains-of-all-nations' })
    expect(link.getAttribute('href')).toBe('https://example.org/rediker/villains-of-all-nations')
    expect(link.getAttribute('target')).toBe('_blank')

    await userEvent.click(within(facts).getByRole('button', { name: 'Перейти к кадру s003' }))
    await waitFor(() => expect(window.location.search).toBe(''))
    await waitFor(() => expect(document.activeElement).toBe(voOf('s003')))
  })

  test('без фактов — строка «Чат не прислал фактов на проверку»', async () => {
    const api = createMockApi()
    const file = api.handle('GET', '/api/projects/pirate/director/v003').body as Record<string, unknown>
    expect(api.handle('POST', '/api/projects/pirate/director?source=manual', { ...file, facts: [] }).status).toBe(200)
    const { side } = await open('/episodes/pirate/script', api)
    const facts = await within(side).findByRole('region', { name: 'Факт-чек' }, { timeout: 3000 })
    expect(within(facts).getByText('Чат не прислал фактов на проверку.')).toBeTruthy()
  })
})

describe('смета', () => {
  test('строки с подписями, итог «~», остаток месяца; правка VO — новая смета', async () => {
    const { side } = await open()
    const estimate = await within(side).findByRole('region', { name: 'Смета по плану' }, { timeout: 3000 })
    await within(estimate).findByText('Итого')
    const rows = [...estimate.querySelectorAll('dl > div')].map((row) =>
      [...row.children].map((cell) => cell.textContent),
    )
    expect(rows.map(([title]) => title)).toEqual(['Кадры', 'Голос', 'Анимация', 'План'])
    expect(rows[0]).toEqual(['Кадры', '8 × $0.067', '$0.54'])
    expect(rows[2]).toEqual(['Анимация', '4 клипа × $0.20', '$0.80'])
    expect(rows[3]).toEqual(['План', 'Мост через чат', '$0'])
    expect(within(estimate).getByText(/^~\$/).textContent).toMatch(/^~\$\d+\.\d\d$/)
    expect(within(estimate).getByText(/^Останется \$\d+\.\d\d из месячных \$150$/)).toBeTruthy()

    const voice = rows[1]![1]!
    fireEvent.change(voOf('s001'), { target: { value: 'Short.' } })
    await waitFor(() => expect(within(estimate).queryByText(voice)).toBeNull(), { timeout: 4000 })
  })

  test('превышение лимита выпуска — предупреждение цветом warning, не отказ', async () => {
    cursus.budgets = { ...BUDGETS, per_episode_usd: 4 }
    const { side } = await open()
    const estimate = await within(side).findByRole('region', { name: 'Смета по плану' }, { timeout: 3000 })
    const warning = await within(estimate).findByText(/^Лимит на выпуск \$4: занято \$3\.84/)
    expect(warning.closest('p')?.className).toContain('text-warning')
    expect(approveButton(side).hasAttribute('disabled')).toBe(false)
  })
})

describe('после генерации (M6.11)', () => {
  const rowsOf = (estimate: HTMLElement) =>
    [...estimate.querySelectorAll('dl > div')].map((row) => [...row.children].map((cell) => cell.textContent))

  test('78 из 104 нарисованы — 26 кадров и «Уже нарисовано»; правка действия одного — 27', async () => {
    const api = createMockApi()
    api.generateArtboard()
    const { side } = await open('/episodes/pirate/script', api)
    const estimate = await within(side).findByRole('region', { name: 'Смета по плану' }, { timeout: 3000 })
    await within(estimate).findByText('Уже нарисовано')
    const rows = rowsOf(estimate)
    expect(rows[0]).toEqual(['Кадры', '26 × $0.067', '$1.74'])
    expect(rows[1]).toEqual(['Уже нарисовано', '78 кадров', '$0'])
    const drawnRow = within(estimate).getByText('Уже нарисовано').parentElement!
    expect(drawnRow.lastElementChild!.className).toContain('text-muted')

    const edit = { shots: { s001: { user_override: { image: { prompt: 'drops the cartridge case on the deck' } } } } }
    expect(api.handle('PATCH', '/api/projects/pirate', edit).status).toBe(200)
    cleanup()
    const again = await open('/episodes/pirate/script', api)
    const fresh = await within(again.side).findByRole('region', { name: 'Смета по плану' }, { timeout: 3000 })
    await waitFor(() => expect(rowsOf(fresh)[0]).toEqual(['Кадры', '27 × $0.067', '$1.81']))
    expect(rowsOf(fresh)[1]).toEqual(['Уже нарисовано', '77 кадров', '$0'])
    // Правка — не новая версия: утверждение на месте
    expect(approveButton(again.side).textContent).toBe('План v004 утверждён')
  })

  test('новая версия из JSON — «Изменения v005»: кадр с картинкой, её время и цена; «Скрыть»', async () => {
    const api = createMockApi()
    api.generateArtboard()
    const { side } = await open('/episodes/pirate/script?mode=json', api)
    const area = (await screen.findByRole('textbox', { name: 'JSON плана' }, { timeout: 3000 })) as HTMLTextAreaElement
    const plan = JSON.parse(area.value) as { shots: { id: string; vo: string; image: { prompt: string } }[] }
    plan.shots.find((shot) => shot.id === 's001')!.image.prompt = 'climbs out of the hold with the cartridge case'
    plan.shots.find((shot) => shot.id === 's047')!.image.prompt = 'ducks behind a gun carriage'
    plan.shots.find((shot) => shot.id === 's002')!.vo += ' Again.'
    fireEvent.change(area, { target: { value: JSON.stringify(plan, null, 2) } })
    const panel = screen.getByRole('complementary', { name: 'Проверка плана' })
    const save = within(panel).getByRole('button', { name: 'Сохранить как версию' })
    await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false), { timeout: 3000 })
    await userEvent.click(save)

    const report = await within(side).findByRole('region', { name: 'Изменения v005' }, { timeout: 3000 })
    expect(within(report).getByText('Изменено 3 кадра; картинки устарели у 1')).toBeTruthy()
    const stale = within(report).getByRole('list', { name: 'Устаревшие картинки' })
    // s047 упал отказом фильтра — картинки нет, устаревать нечему; s002 — только VO
    expect(within(stale).getAllByRole('listitem')).toHaveLength(1)
    expect(within(stale).getByRole('button', { name: 'Перейти к кадру s001' })).toBeTruthy()
    expect(within(stale).getByText(/^картинка .*\d\d:\d\d, \$0\.067 — устарела$/)).toBeTruthy()

    await userEvent.click(within(report).getByRole('button', { name: 'Скрыть изменения' }))
    expect(within(side).queryByRole('region', { name: 'Изменения v005' })).toBeNull()
  })
})

describe('утверждение', () => {
  test('плана нет — кнопка выключена, подсказка; части не собраны — каких не хватает', async () => {
    const { side } = await open('/episodes/samurai/script')
    await waitFor(() => expect(within(side).getByText('Плана ещё нет — вставьте ответ чата на все части.')).toBeTruthy())
    expect(approveButton(side).hasAttribute('disabled')).toBe(true)
    expect(within(side).queryByRole('region', { name: 'Смета по плану' })).toBeNull()

    await userEvent.type(within(side).getByRole('textbox', { name: 'Ответ из чата' }), 'part 1')
    await userEvent.click(within(side).getByRole('button', { name: 'Применить вставку' }))
    expect(await within(side).findByText('План ещё не собран: не хватает частей 2, 3, 4 из 4.')).toBeTruthy()
  })

  test('стадия позже генерации — 409 с текстом бэкенда', async () => {
    const { side } = await open()
    await userEvent.click(approveButton(side))
    const alert = await within(side).findByRole('alert')
    expect(alert.textContent).toBe('Выпуск уже на стадии «Монтаж» — план утверждается до начала генерации.')
  })

  test('409 — сводка и список кадров со ссылками на лист', async () => {
    const api = scriptStage()
    const refusal: ApprovalRefusal = {
      code: 'plan_not_ready',
      message: '2 кадра без VO: s003, s061 — допишите на листе сценария или в таблице плана и утвердите снова.',
      problems: [
        { check: 'vo', shot_id: 's003', message: 'кадр s003: пустой VO — допишите текст закадрового голоса' },
        { check: 'vo', shot_id: 's061', message: 'кадр s061: пустой VO — допишите текст закадрового голоса' },
      ],
    }
    const handle = api.handle
    api.handle = (method, url, body) =>
      url.endsWith('/approve') ? { status: 409, body: { detail: refusal } } : handle(method, url, body)
    const { side } = await open('/episodes/pirate/script', api)
    await userEvent.click(approveButton(side))
    const alert = await within(side).findByRole('alert')
    expect(within(alert).getByText(refusal.message)).toBeTruthy()
    const list = within(alert).getByRole('list', { name: 'Кадры с проблемами' })
    expect(within(list).getAllByText('пустой VO — допишите текст закадрового голоса')).toHaveLength(2)
    await userEvent.click(within(list).getByRole('button', { name: 'Перейти к кадру s061' }))
    await waitFor(() => expect(document.activeElement).toBe(voOf('s061')))
  })

  test('успех — тост, «План v003 утверждён», рельс на «Генерации», списки перезапрошены', async () => {
    const { side, stub } = await open('/episodes/pirate/script', scriptStage())
    const rail = screen.getByRole('navigation', { name: 'Этапы выпуска' })
    expect(within(rail).getByRole('link', { name: 'Сценарий' }).getAttribute('title')).toBe('Сценарий — в работе')
    const lists = () => stub.fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/episodes?') || String(url) === '/api/episodes').length
    const before = lists()

    await userEvent.click(approveButton(side))
    await waitFor(() => expect(useUiStore.getState().toasts.map((t) => t.message)).toContain('План v003 утверждён'))
    await waitFor(() => expect(within(rail).getByRole('link', { name: 'Генерация' }).getAttribute('title')).toBe('Генерация — в работе'))
    expect(within(rail).getByRole('link', { name: 'Сценарий' }).getAttribute('title')).toBe('Сценарий — готово')
    await waitFor(() => expect(approveButton(side).textContent).toContain('План v003 утверждён'))
    expect(approveButton(side).hasAttribute('disabled')).toBe(true)
    expect(lists()).toBeGreaterThan(before)
  })

  test('новая версия после утверждения — «Утвердить снова» и какая утверждена', async () => {
    const api = scriptStage()
    const { side } = await open('/episodes/pirate/script', api)
    await userEvent.click(approveButton(side))
    await waitFor(() => expect(approveButton(side).textContent).toContain('План v003 утверждён'))

    // Новая версия — правкой в JSON и «Сохранить как версию»
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Режим' })).getByRole('radio', { name: 'JSON' }))
    const area = (await screen.findByRole('textbox', { name: 'JSON плана' })) as HTMLTextAreaElement
    fireEvent.change(area, { target: { value: area.value.replace('first thing you learn', 'first lesson you learn') } })
    const check = screen.getByRole('complementary', { name: 'Проверка плана' })
    const save = within(check).getByRole('button', { name: 'Сохранить как версию' })
    await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false), { timeout: 3000 })
    await userEvent.click(save)
    await waitFor(() => expect(approveButton(side).textContent).toContain('Утвердить снова'), { timeout: 3000 })
    expect(within(side).getByText('Утверждена v003, текущая — v004.')).toBeTruthy()
  })
})
