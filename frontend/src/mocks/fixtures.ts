/* Данные пиратского выпуска для оболочки (до M2). Числа — как в макетах `design/`,
   иначе при сверке скриншотов будет шум. Сети нет: экраны берут данные отсюда напрямую. */
import type { Channel, ChannelId, Episode, Slot, StageId, StageState, StatusLine } from '../types/fixtures'

export const channels: Channel[] = [
  {
    id: 'cursus',
    name: 'Cursus',
    initial: 'C',
    format: 'every_rank',
    spentUsd: 61.4,
    monthlyBudgetUsd: 150,
    voiceQuota: { usedChars: 212_400, limitChars: 600_000 },
  },
  {
    id: 'otto',
    name: "Otto's Timeline",
    initial: 'O',
    format: 'host',
    spentUsd: 23.15,
    monthlyBudgetUsd: 100,
    voiceQuota: { usedChars: 84_300, limitChars: 600_000 },
  },
]

export function channelById(id: ChannelId): Channel {
  return channels.find((c) => c.id === id) ?? channels[0]!
}

const done = (...ids: StageId[]) => ids
function stages(doneIds: StageId[], active: StageId | null, error: StageId | null = null): Record<StageId, StageState> {
  const all: StageId[] = ['idea', 'script', 'generate', 'edit', 'export', 'publish']
  return Object.fromEntries(
    all.map((id) => [id, id === error ? 'error' : id === active ? 'active' : doneIds.includes(id) ? 'done' : 'todo']),
  ) as Record<StageId, StageState>
}

export const episodes: Episode[] = [
  {
    id: 'pirate',
    channel: 'cursus',
    title: 'Every Rank on a Pirate Ship (Powder Monkey to Captain)',
    shortTitle: 'Pirate Ship',
    boardStage: 'edit',
    status: 'warning',
    duration: '19:48',
    shots: 104,
    words: 3060,
    meta: 'Кадры 104 из 104, SFX не расставлены',
    progress: 0.82,
    spentUsd: 3.84,
    slot: '13 сент',
    stages: stages(done('idea', 'script', 'generate'), 'edit'),
    period: { id: 'caribbean-1716', label: 'Карибы, 1716' },
    appearances: [
      'you@powder-monkey-11',
      'you@able-seaman-17',
      'you@gunner-23',
      'you@quartermaster-28',
      'you@captain-35',
    ],
  },
  {
    id: 'peasant',
    channel: 'otto',
    title: '24 Hours as a Medieval Peasant, 1347',
    shortTitle: 'Medieval Peasant 1347',
    boardStage: 'ready',
    status: 'ready',
    duration: '6:12',
    shots: 48,
    words: 940,
    meta: 'Мастер 1920×1080, 1.9 ГБ',
    progress: 1,
    spentUsd: 2.15,
    slot: '11 сент, сегодня',
    stages: stages(done('idea', 'script', 'generate', 'edit', 'export'), 'publish'),
    period: { id: 'england-1347', label: 'Англия, 1347' },
    appearances: ['otto@england-1347'],
  },
  {
    id: 'monastery',
    channel: 'cursus',
    title: 'Medieval Monastery: Oblate to Abbot',
    shortTitle: 'Medieval Monastery',
    boardStage: 'generate',
    status: 'generating',
    duration: '21:10',
    shots: 104,
    words: 3210,
    meta: 'Кадры 78 из 104, ~9 мин',
    progress: 0.75,
    spentUsd: 2.71,
    slot: '15 сент',
    stages: stages(done('idea', 'script'), 'generate'),
  },
  {
    id: 'sweep',
    channel: 'otto',
    title: 'A Day as a Victorian Chimney Sweep',
    shortTitle: 'Victorian Chimney Sweep',
    boardStage: 'generate',
    status: 'failed',
    duration: '6:40',
    shots: 52,
    words: 1010,
    meta: '12 кадров не удались',
    progress: 0.61,
    spentUsd: 1.92,
    slot: '19 сент',
    stages: stages(done('idea', 'script'), null, 'generate'),
  },
  {
    id: 'samurai',
    channel: 'cursus',
    title: 'Samurai Household: every rank',
    shortTitle: 'Samurai Household',
    boardStage: 'script',
    status: 'generating',
    duration: '~18:00',
    shots: 0,
    words: 2140,
    meta: 'Сценарий 2 140 / ~3 000 слов',
    progress: 0.71,
    spentUsd: 0.38,
    slot: '17 сент',
    stages: stages(done('idea'), 'script'),
  },
  {
    id: 'arsenal',
    channel: 'cursus',
    title: 'Venetian Arsenal: every rank',
    shortTitle: 'Venetian Arsenal',
    boardStage: 'idea',
    status: 'queued',
    duration: '~20:00',
    shots: 0,
    words: 0,
    meta: '6 референсов, канон не собран',
    progress: 0.18,
    spentUsd: 0,
    slot: '21 сент',
    stages: stages([], 'idea'),
  },
  {
    id: 'janissary',
    channel: 'cursus',
    title: 'Ottoman Janissary Corps',
    shortTitle: 'Janissary Corps',
    boardStage: 'idea',
    status: 'queued',
    duration: '~22:00',
    shots: 0,
    words: 0,
    meta: '2 референса, тренд растёт',
    progress: 0.08,
    spentUsd: 0,
    slot: null,
    stages: stages([], 'idea'),
  },
  {
    id: 'aztec',
    channel: 'otto',
    title: 'Market Day in the Aztec Empire',
    shortTitle: 'Aztec Market Day',
    boardStage: 'published',
    status: 'published',
    duration: '7:04',
    shots: 56,
    words: 1080,
    meta: 'CTR 6.4%, 41 200 за 48 часов',
    progress: 1,
    spentUsd: 2.44,
    slot: 'вышел 7 сент',
    stages: stages(done('idea', 'script', 'generate', 'edit', 'export', 'publish'), null),
  },
  {
    id: 'viking',
    channel: 'otto',
    title: 'A Viking Winter',
    shortTitle: 'Viking Winter',
    boardStage: 'published',
    status: 'published',
    duration: '6:55',
    shots: 54,
    words: 1040,
    meta: 'CTR 4.1%, 18 900 за 48 часов',
    progress: 1,
    spentUsd: 2.28,
    slot: 'вышел 5 сент',
    stages: stages(done('idea', 'script', 'generate', 'edit', 'export', 'publish'), null),
  },
]

