// Режим «JSON» экрана 3 на моке плана «Пиратов» (v003): текст версии, синтаксис без запроса, ошибки бэкенда с
// подсветкой и переходом к строке, «Сохранить как версию» с двумя тостами, вопрос при уходе с правками. Подсветка и
// номера рисуют только окно видимых строк (M6.11): на плане ~4 500 строк в DOM — сотня строк, не тысячи.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderApp } from '../../../app/__tests__/harness'
import { autosaver } from '../../../app/autosave'
import { useUiStore } from '../../../store/uiStore'
import { discardJsonDraft } from '../jsonDrafts'

const INITIAL = { channel: 'cursus' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [] }

beforeEach(() => useUiStore.setState(INITIAL))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  autosaver.reset()
  discardJsonDraft('pirate')
})

const calls = (fetch: ReturnType<typeof vi.fn>, path: string) =>
  fetch.mock.calls.filter(([url, init]) => String(url).includes(path) && (init as RequestInit | undefined)?.method === 'POST')

async function editor() {
  const app = renderApp('/episodes/pirate/script?mode=json')
  const area = (await screen.findByRole('textbox', { name: 'JSON плана' }, { timeout: 3000 })) as HTMLTextAreaElement
  const panel = screen.getByRole('complementary', { name: 'Проверка плана' })
  // Открытая версия проверяется сразу
  await waitFor(() => expect(within(panel).getByText('ошибок нет')).toBeTruthy(), { timeout: 3000 })
  return { ...app, area, panel }
}

const setText = (area: HTMLTextAreaElement, value: string) => fireEvent.change(area, { target: { value } })
const lineOf = (text: string, needle: string) => text.split('\n').findIndex((l) => l.includes(needle)) + 1
const save = (panel: HTMLElement) => within(panel).getByRole('button', { name: 'Сохранить как версию' })
/** Номера строк, нарисованные сейчас (окно), и подсвеченные ошибкой среди них */
const numbers = () => [...document.querySelectorAll('[data-line-numbers] > div[class]')].map((row) => row.textContent)
const failedRows = () => [...document.querySelectorAll('[data-line-numbers] [data-failed]')].map((row) => row.textContent)

