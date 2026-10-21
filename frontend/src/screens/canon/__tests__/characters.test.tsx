// Экран 12, слой «Персонажи», на моках API: список персонажей канала с листами, «Неизменяемое» и облики карточками
// со статусом листа и ценой, облик без листа помечен, правка одной записью черновика, «Новый облик», копия облика в
// другую эпоху (диалог и черновик), «Нужно каналу» → облик в черновике персонажа.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Character } from '@/types/canon'
import { stubApi } from '../../../api/__tests__/fakes'
import { renderApp } from '../../../app/__tests__/harness'
import { autosaver } from '../../../app/autosave'
import { setPlatform } from '../../../app/keyboard'
import { CANON_CHARACTERS } from '../../../mocks/api'
import { useUiStore } from '../../../store/uiStore'

const INITIAL = { channel: 'cursus' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [], save: { kind: 'idle' as const } }

beforeEach(() => {
  useUiStore.setState(INITIAL)
  setPlatform('other')
})
// Сначала размонтировать, потом снять фейки (L-024)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  autosaver.reset()
})

type Call = [string, RequestInit | undefined]
const calls = (fetch: ReturnType<typeof vi.fn>, method: string, path?: string) =>
  (fetch.mock.calls as Call[])
    .filter(([url, init]) => (init?.method ?? 'GET') === method && (!path || String(url).startsWith(path)))
    .map(([url, init]) => ({ url: String(url), body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined }))

async function openCharacters(search = '&character=you', stub = stubApi()) {
  const app = renderApp(`/canon?layer=characters${search}`, { stub })
  const form = await screen.findByRole('form', { name: 'Персонаж' }, { timeout: 3000 })
  return { ...app, form }
}

const YOU = CANON_CHARACTERS.cursus.you!.versions[1]!.data
const card = (form: HTMLElement, title: string) => within(within(form).getByRole('list', { name: 'Облики персонажа' })).getByRole('button', { name: title })

