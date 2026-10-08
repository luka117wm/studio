/* Ответы API с контентом артборда 1 «Выпуски» (сентябрь 2026, «сегодня» — пятница, 11 сентября) — для vitest и e2e
   (`page.route`, M3.7). Формы — сгенерированные типы через `satisfies`: смена модели на бэкенде ломает сборку тестов,
   а не молча моки. Числа — как в артборде, иначе сверка скриншотов даст шум (приём M1.3).
   В production-код не импортируется (решение 7 устава M3). */
import type { ChannelProfile, FormatPreview } from '@/types/channel'
import type { CostSummary, Money } from '@/types/cost'
import type { EpisodeCreate, EpisodeListItem, EpisodePatch, EpisodeSummary } from '@/types/episode'
import type { BridgeError, BridgeRun, BridgeSettings } from '@/types/bridge'
import type { Director } from '@/types/director'
import type { JobList } from '@/types/job'
import type {
  ApprovalProblem,
  ApprovalRefusal,
  EffectivePlan,
  EstimateLine,
  PlanAnswerResult,
  PlanCheck,
  PlanEstimate,
  PlanParts,
  PlanPrompt,
  PlanShot,
  ValidationItem,
} from '@/types/plan'
import type { EpisodeBrief, ImportResult, Project } from '@/types/project'
import type { Slot, SlotAssign } from '@/types/slot'
import { formatSlotDate, formatUsd } from '../app/format'

export const TODAY = '2026-09-11'
/** «Сейчас» артборда — 12:41 по Москве: время записи в ответах мока, отсюда «Сохранено 12:41» в шапке */
export const NOW = `${TODAY}T09:41:00+00:00`
type ChannelId = ChannelProfile['id']

const money = (usd_micro: number): Money => ({ usd_micro, usd: formatUsd(usd_micro) })

export const channels = [
  {
    id: 'cursus',
    name: 'Cursus',
    format: 'every_rank',
    budgets: { monthly_usd: 150, per_episode_usd: 15, animation_usd: 5 },
    voice_quota: { limit_chars: 600_000 },
    voice: { voice_id: 'unset', pace_wpm: null },
  },
  {
    id: 'otto',
    name: "Otto's Timeline",
    format: 'host',
    budgets: { monthly_usd: 100, per_episode_usd: 8, animation_usd: 3 },
    voice_quota: { limit_chars: 600_000 },
    voice: { voice_id: 'unset', pace_wpm: null },
  },
] satisfies ChannelProfile[]

const summary = (fields: Partial<EpisodeSummary>): EpisodeSummary => ({
  shots_total: 0,
  shots_done: 0,
  shots_failed: 0,
  shots_stale: 0,
  shots_generating: 0,
  vo_words: 0,
  duration_s: null,
  duration_source: null,
  spent_usd_micro: 0,
  job: null,
  ...fields,
})

const stamp = (day: number) => `2026-08-${String(day).padStart(2, '0')}T09:00:00+00:00`

/** Выпуски артборда в порядке ответа `GET /api/episodes`: по дате слота, без слота — в конце */
export const episodes = [
  {
    id: 'viking',
    channel: 'otto',
    title: 'A Viking Winter',
    short_title: 'Viking Winter',
    origin: 'blank',
    stage: 'publish',
    status: 'published',
    slot_date: '2026-09-05',
    created_at: stamp(10),
    updated_at: stamp(30),
    summary: summary({ shots_total: 54, shots_done: 54, vo_words: 1040, duration_s: 415, duration_source: 'voice', spent_usd_micro: 2_280_000 }),
  },
  {
    id: 'aztec',
    channel: 'otto',
    title: 'Market Day in the Aztec Empire',
    short_title: 'Aztec Market Day',
    origin: 'blank',
    stage: 'publish',
    status: 'published',
    slot_date: '2026-09-07',
    created_at: stamp(11),
    updated_at: stamp(31),
    summary: summary({ shots_total: 56, shots_done: 56, vo_words: 1080, duration_s: 424, duration_source: 'voice', spent_usd_micro: 2_440_000 }),
  },
  {
    id: 'peasant',
    channel: 'otto',
    title: '24 Hours as a Medieval Peasant, 1347',
    short_title: 'Medieval Peasant 1347',
    origin: 'blank',
    stage: 'export',
    status: 'ready',
    slot_date: '2026-09-11',
    created_at: stamp(14),
    updated_at: stamp(31),
    summary: summary({ shots_total: 48, shots_done: 48, vo_words: 940, duration_s: 372, duration_source: 'voice', spent_usd_micro: 2_150_000 }),
  },
  {
    id: 'pirate',
    channel: 'cursus',
    title: 'Pirate Ship: Powder Monkey to Captain',
    short_title: 'Pirate Ship',
    origin: 'reference',
    stage: 'edit',
    status: 'warning',
    slot_date: '2026-09-13',
    created_at: stamp(15),
    updated_at: stamp(31),
    summary: summary({ shots_total: 104, shots_done: 104, vo_words: 3060, duration_s: 1188, duration_source: 'voice', spent_usd_micro: 3_840_000 }),
  },
  {
    id: 'monastery',
    channel: 'cursus',
    title: 'Medieval Monastery: Oblate to Abbot',
    short_title: 'Medieval Monastery',
    origin: 'blank',
    stage: 'generate',
    status: 'generating',
    slot_date: '2026-09-15',
    created_at: stamp(18),
    updated_at: stamp(31),
    summary: summary({
      shots_total: 104,
      shots_done: 78,
      shots_generating: 4,
      vo_words: 3210,
      duration_s: 1270,
      duration_source: 'voice',
      spent_usd_micro: 2_710_000,
      job: { kind: 'images', status: 'running', progress: 0.75, message: '78 из 104' },
    }),
  },
  {
    id: 'samurai',
    channel: 'cursus',
    title: 'Samurai Household: every rank',
    short_title: 'Samurai Household',
    origin: 'blank',
    stage: 'script',
    status: 'generating',
    slot_date: '2026-09-17',
    created_at: stamp(20),
    updated_at: stamp(31),
    summary: summary({ vo_words: 2140, duration_s: 1080, duration_source: 'target', spent_usd_micro: 380_000 }),
  },
  {
    id: 'sweep',
    channel: 'otto',
    title: 'A Day as a Victorian Chimney Sweep',
    short_title: 'Victorian Chimney Sweep',
    origin: 'blank',
    stage: 'generate',
    status: 'failed',
    slot_date: '2026-09-19',
    created_at: stamp(21),
    updated_at: stamp(31),
    summary: summary({
      shots_total: 52,
      shots_done: 40,
      shots_failed: 12,
      vo_words: 1010,
      duration_s: 400,
      duration_source: 'voice',
      spent_usd_micro: 1_920_000,
    }),
  },
  {
    id: 'arsenal',
    channel: 'cursus',
    title: 'Venetian Arsenal: every rank',
    short_title: 'Venetian Arsenal',
    origin: 'backlog',
    stage: 'idea',
    status: 'queued',
    slot_date: '2026-09-21',
    created_at: stamp(24),
    updated_at: stamp(24),
    summary: summary({ duration_s: 1200, duration_source: 'target' }),
  },
  {
    id: 'janissary',
    channel: 'cursus',
    title: 'Ottoman Janissary Corps',
    short_title: 'Janissary Corps',
    origin: 'backlog',
    stage: 'idea',
    status: 'queued',
    slot_date: null,
    created_at: stamp(25),
    updated_at: stamp(25),
    summary: summary({ duration_s: 1320, duration_source: 'target' }),
  },
] satisfies EpisodeListItem[]