export function episodeById(id: string | null): Episode | undefined {
  return id === null ? undefined : episodes.find((e) => e.id === id)
}

/** Слоты публикации, сентябрь 2026, раз в два дня */
export const slots: Slot[] = [
  { day: '5', weekday: 'сб', episodeId: 'viking' },
  { day: '7', weekday: 'пн', episodeId: 'aztec' },
  { day: '9', weekday: 'ср', missed: true },
  { day: '11', weekday: 'пт', episodeId: 'peasant', today: true },
  { day: '13', weekday: 'вс', episodeId: 'pirate' },
  { day: '15', weekday: 'вт', episodeId: 'monastery' },
  { day: '17', weekday: 'чт', episodeId: 'samurai' },
  { day: '19', weekday: 'сб', episodeId: 'sweep' },
  { day: '21', weekday: 'пн', episodeId: 'arsenal' },
  { day: '23', weekday: 'ср', empty: true },
  { day: '25', weekday: 'пт', empty: true },
]

export const statusLine: StatusLine = {
  process: 'Генерация кадров: Medieval Monastery, 78 из 104',
  note: 'Следующий слот 13 сентября, Every Rank on a Pirate Ship: нет SFX, экспорт не запускался',
  savedAt: '12:41',
}

/** Оценки цен платных действий для подписей кнопок, USD. До M2 — константы; потом считает `cost/`. */
export const estimates = {
  ideasUsd: 0.12,
  scriptUsd: 0.38,
  shotsUsd: 6.97,
  voiceUsd: 1.27,
  styleUsd: 0.4,
  thumbnailUsd: 0.24,
}
