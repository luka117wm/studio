// Карта структуры референса: ширины сегментов в сумме 100 %, узкие — подпись в Tooltip, шкала времени.
import { describe, expect, test } from 'vitest'
import type { SegmentMetrics } from '@/types/reference'
import { layoutSegments, scaleTicks } from '../structureMap'

const segment = (index: number, kind: SegmentMetrics['kind'], label: string, duration_s: number): SegmentMetrics => ({
  index,
  kind,
  label,
  start_s: 0,
  duration_s,
  words: 0,
  pace_wpm: 0,
  facts: 0,
  facts_per_min: 0,
})

/** Сегменты артборда: 22:41 = 1361 с */
const WARSHIP = [22, 43, 168, 26, 196, 214, 31, 232, 258, 171].map((d, i) => segment(i + 1, 'rank', `Сегмент ${i + 1}`, d))
const sum = (boxes: { widthPct: number }[]) => Math.round(boxes.reduce((s, b) => s + b.widthPct, 0) * 100) / 100

describe('layoutSegments', () => {
  test('ширины пропорциональны длительности и в сумме ровно 100 %', () => {
    const boxes = layoutSegments(WARSHIP)
    expect(sum(boxes)).toBe(100)
    expect(boxes[0]!.widthPct).toBeCloseTo((22 / 1361) * 100, 1)
    expect(boxes[8]!.widthPct).toBeCloseTo((258 / 1361) * 100, 1)
    // Каждая ширина — в сотых процента
    for (const box of boxes) expect(Math.round(box.widthPct * 100) / 100).toBe(box.widthPct)
  })

  test.each([
    [[1, 1, 1]],
    [[1, 2, 3, 4, 5, 6, 7]],
    [[0.4, 0.3, 0.3]],
    [[59.9, 0.05, 0.05]],
  ])('сумма 100 при неровных долях: %j', (durations) => {
    expect(sum(layoutSegments(durations.map((d, i) => segment(i + 1, 'rank', 's', d))))).toBe(100)
  })

  test('узкие сегменты — подпись только в Tooltip', () => {
    const boxes = layoutSegments(WARSHIP)
    expect(boxes.filter((b) => b.narrow).map((b) => b.index)).toEqual([1, 2, 4, 7])
    expect(boxes[0]!.tooltip).toBe('Сегмент 1, длительность 0:22')
    expect(boxes[2]!.length).toBe('2:48')
  })

  test('нулевая длительность — равные доли; пусто — пусто', () => {
    expect(layoutSegments([segment(1, 'hook', 'a', 0), segment(2, 'finale', 'b', 0)]).map((b) => b.widthPct)).toEqual([50, 50])
    expect(layoutSegments([])).toEqual([])
  })
})

describe('scaleTicks', () => {
  test('0, ¼, ½, ¾, конец', () => {
    expect(scaleTicks(1361)).toEqual(['0:00', '5:40', '11:21', '17:01', '22:41'])
    expect(scaleTicks(4000)).toEqual(['0:00', '16:40', '33:20', '50:00', '1:06:40'])
  })
})

describe('subtitlesPreview', () => {
  test('без номеров, строк времени, заголовка VTT и таймкодов; длинное — с многоточием', async () => {
    const { subtitlesPreview, PREVIEW_CHARS } = await import('../referenceView')
    const srt = '1\n00:00:00,000 --> 00:00:06,500\nYou are seventeen,\nand the navy hands you an oar.\n\n2\n00:00:06,500 --> 00:00:13,000\n<i>Three hundred</i> men pull.\n'
    expect(subtitlesPreview(srt)).toBe('You are seventeen, and the navy hands you an oar. Three hundred men pull.')
    expect(subtitlesPreview('WEBVTT\n\n00:01.000 --> 00:02.000\nHello')).toBe('Hello')
    expect(subtitlesPreview('0:00 You are seventeen\n1:02:03 much later')).toBe('You are seventeen much later')
    const long = subtitlesPreview(`0:00 ${'word '.repeat(80)}`)
    expect(long.endsWith('…')).toBe(true)
    expect(long.length).toBe(PREVIEW_CHARS + 1)
  })
})

describe('referenceHeading', () => {
  test('название и автор; без названия — ссылка; без ссылки — id', async () => {
    const { referenceHeading } = await import('../referenceView')
    const base = { id: 'ref0001', url: '', title: '', author: '', duration_s: 180 }
    const heading = (fields: Partial<typeof base>) => referenceHeading({ ...base, ...fields } as never)
    expect(heading({ title: 'Every Rank on a Roman Warship', author: 'Gradus' })).toBe('Every Rank on a Roman Warship — Gradus, 3:00')
    expect(heading({ url: 'youtube.com/watch?v=x' })).toBe('youtube.com/watch?v=x, 3:00')
    expect(heading({})).toBe('ref0001, 3:00')
  })
})
