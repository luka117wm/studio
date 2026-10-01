import { describe, expect, test } from 'vitest'
import { formatDuration, formatEpisodeDuration, formatSlotDate, formatUsd } from '../format'

describe('formatUsd — то же правило, что `format_usd` бэкенда', () => {
  test.each([
    [0, '$0'],
    [1, '<$0.01'],
    [4_999, '<$0.01'],
    [5_000, '$0.01'], // половина цента — вверх
    [61_400_000, '$61.40'],
    [151_200_000, '$151.20'],
    [150_000_000, '$150'],
    [3_845_000, '$3.85'],
    [3_844_999, '$3.84'],
    [-2_500_000, '-$2.50'],
    [-1, '-<$0.01'],
  ])('%i микродолларов → %s', (micro, text) => {
    expect(formatUsd(micro)).toBe(text)
  })
})

describe('formatDuration', () => {
  test.each([
    [1188, {}, '19:48'],
    [1080, { estimate: true }, '~18:00'],
    [59.6, {}, '1:00'],
    [3723, {}, '1:02:03'],
    [0, {}, '0:00'],
  ])('%s с %o → %s', (seconds, options, text) => {
    expect(formatDuration(seconds, options)).toBe(text)
  })

  test('из сводки: голос — точно, оценка и цель — с «~», без плана — null', () => {
    const base = {
      shots_total: 0,
      shots_done: 0,
      shots_failed: 0,
      shots_stale: 0,
      shots_generating: 0,
      vo_words: 0,
      spent_usd_micro: 0,
      job: null,
    }
    expect(formatEpisodeDuration({ ...base, duration_s: 1188, duration_source: 'voice' })).toBe('19:48')
    expect(formatEpisodeDuration({ ...base, duration_s: 1200, duration_source: 'target' })).toBe('~20:00')
    expect(formatEpisodeDuration({ ...base, duration_s: 81.6, duration_source: 'estimate' })).toBe('~1:22')
    expect(formatEpisodeDuration({ ...base, duration_s: null, duration_source: null })).toBeNull()
  })
})

describe('formatSlotDate', () => {
  test('ячейка и фраза, без сдвига часового пояса', () => {
    expect(formatSlotDate('2026-09-13')).toBe('13 сент')
    expect(formatSlotDate('2026-09-13', { long: true })).toBe('13 сентября')
    expect(formatSlotDate('2026-01-01')).toBe('1 янв')
    expect(formatSlotDate('2026-12-31', { long: true })).toBe('31 декабря')
    expect(formatSlotDate('garbage')).toBe('garbage')
  })
})