/** Полоса слотов артборда: 3 прошлых, сегодня, 7 будущих; риски — по правилам `docs/slots.md` */
export const slots = [
  { date: '2026-09-05', weekday: 6, episode_id: 'viking', channel: 'otto', state: 'published', risk: null },
  { date: '2026-09-07', weekday: 1, episode_id: 'aztec', channel: 'otto', state: 'published', risk: null },
  { date: '2026-09-09', weekday: 3, episode_id: null, channel: null, state: 'missed', risk: null },
  { date: '2026-09-11', weekday: 5, episode_id: 'peasant', channel: 'otto', state: 'today', risk: null },
  {
    date: '2026-09-13',
    weekday: 7,
    episode_id: 'pirate',
    channel: 'cursus',
    state: 'filled',
    risk: { level: 'warning', reason: 'not_exported' },
  },
  { date: '2026-09-15', weekday: 2, episode_id: 'monastery', channel: 'cursus', state: 'filled', risk: null },
  { date: '2026-09-17', weekday: 4, episode_id: 'samurai', channel: 'cursus', state: 'filled', risk: null },
  {
    date: '2026-09-19',
    weekday: 6,
    episode_id: 'sweep',
    channel: 'otto',
    state: 'filled',
    risk: { level: 'failed', reason: 'shots_failed' },
  },
  { date: '2026-09-21', weekday: 1, episode_id: 'arsenal', channel: 'cursus', state: 'filled', risk: null },
  { date: '2026-09-23', weekday: 3, episode_id: null, channel: null, state: 'empty', risk: null },
  { date: '2026-09-25', weekday: 5, episode_id: null, channel: null, state: 'empty', risk: null },
] satisfies Slot[]

const costSummary = (channel: ChannelId, limit: number, byStage: Record<string, number>): CostSummary => {
  const spent = Object.values(byStage).reduce((sum, micro) => sum + micro, 0)
  return {
    channel,
    month: '2026-09',
    budget: {
      limit: money(limit),
      charged: money(spent),
      reserved: money(0),
      queued: money(0),
      remaining: money(limit - spent),
    },
    by_stage: Object.entries(byStage).map(([stage, micro]) => ({ stage, spent: money(micro) })),
    stale_pricing: [],
  }
}

/** Расход сентября: Cursus $61.40 из $150 (шапка артборда), Otto $23.15 из $100 */
export const costSummaries: Record<ChannelId, CostSummary> = {
  cursus: costSummary('cursus', 150_000_000, { script: 4_200_000, images: 44_700_000, voice: 12_500_000 }),
  otto: costSummary('otto', 100_000_000, { script: 1_350_000, images: 16_800_000, voice: 5_000_000 }),
}

/** Пресеты диалога «Новый выпуск»: «~$3.80 за выпуск» и «~$2.10 за выпуск», как в артборде */
export const formats = {
  cursus: {
    channel: 'cursus',
    format: 'every_rank',
    preset: {
      label: 'every rank',
      hint: 'Рассказчик во втором лице',
      minutes: { min: 18, target: 20, max: 25 },
      sections: 8,
      shots: 100,
      words_per_minute: 150,
    },
    estimate: {
      stages: [
        {
          stage: 'script',
          provider: 'anthropic',
          model: 'claude-opus-5',
          lines: [
            { unit: 'token_in', quantity: 8000, variant: null, usd_micro: 40_000 },
            { unit: 'token_out', quantity: 18_000, variant: null, usd_micro: 340_000 },
          ],
          usd_micro: 380_000,
          stale_pricing: false,
        },
        {
          stage: 'images',
          provider: 'gemini',
          model: 'gemini-3.1-flash-image',
          lines: [{ unit: 'image', quantity: 100, variant: '1K', usd_micro: 2_700_000 }],
          usd_micro: 2_700_000,
          stale_pricing: false,
        },
        {
          stage: 'voice',
          provider: 'elevenlabs',
          model: 'eleven_multilingual_v2',
          lines: [{ unit: 'char', quantity: 18_000, variant: null, usd_micro: 720_000 }],
          usd_micro: 720_000,
          stale_pricing: false,
        },
      ],
      usd_micro: 3_800_000,
    },
    stale_pricing: false,
  },
  otto: {
    channel: 'otto',
    format: 'host',
    preset: {
      label: 'сутки в эпохе',
      hint: 'Отто в кадре',
      minutes: { min: 6, target: 7, max: 10 },
      sections: 5,
      shots: 40,
      words_per_minute: 150,
    },
    estimate: {
      stages: [
        {
          stage: 'script',
          provider: 'anthropic',
          model: 'claude-opus-5',
          lines: [
            { unit: 'token_in', quantity: 8000, variant: null, usd_micro: 40_000 },
            { unit: 'token_out', quantity: 6300, variant: null, usd_micro: 150_000 },
          ],
          usd_micro: 190_000,
          stale_pricing: false,
        },
        {
          stage: 'images',
          provider: 'gemini',
          model: 'gemini-3.1-flash-image',
          lines: [{ unit: 'image', quantity: 40, variant: '1K', usd_micro: 1_600_000 }],
          usd_micro: 1_600_000,
          stale_pricing: false,
        },
        {
          stage: 'voice',
          provider: 'elevenlabs',
          model: 'eleven_multilingual_v2',
          lines: [{ unit: 'char', quantity: 6300, variant: null, usd_micro: 310_000 }],
          usd_micro: 310_000,
          stale_pricing: false,
        },
      ],
      usd_micro: 2_100_000,
    },
    stale_pricing: false,
  },
} satisfies Record<ChannelId, FormatPreview>

/** Снимок джобов: идёт генерация кадров Medieval Monastery (статус-строка артборда) */
export const jobs = {
  items: [
    {
      id: 'job-monastery-images',
      kind: 'images',
      status: 'running',
      progress: 0.75,
      message: '78 из 104',
      payload: {},
      result: null,
      error: null,
      attempts: 1,
      cancel_requested: false,
      episode_id: 'monastery',
      batch_id: 'batch-monastery',
      idempotency_key: null,
      created_at: '2026-09-11T08:30:00+00:00',
      started_at: '2026-09-11T08:30:01+00:00',
      finished_at: null,
      cost_usd_micro: 2_010_000,
      cost_stage: 'images',
    },
  ],
  summary: { total: 1, queued: 0, running: 1, done: 0, failed: 0, cancelled: 0 },
  last_event_id: 1200,
} satisfies JobList

