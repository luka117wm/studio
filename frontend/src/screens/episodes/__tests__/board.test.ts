import { describe, expect, test } from 'vitest'
import type { EpisodeListItem } from '@/types/episode'
import { episodes } from '../../../mocks/api'
import {
  ETA_MIN_WINDOW_MS,
  boardColumn,
  cardDuration,
  cardMeta,
  cardProgress,
  cardSlot,
  countLabel,
  formatCount,
  localToday,
  matchesQuery,
  plural,
  remainingSeconds,
  type ColumnId,
} from '../board'

type Stage = EpisodeListItem['stage']
type EpisodeStatus = EpisodeListItem['status']

const STATUSES: EpisodeStatus[] = ['queued', 'generating', 'warning', 'ready', 'failed', 'published']

/** Ожидаемая колонка по статусам в порядке STATUSES — docs/episodes.md, «Стадия и статус» */
const COLUMN_TABLE: Record<Stage, ColumnId[]> = {
  idea: ['idea', 'idea', 'idea', 'idea', 'idea', 'published'],
  script: ['script', 'script', 'script', 'script', 'script', 'published'],
  generate: ['generate', 'generate', 'generate', 'generate', 'generate', 'published'],
  edit: ['edit', 'edit', 'edit', 'edit', 'edit', 'published'],
  export: ['edit', 'edit', 'edit', 'ready', 'edit', 'published'],
  publish: ['ready', 'ready', 'ready', 'ready', 'ready', 'published'],
}

const PAIRS = Object.entries(COLUMN_TABLE).flatMap(([stage, columns]) =>
  STATUSES.map((status, i) => ({ stage: stage as Stage, status, column: columns[i] })),
)

const byId = (id: string): EpisodeListItem => {
  const episode = episodes.find((e) => e.id === id)
  if (!episode) throw new Error(`нет выпуска ${id} в моках`)
  return structuredClone(episode)
}

const NO_CONTEXT = { targetWords: null, etaSeconds: null }

describe('колонка доски', () => {
  test('таблица покрывает все 36 пар стадия × статус', () => {
    expect(PAIRS).toHaveLength(36)
  })

  test.each(PAIRS)('$stage × $status → $column', ({ stage, status, column }) => {
    expect(boardColumn({ stage, status })).toBe(column)
  })

  test('выпуски артборда стоят в своих колонках', () => {
    const columns = Object.fromEntries(episodes.map((e) => [e.id, boardColumn(e)]))
    expect(columns).toEqual({
      viking: 'published',
      aztec: 'published',
      peasant: 'ready',
      pirate: 'edit',
      monastery: 'generate',
      samurai: 'script',
      sweep: 'generate',
      arsenal: 'idea',
      janissary: 'idea',
    })
  })
})

describe('строка «что сейчас»', () => {
  test('генерация с идущим джобом и оценкой остатка: «Кадры 78 из 104, ~9 мин»', () => {
    expect(cardMeta(byId('monastery'), { targetWords: null, etaSeconds: 540 })).toEqual({
      text: 'Кадры 78 из 104, ~9 мин',
      tone: 'generating',
    })
  })

  test('без замеров скорости — без оценки, не выдумываем', () => {
    expect(cardMeta(byId('monastery'), NO_CONTEXT).text).toBe('Кадры 78 из 104')
  })

  test('ошибки кадров: «12 кадров не удались»', () => {
    expect(cardMeta(byId('sweep'), NO_CONTEXT)).toEqual({ text: '12 кадров не удались', tone: 'failed' })
  })

  test('сценарий к цели пресета: «Сценарий 2 140 / ~3 000 слов»', () => {
    expect(cardMeta(byId('samurai'), { targetWords: 3000, etaSeconds: null })).toEqual({
      text: 'Сценарий 2 140 / ~3 000 слов',
      tone: 'generating',
    })
  })

  test('идея без данных: «Идея»', () => {
    expect(cardMeta(byId('arsenal'), NO_CONTEXT)).toEqual({ text: 'Идея', tone: 'muted' })
  })

  test('монтаж с предупреждением — кадры цветом warning', () => {
    expect(cardMeta(byId('pirate'), NO_CONTEXT)).toEqual({ text: 'Кадры 104 из 104', tone: 'warning' })
  })

  test('готов и опубликован — приглушённо', () => {
    expect(cardMeta(byId('peasant'), NO_CONTEXT)).toEqual({ text: 'Готов к загрузке', tone: 'muted' })
    expect(cardMeta(byId('viking'), NO_CONTEXT)).toEqual({ text: 'Опубликован', tone: 'muted' })
  })

  test('джоб другого вида на выпуске — его подпись и процент', () => {
    const episode = byId('arsenal')
    episode.summary.job = { kind: 'sleep_job', status: 'running', progress: 0.4, message: null }
    expect(cardMeta(episode, NO_CONTEXT)).toEqual({ text: 'Проверочный джоб 40%', tone: 'generating' })
  })

  test('джоб в очереди — не идёт: ни штриховки, ни оценки', () => {
    const episode = byId('arsenal')
    episode.summary.job = { kind: 'sleep_job', status: 'queued', progress: 0, message: null }
    expect(cardMeta(episode, { targetWords: null, etaSeconds: 60 })).toEqual({ text: 'Идея', tone: 'muted' })
    expect(cardProgress(episode, null).fill).toBe('queued')
  })

  test('сценарий без слов и без пресета', () => {
    const episode = byId('samurai')
    expect(cardMeta(episode, NO_CONTEXT).text).toBe('Сценарий 2 140 слов')
    episode.summary.vo_words = 0
    expect(cardMeta(episode, NO_CONTEXT).text).toBe('Сценарий не начат')
  })

  test('стадия упала без неудачных кадров', () => {
    const episode = byId('samurai')
    episode.status = 'failed'
    expect(cardMeta(episode, NO_CONTEXT)).toEqual({ text: 'Стадия не удалась, нужен повтор', tone: 'failed' })
  })
})

