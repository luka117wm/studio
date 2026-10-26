// Модель выбора кадров экрана 4: клик и якорь, ⇧-диапазон по порядку плана в обе стороны, ⌘A, отбрасывание кадров,
// которых больше нет в плане; подписи сегментов модели.
import { describe, expect, test } from 'vitest'
import { shortLabels } from '../grid'
import { EMPTY, clickShot, prune, selectAll } from '../selection'

const ORDER = Array.from({ length: 104 }, (_, i) => `s${String(i + 1).padStart(3, '0')}`)
const ids = (selection: { ids: ReadonlySet<string> }) => [...selection.ids].sort()

describe('выбор кадров', () => {
  test('клик выбирает и ставит якорь, повторный снимает', () => {
    const one = clickShot(EMPTY, ORDER, 's003', false)
    expect(ids(one)).toEqual(['s003'])
    expect(one.anchor).toBe('s003')
    const two = clickShot(one, ORDER, 's010', false)
    expect(ids(two)).toEqual(['s003', 's010'])
    expect(ids(clickShot(two, ORDER, 's003', false))).toEqual(['s010'])
  })

  test('⇧-клик s035 → s050 — 16 кадров по порядку плана; в обратную сторону — те же; якорь остаётся', () => {
    const anchor = clickShot(EMPTY, ORDER, 's035', false)
    const range = clickShot(anchor, ORDER, 's050', true)
    expect(range.ids.size).toBe(16)
    expect(ids(range)).toEqual(ORDER.slice(34, 50))
    expect(range.anchor).toBe('s035')
    const back = clickShot(clickShot(EMPTY, ORDER, 's050', false), ORDER, 's035', true)
    expect(ids(back)).toEqual(ids(range))
  })

  test('⇧-клик добавляет к выбранному; без якоря — как обычный клик', () => {
    const picked = clickShot(clickShot(EMPTY, ORDER, 's001', false), ORDER, 's090', false)
    const range = clickShot(picked, ORDER, 's092', true)
    expect(ids(range)).toEqual(['s001', 's090', 's091', 's092'])
    expect(ids(clickShot(EMPTY, ORDER, 's005', true))).toEqual(['s005'])
  })

  test('⌘A — все кадры плана; кадров, которых нет в плане, в выборе не остаётся', () => {
    expect(selectAll(EMPTY, ORDER).ids.size).toBe(104)
    const picked = clickShot(clickShot(EMPTY, ORDER, 's001', false), ORDER, 's104', false)
    const shorter = prune(picked, ORDER.slice(0, 100))
    expect(ids(shorter)).toEqual(['s001'])
    expect(shorter.anchor).toBeNull()
    // Ничего не выпало — тот же объект: экран не перерисовывается зря
    expect(prune(picked, ORDER)).toBe(picked)
  })
})

describe('подписи моделей', () => {
  test('без общего начала: «2 Lite», «2», «2 · 2K», «Pro»; одна модель — подпись целиком', () => {
    expect(shortLabels(['Nano Banana 2 Lite', 'Nano Banana 2', 'Nano Banana 2 · 2K', 'Nano Banana Pro'])).toEqual(['2 Lite', '2', '2 · 2K', 'Pro'])
    expect(shortLabels(['Nano Banana 2'])).toEqual(['Nano Banana 2'])
    expect(shortLabels(['Fake Small', 'Fake'])).toEqual(['Fake Small', 'Fake'])
  })
})
