// Сетка кадров экрана 4 на моках артборда 4: прилипающие заголовки разделов и их сводки; плитка — миниатюра 320
// выбранной версии, точки версий, отказ фильтра с причиной, «рисуется», очередь; конец джоба кадра по SSE —
// project.json перезапрошен, миниатюра в плитке, расходы шапки заново (L-046). Чистые функции сетки — `grid.ts`.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { EffectivePlan } from '@/types/plan'
import type { Project } from '@/types/project'
import { autosaver } from '../../../app/autosave'
import { setPlatform } from '../../../app/keyboard'
import { SAFETY_REFUSAL } from '../../../mocks/api'
import { useUiStore } from '../../../store/uiStore'
import { NO_MARKS } from '../checks'
import { gridSections, headerNote, sectionNote, statusNote, type TileShot } from '../grid'
import { INITIAL, artboardApi, calls, openGenerate, shotEvent, stream } from './harness'

beforeEach(() => {
  useUiStore.setState(INITIAL)
  setPlatform('other')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  autosaver.reset()
})

const header = (title: string) => screen.getByRole('region', { name: title }).querySelector('header')!
const tile = (name: string) => screen.getByRole('listitem', { name })

describe('разделы', () => {
  test('заголовок прилипает; сводки «все готовы», «1 ошибка, 13 готовы», «рисуется», «в очереди»', async () => {
    await openGenerate(artboardApi())
    const cold = header('Cold open')
    expect(cold.className).toContain('sticky')
    expect(cold.className).toContain('top-0')
    expect(cold.className).toContain('bg-app')
    expect(cold.textContent).toBe('Cold open6 кадроввсе готовы')
    expect(header('Powder monkey').textContent).toBe('Powder monkey15 кадроввсе готовы')
    expect(within(header('Able seaman')).getByText('1 ошибка, 13 готовы').className).toContain('text-failed-text')
    expect(within(header('Quartermaster')).getByText('1 ошибка, 15 готовы')).toBeTruthy()
    expect(within(header('Captain')).getByText('рисуется').className).toContain('text-generating')
    expect(within(header('Outro')).getByText('в очереди').className).toContain('text-queued-text')
    // 5 в ряд на 1536, 6 на 1920, 8 на 2560
    const list = within(screen.getByRole('region', { name: 'Cold open' })).getByRole('list')
    expect(list.className).toContain('grid-cols-5')
    expect(list.className).toContain('min-[1920px]:grid-cols-6')
    expect(list.className).toContain('min-[2560px]:grid-cols-8')
  })
})

describe('плитка', () => {
  test('готовая — миниатюра 320 выбранной версии и точки версий; три версии — выбрана вторая', async () => {
    await openGenerate(artboardApi())
    const ready = tile('s003, готов')
    expect(ready.querySelector('img')?.getAttribute('src')).toBe('/api/projects/pirate/shots/s003/images/2/thumb?w=320')
    expect(within(ready).getByRole('img', { name: 'Версия 2 из 3, выбрана' }).className).toContain('bg-accent')
    expect(within(ready).getByRole('img', { name: 'Версия 1 из 3' }).className).toContain('bg-disabled')
    expect(within(ready).getByRole('img', { name: 'готов' }).dataset.status).toBe('ready')
    expect(within(tile('s001, готов')).getAllByRole('img', { name: /^Версия/ })).toHaveLength(1)
  })

  test('отказ фильтра — номер в цвете fail, рамка fail, причина внизу, картинки нет', async () => {
    await openGenerate(artboardApi())
    const failed = tile('s047, ошибка')
    expect(failed.className).toContain('border-failed')
    expect(within(failed).getByText('s047').className).toContain('text-failed-text')
    expect(within(failed).getByText(SAFETY_REFUSAL)).toBeTruthy()
    expect(failed.querySelector('img')).toBeNull()
    expect(failed.querySelector('[data-status="failed"]')).not.toBeNull()
  })

  test('рисуется — подпись, штриховка и полоса снизу; в очереди — тёмный фон и полый круг', async () => {
    await openGenerate(artboardApi())
    const running = tile('s082, рисуется')
    expect(within(running).getByText('рисуется').className).toContain('text-generating')
    expect(running.className).toContain('border-accent/50')
    expect(running.querySelector('[data-status="generating"]')).not.toBeNull()
    const queued = tile('s090, в очереди')
    expect(queued.className).toContain('bg-strip')
    expect(queued.querySelector('[data-status="queued"]')).not.toBeNull()
    expect(queued.querySelector('img')).toBeNull()
  })
})