describe('прогресс карточки', () => {
  test.each([
    ['monastery', null, 0.75, 'generating'],
    ['sweep', null, 40 / 52, 'failed'],
    ['samurai', 3000, 2140 / 3000, 'generating'],
    ['pirate', null, 1, 'warning'],
    ['arsenal', null, 0, 'queued'],
    ['peasant', null, 1, 'ready'],
    ['viking', null, 1, 'ready'],
  ] as const)('%s → %f, %s', (id, target, value, fill) => {
    const progress = cardProgress(byId(id), target)
    expect(progress.value).toBeCloseTo(value, 5)
    expect(progress.fill).toBe(fill)
  })

  test('сценарий без пресета — 0, слова сверх цели — не больше 1', () => {
    expect(cardProgress(byId('samurai'), null).value).toBe(0)
    expect(cardProgress(byId('samurai'), 1000).value).toBe(1)
  })

  test('проверочный джоб — его прогресс со штриховкой', () => {
    const episode = byId('arsenal')
    episode.summary.job = { kind: 'sleep_job', status: 'running', progress: 0.4, message: null }
    expect(cardProgress(episode, null)).toEqual({ value: 0.4, fill: 'generating' })
  })
})

describe('длительность и слот', () => {
  test('по голосу, по оценке или цели, без плана', () => {
    expect(cardDuration(byId('pirate'))).toBe('19:48')
    expect(cardDuration(byId('samurai'))).toBe('~18:00')
    const noPlan = byId('arsenal')
    noPlan.summary.duration_s = null
    noPlan.summary.duration_source = null
    expect(cardDuration(noPlan)).toBe('—')
  })

  test('слот: сегодня, обычный, опубликован, не назначен', () => {
    const today = '2026-09-11'
    expect(cardSlot(byId('peasant'), today)).toEqual({ text: '11 сент, сегодня', today: true })
    expect(cardSlot(byId('pirate'), today)).toEqual({ text: '13 сент', today: false })
    expect(cardSlot(byId('aztec'), today)).toEqual({ text: 'вышел 7 сент', today: false })
    expect(cardSlot(byId('janissary'), today)).toEqual({ text: 'слот не назначен', today: false })
  })

  test('сегодня — по часам машины, а не UTC', () => {
    expect(localToday(new Date(2026, 8, 11, 23, 59))).toBe('2026-09-11')
    expect(localToday(new Date(2026, 0, 2, 0, 1))).toBe('2026-01-02')
  })
})

describe('оценка остатка', () => {
  test('по скорости с первого замера: четверть за минуту — ещё минута на оставшуюся четверть', () => {
    expect(remainingSeconds({ at: 0, progress: 0.5 }, { at: 60_000, progress: 0.75 })).toBeCloseTo(60, 5)
  })

  test('без движения, короткое окно или конец — нет оценки', () => {
    expect(remainingSeconds({ at: 0, progress: 0.5 }, { at: 60_000, progress: 0.5 })).toBeNull()
    expect(remainingSeconds({ at: 0, progress: 0.5 }, { at: ETA_MIN_WINDOW_MS - 1, progress: 0.6 })).toBeNull()
    expect(remainingSeconds({ at: 0, progress: 0.5 }, { at: 60_000, progress: 1 })).toBeNull()
  })
})

describe('тексты', () => {
  test.each([
    [1, 'кадр'],
    [2, 'кадра'],
    [5, 'кадров'],
    [11, 'кадров'],
    [12, 'кадров'],
    [21, 'кадр'],
    [22, 'кадра'],
    [111, 'кадров'],
  ])('%i %s', (n, word) => {
    expect(plural(n, ['кадр', 'кадра', 'кадров'])).toBe(word)
  })

  test('разряды — неразрывным пробелом', () => {
    expect(formatCount(940)).toBe('940')
    expect(formatCount(2140)).toBe('2 140')
    expect(formatCount(1_250_000)).toBe('1 250 000')
  })
})

describe('поиск и счётчик', () => {
  test('по названию и короткому имени, без учёта регистра', () => {
    expect(matchesQuery(byId('monastery'), '  MONASTERY ')).toBe(true)
    // «Peasant 1347» есть только в коротком имени: в названии — «Peasant, 1347»
    expect(matchesQuery(byId('peasant'), 'peasant 1347')).toBe(true)
    expect(matchesQuery(byId('pirate'), 'monastery')).toBe(false)
    expect(matchesQuery(byId('pirate'), '')).toBe(true)
  })

  test('все видны — «9 всего, 2 опубликовано», иначе — «видимые из всех»', () => {
    expect(countLabel(9, episodes)).toBe('9 всего, 2 опубликовано')
    expect(countLabel(1, episodes)).toBe('1 из 9')
  })
})