// --- маршрутизатор ---------------------------------------------------------------------------

/* ---- Экран 3: заявка, мост, план (M4.4) ---- */

export const bridgeSettings = {
  plan_source: 'bridge',
  api: { available: false, reason: 'Нет ключа ANTHROPIC_API_KEY — docs/api_keys.md' },
} satisfies BridgeSettings

/** Размер части плана (`config/formats.yaml → plan.shots_per_part`) и число частей по пресету канала */
export const SHOTS_PER_PART = 26
const PARTS_TOTAL: Record<ChannelId, number> = { cursus: 4, otto: 2 }

export const emptyBrief = {
  idea: '',
  angle: '',
  hook_promise: '',
  notes: '',
  sources: [],
  idea_id: null,
  reference_id: null,
  reference_mode: 'none',
} satisfies EpisodeBrief

/** Заявки артборда: у «Самураев» заполнена (можно копировать промпт), у остальных пусто */
const briefs: Record<string, EpisodeBrief> = {
  samurai: {
    ...emptyBrief,
    idea: 'Every rank in a samurai household, from page boy to lord',
    angle: 'One boy climbs the household from the kitchen to the hall',
    hook_promise: 'From page boy to lord in twenty minutes',
    sources: [{ title: 'Samurai households, 1600–1868', url: 'https://example.org/samurai' }],
  },
}

const SECTIONS = [
  { id: 'r1', title: 'Powder monkey', chapter: true, vo_direction: 'calm, dry irony' },
  { id: 'r2', title: 'Gun drill', chapter: true, vo_direction: null },
  { id: 'r3', title: 'Quartermaster', chapter: true, vo_direction: null },
  { id: 'r4', title: 'Captain', chapter: true, vo_direction: null },
]

const VO = [
  'You are eleven years old, and the first thing you learn on this ship is where the gunpowder lives.',
  'Your job is to run. Cartridge case in both arms, up the ladder, along the gun deck, and back down.',
  'The gun goes off eighteen inches from your ear. You will not hear properly again until Thursday.',
]

/** Кадр плана артборда: VO по кругу из трёх фраз, раздел — по 26 кадров */
function planShot(n: number): PlanShot {
  return {
    id: `s${String(n).padStart(3, '0')}`,
    section: SECTIONS[Math.min(SECTIONS.length - 1, Math.floor((n - 1) / SHOTS_PER_PART))]?.id ?? 'r1',
    vo: VO[(n - 1) % VO.length] ?? '',
    image: { prompt: 'carries a leather cartridge case down the gun deck', period: 'caribbean-1716', appearances: [], shot_size: 'action' },
    motion: { type: 'push_in', strength: 0.08, ease: 'in_out_cubic' },
    transition_in: { type: 'cut', duration: 0 },
    animate: { recommended: false, reason: null, prompt: null, seconds: 4 },
    sfx: [],
    overlay: null,
    status: 'queued',
    stale_reasons: [],
    duration_locked: false,
    prompt_locked: false,
    overridden: [],
  }
}

export function mockPlan(episode: EpisodeListItem, version: string, shots: number): EffectivePlan {
  return {
    version,
    source: 'bridge',
    approved_version: null,
    meta: {
      channel: episode.channel,
      episode_id: episode.id,
      working_title: episode.title,
      format: episode.channel === 'otto' ? 'host' : 'every_rank',
      language: 'en',
      target_minutes: episode.channel === 'otto' ? 8 : 20,
      part: 1,
      parts_total: 1,
    },
    sections: SECTIONS.slice(0, Math.max(1, Math.ceil(shots / SHOTS_PER_PART))),
    shots: Array.from({ length: shots }, (_, i) => planShot(i + 1)),
    facts: [],
  }
}

/* ---- План «Пиратов» по артборду 3: лист и таблица (M4.5) ---- */

type ArtShot = Pick<PlanShot, 'id' | 'section' | 'vo' | 'status' | 'stale_reasons'> & {
  prompt: string
  period: string
  heroes: string[]
  size: PlanShot['image']['shot_size']
  motion: PlanShot['motion']
  transition: PlanShot['transition_in']
  animate: boolean
  sfx: number
}

const ART_SECTIONS = [
  { id: 'cold', title: 'Cold open', chapter: false, vo_direction: 'calm, dry irony' },
  { id: 'r1', title: 'Rank 1: Powder monkey', chapter: true, vo_direction: null },
  { id: 'r2', title: 'Rank 2: Landsman', chapter: true, vo_direction: null },
  { id: 'r5', title: 'Rank 5: Quartermaster', chapter: true, vo_direction: null },
]

const BOY = 'you@powder-monkey-11'
const MAN = 'you@landsman-16'
const ease = 'in_out_cubic' as const
const cut = { type: 'cut' as const, duration: 0 }