describe('JSON', () => {
  test('открывается файл текущей версии в 2 пробела; сохранять нечего', async () => {
    const { area, panel } = await editor()
    const plan = JSON.parse(area.value) as { meta: { episode_id: string }; shots: { id: string }[] }
    expect(plan.meta.episode_id).toBe('pirate')
    expect(plan.shots.map((s) => s.id)).toContain('s061')
    expect(area.value).toBe(JSON.stringify(plan, null, 2))
    expect(save(panel).hasAttribute('disabled')).toBe(true)
    expect(within(panel).getByText('Сохранять нечего: текст совпадает с v003.')).toBeTruthy()
  })

  test('ошибка синтаксиса — строка и столбец, запрос проверки не уходит', async () => {
    const { area, panel, stub } = await editor()
    const before = calls(stub.fetch, '/director/validate').length
    const broken = area.value.replace(/("working_title": "[^"]*"),/, '$1')
    setText(area, broken)
    const where = lineOf(broken, '"working_title"') + 1
    expect(await within(panel).findByText(`строка ${where}:5`)).toBeTruthy()
    expect(within(panel).getByText('ошибка синтаксиса')).toBeTruthy()
    expect(save(panel).hasAttribute('disabled')).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(calls(stub.fetch, '/director/validate')).toHaveLength(before)
  })

  test('доменная ошибка — подсветка строки кадра, клик ставит курсор на неё', async () => {
    const { area, panel } = await editor()
    const plan = JSON.parse(area.value) as { shots: { id: string; vo: string }[] }
    plan.shots.find((s) => s.id === 's003')!.vo = ''
    const text = JSON.stringify(plan, null, 2)
    setText(area, text)

    const problem = await within(panel).findByRole('button', { name: /s003 пустой vo/ }, { timeout: 3000 })
    expect(within(panel).getByText('1 ошибка')).toBeTruthy()
    const voLine = text.split('\n').findIndex((l, i) => i > lineOf(text, '"id": "s003"') - 1 && l.includes('"vo": ""')) + 1
    expect(within(problem).getByText(`строка ${voLine}`)).toBeTruthy()

    await userEvent.click(problem)
    expect(document.activeElement).toBe(area)
    const offset = text.split('\n').slice(0, voLine - 1).reduce((sum, l) => sum + l.length + 1, 0)
    expect(area.selectionStart).toBe(offset)
    // Строка ошибки — в окне после перехода, номер подсвечен
    await waitFor(() => expect(failedRows()).toEqual([String(voLine)]))
    expect(save(panel).hasAttribute('disabled')).toBe(true)
  })

  test('план ~4 500 строк: в DOM только окно строк, прокрутка и переход к ошибке в конце рисуют нужные', async () => {
    const { area, panel } = await editor()
    const plan = JSON.parse(area.value) as { shots: { id: string; vo: string }[]; facts: unknown[] }
    const template = plan.shots
    plan.shots = Array.from({ length: 112 }, (_, i) => ({ ...template[i % template.length]!, id: `s${String(i + 1).padStart(3, '0')}` }))
    plan.facts = []
    plan.shots.at(-1)!.vo = ''
    const text = JSON.stringify(plan, null, 2)
    const total = text.split('\n').length
    expect(total).toBeGreaterThan(4000)
    setText(area, text)

    const problem = await within(panel).findByRole('button', { name: /s112 пустой vo/ }, { timeout: 3000 })
    const rows = () => document.querySelectorAll('[data-line-numbers] > div[class]').length
    const layerRows = () => area.parentElement!.querySelectorAll('[aria-hidden] > div[class]').length
    expect(rows()).toBeLessThan(200)
    expect(layerRows()).toBe(rows())
    expect(numbers()[0]).toBe('1')

    area.scrollTop = 2000 * 20
    fireEvent.scroll(area)
    await waitFor(() => expect(numbers()).toContain('2001'))
    expect(numbers()).not.toContain('1')
    expect(rows()).toBeLessThan(200)

    await userEvent.click(problem)
    const voLine = Number(within(problem).getByText(/^строка \d+$/).textContent!.split(' ')[1])
    expect(voLine).toBeGreaterThan(total - 100)
    await waitFor(() => expect(failedRows()).toEqual([String(voLine)]))
  })

  test('«Сохранить как версию» — тост с номером и режим «Сценарий»', async () => {
    const { area, panel } = await editor()
    setText(area, area.value.replace('first thing you learn', 'first lesson you learn'))
    await waitFor(() => expect(save(panel).hasAttribute('disabled')).toBe(false), { timeout: 3000 })
    await userEvent.click(save(panel))
    expect(await screen.findByText('Сохранено как v004')).toBeTruthy()
    await waitFor(() => expect(window.location.search).toBe(''))
    const sheet = await screen.findByRole('article', { name: 'Лист сценария' }, { timeout: 3000 })
    expect(within(sheet).getByText(/^v004/)).toBeTruthy()
  })

  test('совпал хэш — свой тост, версия не создаётся, текст — как в файле', async () => {
    const { area, panel, stub } = await editor()
    const base = area.value
    setText(area, JSON.stringify(JSON.parse(base)))
    await waitFor(() => expect(save(panel).hasAttribute('disabled')).toBe(false), { timeout: 3000 })
    await userEvent.click(save(panel))
    expect(await screen.findByText('Совпадает с v003, новая версия не создана')).toBeTruthy()
    expect(window.location.search).toBe('?mode=json')
    await waitFor(() => expect(area.value).toBe(base))
    expect(calls(stub.fetch, '/projects/pirate/director?')).toHaveLength(1)
  })

  test('уход из режима с правками — вопрос: «Остаться» или «Уйти без сохранения»', async () => {
    const { area } = await editor()
    const base = area.value
    setText(area, base.replace('first thing you learn', 'first lesson you learn'))
    const modes = screen.getByRole('radiogroup', { name: 'Режим' })

    await userEvent.click(within(modes).getByRole('radio', { name: 'Сценарий' }))
    const dialog = await screen.findByRole('dialog', { name: 'Несохранённый JSON' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Остаться' }))
    expect(window.location.search).toBe('?mode=json')
    expect(area.value).not.toBe(base)

    await userEvent.keyboard('{Control>}{Shift>}1{/Shift}{/Control}')
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Уйти без сохранения' }))
    expect(window.location.search).toBe('')
    await userEvent.click(within(modes).getByRole('radio', { name: 'JSON' }))
    const reopened = (await screen.findByRole('textbox', { name: 'JSON плана' })) as HTMLTextAreaElement
    expect(reopened.value).toBe(base)
  })

  test('правки переживают уход на другой экран; закрытие вкладки — вопрос браузера', async () => {
    const { area } = await editor()
    const edited = area.value.replace('first thing you learn', 'first lesson you learn')
    setText(area, edited)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)

    await userEvent.click(within(screen.getByRole('navigation', { name: 'Этапы выпуска' })).getByRole('link', { name: 'Монтаж' }))
    await waitFor(() => expect(window.location.pathname).toBe('/episodes/pirate/edit'))
    window.history.back()
    const back = (await screen.findByRole('textbox', { name: 'JSON плана' }, { timeout: 3000 })) as HTMLTextAreaElement
    expect(back.value).toBe(edited)
  })
})