describe('живые данные', () => {
  test('конец джоба кадра по SSE — project.json заново, миниатюра в плитке, расходы шапки заново', async () => {
    const api = artboardApi()
    const { stub } = await openGenerate(api)
    const emit = stream()
    const projectCalls = () => calls(stub.fetch, 'GET', '/api/projects/pirate').filter((url) => url === '/api/projects/pirate').length
    const costCalls = () => calls(stub.fetch, 'GET', '/api/cost/summary').length
    const [projectBefore, costBefore] = [projectCalls(), costCalls()]

    api.generation.drawShot('pirate', 's081')
    emit('job.done', shotEvent('s081', 'done'))
    const drawn = await screen.findByRole('listitem', { name: 's081, готов' }, { timeout: 3000 })
    expect(drawn.querySelector('img')?.getAttribute('src')).toBe('/api/projects/pirate/shots/s081/images/1/thumb?w=320')
    expect(projectCalls()).toBe(projectBefore + 1)
    await waitFor(() => expect(costCalls()).toBeGreaterThan(costBefore))
  })

  test('сотня концов подряд — один перезапрос project.json в секунду', async () => {
    const api = artboardApi()
    const { stub } = await openGenerate(api)
    const emit = stream()
    const projectCalls = () => calls(stub.fetch, 'GET', '/api/projects/pirate').filter((url) => url === '/api/projects/pirate').length
    const before = projectCalls()
    for (const shot of ['s081', 's082', 's083']) {
      api.generation.drawShot('pirate', shot)
      emit('job.done', shotEvent(shot, 'done'))
    }
    await screen.findByRole('listitem', { name: 's081, готов' }, { timeout: 3000 })
    expect(projectCalls()).toBe(before + 1)
    // Хвост окна приносит остальные
    await screen.findByRole('listitem', { name: 's083, готов' }, { timeout: 3000 })
    expect(projectCalls()).toBe(before + 2)
  })
})

describe('grid.ts', () => {
  const shot = (id: string, status: TileShot['status']): TileShot => ({ id, status, version: null, versions: [], error: null, staleReasons: [], marks: NO_MARKS })

  test('сводка раздела: ошибки важнее работы, работа — готовности', () => {
    expect(sectionNote([shot('a', 'done'), shot('b', 'failed'), shot('c', 'generating')])).toEqual({ text: '1 ошибка, 1 готов', status: 'failed' })
    expect(sectionNote([shot('a', 'queued'), shot('b', 'generating')])).toEqual({ text: 'рисуется', status: 'generating' })
    expect(sectionNote([shot('a', 'done'), shot('b', 'queued')])).toEqual({ text: 'в очереди', status: 'queued' })
    expect(sectionNote([shot('a', 'done'), shot('b', 'stale')])).toEqual({ text: '1 устарел', status: 'warning' })
    expect(sectionNote([shot('a', 'todo'), shot('b', 'todo')])).toEqual({ text: 'не нарисованы', status: null })
    expect(sectionNote([shot('a', 'done'), shot('b', 'todo')])).toEqual({ text: '1 из 2 готовы', status: null })
  })

  test('склонения: 1 кадр, 21 кадр, 104 кадра, 5 кадров; сбоев больше пяти — «и ещё N»', () => {
    const plan = (n: number): EffectivePlan =>
      ({
        sections: [{ id: 'r1', title: 'R1', chapter: true, vo_direction: null }],
        shots: Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, section: 'r1', status: 'todo', stale_reasons: [] })),
      }) as unknown as EffectivePlan
    expect(headerNote(gridSections(plan(1), undefined))).toBe('1 кадр, 1 раздел')
    expect(headerNote(gridSections(plan(21), undefined))).toBe('21 кадр, 1 раздел')
    expect(headerNote(gridSections(plan(104), undefined))).toBe('104 кадра, 1 раздел')
    expect(headerNote(gridSections(plan(5), undefined))).toBe('5 кадров, 1 раздел')

    const failed = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`s${i + 1}`, { status: 'failed' }]))
    const project = { shots: failed, assets: {} } as unknown as Project
    expect(statusNote(gridSections(plan(7), project))).toBe('Кадры 0 из 7, 7 кадров не удались: s1, s2, s3, s4, s5 и ещё 2')
  })

  test('убранные кадры и пустые разделы не видны; статус — из project.json, без записи — из плана', () => {
    const plan = {
      sections: [
        { id: 'r1', title: 'R1', chapter: true, vo_direction: null },
        { id: 'r2', title: 'R2', chapter: true, vo_direction: null },
      ],
      shots: [
        { id: 's1', section: 'r1', status: 'todo', stale_reasons: [] },
        { id: 's2', section: 'r1', status: 'removed', stale_reasons: [] },
      ],
    } as unknown as EffectivePlan
    const project = { shots: { s1: { status: 'stale', image_version: 2, stale_reasons: ['Промпт изменён вручную'] } }, assets: {} } as unknown as Project
    const sections = gridSections(plan, project)
    expect(sections.map((s) => s.section.id)).toEqual(['r1'])
    expect(sections[0]!.shots).toEqual([{ id: 's1', status: 'stale', version: 2, versions: [], error: null, staleReasons: ['Промпт изменён вручную'], marks: NO_MARKS }])
  })
})