/** Кадры s001…s006, s061, s062 артборда; у s004 VO в версии другой — правка возвращает текст артборда */
const ART_SHOTS: ArtShot[] = [
  { id: 's001', section: 'cold', vo: 'You are eleven years old, and the first thing you learn on this ship is where the gunpowder lives.', prompt: 'A barefoot boy carries a leather cartridge case down a narrow gun deck, sailors loading a cannon behind him', period: 'caribbean-1716', heroes: [BOY], size: 'establishing', motion: { type: 'push_in', strength: 0.08, ease }, transition: cut, animate: true, sfx: 2, status: 'done', stale_reasons: [] },
  { id: 's002', section: 'cold', vo: 'Nobody asks your name. They ask if you can run a cartridge to the guns without tripping.', prompt: 'Close view of a boy’s soot-marked hands gripping a canvas cartridge, cannon wheel behind', period: 'caribbean-1716', heroes: [BOY], size: 'detail', motion: { type: 'pull_out', strength: 0.12, ease }, transition: { type: 'crossfade', duration: 0.2 }, animate: false, sfx: 1, status: 'done', stale_reasons: [] },
  { id: 's003', section: 'r1', vo: 'Your station is the magazine, a felt-lined room below the waterline where no lantern is ever allowed and no man walks in with nails in his boots.', prompt: 'Felt-lined powder magazine below the waterline, barrels stacked in rows, a boy at the door', period: 'caribbean-1716', heroes: [BOY, 'gunner@gun-deck-30'], size: 'establishing', motion: { type: 'push_in', strength: 0.1, ease }, transition: cut, animate: true, sfx: 3, status: 'done', stale_reasons: [] },
  { id: 's004', section: 'r1', vo: 'Twelve cartridges a trip. Every gun crew counts the seconds.', prompt: 'Boy running along a crowded gun deck, sailors either side, ropes and shot racks', period: 'caribbean-1716', heroes: [BOY], size: 'action', motion: { type: 'pan_right', strength: 0.1, ease: 'linear' }, transition: cut, animate: false, sfx: 2, status: 'queued', stale_reasons: [] },
  { id: 's005', section: 'r2', vo: 'A landsman is a grown man who knows nothing. He is paid the least, and he is handed the work nobody else claims.', prompt: 'Weather-beaten man in ragged slops standing apart from a working crew on an open deck', period: 'caribbean-1716', heroes: [MAN], size: 'reaction', motion: { type: 'push_in', strength: 0.06, ease }, transition: { type: 'crossfade', duration: 0.27 }, animate: false, sfx: 1, status: 'queued', stale_reasons: [] },
  { id: 's006', section: 'r2', vo: 'Pump the bilge, scrub the deck, carry the dead. A year of it, and the crew starts using your name.', prompt: 'Two men working a bilge pump in knee-deep water, low cramped hold', period: 'caribbean-1716', heroes: [MAN, 'you@able-seaman-19'], size: 'action', motion: { type: 'pull_out', strength: 0.14, ease }, transition: cut, animate: true, sfx: 2, status: 'stale', stale_reasons: ['Промпт: добавлено „knee-deep water“'] },
  { id: 's061', section: 'r5', vo: 'Here is the part nobody expects: the crew votes for the captain. And they can vote him out.', prompt: 'Crowded main deck at dusk, raised hands of a voting crew, captain standing apart by the rail', period: 'caribbean-1726', heroes: [], size: 'establishing', motion: { type: 'push_in', strength: 0.04, ease }, transition: cut, animate: true, sfx: 0, status: 'done', stale_reasons: [] },
  { id: 's062', section: 'r5', vo: 'The quartermaster is the man who counts those votes, divides the plunder and speaks for the crew when the captain will not.', prompt: 'Quartermaster writing shares in a ledger on a barrel head, men waiting in line behind him', period: 'caribbean-1726', heroes: ['quartermaster@ship-40'], size: 'detail', motion: { type: 'pan_left', strength: 0.08, ease: 'linear' }, transition: cut, animate: false, sfx: 1, status: 'done', stale_reasons: [] },
]

/** Правка VO у s004 — текст артборда поверх версии */
const ART_OVERRIDES: Record<string, Record<string, unknown>> = {
  s004: { vo: 'Twelve cartridges a trip, and every gun crew above you counts the seconds you are late.' },
}

/** Факт-чек артборда: два подтверждено, один спорно, один без источника (кадр s008 артборда — здесь s004) */
const ART_FACTS: EffectivePlan['facts'] = [
  { claim: 'Команда пиратского корабля выбирала капитана голосованием и могла его сместить.', status: 'verified', source_url: 'https://example.org/rediker/villains-of-all-nations', shot_id: 's061' },
  { claim: 'Пороховой погреб обшивали войлоком, работали без обуви с гвоздями.', status: 'verified', source_url: 'https://example.org/royal-navy/gunnery-1780', shot_id: 's003' },
  { claim: 'Юнгам-пороховщикам платили половину доли взрослого матроса.', status: 'disputed', source_url: 'https://example.org/articles/shares-1720', shot_id: 's004' },
  { claim: 'Слово powder monkey встречается в документах до 1700 года.', status: 'not_found', source_url: null, shot_id: 's001' },
]

function artboardPlan(episode: EpisodeListItem): EffectivePlan {
  return {
    ...mockPlan(episode, 'v003', 0),
    meta: { ...mockPlan(episode, 'v003', 0).meta, working_title: 'Every Rank on a Pirate Ship' },
    facts: ART_FACTS,
    sections: ART_SECTIONS,
    shots: ART_SHOTS.map((a) => ({
      ...planShot(1),
      id: a.id,
      section: a.section,
      vo: a.vo,
      image: { prompt: a.prompt, period: a.period, appearances: a.heroes, shot_size: a.size },
      motion: a.motion,
      transition_in: a.transition,
      animate: a.animate
        ? { recommended: true, reason: 'the motion carries the beat', prompt: 'slow camera move along the action', seconds: 4 }
        : { recommended: false, reason: null, prompt: null, seconds: 4 },
      sfx: Array.from({ length: a.sfx }, (_, i) => ({ prompt: `effect ${i + 1}`, offset: 0, duration: 2, gain_db: -18 })),
      status: a.status,
      stale_reasons: a.stale_reasons,
    })),
  }
}

/** Файл версии (`GET …/director/vNNN`) — план без состояния и правок */
function directorFile(plan: EffectivePlan): Director {
  return {
    schema: 'studio.director/1',
    meta: plan.meta,
    brief: { idea: plan.meta.working_title, angle: '', hook_promise: '' },
    sections: plan.sections,
    shots: plan.shots.map(({ id, section, vo, image, motion, transition_in, animate, sfx, overlay }) => ({
      id,
      section,
      vo,
      image,
      motion,
      transition_in,
      animate,
      sfx,
      overlay,
    })),
    thumbnail: { concepts: [] },
    publish: { titles: [], description: '', tags: [], category_id: '27', synthetic_media: true, made_for_kids: false },
    facts: plan.facts,
  }
}

/* ---- Смета, проверка, версия из JSON, утверждение (M4.7) ---- */

/** Цены маршрутов профиля standard из `config/pricing.yaml`, микродоллары: кадр 1K, знак голоса, секунда клипа 720p */
const PRICE = { image: 67_000, char: 100, second: 50_000 } as const

const ru = (n: number, [one, few, many]: readonly [string, string, string]) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many
const count = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')

const STAGE_TITLE: Record<EpisodeListItem['stage'], string> = {
  idea: 'Идея',
  script: 'Сценарий',
  generate: 'Генерация',
  edit: 'Монтаж',
  export: 'Экспорт',
  publish: 'Публикация',
}

/** JSON с ключами по алфавиту — сравнение плана «по хэшу», как `canonical_hash` бэкенда */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function estimateLine(title: string, label: string, stage: string, model: string, lines: EstimateLine['cost']['lines']): EstimateLine {
  const usd_micro = lines.reduce((sum, line) => sum + line.usd_micro, 0)
  return {
    title,
    label,
    usd: money(usd_micro),
    cost: { stage, provider: stage === 'images' || stage === 'animate' ? 'gemini' : 'elevenlabs', model, lines, usd_micro, stale_pricing: false },
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Мёрдж PATCH (`docs/project_schema.md`): словари рекурсивно, `null` — сброс поля, пустые блоки исчезают */
function mergeOverride(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key]
    else if (isPlainObject(value)) {
      const inner = mergeOverride(isPlainObject(merged[key]) ? merged[key] : {}, value)
      if (Object.keys(inner).length) merged[key] = inner
      else delete merged[key]
    } else merged[key] = value
  }
  return merged
}

function overlay<T>(base: T, override: Record<string, unknown>): T {
  if (!isPlainObject(base)) return base
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? overlay(out[key], value) : value
  }
  return out as T
}

