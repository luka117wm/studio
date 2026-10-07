// Заявка выпуска на экране 3: поля, источники, автосохранение PATCH `{brief}` через 800 мс тишины.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderApp } from '../../../app/__tests__/harness'
import { autosaver } from '../../../app/autosave'
import { useUiStore } from '../../../store/uiStore'
import type { EpisodeBrief } from '@/types/project'

const INITIAL = { channel: 'cursus' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [] }

beforeEach(() => useUiStore.setState(INITIAL))
// Сначала размонтировать, потом снять фейки (L-024)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  autosaver.reset()
})

const patches = (fetch: ReturnType<typeof vi.fn>) =>
  fetch.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([url, init]) => ({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) as { brief: EpisodeBrief } }))

async function form(episodeId: string) {
  const app = renderApp(`/episodes/${episodeId}/script`)
  const brief = await screen.findByRole('form', { name: 'Заявка' }, { timeout: 3000 })
  return { ...app, brief }
}

describe('заявка', () => {
  test('без плана заявка в центре; правка идеи — один PATCH {brief} после паузы', async () => {
    const { brief, stub } = await form('monastery')
    expect(screen.getByText(/План приходит из чата частями по 26 кадров/)).toBeTruthy()

    await userEvent.type(within(brief).getByRole('textbox', { name: 'Идея' }), 'Monastery ranks')
    await waitFor(() => expect(patches(stub.fetch)).toHaveLength(1), { timeout: 3000 })
    const [patch] = patches(stub.fetch)
    expect(patch?.url).toBe('/api/projects/monastery')
    expect(patch?.body.brief).toEqual({
      idea: 'Monastery ranks',
      angle: '',
      hook_promise: '',
      notes: '',
      sources: [],
      idea_id: null,
      reference_id: null,
      reference_mode: 'none',
    })
    expect(stub.api.projects.get('monastery')?.brief?.idea).toBe('Monastery ranks')
  })

  test('источник добавляется и убирается; в записи — список целиком', async () => {
    const { brief, stub } = await form('samurai')
    expect(within(brief).getByRole('textbox', { name: 'Источник 1: название' })).toBeTruthy()

    await userEvent.click(within(brief).getByRole('button', { name: 'Добавить источник' }))
    await userEvent.type(within(brief).getByRole('textbox', { name: 'Источник 2: название' }), 'Edo law')
    await userEvent.type(within(brief).getByRole('textbox', { name: 'Источник 2: ссылка' }), 'https://example.org/edo')
    await userEvent.click(within(brief).getByRole('button', { name: 'Убрать источник 1' }))
    expect(within(brief).queryByRole('textbox', { name: 'Источник 2: название' })).toBeNull()

    await waitFor(() => expect(patches(stub.fetch).length).toBeGreaterThan(0), { timeout: 3000 })
    expect(patches(stub.fetch).at(-1)?.body.brief.sources).toEqual([{ title: 'Edo law', url: 'https://example.org/edo' }])
  })

  test('с принятым планом заявка свёрнута над ним и раскрывается', async () => {
    renderApp('/episodes/pirate/script')
    expect(await screen.findByRole('article', { name: 'План' }, { timeout: 3000 })).toBeTruthy()
    expect(screen.queryByRole('form', { name: 'Заявка' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Заявка' }))
    expect(screen.getByRole('form', { name: 'Заявка' })).toBeTruthy()
  })
})
