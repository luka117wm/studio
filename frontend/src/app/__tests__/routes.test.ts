import { describe, expect, test } from 'vitest'
import { matchRoute, paths, routes } from '../routes'

describe('routes', () => {
  test('одиннадцать экранов, шаблоны уникальны', () => {
    expect(routes).toHaveLength(11)
    expect(new Set(routes.map((r) => r.pattern)).size).toBe(11)
    expect(new Set(routes.map((r) => r.screen)).size).toBe(11)
  })

  test('параметры выпуска и кадра разбираются и декодируются', () => {
    expect(matchRoute('/episodes/pirate/edit')?.route.screen).toBe('edit')
    const m = matchRoute('/episodes/c07%20pirate/edit/s004')
    expect(m?.route.screen).toBe('inspector')
    expect(m?.params).toEqual({ episodeId: 'c07 pirate', shotId: 's004' })
    expect(matchRoute('/episodes/')?.route.screen).toBe('episodes')
  })

  test('неизвестные пути не совпадают', () => {
    expect(matchRoute('/episodes/pirate')).toBeNull()
    expect(matchRoute('/episodes/pirate/unknown')).toBeNull()
    expect(matchRoute('/nope')).toBeNull()
  })

  test('paths.stage: идея ведёт в бэклог, остальные — в выпуск', () => {
    expect(paths.stage('pirate', 'idea')).toBe('/ideas')
    expect(paths.stage('pirate', 'export')).toBe('/episodes/pirate/export')
    expect(paths.shot('pirate', 's004')).toBe('/episodes/pirate/edit/s004')
  })
})
