// Подписи полей кадра для листа и таблицы плана — таблицы случаев.
import { describe, expect, test } from 'vitest'
import {
  PREVIEW_FPS,
  heroLabel,
  heroesLabel,
  motionLabel,
  motionName,
  periodYears,
  shotSizeLabel,
  statusOf,
  transitionLabel,
  type MotionType,
  type ShotSize,
} from '../shotLabels'

describe('движение', () => {
  test.each<[MotionType, number, string]>([
    ['push_in', 0.08, 'наезд 1.08×'],
    ['push_in', 0.1, 'наезд 1.10×'],
    ['pull_out', 0.12, 'отъезд 1.12×'],
    ['pan_right', 0.1, 'панорама →'],
    ['pan_left', 0.08, 'панорама ←'],
    ['tilt_up', 0.05, 'панорама ↑'],
    ['tilt_down', 0.05, 'панорама ↓'],
    ['static', 0, 'статика'],
    ['drift', 0.04, 'дрейф'],
  ])('%s %s → «%s»', (type, strength, label) => {
    expect(motionLabel({ type, strength })).toBe(label)
  })

  test('название без силы — колонка таблицы', () => {
    expect(motionName('push_in')).toBe('наезд')
    expect(motionName('pan_right')).toBe('панорама')
  })
})

describe('переход', () => {
  test('кадры — при PREVIEW_FPS', () => {
    expect(PREVIEW_FPS).toBe(30)
  })

  test.each([
    [{ type: 'cut' as const, duration: 0 }, 'встык'],
    [{ type: 'crossfade' as const, duration: 0.2 }, 'наплыв 6 к'],
    [{ type: 'crossfade' as const, duration: 0.4 }, 'наплыв 12 к'],
    [{ type: 'crossfade' as const, duration: 0.27 }, 'наплыв 8 к'],
    [{ type: 'dip' as const, duration: 0.6 }, 'через чёрное 18 к'],
  ])('%o → «%s»', (transition, label) => {
    expect(transitionLabel(transition)).toBe(label)
  })
})

describe('план и герои', () => {
  test.each<[ShotSize, string]>([
    ['establishing', 'общий'],
    ['action', 'действие'],
    ['reaction', 'реакция'],
    ['detail', 'деталь'],
  ])('%s → «%s»', (size, label) => {
    expect(shotSizeLabel(size)).toBe(label)
  })

  test.each([
    ['you@powder-monkey-11', 'Powder monkey'],
    ['you@quartermaster-28', 'Quartermaster'],
    ['otto@england-1347', 'Otto'],
    ['gunner@gun-deck-30', 'Gunner'],
    ['crew', 'Crew'],
  ])('%s → «%s»', (appearance, label) => {
    expect(heroLabel(appearance)).toBe(label)
  })

  test('герои через запятую, без героев — пусто', () => {
    expect(heroesLabel(['you@landsman-16', 'you@able-seaman-19'])).toBe('Landsman, Able seaman')
    expect(heroesLabel([])).toBe('')
  })
})

describe('статус и годы', () => {
  test.each([
    ['todo', 'queued', 'в очереди'],
    ['queued', 'queued', 'в очереди'],
    ['generating', 'generating', 'генерация'],
    ['done', 'ready', 'готов'],
    ['stale', 'warning', 'проверить'],
    ['failed', 'failed', 'ошибка'],
  ] as const)('%s → глиф %s, «%s»', (status, glyph, label) => {
    expect(statusOf(status)).toEqual({ status: glyph, label })
  })

  test('годы эпох кадров', () => {
    const shot = (period: string) => ({ image: { prompt: '', period, appearances: [], shot_size: 'action' as const } })
    expect(periodYears([shot('caribbean-1716'), shot('caribbean-1726'), shot('caribbean-1716')])).toBe('1716–1726')
    expect(periodYears([shot('england-1347')])).toBe('1347')
    expect(periodYears([shot('prehistory')])).toBe('')
  })
})