const OVERRIDE_FIELDS: PlanShot['overridden'] = ['vo', 'image.prompt', 'image.shot_size', 'motion', 'transition_in', 'animate', 'sfx']

function overriddenOf(override: Record<string, unknown>): PlanShot['overridden'] {
  return OVERRIDE_FIELDS.filter((field) => {
    const [head, tail] = field.split('.') as [string, string | undefined]
    const value = override[head]
    return tail ? isPlainObject(value) && value[tail] !== undefined : value !== undefined
  })
}

/** Ответ со стилевым токеном отклоняется, как бэкендом (docs/bridge.md, «Приём ответа») */
export const STYLE_TOKEN = 'cinematic lighting'

const styleRefusal = (part: number): BridgeError => ({
  message: `Часть ${part} не прошла проверку: 1 ошибка.`,
  hint: 'Попросите чат исправить кадр s003 и прислать часть целиком.',
  errors: [
    {
      path: 's003',
      message:
        'кадр s003: в image.prompt стилевой токен «cinematic lighting» (lighting), ожидалось только действие, ' +
        'композиция и ракурс — стиль задаёт канон',
    },
  ],
})

interface PartsState {
  received: number[]
  lastRun: BridgeRun | null
}

export interface MockResponse {
  status: number
  body: unknown
}

const ok = (body: unknown, status = 200): MockResponse => ({ status, body })
const fail = (status: number, detail: string | Record<string, unknown>): MockResponse => ({ status, body: { detail } })

/** Расписание артборда: слот раз в два дня от 5 сентября (`docs/slots.md`, «Расписание») */
const ANCHOR = '2026-09-05'
const EVERY_DAYS = 2
const DAY_MS = 86_400_000

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)
const isoOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10)
const isSlotDate = (iso: string) => (dayNumber(iso) - dayNumber(ANCHOR)) % EVERY_DAYS === 0

/** Бэкенд в памяти: запрос → ответ по контенту артборда. Запись (создание, правка, слот) меняет копию выпусков,
 *  поэтому тест видит результат своей мутации. Общий для vitest (`stubApi`) и e2e (`page.route`). */
