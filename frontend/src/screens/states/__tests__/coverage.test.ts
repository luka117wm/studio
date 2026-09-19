// Покрытие каталога: каждый компонент кита показан хотя бы раз; реестр не ссылается на несуществующие имена.
import { describe, expect, test } from 'vitest'
import * as ui from '../../../ui'
import { allDemos, coveredComponents, groups, productSections, productStates } from '../registry'

/** Экспорты src/ui, которые являются компонентами: функции с именем с заглавной буквы */
const kitComponents = Object.entries(ui)
  .filter(([name, value]) => typeof value === 'function' && /^[A-Z]/.test(name))
  .map(([name]) => name)
  .sort()

describe('реестр каталога', () => {
  test('каждый компонент кита есть в реестре (добавили в кит — добавьте демонстрацию)', () => {
    const covered = coveredComponents()
    const missing = kitComponents.filter((name) => !covered.has(name))
    expect(missing).toEqual([])
    expect(kitComponents.length).toBeGreaterThanOrEqual(28)
  })

  test('в реестре нет несуществующих компонентов', () => {
    const unknown = [...coveredComponents()].filter((name) => !kitComponents.includes(name))
    expect(unknown).toEqual([])
  })

  test('у каждой демонстрации есть имя состояния и узел, группы непустые', () => {
    for (const g of groups) expect(g.demos.length, g.id).toBeGreaterThan(0)
    for (const d of allDemos()) {
      expect(d.state.trim().length).toBeGreaterThan(0)
      expect(d.node).toBeTruthy()
    }
    expect(groups.map((g) => g.id)).toEqual(['controls', 'inputs', 'layers', 'feedback', 'empty', 'errors'])
  })

  test('продуктовые состояния: семь из задания присутствуют, секции заполнены', () => {
    const ids = new Set(productStates.map((p) => p.id))
    for (const id of ['no-episodes', 'no-ideas', 'no-plan', 'error-file', 'error-budget', 'error-net', 'process-shots']) {
      expect(ids.has(id), id).toBe(true)
    }
    for (const s of productSections) {
      expect(productStates.some((p) => p.section === s.id), s.id).toBe(true)
    }
    expect(new Set(productStates.map((p) => p.id)).size).toBe(productStates.length)
  })
})