describe('слой «Персонажи»', () => {
  test('список: имя, канал, облики и готовые листы, глиф; статус-строка — облики без полного листа', async () => {
    await openCharacters()
    const rows = within(screen.getByRole('list', { name: 'Персонажи' })).getAllByRole('button')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Капитан (второй план)'),
      expect.stringContaining('You — рассказчик-участник'),
    ])
    // У Капитана лист устарел (6/6 на прежнем лице): «устарел» и warning, как на карточке облика, а не «не собран»
    expect(rows[0]!.textContent).toContain('Cursus · 1 облик · лист устарел')
    expect(within(rows[0]!).getByRole('img').getAttribute('data-status')).toBe('warning')
    expect(rows[1]!.textContent).toContain('Cursus · 5 обликов · 3 листа готовы')
    expect(within(rows[1]!).getByRole('img').getAttribute('data-status')).toBe('warning')
    expect(rows[1]!.getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('complementary', { name: 'Персонажи канала' }).className).toContain('w-shell-library')
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Персонажи: 3 облика без полного листа'))
  })

  test('«Неизменяемое» и облики: подпись, статус листа и цена; облик без листа — кадры не генерируются', async () => {
    const { form } = await openCharacters()
    const nature = within(form).getByRole('region', { name: 'Неизменяемое' })
    expect(within(nature).getByRole('textbox', { name: 'Неизменяемое: Черты лица' })).toHaveProperty('value', YOU.nature.face)
    expect(within(nature).getAllByRole('textbox')).toHaveLength(4)

    const first = await waitFor(() => {
      const button = card(form, 'You · пороховая обезьяна · 11 лет · Карибы 1716')
      expect(button.textContent).toContain('готов 6/6')
      return button
    })
    expect(first.textContent).toContain('собран, $1.61')
    expect(first.textContent).not.toContain('не генерируются')
    const boatswain = card(form, 'You · боцман · 34 года · Карибы 1716')
    await waitFor(() => expect(boatswain.textContent).toContain('собран наполовину 3/6'))
    expect(boatswain.textContent).toContain('сборка ~$1.61')
    const quartermaster = card(form, 'You · квартирмейстер · 41 год · Карибы 1716')
    await waitFor(() => expect(quartermaster.textContent).toContain('лист не собран'))
    expect(quartermaster.textContent).toContain('Кадры с этим обликом не генерируются')
    expect(within(quartermaster).getByRole('img').getAttribute('data-status')).toBe('failed')
    expect(within(form).getByRole('region', { name: 'Облики' }).textContent).toContain('5 обликов · 3 листа готово')

    // Карточка выбирает облик и открывает его лист (M5.9); после Esc под карточками — форма облика
    await userEvent.click(quartermaster)
    await waitFor(() => expect(window.location.search).toContain('appearance=you%40quartermaster-41'))
    expect(window.location.search).toContain('sheet=you%40quartermaster-41')
    expect(await screen.findByRole('dialog', { name: 'Лист опорных портретов: You · квартирмейстер · 41 год · Карибы 1716' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Лист опорных портретов/ })).toBeNull())
    expect(within(form).getByRole('region', { name: 'Облик you@quartermaster-41' })).toBeTruthy()
  })

  test('правка неизменяемого и облика — одна запись черновика персонажа; появляется «Опубликовать v003»', async () => {
    const { form, stub } = await openCharacters()
    const posture = within(form).getByRole('textbox', { name: 'Неизменяемое: Осанка' })
    await userEvent.clear(posture)
    await userEvent.type(posture, 'Upright')
    await userEvent.type(within(form).getByRole('textbox', { name: 'Облик: предметы: добавить' }), 'powder horn{Enter}')
    await waitFor(() => expect(calls(stub.fetch, 'PUT')).toHaveLength(1), { timeout: 3000 })
    const put = calls(stub.fetch, 'PUT')[0]!
    expect(put.url).toBe('/api/canon/cursus/characters/you/draft')
    const body = put.body as Character
    expect(body.nature.posture).toBe('Upright')
    expect(body.appearances[0]!.props).toEqual(['leather cartridge case', 'powder horn'])
    expect(body.appearances).toHaveLength(5)
    expect(await screen.findByRole('button', { name: 'Опубликовать v003' })).toBeTruthy()
  })

  test('«Новый облик»: id своего персонажа и эпоха — облик в черновике и выбран', async () => {
    const { form, stub } = await openCharacters()
    await userEvent.click(within(form).getByRole('button', { name: 'Новый облик' }))
    const dialog = screen.getByRole('dialog', { name: 'Новый облик' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'id облика' }), 'boatswain-34')
    expect(within(dialog).getByText('Облик you@boatswain-34 уже есть — выберите другой id.')).toBeTruthy()
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'id облика' }))
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'id облика' }), 'cook-40')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Подпись нового облика' }), 'кок')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Добавить облик' }))
    await waitFor(() => expect(window.location.search).toContain('appearance=you%40cook-40'))
    expect(within(form).getByRole('region', { name: 'Облик you@cook-40' })).toBeTruthy()
    await waitFor(() => expect(calls(stub.fetch, 'PUT')).toHaveLength(1), { timeout: 3000 })
    const added = (calls(stub.fetch, 'PUT')[0]!.body as Character).appearances.at(-1)!
    expect(added).toMatchObject({ id: 'you@cook-40', label: 'кок', period: 'caribbean-1716', clothing: '', props: [] })
  })

  test('«Скопировать облик в другой период»: что переносится и что заново; копия в черновике с тем же лицом, без листа', async () => {
    const { form, stub } = await openCharacters()
    const copy = within(form).getByRole('button', { name: 'Скопировать облик в другой период' })
    expect(copy.className).toContain('bg-accent') // черновика нет — главное действие экрана
    await userEvent.click(copy)
    const dialog = screen.getByRole('dialog', { name: 'Скопировать облик в другой период' })
    expect(within(dialog).getByRole('combobox', { name: 'Облик-источник' }).textContent).toContain('You · пороховая обезьяна · 11 лет · Карибы 1716')
    expect(within(dialog).getByRole('combobox', { name: 'Период-назначение' }).textContent).toContain('Англия, 1347')
    expect(within(dialog).getByRole('textbox', { name: 'id копии' })).toHaveProperty('value', 'you@powder-monkey-11-england')
    const source = YOU.appearances[0]!
    const keep = within(dialog).getByRole('region', { name: 'Переносится' })
    expect(keep.textContent).toContain(`${YOU.nature.face}; ${source.face}`)
    expect(keep.textContent).toContain(source.build)
    expect(keep.textContent).toContain('11 лет')
    const reset = within(dialog).getByRole('region', { name: 'Заполняется заново' })
    expect(reset.textContent).toContain(source.clothing)
    expect(reset.textContent).toContain('leather cartridge case')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать облик' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls(stub.fetch, 'POST', '/api/canon/cursus/appearances/you%40powder-monkey-11/copy').map((c) => c.body)).toEqual([
      { period: 'england-1347', appearance_id: 'you@powder-monkey-11-england' },
    ])
    const created = stub.api.canon.characters.cursus.get('you')!.draft!.data.appearances.at(-1)!
    expect(created).toMatchObject({ id: 'you@powder-monkey-11-england', period: 'england-1347', face: source.face, build: source.build, age: 11, clothing: '', wear: '', props: [], label: '' })
    await waitFor(() => expect(window.location.search).toContain('appearance=you%40powder-monkey-11-england'))
    const copied = await waitFor(() => card(form, 'You · powder-monkey-11-england · 11 лет · Англия 1347'))
    await waitFor(() => expect(copied.textContent).toContain('Кадры с этим обликом не генерируются'))
    expect(await screen.findByText('Облик создан: Англия 1347 · лист портретов нужно собрать')).toBeTruthy()
  })

  test('«Нужно каналу» → облик нового персонажа в черновике и переход к нему', async () => {
    const { stub } = await openCharacters()
    const needed = screen.getByRole('complementary', { name: 'Нужно каналу' })
    const items = await within(needed).findAllByRole('listitem', {}, { timeout: 3000 })
    const daimyo = items.find((li) => li.textContent?.startsWith('daimyo@edo-1650'))!
    expect(daimyo.textContent).toContain('9 кадров в 1 выпуске')
    await userEvent.click(within(daimyo).getByRole('button', { name: 'Создать' }))
    await waitFor(() => expect(window.location.search).toContain('character=daimyo'))
    expect(calls(stub.fetch, 'POST', '/api/canon/cursus/needed/appearances/daimyo%40edo-1650')).toHaveLength(1)
    const form = await screen.findByRole('form', { name: 'Персонаж' })
    expect(await within(form).findByRole('region', { name: 'Облик daimyo@edo-1650' })).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Персонажи' })).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringContaining('CAP'),
      expect.stringContaining('DAI'),
      expect.stringContaining('YOU'),
    ])
  })

  test('канал Otto: свой персонаж, все листы готовы', async () => {
    useUiStore.setState({ channel: 'otto' })
    const { form } = await openCharacters('')
    expect(within(screen.getByRole('list', { name: 'Персонажи' })).getAllByRole('button').map((b) => b.textContent)).toEqual([expect.stringContaining("Otto's Timeline · 3 облика · все листы готовы")])
    expect(within(form).getByRole('textbox', { name: 'Имя персонажа' })).toHaveProperty('value', 'Отто')
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Персонажи: у всех обликов лист собран'))
  })
})