export function createMockApi() {
  const state: EpisodeListItem[] = structuredClone(episodes)
  let created = 0
  const projects = new Map<string, Project>()
  /** Версии плана без правок; правки — отдельно, как в project.json; действующий план — их наложение */
  const plans = new Map<string, EffectivePlan>()
  const overrides = new Map<string, Record<string, Record<string, unknown>>>()
  const partSets = new Map<string, PartsState>()
  let runs = 0

  const one = (id: string) => state.find((e) => e.id === id)

  /** Окно артборда поверх текущих выпусков: занятость — по `slot_date`, состояние — по правилам бэкенда
   *  (`docs/slots.md`, «Состояние»). Риск шаблона остаётся, только пока в слоте тот же выпуск. */
  function currentSlots(): Slot[] {
    return slots.map((template) => {
      const episode = state.find((e) => e.slot_date === template.date)
      if (episode?.id === template.episode_id) return template
      const slotState: Slot['state'] =
        episode?.status === 'published'
          ? 'published'
          : template.date === TODAY
            ? 'today'
            : template.date < TODAY
              ? 'missed'
              : episode
                ? 'filled'
                : 'empty'
      return { ...template, episode_id: episode?.id ?? null, channel: episode?.channel ?? null, state: slotState, risk: null }
    })
  }

  /** Проверки даты слота как у бэкенда: вне расписания — 422 с ближайшими, занят другим — 409 */
  function slotRefusal(id: string | null, date: string): MockResponse | null {
    if (!isSlotDate(date)) {
      const day = dayNumber(date)
      const before = day - ((day - dayNumber(ANCHOR)) % EVERY_DAYS + EVERY_DAYS) % EVERY_DAYS
      const nearest = [before - EVERY_DAYS, before, before + EVERY_DAYS, before + 2 * EVERY_DAYS].map(isoOf)
      return fail(422, { message: `${date} — не день слота: слоты раз в ${EVERY_DAYS} дня.`, nearest })
    }
    const holder = state.find((e) => e.slot_date === date && e.id !== id)
    if (!holder) return null
    return fail(
      409,
      `Слот ${formatSlotDate(date, { long: true })} занят выпуском «${holder.title}» (${holder.id}); снимите его со слота или выберите другой.`,
    )
  }

  /** Первый слот строго после сегодняшнего, в котором нет выпуска (как `next_free_slot` бэкенда) */
  function nextFree(): string {
    let day = dayNumber(TODAY) + 1
    while (!isSlotDate(isoOf(day)) || state.some((e) => e.slot_date === isoOf(day))) day += 1
    return isoOf(day)
  }

  /** project.json выпуска: создаётся при первом обращении, заявка — из `briefs` */
  function projectOf(episode: EpisodeListItem): Project {
    let project = projects.get(episode.id)
    if (!project) {
      const plan = plansOf(episode)
      project = {
        schema: 'studio.project/1',
        episode_id: episode.id,
        channel: episode.channel,
        brief: briefs[episode.id] ? structuredClone(briefs[episode.id]!) : null,
        director_version: plan?.version ?? null,
        director_versions: {},
        shots: {},
        assets: {},
        timings: {},
        cost: {},
        updated_at: NOW,
      }
      projects.set(episode.id, project)
    }
    return project
  }

  /** План в работе у «Пиратов» (стадия «Монтаж») — версия v003 по артборду 3; у остальных — нет */
  function plansOf(episode: EpisodeListItem): EffectivePlan | null {
    if (!plans.has(episode.id) && episode.id === 'pirate') {
      plans.set(episode.id, artboardPlan(episode))
      overrides.set(episode.id, structuredClone(ART_OVERRIDES))
    }
    return plans.get(episode.id) ?? null
  }

  /** Действующий план: версия плюс правки (бэкенд, M4.3) */
  function effectivePlan(episode: EpisodeListItem): EffectivePlan | null {
    const plan = plansOf(episode)
    if (!plan) return null
    const edits = overrides.get(episode.id) ?? {}
    return {
      ...plan,
      shots: plan.shots.map((shot) => {
        const edit = edits[shot.id] ?? {}
        return { ...overlay(shot, edit), overridden: overriddenOf(edit) }
      }),
    }
  }

  /** PATCH правок кадров: только кадры версии, проверки — как у кадра плана (пустой VO, стоп-лист) */
  function patchShots(episode: EpisodeListItem, shots: Record<string, { user_override?: Record<string, unknown> | null }>): MockResponse | null {
    const plan = plansOf(episode)
    const edits = overrides.get(episode.id) ?? {}
    const next = structuredClone(edits)
    const errors: { type: string; loc: (string | number)[]; msg: string }[] = []
    for (const [id, patch] of Object.entries(shots)) {
      if (!plan?.shots.some((shot) => shot.id === id)) {
        errors.push({ type: 'shot_not_in_plan', loc: ['shots', id], msg: `кадр ${id}: нет в плане ${plan?.version ?? '—'}, ожидалось id кадра текущей версии` })
        continue
      }
      if (!('user_override' in patch)) continue
      const merged = patch.user_override === null ? {} : mergeOverride(next[id] ?? {}, patch.user_override ?? {})
      const image = isPlainObject(merged.image) ? merged.image : {}
      if (typeof image.prompt === 'string' && image.prompt.includes(STYLE_TOKEN)) {
        errors.push({
          type: 'shot_override',
          loc: ['shots', id, 'user_override', 'image', 'prompt'],
          msg: `кадр ${id}: в image.prompt стилевой токен «cinematic lighting» (lighting), ожидалось только действие, композиция и ракурс — стиль задаёт канон`,
        })
      }
      if (typeof merged.vo === 'string' && !merged.vo.trim()) {
        errors.push({ type: 'shot_override', loc: ['shots', id, 'user_override', 'vo'], msg: `кадр ${id}: пустой vo, ожидалось текст закадрового голоса` })
      }
      if (Object.keys(merged).length) next[id] = merged
      else delete next[id]
    }
    if (errors.length) return { status: 422, body: { detail: errors } }
    overrides.set(episode.id, next)
    const project = projectOf(episode)
    for (const shot of plan?.shots ?? []) {
      project.shots[shot.id] = {
        status: shot.status,
        duration_locked: false,
        prompt_locked: false,
        user_override: next[shot.id] ?? null,
        stale_reasons: shot.stale_reasons,
      }
    }
    return null
  }

  function partsOf(episode: EpisodeListItem): PartsState {
    let parts = partSets.get(episode.id)
    if (!parts) {
      parts = { received: [], lastRun: null }
      partSets.set(episode.id, parts)
    }
    return parts
  }

  function planParts(episode: EpisodeListItem): PlanParts {
    const parts = partsOf(episode)
    const total = PARTS_TOTAL[episode.channel]
    const missing = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !parts.received.includes(n))
    return {
      parts_total: total,
      shots_per_part: SHOTS_PER_PART,
      received: [...parts.received],
      next_part: missing[0] ?? null,
      last_run: parts.lastRun,
    }
  }

  function run(episode: EpisodeListItem, part: number, status: BridgeRun['status'], errors: BridgeRun['errors'] = []): BridgeRun {
    runs += 1
    return {
      id: `run-${runs}`,
      task: 'plan',
      channel: episode.channel,
      episode_id: episode.id,
      target_id: null,
      prompt_id: part === 1 ? 'plan_first' : 'plan_next',
      prompt_version: 1,
      prompt_hash: `sha256:mock-${part}`,
      part,
      parts_total: PARTS_TOTAL[episode.channel],
      status,
      errors,
      created_at: NOW,
      answered_at: status === 'prompted' ? null : NOW,
    }
  }

  function planPrompt(episode: EpisodeListItem, part: number): MockResponse {
    if (!projectOf(episode).brief?.idea.trim()) {
      return fail(409, 'Сначала заполните заявку: без идеи чату не из чего писать план.')
    }
    const total = PARTS_TOTAL[episode.channel]
    const parts = partsOf(episode)
    const missing = Array.from({ length: part - 1 }, (_, i) => i + 1).filter((n) => !parts.received.includes(n))
    if (part > 1 && missing.length) {
      return fail(409, `Сначала вставьте ответ на часть ${missing[0]} — промпт части ${part} продолжает её.`)
    }
    const first = (part - 1) * SHOTS_PER_PART + 1
    parts.lastRun = run(episode, part, 'prompted')
    return ok({
      text: `Write part ${part} of ${total} of the director plan for episode ${episode.id}.`,
      prompt_id: part === 1 ? 'plan_first' : 'plan_next',
      version: 1,
      run_id: parts.lastRun.id,
      part,
      parts_total: total,
      first_shot: `s${String(first).padStart(3, '0')}`,
      last_shot: `s${String(first + SHOTS_PER_PART - 1).padStart(3, '0')}`,
    } satisfies PlanPrompt)
  }

  /** Ответ чата: часть — открытого обмена или следующая недостающая; на последней — новая версия плана */
  function planAnswer(episode: EpisodeListItem, text: string): MockResponse {
    const parts = partsOf(episode)
    const total = PARTS_TOTAL[episode.channel]
    const open = parts.lastRun?.status === 'prompted' ? parts.lastRun.part : null
    const part = open ?? planParts(episode).next_part ?? 1
    if (text.includes(STYLE_TOKEN)) {
      const refusal = styleRefusal(part)
      parts.lastRun = run(episode, part, 'failed', refusal.errors)
      return { status: 422, body: refusal }
    }
    if (part === 1) parts.received = []
    parts.received = [...new Set([...parts.received, part])].sort((a, b) => a - b)
    parts.lastRun = run(episode, part, 'applied')
    const missing = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !parts.received.includes(n))
    let importResult: PlanAnswerResult['import_result'] = null
    if (!missing.length) {
      const number = (plans.get(episode.id) ? Number(plans.get(episode.id)!.version.slice(1)) : 0) + 1
      const version = `v${String(number).padStart(3, '0')}`
      const shots = total * SHOTS_PER_PART
      plans.set(episode.id, mockPlan(episode, version, shots))
      projectOf(episode).director_version = version
      Object.assign(episode, {
        stage: episode.stage === 'idea' ? 'script' : episode.stage,
        summary: { ...episode.summary, shots_total: shots },
        updated_at: NOW,
      })
      parts.received = []
      importResult = { version, created: true, added: shots, changed: 0, removed: 0, changes: [] }
    }
    return ok({
      run_id: parts.lastRun.id,
      part,
      parts_total: total,
      shots_in_part: SHOTS_PER_PART,
      received: importResult ? Array.from({ length: total }, (_, i) => i + 1) : [...parts.received],
      next_part: missing[0] ?? null,
      import_result: importResult,
      warnings: [],
    } satisfies PlanAnswerResult)
  }

  /** Смета как у `plan_estimate` бэкенда: кадры, голос, клипы, план через мост; остаток месяца — от сводки расходов */
  function estimateOf(episode: EpisodeListItem): MockResponse {
    const plan = effectivePlan(episode)
    if (!plan) return fail(409, 'Плана ещё нет — смета появится, когда план будет собран: вставьте ответ чата или импортируйте JSON.')
    const shots = plan.shots.filter((shot) => shot.status !== 'removed')
    const chars = shots.reduce((sum, shot) => sum + shot.vo.length, 0)
    const clips = shots.filter((shot) => shot.animate.recommended)
    const seconds = clips.reduce((sum, shot) => sum + shot.animate.seconds, 0)
    const sameLength = new Set(clips.map((shot) => shot.animate.seconds)).size <= 1
    const clipWord = ru(clips.length, ['клип', 'клипа', 'клипов'])
    const lines = [
      estimateLine('Кадры', `${shots.length} × $0.067`, 'images', 'gemini-3.1-flash-image', [
        { unit: 'image', quantity: shots.length, variant: '1K', usd_micro: PRICE.image * shots.length },
      ]),
      estimateLine('Голос', `${count(chars)} ${ru(chars, ['знак', 'знака', 'знаков'])}`, 'voice', 'eleven_multilingual_v2', [
        { unit: 'char', quantity: chars, variant: null, usd_micro: PRICE.char * chars },
      ]),
      estimateLine(
        'Анимация',
        !clips.length ? `0 ${clipWord}` : sameLength ? `${clips.length} ${clipWord} × ${formatUsd(PRICE.second * (clips[0]?.animate.seconds ?? 0))}` : `${clips.length} ${clipWord}, ${seconds} с`,
        'animate',
        'veo-3.1-lite-generate-preview',
        [{ unit: 'second', quantity: seconds, variant: '720p', usd_micro: PRICE.second * seconds }],
      ),
      {
        title: 'План',
        label: 'Мост через чат',
        usd: money(0),
        cost: { stage: 'script', provider: 'bridge', model: 'chat', lines: [], usd_micro: 0, stale_pricing: false, via: 'bridge' as const },
      },
    ]
    const total = lines.reduce((sum, line) => sum + line.usd.usd_micro, 0)
    const animation = lines[2]!.usd.usd_micro
    const budgets = channels.find((c) => c.id === episode.channel)!.budgets
    const spent = costSummaries[episode.channel].budget
    const monthCommitted = spent.charged.usd_micro + spent.reserved.usd_micro + spent.queued.usd_micro
    const outlook = (level: 'month' | 'episode' | 'animation', limitUsd: number, committed: number, share: number) => {
      const limit = limitUsd * 1_000_000
      const left = limit - committed - share
      const exceeded = share > 0 && left < 0
      const title = { month: 'Месячный лимит', episode: 'Лимит на выпуск', animation: 'Лимит на анимацию выпуска' }[level]
      const message = exceeded
        ? `${title} ${formatUsd(limit)}: занято ${formatUsd(committed)}, смета ${formatUsd(share)} — не хватает ${formatUsd(-left)}; поднять лимит можно в настройках канала.`
        : { month: `Останется ${formatUsd(Math.max(left, 0))} из месячных ${formatUsd(limit)}`, episode: `Останется ${formatUsd(Math.max(left, 0))} из ${formatUsd(limit)} на выпуск`, animation: `Останется ${formatUsd(Math.max(left, 0))} из ${formatUsd(limit)} на анимацию` }[level]
      return { level, limit: money(limit), committed: money(committed), estimate: money(share), remaining: money(Math.max(left, 0)), exceeded, message }
    }
    const outlooks = [
      outlook('month', budgets.monthly_usd, monthCommitted, total),
      outlook('episode', budgets.per_episode_usd, episode.summary.spent_usd_micro, total),
      outlook('animation', budgets.animation_usd, 0, animation),
    ]
    return ok({
      version: plan.version,
      plan_source: 'bridge',
      lines,
      total: money(total),
      budgets: outlooks,
      warnings: outlooks.filter((o) => o.exceeded).map((o) => o.message),
      stale_pricing: false,
    } satisfies PlanEstimate)
  }

  /** Проверка плана, как у `director/validate`: план для этого выпуска, VO не пусто, в промпте нет стоп-слов */
  function checkDirector(episode: EpisodeListItem, body: unknown): ValidationItem[] {
    if (!isPlainObject(body)) return [{ shot_id: null, path: '', message: 'План — объект JSON' }]
    const items: ValidationItem[] = []
    const meta = isPlainObject(body.meta) ? body.meta : {}
    if (meta.episode_id !== episode.id) {
      items.push({ shot_id: null, path: 'meta.episode_id', message: `meta: episode_id «${String(meta.episode_id)}» — план для другого выпуска, ожидалось «${episode.id}»` })
    }
    for (const shot of Array.isArray(body.shots) ? body.shots : []) {
      if (!isPlainObject(shot)) continue
      const id = String(shot.id)
      if (typeof shot.vo !== 'string' || !shot.vo.trim()) {
        items.push({ shot_id: id, path: 'vo', message: `кадр ${id}: пустой vo, ожидалось текст закадрового голоса` })
      }
      const image = isPlainObject(shot.image) ? shot.image : {}
      if (typeof image.prompt === 'string' && image.prompt.includes(STYLE_TOKEN)) {
        items.push({
          shot_id: id,
          path: 'image.prompt',
          message: `кадр ${id}: в image.prompt стилевой токен «cinematic lighting» (lighting), ожидалось только действие, композиция и ракурс — стиль задаёт канон`,
        })
      }
    }
    return items
  }

  /** «Сохранить как версию»: тот же план — версия не создаётся; иначе vNNN+1 `manual`, стадия `generate` → `script` */
  function saveVersion(episode: EpisodeListItem, body: unknown): MockResponse {
    const items = checkDirector(episode, body)
    if (items.length) return fail(422, { errors: items.map((item) => item.message), items })
    const current = plansOf(episode)
    const director = body as Director
    if (current && canonical(directorFile(current)) === canonical(director)) {
      return ok({ version: current.version, created: false, added: 0, changed: 0, removed: 0, changes: [] } satisfies ImportResult)
    }
    const version = `v${String((current ? Number(current.version.slice(1)) : 0) + 1).padStart(3, '0')}`
    const before = new Map((current?.shots ?? []).map((shot) => [shot.id, shot]))
    const shots = director.shots.map((shot) => ({
      ...planShot(1),
      ...shot,
      status: before.get(shot.id)?.status ?? 'queued',
      stale_reasons: [],
      overridden: [],
    })) as PlanShot[]
    plans.set(episode.id, {
      version,
      source: 'manual',
      approved_version: current?.approved_version ?? null,
      // Тело — файл версии из редактора: поля с умолчанием в нём уже есть
      meta: director.meta as EffectivePlan['meta'],
      sections: director.sections as EffectivePlan['sections'],
      shots,
      facts: (director.facts ?? []).map((fact) => ({ ...fact, source_url: fact.source_url ?? null })),
    })
    projectOf(episode).director_version = version
    if (episode.stage === 'generate') Object.assign(episode, { stage: 'script', updated_at: NOW })
    const ids = new Set(shots.map((shot) => shot.id))
    const added = shots.filter((shot) => !before.has(shot.id)).length
    const removed = [...before.keys()].filter((id) => !ids.has(id)).length
    const changed = shots.filter((shot) => before.has(shot.id) && canonical(before.get(shot.id)!.vo) !== canonical(shot.vo)).length
    return ok({ version, created: true, added, changed, removed, changes: [] } satisfies ImportResult)
  }

  /** «Утвердить план», как бэкенд M4.6: стадия до генерации, план есть, у кадров VO и промпт; повтор — без изменений */
  function approve(episode: EpisodeListItem): MockResponse {
    const plan = effectivePlan(episode)
    const problems: ApprovalProblem[] = []
    if (!['idea', 'script', 'generate'].includes(episode.stage)) {
      problems.push({ check: 'stage', shot_id: null, message: `Выпуск уже на стадии «${STAGE_TITLE[episode.stage]}» — план утверждается до начала генерации.` })
    }
    if (!plan) problems.push({ check: 'plan', shot_id: null, message: 'Плана ещё нет — скопируйте промпт части 1 и вставьте ответ чата.' })
    for (const shot of plan?.shots ?? []) {
      if (shot.status === 'removed') continue
      if (!shot.vo.trim()) problems.push({ check: 'vo', shot_id: shot.id, message: `кадр ${shot.id}: пустой VO — допишите текст закадрового голоса` })
      if (!shot.image.prompt.trim()) problems.push({ check: 'prompt', shot_id: shot.id, message: `кадр ${shot.id}: пустой промпт — опишите действие и композицию` })
    }
    if (problems.length) {
      const parts = problems.filter((p) => p.shot_id === null).map((p) => p.message)
      const groups = new Map<string, string[]>()
      for (const p of problems) if (p.shot_id) groups.set(p.check, [...(groups.get(p.check) ?? []), p.shot_id])
      const summaries = [...groups].map(([check, ids]) => `${ids.length} ${ru(ids.length, ['кадр', 'кадра', 'кадров'])} ${check === 'vo' ? 'без VO' : 'без промпта'}: ${ids.join(', ')}`)
      if (summaries.length) parts.push(`${summaries.join('; ')} — допишите на листе сценария или в таблице плана и утвердите снова.`)
      return fail(409, { code: 'plan_not_ready', message: parts.join(' '), problems } satisfies ApprovalRefusal)
    }
    const base = plansOf(episode)!
    if (base.approved_version === base.version && episode.stage === 'generate') return ok(episode)
    base.approved_version = base.version
    Object.assign(projectOf(episode), { approved_version: base.version, approved_at: NOW, updated_at: NOW })
    Object.assign(episode, { stage: 'generate', updated_at: NOW })
    return ok(episode)
  }

  function handle(method: string, url: string, body?: unknown): MockResponse {
    const { pathname, searchParams } = new URL(url, 'http://studio.test')
    const path = pathname.replace(/^\/api/, '')
    const channel = searchParams.get('channel') as ChannelId | null
    const parts = path.split('/').filter(Boolean)

    if (method === 'GET' && path === '/channels') return ok(channels)
    if (method === 'GET' && path === '/episodes') return ok(channel ? state.filter((e) => e.channel === channel) : state)
    if (method === 'GET' && path === '/slots') return ok(currentSlots())
    if (method === 'GET' && path === '/jobs') return ok(jobs)
    if (method === 'GET' && path === '/bridge/settings') return ok(bridgeSettings)
    if (method === 'GET' && path === '/cost/summary') {
      return channel && costSummaries[channel] ? ok(costSummaries[channel]) : fail(422, 'Неизвестный канал.')
    }
    if (method === 'GET' && path === '/formats') {
      return channel && formats[channel] ? ok(formats[channel]) : fail(422, 'Неизвестный канал.')
    }
    if (method === 'POST' && path === '/episodes') {
      const request = body as EpisodeCreate
      const slot = request.slot === null ? null : request.slot && request.slot !== 'next_free' ? request.slot : nextFree()
      const refusal = slot === null ? null : slotRefusal(null, slot)
      if (refusal) return refusal
      created += 1
      const episode: EpisodeListItem = {
        id: request.id ?? `${request.channel[0]}${String(10 + created).padStart(2, '0')}`,
        channel: request.channel,
        title: request.title ?? 'Новый выпуск',
        short_title: request.short_title ?? null,
        origin: request.origin ?? 'blank',
        stage: request.origin === 'backlog' ? 'idea' : 'script',
        status: 'queued',
        slot_date: slot,
        created_at: NOW,
        updated_at: NOW,
        summary: summary({}),
      }
      state.push(episode)
      return ok(episode, 201)
    }
    if (parts[0] === 'episodes' && parts[1]) {
      const episode = one(decodeURIComponent(parts[1]))
      if (!episode) return fail(404, `Выпуск «${parts[1]}» не найден.`)
      if (method === 'GET' && parts.length === 2) return ok(episode)
      if (method === 'PATCH' && parts.length === 2) {
        Object.assign(episode, body as EpisodePatch, { updated_at: NOW })
        return ok(episode)
      }
      if (method === 'POST' && parts[2] === 'approve') return approve(episode)
      if (method === 'PUT' && parts[2] === 'slot') {
        const { date } = body as SlotAssign
        const refusal = date === null ? null : slotRefusal(episode.id, date)
        if (refusal) return refusal
        if (episode.slot_date !== date) Object.assign(episode, { slot_date: date, updated_at: NOW })
        return ok(episode)
      }
    }
    if (parts[0] === 'projects' && parts[1]) {
      const episode = one(decodeURIComponent(parts[1]))
      if (!episode) return fail(404, `Выпуск «${parts[1]}» не найден.`)
      const rest = parts.slice(2).join('/')
      if (method === 'GET' && rest === '') return ok(projectOf(episode))
      if (method === 'PATCH' && rest === '') {
        const project = projectOf(episode)
        const patch = body as { brief?: Partial<EpisodeBrief> | null; shots?: Record<string, { user_override?: Record<string, unknown> | null }> }
        if (patch.shots) {
          const refusal = patchShots(episode, patch.shots)
          if (refusal) return refusal
        }
        if ('brief' in patch) project.brief = patch.brief === null ? null : { ...(project.brief ?? emptyBrief), ...patch.brief }
        project.updated_at = NOW
        return ok(project)
      }
      if (method === 'GET' && rest === 'plan') return ok(effectivePlan(episode))
      if (method === 'GET' && rest === 'estimate') return estimateOf(episode)
      if (method === 'POST' && rest === 'director/validate') {
        const items = checkDirector(episode, body)
        return ok({ ok: !items.length, errors: items.map((item) => item.message), items } satisfies PlanCheck)
      }
      if (method === 'POST' && rest === 'director') return saveVersion(episode, body)
      if (method === 'GET' && parts[2] === 'director' && parts[3]) {
        const plan = plansOf(episode)
        return plan && plan.version === parts[3] ? ok(directorFile(plan)) : fail(404, `Версия ${parts[3]} плана выпуска «${episode.id}» не найдена.`)
      }
      if (method === 'GET' && rest === 'plan/parts') return ok(planParts(episode))
      if (method === 'POST' && rest === 'plan/prompt') return planPrompt(episode, Number(searchParams.get('part') ?? 1))
      if (method === 'POST' && rest === 'plan/answer') return planAnswer(episode, (body as { text: string }).text)
    }
    return fail(404, `Мок API не знает ${method} ${path}.`)
  }

  return { handle, episodes: state, projects }
}

export type MockApi = ReturnType<typeof createMockApi>
