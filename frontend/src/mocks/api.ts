/* Ответы API с контентом артборда 1 «Выпуски» (сентябрь 2026, «сегодня» — пятница, 11 сентября) — для vitest и e2e
   (`page.route`, M3.7). Формы — сгенерированные типы через `satisfies`: смена модели на бэкенде ломает сборку тестов,
   а не молча моки. Числа — как в артборде, иначе сверка скриншотов даст шум (приём M1.3).
   В production-код не импортируется (решение 7 устава M3). */
import type { ChannelProfile, FormatPreview } from '@/types/channel'
import type { BudgetRefusal, CostSummary, Money } from '@/types/cost'
import type { EpisodeCreate, EpisodeListItem, EpisodePatch, EpisodeSummary } from '@/types/episode'
import type { BridgeError, BridgeRun, BridgeSettings } from '@/types/bridge'
import type {
  AnchorSetState,
  AnchorSlot,
  AnchorsEstimate,
  Appearance,
  CanonNeeded,
  CanonSummary,
  CanonVersionInfo,
  Character,
  NeededItem,
  Period,
  PeriodAnswerResult,
  PeriodConflict,
  PeriodPrompt,
  Style,
  Swatch,
} from '@/types/canon'
import type { Director } from '@/types/director'
import type { StageCatalog } from '@/types/provider'
import type { RedrawEstimate } from '@/types/shot_redraw'
import type { BatchEstimate, BatchRefusal, BatchResult, BatchSummary, SkippedShot } from '@/types/batch'
import type { Idea, IdeaCreate, IdeaPatch, IdeasAnswerResult, IdeasPrompt } from '@/types/idea'
import type { Job, JobList } from '@/types/job'
import type {
  AnchorSheet,
  ApprovalProblem,
  ApprovalRefusal,
  CanonProblem,
  CanonTarget,
  EffectivePlan,
  EpisodeAppearanceItem,
  EpisodeCanon,
  EpisodeCanonItem,
  EstimateLine,
  PlanAnswerResult,
  PlanCheck,
  PlanEstimate,
  PlanParts,
  PlanPrompt,
  PlanShot,
  PromptProblem,
  PromptRef,
  PromptSection,
  ShotChange,
  ShotPrompt,
  SimilarityReport,
  ValidationItem,
} from '@/types/plan'
import type { ReferenceAnalysis, ReferenceMetrics, ReferenceVideo } from '@/types/reference'
import type { Asset, EpisodeBrief, FaceCheck, ImportResult, Project, ShotImages, ShotState } from '@/types/project'
import type { CheckEstimate } from '@/types/check'
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
    // Семена ниши артборда 2; у Otto семян нет — пустой список
    seeds: ['every rank', 'medieval life', 'pirates', 'ancient jobs', 'monasteries'],
    checks: { anachronism: true },
  },
  {
    id: 'otto',
    name: "Otto's Timeline",
    format: 'host',
    budgets: { monthly_usd: 100, per_episode_usd: 8, animation_usd: 3 },
    voice_quota: { limit_chars: 600_000 },
    voice: { voice_id: 'unset', pace_wpm: null },
    seeds: [],
    checks: { anachronism: true },
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
      channel: null,
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

/* ---- Кадры «Пиратов» по артборду 4: сетка, версии, пачка 78 из 104 (M6.7) ---- */

/** Кадр 1K маршрута nb2 из `config/pricing.yaml`, микродоллары */
const PRICE_IMAGE = 67_000

/** Разделы артборда 4 и число кадров: 104 кадра, 8 разделов */
const GEN_SECTIONS: [id: string, title: string, shots: number][] = [
  ['cold', 'Cold open', 6],
  ['powder', 'Powder monkey', 15],
  ['landsman', 'Landsman', 13],
  ['able', 'Able seaman', 14],
  ['boatswain', 'Boatswain', 13],
  ['quartermaster', 'Quartermaster', 16],
  ['captain', 'Captain', 19],
  ['outro', 'Outro', 8],
]
/** Облик раздела — пять «you@…» канона моков (у квартирмейстера листа нет, у боцмана — 3 из 6); капитан и финал —
 *  общие планы без персонажа */
const GEN_LOOKS: Record<string, string> = {
  cold: 'you@powder-monkey-11',
  powder: 'you@powder-monkey-11',
  landsman: 'you@landsman-19',
  able: 'you@able-seaman-23',
  boatswain: 'you@boatswain-34',
  quartermaster: 'you@quartermaster-41',
}
export const GEN_BATCH = 'batch-pirate'
/** Пачка артборда: s001–s080 закончены (s047 и s071 — отказ фильтра), s081–s083 рисуются, остальные в очереди */
const GEN_FINISHED = 80
const GEN_RUNNING = 83
const GEN_FAILED: ReadonlySet<string> = new Set(['s047', 's071'])
const GEN_STARTED = '2026-09-11T09:00:00+00:00'
/** Остаток пачки — секунд на кадр при трёх параллельных: 24 кадра → «осталось ~9 мин» */
const GEN_SECONDS_PER_SHOT = 22.5
/** Цена единицы в подписи каталога и сметы — до десятых цента, как `format_unit_usd` бэкенда */
const unitMoney = (usd_micro: number): Money => ({ usd_micro, usd: `$${(usd_micro / 1_000_000).toFixed(3).replace(/0$/, '')}` })

/** Каталог `images`, как `GET /api/providers/catalog/images`: порядок и подписи — `config/providers.yaml`, цены
 *  картинки 1K/2K — `config/pricing.yaml`; по умолчанию — профиль standard */
export const IMAGE_CATALOG = {
  stage: 'images',
  kind: 'image',
  default: 'nb2',
  models: [
    { key: 'nb2-lite', label: 'Nano Banana 2 Lite', model: 'gemini-3.1-flash-lite-image', unit: 'image', price: unitMoney(34_000) },
    { key: 'nb2', label: 'Nano Banana 2', model: 'gemini-3.1-flash-image', unit: 'image', price: unitMoney(PRICE_IMAGE) },
    { key: 'nb2-2k', label: 'Nano Banana 2 · 2K', model: 'gemini-3.1-flash-image', unit: 'image', price: unitMoney(101_000) },
    { key: 'nb-pro', label: 'Nano Banana Pro', model: 'gemini-3-pro-image', unit: 'image', price: unitMoney(134_000) },
  ],
} satisfies StageCatalog
type CatalogEntry = StageCatalog['models'][number]

/** `error` джоба, как у воркера (`jobs/worker.py::describe`): «<ТипОшибки>: <текст>»; у кадра — текст без типа */
const jobError = (text: string) => `ProviderError: ${text}`

export const SAFETY_REFUSAL =
  'Gemini не нарисовал картинку (IMAGE_SAFETY) — сработал фильтр безопасности: насилие и опасные действия — смягчите действие кадра.'

/** Версии кадра артборда: у каждого третьего три (выбрана вторая), у чётного две, у остальных одна */
const genVersions = (n: number) => (n % 3 === 0 ? 3 : n % 2 === 0 ? 2 : 1)

/** Кадр режима «Сравнение версий» артборда 4: три версии, выбрана вторая; модель — индекс каталога, сходство лица
 *  с фасом облика — «среднее», «высокое», «высокое» (порог 0.47, запас 0.10). Время — 11:41, 11:58, 12:24 МСК */
export const GEN_COMPARE = 's061'
const GEN_COMPARE_VERSIONS: { model: number; seed: number; at: string; score: number }[] = [
  { model: 1, seed: 418_902, at: '2026-09-11T08:41:00+00:00', score: 0.52 },
  { model: 1, seed: 771_344, at: '2026-09-11T08:58:00+00:00', score: 0.71 },
  { model: 3, seed: 905_117, at: '2026-09-11T09:24:00+00:00', score: 0.66 },
]

/** Цена вопроса к VLM об анахронизмах одного кадра (M6.10): оценка сверху, как `anachronism.estimate` бэкенда */
const CHECK_QUESTION = 900
const CHECK_PERIOD = 'periods/caribbean-1716/v001'
/** Пометки проверок «Пиратов» (M6.10): три лица ниже порога, один анахронизм, лиц не нашлось на двух общих планах */
const GEN_LOW: Record<string, number> = { s012: 0.21, s028: 0.33, s044: 0.41 }
const GEN_SUSPECT: Record<string, string[]> = { s019: ['wristwatches', 'zippers'] }
const GEN_NO_FACE: ReadonlySet<string> = new Set(['s003', 's015'])

/** Проверки выбранной версии кадра артборда: лицо облика (сходство 0.55…0.80, `low`, `no_face`) и анахронизмы */
function genChecks(shot: string, n: number, appearance: string | undefined): Asset['checks'] {
  const checked_at = GEN_STARTED
  const found = GEN_SUSPECT[shot] ?? []
  const anachronism = { status: found.length ? ('suspect' as const) : ('ok' as const), found, period: CHECK_PERIOD, usd_micro: 163, checked_at }
  if (!appearance) return { anachronism }
  const low = GEN_LOW[shot]
  const face: FaceCheck = GEN_NO_FACE.has(shot)
    ? { status: 'no_face', appearances: [{ id: appearance, status: 'no_face', score: null }], faces: 0, threshold: 0.47, checked_at }
    : {
        status: low === undefined ? 'ok' : 'low',
        appearances: [{ id: appearance, status: low === undefined ? 'ok' : 'low', score: low ?? (found.length ? 0.62 : 0.55 + ((n * 7) % 26) / 100) }],
        faces: 1,
        threshold: 0.47,
        checked_at,
      }
  return { face, anachronism }
}

/** Версия s061 с метаданными артборда и проверкой лица облика раздела */
function compareAsset(shot: string, version: number, appearance: string): Asset {
  const meta = GEN_COMPARE_VERSIONS[version - 1]!
  const face = {
    status: 'ok' as const,
    appearances: [{ id: appearance, status: 'ok' as const, score: meta.score, front: 'front-1-mock' }],
    faces: 1,
    threshold: 0.47,
    checked_at: meta.at,
  }
  return { ...imageAsset(shot, version, IMAGE_CATALOG.models[meta.model]!), seed: meta.seed, created_at: meta.at, checks: { face } }
}

/** План v004 артборда 4: утверждён, кадры по разделам, VO и действие — по кругу из трёх фраз */
function generationPlan(episode: EpisodeListItem): EffectivePlan {
  const base = mockPlan(episode, 'v004', 0)
  let n = 0
  const shots = GEN_SECTIONS.flatMap(([section, , count]) =>
    Array.from({ length: count }, (): PlanShot => {
      n += 1
      const look = GEN_LOOKS[section]
      return {
        ...planShot(n),
        section,
        image: { prompt: 'carries a leather cartridge case down the gun deck', period: 'caribbean-1716', appearances: look ? [look] : [], shot_size: 'action' },
        status: 'todo',
      }
    }),
  )
  return {
    ...base,
    approved_version: 'v004',
    meta: { ...base.meta, working_title: 'Every Rank on a Pirate Ship', parts_total: 4 },
    sections: GEN_SECTIONS.map(([id, title]) => ({ id, title, chapter: id !== 'cold' && id !== 'outro', vo_direction: null })),
    shots,
  }
}

function imageAsset(shot: string, version: number, entry: CatalogEntry = IMAGE_CATALOG.models[1]!): Asset {
  return {
    id: `img-${shot}-v${version}`,
    shot_id: shot,
    kind: 'image',
    version,
    path: `media/${shot}/v${String(version).padStart(3, '0')}.png`,
    hash: `sha256:${shot}${version}`,
    status: 'ok',
    model: entry.key,
    model_id: entry.model,
    seed: 1900 + version,
    variant: version,
    usd_micro: entry.price.usd_micro,
    created_at: GEN_STARTED,
    cached: false,
    checks: null,
  }
}

const shotState = (fields: Partial<ShotState>): ShotState => ({
  status: 'todo',
  image_version: null,
  duration_locked: false,
  prompt_locked: false,
  user_override: null,
  stale_reasons: [],
  error: null,
  ...fields,
})

/** Джоб кадра пачки или одиночной перерисовки (`batchId` null — тогда `id` задаёт вызывающий) */
function shotJob(
  episodeId: string,
  batchId: string | null,
  shot: string,
  status: Job['status'],
  order: { id?: string; model?: CatalogEntry; variant?: number } = {},
): Job {
  const entry = order.model ?? IMAGE_CATALOG.models[1]!
  const started = status === 'queued' ? null : GEN_STARTED
  const finished = status === 'done' || status === 'failed' || status === 'cancelled' ? GEN_STARTED : null
  return {
    id: order.id ?? `job-${batchId}-${shot}`,
    kind: 'shot_image',
    status,
    progress: status === 'done' ? 1 : status === 'running' ? 0.5 : 0,
    message: status === 'running' ? `Кадр ${shot} · рисуется` : null,
    payload: { shot_id: shot, variant: order.variant ?? 1, model: entry.key },
    result: null,
    error: status === 'failed' ? jobError(SAFETY_REFUSAL) : null,
    attempts: started ? 1 : 0,
    cancel_requested: false,
    episode_id: episodeId,
    batch_id: batchId,
    idempotency_key: null,
    created_at: GEN_STARTED,
    started_at: started,
    finished_at: finished,
    cost_usd_micro: entry.price.usd_micro,
    cost_stage: 'images',
    channel: null,
  }
}

/** Строка пачки — как таблица `batches` бэкенда; счётчики и деньги сводки считаются по её джобам */
interface MockBatch {
  id: string
  episode_id: string
  created_at: string
  paused: boolean
  cancelled: boolean
  /** Ключ каталога на пачку; нет — профиль по умолчанию */
  model?: string
}

/* ---- Смета, проверка, версия из JSON, утверждение (M4.7) ---- */

/** Цены маршрутов профиля standard из `config/pricing.yaml`, микродоллары: кадр 1K, знак голоса, секунда клипа 720p */
const PRICE = { image: PRICE_IMAGE, char: 100, second: 50_000 } as const

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
    cost: { stage, provider: ['images', 'animate', 'anchors'].includes(stage) ? 'gemini' : 'elevenlabs', model, lines, usd_micro, stale_pricing: false },
  }
}

/* ---- Идеи артборда 2 и бэклог (M4.9) ---- */

const idea = (n: number, fields: Partial<Idea> & Pick<Idea, 'channel' | 'title' | 'status'>): Idea => ({
  id: `i${String(n).padStart(4, '0')}`,
  angle: '',
  hook_promise: '',
  summary: '',
  score: null,
  score_reason: null,
  source: 'bridge',
  episode_id: null,
  created_at: `2026-09-${String(n).padStart(2, '0')}T09:00:00+00:00`,
  updated_at: `2026-09-${String(n).padStart(2, '0')}T09:00:00+00:00`,
  ...fields,
})

/** «Идеи из кластеров» артборда — предложения чата (`proposed`), Арсенал уже в бэклоге; бэклог Cursus — 7 идей, как
 *  «Бэклог: 7 идей» в шапке артборда; одна убранная */
export const IDEAS: Idea[] = [
  idea(1, { channel: 'cursus', status: 'backlog', title: 'Every Rank in a Roman Legion', score: 79, score_reason: 'Узнаваемая иерархия, сильный визуал', angle: 'От новобранца-тирона до легата: восемь ступеней и одна лопата на всех.', source: 'manual' }),
  idea(2, { channel: 'cursus', status: 'backlog', title: 'Every Rank in a Royal Kitchen', score: 71, angle: 'Кухня дворца как армия: поварята, вертельщики, кондитер и главный повар с ключом от специй.' }),
  idea(3, { channel: 'cursus', status: 'backlog', title: 'Every Rank in the Venetian Arsenal', score: 77, score_reason: 'Конвейер в XVI веке — неожиданно и наглядно', angle: 'Государственная верфь как конвейер: галера в день, двенадцать тысяч рабочих, отдельная каста мастеров-корабелов с пожизненным контрактом.', hook_promise: 'Как Венеция строила галеру за день', summary: 'От носильщика досок до адмирала Арсенала.' }),
  idea(4, { channel: 'cursus', status: 'backlog', title: 'Every Rank in a Hanseatic Kontor', score: 64, angle: 'Купеческая контора в Бергене: ученики живут взаперти семь лет.' }),
  idea(5, { channel: 'cursus', status: 'backlog', title: 'Every Rank in a Viking Longship', source: 'manual', angle: 'Гребцы, кормчий и хёвдинг: кто делит добычу и как.' }),
  idea(6, { channel: 'cursus', status: 'backlog', title: 'Every Rank in a Coal Mine (1840)', score: 58, angle: 'Дети-трапперы у дверей штольни и хозяин, который в шахту не спускается.' }),
  idea(7, { channel: 'cursus', status: 'backlog', title: 'Every Rank in a Spanish Treasure Fleet', score: 66, angle: 'Серебро из Нового Света: от юнги до генерала флота.' }),
  idea(8, { channel: 'cursus', status: 'dropped', title: 'Every Rank in a Lighthouse Service', score: 41, angle: 'Слишком мало ступеней на часовой ролик.' }),
  idea(9, { channel: 'cursus', status: 'proposed', title: 'Every Rank in a Medieval Monastery (Oblate to Abbot)', score: 81, score_reason: 'Мало похожих роликов, сильный хук', angle: 'Монастырь как вертикаль власти: мальчик-облат, послушник, брат, приор, аббат. Каждая ступень — своя доля хлеба, свой час подъёма и своё право голоса в капитуле.', hook_promise: 'Почему у мальчика в монастыре не было права голоса', summary: 'Пять ступеней монастырской вертикали.' }),
  idea(10, { channel: 'cursus', status: 'proposed', title: 'Every Rank in a Cathedral Build (Mortar Boy to Master Mason)', score: 74, score_reason: 'Стройка на сто лет — понятная драма', angle: 'Стройка длиной в сто лет: кто мешает раствор, кто режет камень, кто держит чертёж. Разница в оплате за день — три порядка.' }),
  idea(11, { channel: 'otto', status: 'proposed', title: 'I Survived a Day as a Monastery Oblate (1180)', score: 68, angle: 'Тот же кластер для Отто: сутки по расписанию монастырских часов, восемь служб, разговоры только знаками.' }),
  idea(12, { channel: 'otto', status: 'backlog', title: 'A Day in Pompeii Before the Eruption', score: 70, source: 'manual' }),
]

/* ---- Референс артборда 2 (M4.11): «Every Rank on a Roman Warship», 22:41, 10 сегментов ---- */

type Kind = ReferenceAnalysis['segments'][number]['kind']

/** Сегменты артборда: вид, подпись, длительность в секундах, фактов */
const WARSHIP: [Kind, string, number, number][] = [
  ['hook', 'Хук', 22, 1],
  ['promise', 'Обещание', 43, 2],
  ['rank', 'Ранг 1', 168, 12],
  ['retention', 'Крючок', 26, 0],
  ['rank', 'Ранг 2', 196, 13],
  ['rank', 'Ранг 3', 214, 13],
  ['retention', 'Крючок', 31, 1],
  ['rank', 'Ранг 4', 232, 14],
  ['rank', 'Ранг 5', 258, 8],
  ['finale', 'Финал', 171, 3],
]

/** Метрики как у `metrics()` бэкенда; слова сегмента — по его доле длительности (у мока нет реплик) */
function metricsOf(analysis: ReferenceAnalysis, duration: number, words: number, norm: number): ReferenceMetrics {
  const starts = analysis.segments.map((seg) => seg.start)
  const rows = analysis.segments.map((seg, i) => {
    const length = (starts[i + 1] ?? duration) - seg.start
    const segWords = Math.round((words * length) / duration)
    return {
      index: i + 1,
      kind: seg.kind,
      label: seg.label,
      start_s: seg.start,
      duration_s: length,
      words: segWords,
      pace_wpm: Math.round((segWords / (length / 60)) * 10) / 10,
      facts: seg.facts,
      facts_per_min: Math.round((seg.facts / (length / 60)) * 100) / 100,
    }
  })
  const factsTotal = rows.reduce((sum, row) => sum + row.facts, 0)
  const perMin = factsTotal / (duration / 60)
  const holding = rows.filter((row) => perMin && row.facts / (row.duration_s / 60) >= 0.7 * perMin)
  const last = holding[holding.length - 1]
  const pace = words / (duration / 60)
  return {
    duration_s: duration,
    words,
    pace_wpm: Math.round(pace * 10) / 10,
    norm_wpm: norm,
    pace_delta: Math.round(((pace - norm) / norm) * 1000) / 1000,
    facts_total: factsTotal,
    facts_per_min: Math.round(perMin * 100) / 100,
    holds_until_s: last ? last.start_s + last.duration_s : null,
    retention_hooks_s: rows.filter((row) => row.kind === 'retention').map((row) => row.start_s),
    segments_total: rows.length,
    ranks_total: rows.filter((row) => row.kind === 'rank').length,
    segments: rows,
  }
}

const WARSHIP_ANALYSIS: ReferenceAnalysis = {
  title: 'Every Rank on a Roman Warship',
  author: 'Gradus',
  topic: 'How rank, pay and danger were split on a Roman war galley',
  segments: WARSHIP.reduce<ReferenceAnalysis['segments']>((list, [kind, label, , facts], i) => {
    const start = WARSHIP.slice(0, i).reduce((sum, [, , length]) => sum + length, 0)
    return [...list, { kind, label, start, facts }]
  }, []),
  // Приёмы подачи артборда
  techniques: [
    { text: 'Ранг называется голосом и повторяется в конце блока', count: 10 },
    { text: 'Возврат к одному герою между рангами', count: 6 },
    { text: 'Цена ошибки: что бывает, если не справился', count: 5 },
    { text: 'Сравнение жалованья в конце каждого ранга', count: 9 },
  ],
}

/** Начало текста субтитров — материал чужой, на экране только превью */
const WARSHIP_SUBTITLES =
  '1\n00:00:00,000 --> 00:00:05,200\nYou are seventeen, and the navy hands you an oar.\n\n2\n00:00:05,200 --> 00:00:11,000\nThree hundred men pull below deck and none of them can see.\n'

export const REFERENCES: ReferenceVideo[] = [
  {
    id: 'ref0001',
    channel: 'cursus',
    url: 'youtube.com/watch?v=gradus-roman-warship',
    title: WARSHIP_ANALYSIS.title,
    author: WARSHIP_ANALYSIS.author,
    duration_s: 1361,
    cues: 412,
    subtitles: WARSHIP_SUBTITLES,
    analysis: WARSHIP_ANALYSIS,
    metrics: metricsOf(WARSHIP_ANALYSIS, 1361, 3357, 150),
    created_at: `${TODAY}T08:50:00+00:00`,
    analyzed_at: `${TODAY}T08:54:00+00:00`,
  },
]

const NO_TIMECODES = 'Не похоже на субтитры: нет таймкодов. Вставьте SRT, VTT или расшифровку с YouTube.'
const clockSeconds = (text: string) => {
  const parts = text.split(':').map(Number)
  return parts.reduce((sum, part) => sum * 60 + part, 0)
}

const IDEA_STATUS: Record<Idea['status'], string> = { proposed: 'предложена', backlog: 'в бэклоге', used: 'взята в выпуск', dropped: 'отброшена' }
const IDEA_MOVES: Record<Idea['status'], Idea['status'][]> = { proposed: ['backlog', 'dropped'], backlog: ['dropped'], dropped: ['backlog'], used: [] }
const titleKey = (title: string) => title.toLowerCase().split(/\s+/).filter(Boolean).join(' ')

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

/* ---- Экран 12: канон канала (M5.7) ---- */
// Стиль Cursus v001–v003 — значения артборда 12 по-английски: текст канона уходит в промпт картинки, и кириллицу
// публикация отклоняет (docs/canon_schema.md, «Черновик и публикация»). Роли образцов — тоже текст промпта.
// У Otto канона нет — экран показывает пустое состояние.

const STYLE_NEGATIVE_V001 = ['plastic', 'modern clothing', 'text in frame', 'captions and watermarks']
const STYLE_NEGATIVE_V002 = [
  'plastic',
  'neon light',
  'modern clothing',
  'zippers and snap buttons',
  'metal-rimmed glasses',
  'glass in cabin windows',
  'text in frame',
  'captions and watermarks',
  'smooth CGI skin',
  'fisheye',
]

function cursusStyle(fields: {
  render: string
  focal: string
  depth: string
  distortion: string
  contrast: string
  accent: Swatch
  grain: string
  composition: string
  negative: string[]
}): Style {
  return {
    render: fields.render,
    material: 'Matte surfaces, dust in the air, damp wood, oxidised metal',
    processing: 'Moderate lift in the shadows, soft roll-off in the highlights, no clipping',
    optics: { focal: fields.focal, depth: fields.depth, distortion: fields.distortion },
    light: {
      character: 'One practical source: a lantern, a candle, a gun port',
      contrast: fields.contrast,
      direction: 'From the side and above, 30–45°; backlight only in the closing shots of a section',
    },
    palette: {
      rule: 'Warm light against cold shadow; saturated colour on one object in the frame only',
      swatches: [
        { role: 'key light', hex: '#E8C88A' },
        { role: 'shadow and depth', hex: '#1E2A2E' },
        { role: 'wood and rigging', hex: '#6B4F34' },
        { role: 'metal and water', hex: '#7E8B8F' },
        fields.accent,
      ],
    },
    grain: fields.grain,
    composition: fields.composition,
    negative_global: fields.negative,
  }
}

interface CanonVersionFile<T = Style> {
  info: CanonVersionInfo
  data: T
}

/** Версии стиля Cursus: v003 — текущая, как в артборде */
export const CURSUS_STYLE: CanonVersionFile[] = [
  {
    info: { version: 'v001', based_on: null, published_at: '2026-06-02T09:00:00+00:00' },
    data: cursusStyle({
      render: 'Digital photograph, even light',
      focal: '50 mm on every shot',
      depth: 'f/5.6: everything in focus',
      distortion: 'No distortion or vignette',
      contrast: 'Low, fill in the shadows',
      accent: { role: 'cloth accent', hex: '#B4664C' },
      grain: 'No grain',
      composition: 'No composition rules',
      negative: STYLE_NEGATIVE_V001,
    }),
  },
  {
    info: { version: 'v002', based_on: 'v001', published_at: '2026-07-14T09:00:00+00:00' },
    data: cursusStyle({
      render: 'Film photograph of the 1980s, clean print',
      focal: '50 mm on every shot',
      depth: 'f/4: the middle ground almost as sharp as the hero',
      distortion: 'No distortion, 6% vignette',
      contrast: 'Medium, even fill',
      accent: { role: 'cloth accent', hex: '#A4553F' },
      grain: '35 mm film grain, ISO 200, barely visible',
      composition: 'Hero off centre; horizon level; foreground covers a third of the frame',
      negative: STYLE_NEGATIVE_V002,
    }),
  },
  {
    info: { version: 'v003', based_on: 'v002', published_at: '2026-08-28T09:00:00+00:00' },
    data: cursusStyle({
      render: 'Film photograph of the 1970s, printed from the negative; no digital cleanness',
      focal: '35 mm for wide and medium shots; 85 mm for the rank portrait',
      depth: 'f/2.8: the hero sharp, the middle ground readable, the background falls apart',
      distortion: 'Slight barrel on 35 mm, 12% vignette, no stretched faces at the edges',
      contrast: 'High, but with readable shadow: details in the shadows do not sink',
      accent: { role: 'cloth accent', hex: '#8E3B2E' },
      grain: '35 mm film grain, ISO 400, visible in the shadows, steady between frames',
      composition: 'Hero off centre; horizon level; foreground covers a third of the frame',
      negative: [...STYLE_NEGATIVE_V002, 'HDR glow', 'symmetrical faces'],
    }),
  },
]

/* ---- Экран 12: эпохи и персонажи (M5.8) ---- */
// Значения артборда 12 по-английски, как у стиля: всё, кроме подписей `label`, уходит в промпт картинки. У Cursus —
// Карибы и Англия опубликованы, Венеция — черновик без запретов (её нельзя использовать); You с пятью обликами и
// Капитан без листа. У Otto стиля нет (пустое состояние слоя «Стиль»), но есть Отто с тремя обликами.

export interface CanonDraftFile<T> {
  based_on: string | null
  saved_at: string
  data: T
}

/** Слой канона в моке: версии по возрастанию и черновик — как каталог сущности на диске */
export interface LayerState<T> {
  versions: CanonVersionFile<T>[]
  draft: CanonDraftFile<T> | null
}

const period = (fields: Partial<Period> & Pick<Period, 'id' | 'label'>): Period => ({
  region: '',
  years: null,
  palette_shift: [],
  materials: [],
  light_sources: [],
  architecture: [],
  clothing: [],
  props: [],
  forbidden: [],
  ...fields,
})

const CARIBBEAN_FORBIDDEN = [
  'zippers',
  'factory-made buttons',
  'plastic',
  'rubber',
  'stainless steel',
  'stamped sheet metal',
  'gold-laced tricorne on a common sailor',
  '20th-century flash tattoos',
  'binoculars',
  'safety matches',
  'rum in a glass bottle',
  'printed labels',
  'wristwatch',
  'trimmed nails and clean hands',
]

/** Эпохи Cursus: две опубликованы, Венеция — только черновик без запретов */
export const CURSUS_PERIODS: Record<string, LayerState<Period>> = {
  'caribbean-1716': {
    versions: [
      {
        info: { version: 'v001', based_on: null, published_at: '2026-06-02T09:00:00+00:00' },
        data: period({
          id: 'caribbean-1716',
          label: 'Карибы, 1716',
          region: 'Caribbean Sea, Nassau',
          years: { from: 1716, to: 1726 },
          palette_shift: ['sun-bleached sailcloth', 'pitch and tar', 'turquoise shallows', 'rusted iron'],
          materials: ['oak', 'hemp', 'sailcloth', 'brass', 'lead', 'leather'],
          light_sources: ['lantern', 'candle in a horn lantern', 'gun port', 'noon sun'],
          architecture: ['gun deck', 'berth deck', 'stern cabin', 'harbour warehouses'],
          clothing: ['slops', 'sleeveless waistcoat', 'kerchief on the head', 'bare feet', 'wide belt'],
          props: ['powder cartridge', 'belaying pin', "ship's log", 'cutlass', 'quadrant'],
          forbidden: CARIBBEAN_FORBIDDEN,
        }),
      },
    ],
    draft: null,
  },
  'england-1347': {
    versions: [
      {
        info: { version: 'v001', based_on: null, published_at: '2026-06-20T09:00:00+00:00' },
        data: period({
          id: 'england-1347',
          label: 'Англия, 1347',
          region: 'East Anglia',
          years: { from: 1347, to: 1350 },
          palette_shift: ['wet clay', 'undyed wool', 'peat smoke', 'floodplain green'],
          materials: ['oak', 'thatch', 'clay', 'wool', 'linen', 'wrought iron'],
          light_sources: ['open hearth', 'tallow candle', 'doorway', 'overcast sky'],
          architecture: ['longhouse', 'barn', 'parish church', 'mill'],
          clothing: ['cotte', 'chaperon hood', 'leg wraps', 'wooden clogs'],
          props: ['sickle', 'wooden bowl', 'leather bucket', 'millstone'],
          forbidden: ['potato', 'maize', 'tobacco', 'sunflower', 'coat buttons', 'spinning wheel', 'glazed windows', 'brick walls', 'printed book', 'bleached white cloth', 'machine-made chain'],
        }),
      },
    ],
    draft: null,
  },
  'venice-1560': {
    versions: [],
    draft: {
      based_on: null,
      saved_at: '2026-09-10T09:00:00+00:00',
      data: period({
        id: 'venice-1560',
        label: 'Венеция, 1560',
        region: 'Venetian Arsenal',
        years: { from: 1560, to: 1580 },
        palette_shift: ['wet stone', 'leaden water'],
        materials: ['oak', 'hemp', 'pitch'],
        light_sources: ['workshop skylight'],
        architecture: ['shipyard hall', 'dock canal'],
        props: ['adze'],
      }),
    },
  },
}

/** Сколько выпусков канала ссылаются на эпоху текущими планами — счётчик сводки (`episodes`) */
const PERIOD_EPISODES: Record<string, number> = { 'caribbean-1716': 3, 'england-1347': 2, 'venice-1560': 1 }

/** Ссылки планов выпусков на канон — из них «нужно каналу» (без опубликованной версии) */
const PLAN_REFS: Record<ChannelId, { periods: NeededItem[]; appearances: NeededItem[] }> = {
  cursus: {
    periods: [
      { id: 'edo-1650', draft: false, shots: 64, episodes: [{ id: 'samurai', title: 'Samurai Household: every rank', shots: 64 }] },
      { id: 'venice-1560', draft: false, shots: 38, episodes: [{ id: 'arsenal', title: 'Venetian Arsenal: every rank', shots: 38 }] },
    ],
    appearances: [
      { id: 'daimyo@edo-1650', draft: false, shots: 9, episodes: [{ id: 'samurai', title: 'Samurai Household: every rank', shots: 9 }] },
      { id: 'you@ashigaru-17', draft: false, shots: 22, episodes: [{ id: 'samurai', title: 'Samurai Household: every rank', shots: 22 }] },
    ],
  },
  otto: { periods: [], appearances: [] },
}

const look = (fields: Partial<Appearance> & Pick<Appearance, 'id' | 'label' | 'period'>): Appearance => ({
  age: null,
  build: '',
  face: '',
  hair: '',
  clothing: '',
  wear: '',
  props: [],
  negative_local: [],
  ...fields,
})

const YOU_LOOKS: Appearance[] = [
  look({
    id: 'you@powder-monkey-11',
    label: 'пороховая обезьяна',
    period: 'caribbean-1716',
    age: 11,
    build: 'Thin, narrow shoulders, below average height',
    face: 'Boyish, sunburnt cheeks, chapped lips',
    hair: 'Short, sun-bleached, cut unevenly',
    clothing: 'Oversized slops, sleeveless waistcoat, kerchief on the head, barefoot',
    wear: 'Salt stains, tar on the hands, a torn hem',
    props: ['leather cartridge case'],
    negative_local: ['shoes'],
  }),
  look({ id: 'you@landsman-19', label: 'матрос-новичок', period: 'caribbean-1716', age: 19, build: 'Lean, wiry arms', face: 'Thin stubble, peeling nose', clothing: 'Canvas slops, check shirt' }),
  look({ id: 'you@able-seaman-23', label: 'опытный матрос', period: 'caribbean-1716', age: 23, build: 'Lean and strong, rope-burnt palms', face: 'Weathered, short beard', clothing: 'Faded waistcoat, wide belt with a knife' }),
  look({ id: 'you@boatswain-34', label: 'боцман', period: 'caribbean-1716', age: 34, build: 'Broad shoulders, thick forearms', face: 'Full beard, broken nose', clothing: 'Long waistcoat, bosun call on a cord' }),
  look({ id: 'you@quartermaster-41', label: 'квартирмейстер', period: 'caribbean-1716', age: 41, build: 'Heavy-set', face: 'Grey in the beard, deep lines', clothing: 'Dark coat, ledger under the arm' }),
]

const YOU_NATURE = {
  personality: 'Watches before speaking. Does what he is told, but notices who obeys whom.',
  posture: 'Shoulders forward, head slightly down, weight on the front foot: ready to run.',
  manner: 'Never looks at the camera. His hands are almost always busy with an object.',
  face: 'Narrow face, wide-set eyes, a gap between the front teeth, a scar above the left eyebrow.',
}

/** Персонажи каналов: Cursus — You (v001 — три облика, v002 — пять) и Капитан; Otto — Отто */
export const CANON_CHARACTERS: Record<ChannelId, Record<string, LayerState<Character>>> = {
  cursus: {
    captain: {
      versions: [
        {
          info: { version: 'v001', based_on: null, published_at: '2026-07-01T09:00:00+00:00' },
          data: {
            id: 'captain',
            label: 'Капитан (второй план)',
            nature: {
              personality: 'Says little, waits for the crew to decide on its own.',
              posture: 'Stands half-turned, hands behind his back.',
              manner: 'Never raises his voice, keeps his distance from the crew.',
              face: 'Lean face, deep nasolabial folds, grey at the temples.',
            },
            appearances: [look({ id: 'captain@caribbean-1716', label: 'капитан', period: 'caribbean-1716', age: 48, build: 'Tall, upright', clothing: 'Worn blue coat, sash' })],
          },
        },
        {
          // Другое лицо: лист Капитана выбран в v001 и устарел целиком (M5.9)
          info: { version: 'v002', based_on: 'v001', published_at: '2026-09-20T09:00:00+00:00' },
          data: {
            id: 'captain',
            label: 'Капитан (второй план)',
            nature: {
              personality: 'Says little, waits for the crew to decide on its own.',
              posture: 'Stands half-turned, hands behind his back.',
              manner: 'Never raises his voice, keeps his distance from the crew.',
              face: 'Lean face, deep nasolabial folds, a white scar across the chin.',
            },
            appearances: [look({ id: 'captain@caribbean-1716', label: 'капитан', period: 'caribbean-1716', age: 48, build: 'Tall, upright', clothing: 'Worn blue coat, sash' })],
          },
        },
      ],
      draft: null,
    },
    you: {
      versions: [
        {
          info: { version: 'v001', based_on: null, published_at: '2026-06-05T09:00:00+00:00' },
          data: { id: 'you', label: 'You — рассказчик-участник', nature: YOU_NATURE, appearances: YOU_LOOKS.slice(0, 3) },
        },
        {
          info: { version: 'v002', based_on: 'v001', published_at: '2026-08-30T09:00:00+00:00' },
          data: { id: 'you', label: 'You — рассказчик-участник', nature: YOU_NATURE, appearances: YOU_LOOKS },
        },
      ],
      draft: null,
    },
  },
  otto: {
    otto: {
      versions: [
        {
          info: { version: 'v001', based_on: null, published_at: '2026-05-20T09:00:00+00:00' },
          data: {
            id: 'otto',
            label: 'Отто',
            nature: {
              personality: 'Curious and unceremonious: pokes into other people’s work to see how it is done.',
              posture: 'Straight back, open palms, turned towards whoever he talks to.',
              manner: 'Looks into the camera: he is the host. Gestures with one hand.',
              face: 'Round face, thick eyebrows, stubble, a crease on the bridge of the nose.',
            },
            appearances: [
              look({ id: 'otto@england-1347', label: 'крестьянин', period: 'england-1347', age: 34 }),
              look({ id: 'otto@london-1850', label: 'трубочист', period: 'london-1850', age: 34 }),
              look({ id: 'otto@tenochtitlan-1500', label: 'торговец', period: 'tenochtitlan-1500', age: 34 }),
            ],
          },
        },
      ],
      draft: null,
    },
  },
}

/** Ракурсы листа опорных портретов — `config/canon.yaml → anchors.angles` */
export const SHEET_ANGLES: [string, string, string][] = [
  ['front', 'Фас', 'лицо прямо, нейтральный свет'],
  ['three_quarter', 'Три четверти', 'поворот 45°, ключевой свет сбоку'],
  ['profile', 'Профиль', 'силуэт линии носа и лба'],
  ['full_body', 'В полный рост', 'одежда целиком, обувь, пропорции'],
  ['in_action', 'В действии', 'рабочая поза ранга'],
  ['detail', 'Деталь', 'руки и предметы'],
]

/** Листы артборда — выбрано ракурсов по порядку (6 — готов, 3 — наполовину, нет записи — не собран), по 2 кандидата на
 *  ракурс. Выбор сделан в первой версии персонажа с обликом: у Капитана в v002 другое лицо — лист устарел целиком */
const SHEETS_CHOSEN: Record<string, number> = {
  'you@powder-monkey-11': 6,
  'you@landsman-19': 6,
  'you@able-seaman-23': 6,
  'you@boatswain-34': 3,
  'captain@caribbean-1716': 6,
  'otto@england-1347': 6,
  'otto@london-1850': 6,
  'otto@tenochtitlan-1500': 6,
}

/** Кандидат листа в моке — строка `sheet.json` бэкенда */
export interface MockCandidate {
  id: string
  slot: string
  n: number
  status: 'ready' | 'rejected' | 'failed'
  version: string
  error: string | null
  seed: number
  usd_micro: number
  created_at: string
}

/** Лист облика в моке: кандидаты всех сборок и выбор ракурс → id кандидата (`chosen.json`) */
export interface MockSheet {
  candidates: MockCandidate[]
  chosen: Record<string, string>
}

interface MockStale {
  whole: string[]
  body: string[]
  missing: boolean
}

/** Удавшийся кандидат: id — ракурс, номер и хэш входов (облик, версия, ракурс, номер) */
export function mockCandidate(appearanceId: string, version: string, slot: string, n: number): MockCandidate {
  const hash = hex16(`${appearanceId}:${version}:${slot}:${n}`)
  return { id: `${slot}-${n}-${hash}`, slot, n, status: 'ready', version, error: null, seed: parseInt(hash.slice(0, 7), 16), usd_micro: ANCHOR_PRICE, created_at: NOW }
}

/** Шаблоны кадров стиля — `config/canon.yaml → style_frames` */
export const STYLE_FRAMES: [string, string][] = [
  ['establishing', 'Общий план'],
  ['portrait', 'Портрет'],
  ['detail', 'Деталь'],
  ['crowd', 'Толпа'],
  ['night', 'Ночь'],
  ['silhouette', 'Силуэт'],
]

/** Цена Pro 1K из `config/pricing.yaml`, микродоллары: лист 12 картинок, ракурс 2, кадры стиля 6 */
const ANCHOR_PRICE = 134_000
/** Кандидатов на ракурс за одну сборку — `config/canon.yaml → anchors.candidates` */
const ANCHOR_CANDIDATES = 2
/** Устаревание листа (docs/canon_schema.md, «Устаревание»): эти поля — весь лист, одежда — три ракурса */
const SHEET_FIELDS = ['nature.face', 'face', 'build', 'hair', 'age'] as const
const BODY_FIELDS = ['clothing', 'props', 'wear'] as const
const BODY_ANGLES: ReadonlySet<string> = new Set(['full_body', 'in_action', 'detail'])

/** 16 hex-знаков от строки — как хэш входов в id кандидата бэкенда (`front-1-3f9ab2c4d5e6f7a8`), детерминированно */
function hex16(text: string): string {
  let a = 0x811c9dc5
  let b = 0x9747b28c
  for (let i = 0; i < text.length; i += 1) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0
    b = Math.imul(b ^ text.charCodeAt(i), 0x5bd1e995) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

/** Миниатюра кандидата в моке: силуэт и подпись поверх прозрачного фона. Это картинка-заглушка (данные), не цвет
 *  интерфейса: только белый с прозрачностью */
export function thumbSvg(caption: string, width: number, ratio = 4 / 3): string {
  const height = Math.round(width * ratio)
  const head = Math.round(width * 0.16)
  // Атрибуты без имён вида `fill-*`/`text-*`: сканер утилит Tailwind в тесте токенов принял бы их за классы
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="white">`,
    `<rect width="${width}" height="${height}" opacity="0.04"/>`,
    `<circle cx="${width / 2}" cy="${Math.round(height * 0.36)}" r="${head}" opacity="0.16"/>`,
    `<rect x="${Math.round(width * 0.24)}" y="${Math.round(height * 0.36 + head * 1.3)}" width="${Math.round(width * 0.52)}" height="${height}" rx="${head}" opacity="0.12"/>`,
    `<text x="8" y="${height - 12}" font-family="sans-serif" font-size="13" opacity="0.5">${caption}</text>`,
    '</g></svg>',
  ].join('')
}
const STYLE_ANCHOR_FIELDS = ['render', 'material', 'processing', 'optics', 'light'] as const

function anchorLine(title: string, label: string, images: number) {
  return estimateLine(title, label, 'anchors', 'gemini-3-pro-image', [{ unit: 'image', quantity: images, variant: '1K', usd_micro: images * ANCHOR_PRICE }])
}

export const anchorsEstimate = {
  sheet: anchorLine('Собрать лист', '6 ракурсов × 2 кандидата', 12),
  angle: anchorLine('Перегенерировать ракурс', '2 кандидата', 2),
  style: anchorLine('Пересобрать кадры стиля', '6 кадров', STYLE_FRAMES.length),
  stale: null,
} satisfies AnchorsEstimate

/** Изменённые поля стиля, от которых устаревают кадры стиля: рендер, оптика, свет (docs/canon_schema.md) */
function staleStyleFields(before: Style, after: Style): string[] {
  const changed: string[] = []
  for (const field of STYLE_ANCHOR_FIELDS) {
    const a = before[field]
    const b = after[field]
    if (typeof a === 'string') {
      if (a !== b) changed.push(field)
    } else {
      for (const key of Object.keys(a) as (keyof typeof a)[]) {
        if (a[key] !== (b as typeof a)[key]) changed.push(`${field}.${key}`)
      }
    }
  }
  return changed
}

interface StyleState extends LayerState<Style> {
  /** Версия стиля, на которой сделаны кадры стиля; `null` — кадров нет */
  frames: string | null
}

/* ---- Канон выпуска на экране 3 (M5.10, docs/project_schema.md, «Канон выпуска»; docs/prompt_assembly.md) ---- */

type CanonKind = CanonProblem['kind']

/** Отличие сущности канона выпуска от «прибита последняя версия, лист 6/6». Ключ — `style`, `period:<id>`,
 *  `appearance:<id>`; `latest: null` — опубликованной версии нет; `resolved: false` — прибитая версия не находится,
 *  хотя опубликованная есть (облик прибит к версии персонажа, где его ещё не было) */
export interface CanonTweak {
  pinned?: string
  latest?: string | null
  draft?: boolean
  resolved?: boolean
  sheet?: AnchorSheet
}

/** Канон канала глазами канона выпуска: опубликованные версии сущности (у облика — версии персонажа, где он есть),
 *  черновик и лист против версии */
export interface CanonFacts {
  versions: string[]
  draft: boolean
  sheet: (version: string) => AnchorSheet
}
/** `null` — сущности нет ни в каноне канала, ни в «нужно каналу»: план артборда 3 ссылается на облики, которых нет в
 *  артборде 12, — такие считаются прибитыми к последней версии с готовым листом */
export type CanonLookup = (kind: CanonKind, id: string) => CanonFacts | null
/** Прибитые версии плана выпуска (`canon_ref`): `style`, `period:<id>`, `appearance:<id>` → vNNN */
export type CanonPins = Record<string, string>

/** Без канона канала (unit-тесты) стиль прибит к последнему стилю Cursus (v003), эпохи и облики — к v001 */
const PLAN_STYLE = 'v003'
const SHEET_READY: AnchorSheet = { status: 'ready', chosen: 6, total: 6 }
const NO_SHEET: AnchorSheet = { status: 'missing', chosen: 0, total: 6 }
const ON_CANON_SCREEN = ' на экране «Канон»'
const CANON_SUBJECT: Record<CanonKind, string> = { style: 'стиль канала', period: 'эпоха', appearance: 'облик' }
const NOT_PUBLISHED: Record<CanonKind, (id: string) => string> = {
  style: () => 'стиль канала не опубликован — заполните и опубликуйте его',
  period: (id) => `эпоха ${id} не опубликована — создайте и опубликуйте её`,
  appearance: (id) => `облик ${id} не опубликован — создайте и опубликуйте его`,
}

function canonRefOf(kind: CanonKind, id: string, tag: string): string {
  if (kind === 'style') return `style/${tag}`
  if (kind === 'period') return `periods/${id}/${tag}`
  const [character, look] = id.split('@')
  return `characters/${character}/${tag}#${look}`
}

const canonKey = (kind: CanonKind, id: string) => (kind === 'style' ? 'style' : `${kind}:${id}`)

/** Сущность канона выпуска — правила статуса как у `episode_canon._item` бэкенда: факты канона канала, поверх —
 *  отличия теста. Лист смотрится только у ссылки, которая находит версию */
function canonItem(kind: CanonKind, id: string, shots: number, pin: string | undefined, facts: CanonFacts | null, tweak: CanonTweak = {}) {
  const fallback = kind === 'style' ? PLAN_STYLE : 'v001'
  const known = facts
    ? { pinned: pin ?? fallback, latest: facts.versions.at(-1) ?? null, draft: facts.draft }
    : { pinned: pin ?? fallback, latest: pin ?? fallback, draft: false }
  const pinned = tweak.pinned ?? known.pinned
  const latest = tweak.latest === undefined ? known.latest : tweak.latest
  const draft = tweak.draft ?? known.draft
  const moved = tweak.pinned !== undefined || tweak.latest !== undefined
  const resolved =
    latest !== null && (tweak.resolved ?? (facts && !moved ? facts.versions.includes(pinned) : pinned <= latest))
  const status = latest === null ? (draft ? 'draft_only' : 'missing') : resolved && pinned === latest ? 'ready' : 'outdated'
  const item: EpisodeCanonItem = { id, ref: canonRefOf(kind, id, pinned), pinned, latest, status, resolved, draft, shots }
  const sheet = !resolved ? NO_SHEET : (tweak.sheet ?? (facts ? facts.sheet(pinned) : SHEET_READY))
  return { item, sheet }
}

function refProblem(kind: CanonKind, item: EpisodeCanonItem): CanonProblem | null {
  if (item.resolved) return null
  const subject = kind === 'style' ? CANON_SUBJECT.style : `${CANON_SUBJECT[kind]} ${item.id}`
  if (item.latest === null) {
    const message =
      item.status === 'draft_only' ? `${subject}: есть только черновик — опубликуйте его${ON_CANON_SCREEN}` : `${NOT_PUBLISHED[kind](item.id)}${ON_CANON_SCREEN}`
    return { kind, id: item.id, issue: 'unpublished', message }
  }
  return {
    kind,
    id: item.id,
    issue: 'unresolved',
    message: `${subject}: ссылка ${item.ref} не находит опубликованную версию — переведите выпуск на ${item.latest} кнопкой «Перевести на новые версии»`,
  }
}

function sheetProblem(item: EpisodeAppearanceItem): CanonProblem | null {
  const { sheet } = item
  if (!item.resolved || sheet.status === 'ready') return null
  const subject = `облик ${item.id}`
  if (sheet.status === 'missing') {
    return { kind: 'appearance', id: item.id, issue: 'no_sheet', message: `${subject}: нет листа опорных портретов — соберите его${ON_CANON_SCREEN}` }
  }
  if (sheet.status === 'partial') {
    return {
      kind: 'appearance',
      id: item.id,
      issue: 'sheet_incomplete',
      message: `${subject}: лист ${sheet.chosen}/${sheet.total} — выберите недостающие ракурсы${ON_CANON_SCREEN}`,
    }
  }
  return { kind: 'appearance', id: item.id, issue: 'sheet_outdated', message: `${subject}: лист устарел — пересоберите его${ON_CANON_SCREEN}` }
}

/** Сущности канона, на которые ссылается план: эпохи и облики — в порядке первого появления в кадрах */
function planEntities(plan: EffectivePlan): { kind: CanonKind; id: string; shots: number }[] {
  const shots = plan.shots.filter((shot) => shot.status !== 'removed')
  return [
    { kind: 'style' as const, id: 'style', shots: shots.length },
    ...[...new Set(shots.map((shot) => shot.image.period))].map((id) => ({
      kind: 'period' as const,
      id,
      shots: shots.filter((shot) => shot.image.period === id).length,
    })),
    ...[...new Set(shots.flatMap((shot) => shot.image.appearances))].map((id) => ({
      kind: 'appearance' as const,
      id,
      shots: shots.filter((shot) => shot.image.appearances.includes(id)).length,
    })),
  ]
}

/** Прибить новые ссылки плана, как импорт M5.2: прибитые прежде сохраняют версию, новые получают последнюю
 *  опубликованную, а без неё — заготовку v001 */
export function pinPlan(plan: EffectivePlan, pins: CanonPins, lookup: CanonLookup): CanonPins {
  const next = { ...pins }
  for (const { kind, id } of planEntities(plan)) {
    const key = canonKey(kind, id)
    if (next[key]) continue
    const facts = lookup(kind, id)
    next[key] = facts ? (facts.versions.at(-1) ?? 'v001') : kind === 'style' ? PLAN_STYLE : 'v001'
  }
  return next
}

/** Канон выпуска из кадров версии плана, прибитых версий и канона канала; у стиля — все кадры */
export function mockEpisodeCanon(
  plan: EffectivePlan,
  tweaks: Record<string, CanonTweak> = {},
  pins: CanonPins = {},
  lookup: CanonLookup = () => null,
): EpisodeCanon {
  const items = planEntities(plan).map(({ kind, id, shots }) => {
    const key = canonKey(kind, id)
    return { kind, ...canonItem(kind, id, shots, pins[key], lookup(kind, id), tweaks[key]) }
  })
  const style = items[0]!.item
  const periods = items.filter((entry) => entry.kind === 'period').map((entry) => entry.item)
  const appearances = items
    .filter((entry) => entry.kind === 'appearance')
    .map((entry): EpisodeAppearanceItem => ({ ...entry.item, sheet: entry.sheet }))
  const problems = [
    refProblem('style', style),
    ...periods.map((item) => refProblem('period', item)),
    ...appearances.map((item) => refProblem('appearance', item)),
    ...appearances.map(sheetProblem),
  ].filter((problem): problem is CanonProblem => problem !== null)
  return {
    plan_version: plan.version,
    ready: !problems.length,
    updatable: [style, ...periods, ...appearances].some((item) => item.latest !== null && item.latest !== item.pinned),
    style,
    periods,
    appearances,
    problems,
  }
}

/** Сводка отказа по канону — как `approve.canon_summary` бэкенда */
function canonRefusal(problems: CanonProblem[]): string {
  const counted = (kind: CanonKind | null, issue: CanonProblem['issue']) =>
    problems.filter((p) => (kind === null || p.kind === kind) && p.issue === issue).length
  const parts: string[] = []
  if (counted('style', 'unpublished')) parts.push('стиль канала не опубликован')
  const periods = counted('period', 'unpublished')
  if (periods) parts.push(`${periods} ${ru(periods, ['эпоха', 'эпохи', 'эпох'])} не ${ru(periods, ['опубликована', 'опубликованы', 'опубликованы'])}`)
  const looks = counted('appearance', 'unpublished')
  if (looks) parts.push(`${looks} ${ru(looks, ['облик', 'облика', 'обликов'])} не ${ru(looks, ['опубликован', 'опубликованы', 'опубликованы'])}`)
  const unresolved = counted(null, 'unresolved')
  if (unresolved) parts.push(`${unresolved} ${ru(unresolved, ['ссылка', 'ссылки', 'ссылок'])} не ${ru(unresolved, ['находит', 'находят', 'находят'])} версию`)
  for (const [issue, text] of [
    ['no_sheet', 'нет листа'],
    ['sheet_incomplete', 'лист не собран'],
    ['sheet_outdated', 'лист устарел'],
  ] as const) {
    const n = counted('appearance', issue)
    if (n) parts.push(`у ${n} ${ru(n, ['облика', 'обликов', 'обликов'])} ${text}`)
  }
  const where = [
    ...(problems.some((p) => p.issue !== 'unresolved') ? ['экран «Канон»'] : []),
    ...(problems.some((p) => p.issue === 'unresolved') ? ['«Перевести на новые версии»'] : []),
  ]
  return `Канон не готов: ${parts.join(', ')} — ${where.join(' и ')}.`
}

/** Крупность → строка промпта, ракурсы листа и кадры стиля (`config/canon.yaml → shots.sizes`) */
const SHOT_SIZES: Record<PlanShot['image']['shot_size'], { line: string; angles: string[]; frames: string[] }> = {
  establishing: { line: 'wide establishing shot, the place reads first, people small in the frame', angles: ['front', 'full_body'], frames: ['establishing', 'crowd'] },
  action: { line: 'medium-wide shot of the action, whole figures readable', angles: ['front', 'three_quarter', 'full_body', 'in_action'], frames: ['establishing', 'portrait'] },
  reaction: { line: 'close shot on the face and shoulders, the emotion readable', angles: ['front', 'three_quarter', 'profile'], frames: ['portrait', 'night'] },
  detail: { line: 'close-up of the object or the hands in the action', angles: ['front', 'detail'], frames: ['detail', 'portrait'] },
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

/** «(reference images 1–4)», «(reference image 5)», без референсов — пусто */
function refRange(first: number, count: number, style = false): string {
  const word = style ? 'style reference image' : 'reference image'
  if (count === 0) return ''
  return count === 1 ? ` (${word} ${first})` : ` (${word}s ${first}–${first + count - 1})`
}

/** Запрос кадра, как `GET …/shots/{id}/prompt` бэкенда (M5.5): секции из прибитых версий, референсы по крупности,
 *  проблемы канона вместо секций, которые не резолвятся. Тексты секций — короткие, по примерам prompt_assembly.md */
export function mockShotPrompt(channel: ChannelId, shot: PlanShot, canon: EpisodeCanon): ShotPrompt {
  const size = SHOT_SIZES[shot.image.shot_size]
  const problems: PromptProblem[] = []
  // Адресат — как у бэкенда: у сущности без версий «не опубликована», иначе ссылка не находит версию
  const problem = (message: string, kind: CanonKind, item: EpisodeCanonItem, issue?: CanonTarget['issue']) =>
    problems.push({ message: `кадр ${shot.id}: ${message}`, canon: { kind, id: item.id, issue: issue ?? (item.latest === null ? 'unpublished' : 'unresolved') } })
  const period = canon.periods.find((item) => item.id === shot.image.period)
  const looks = shot.image.appearances.map((id) => canon.appearances.find((item) => item.id === id)).filter((item) => item !== undefined)
  if (!canon.style.resolved) problem(`стиль ${canon.style.ref} не найден в каноне ${channel}`, 'style', canon.style)
  if (period && !period.resolved) problem(`эпоха ${period.ref} не найдена в каноне ${channel}`, 'period', period)
  const drawable = looks.filter((look) => {
    if (!look.resolved) {
      problem(`облик ${look.id} не найден в ${look.ref.split('#')[0]}`, 'appearance', look)
      return false
    }
    if (look.sheet.status === 'missing') problem(`у облика ${look.id} нет листа опорных портретов — соберите его${ON_CANON_SCREEN}`, 'appearance', look, 'no_sheet')
    else if (look.sheet.status === 'partial')
      problem(`лист облика ${look.id} ${look.sheet.chosen}/${look.sheet.total} — выберите недостающие ракурсы${ON_CANON_SCREEN}`, 'appearance', look, 'sheet_incomplete')
    else if (look.sheet.status === 'outdated') problem(`лист облика ${look.id} устарел — пересоберите его${ON_CANON_SCREEN}`, 'appearance', look, 'sheet_outdated')
    return true
  })

  const refs: PromptRef[] = []
  const anchorRef = (owner: string, slot: string, label: string): PromptRef => ({
    kind: 'anchor',
    owner,
    slot,
    label: `${owner} — ${lowerFirst(label)}`,
    file: `channels/${channel}/canon/anchors/${owner}/candidates/${slot}-1.jpg`,
    sha256: hex16(`${owner}:${slot}`).repeat(4),
  })
  const persons = drawable.map((look, i) => {
    const first = refs.length + 1
    const angles = look.sheet.status === 'ready' ? size.angles : []
    for (const slot of angles) refs.push(anchorRef(look.id, slot, SHEET_ANGLES.find(([id]) => id === slot)?.[1] ?? slot))
    return { look, header: `Person ${i + 1}${refRange(first, angles.length)}:` }
  })
  const firstFrame = refs.length + 1
  for (const frame of size.frames) {
    const label = STYLE_FRAMES.find(([id]) => id === frame)?.[1] ?? frame
    refs.push({
      kind: 'style_frame',
      owner: 'style',
      slot: frame,
      label: `Кадр стиля — ${lowerFirst(label)}`,
      file: `channels/${channel}/canon/anchors/style/${frame}.jpg`,
      sha256: hex16(`style:${frame}`).repeat(4),
    })
  }

  const sections: PromptSection[] = []
  if (canon.style.resolved) {
    sections.push({
      kind: 'style',
      source: canon.style.ref,
      label: 'Стиль канала',
      text: `Rendering${refRange(firstFrame, size.frames.length, true)}:\n- Technique: painterly digital illustration with the restraint of a museum diorama\n- Grain: fine even film grain across the frame`,
    })
  }
  if (period?.resolved) {
    const label = CURSUS_PERIODS[period.id]?.versions[0]?.data.label ?? period.id
    sections.push({ kind: 'period', source: period.ref, label: `Эпоха: ${label}`, text: 'Era:\n- Place: Caribbean Sea, Nassau\n- Years: 1716 to 1726' })
  }
  for (const { look, header } of persons) {
    sections.push({ kind: 'appearance', source: look.ref, label: `Облик: ${look.id}`, text: `${header}\n- Build: small and wiry\n- Clothing: oversized linen shirt, barefoot` })
  }
  const edited = shot.overridden.includes('image.prompt')
  sections.push({ kind: 'action', source: 'shot', label: edited ? 'Действие — правка человека' : 'Действие', text: `Action: ${shot.image.prompt}` })
  sections.push({ kind: 'shot_size', source: 'shot', label: `Крупность: ${shot.image.shot_size}`, text: `Shot size: ${size.line}` })

  const text = sections.map((section) => section.text).join('\n\n')
  const model = 'gemini-3.1-flash-image'
  return {
    shot_id: shot.id,
    sections,
    text,
    negative: 'text, watermark, modern clothing, plastic sheen, zipper, wristwatch',
    refs,
    dropped: [],
    seed: parseInt(hex16(`${shot.id}:${text}`).slice(0, 7), 16),
    aspect_ratio: '16:9',
    model,
    cost: { stage: 'images', provider: 'gemini', model, lines: [{ unit: 'image', quantity: 1, variant: '1K', usd_micro: PRICE.image }], usd_micro: PRICE.image, stale_pricing: false },
    usd: money(PRICE.image),
    input_hash: problems.length ? null : hex16(text).repeat(4),
    problems,
    warnings: [],
  }
}

export interface MockResponse {
  status: number
  body: unknown
  /** Не JSON: тело — строка этого типа (миниатюра кандидата — SVG) */
  contentType?: string
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
  const profiles = structuredClone(channels) as ChannelProfile[]
  const ideas: Idea[] = structuredClone(IDEAS)
  const references: ReferenceVideo[] = structuredClone(REFERENCES)
  /** Канон каналов (экран 12): у Cursus стиль v001–v003 и кадры стиля на v003, у Otto канона нет */
  const canonStyles: Record<ChannelId, StyleState> = {
    cursus: { versions: structuredClone(CURSUS_STYLE), draft: null, frames: 'v003' },
    otto: { versions: [], draft: null, frames: null },
  }
  /** Эпохи и персонажи каналов (M5.8): каталоги сущностей с версиями и черновиком */
  const canonPeriods: Record<ChannelId, Map<string, LayerState<Period>>> = {
    cursus: new Map(Object.entries(structuredClone(CURSUS_PERIODS))),
    otto: new Map(),
  }
  const canonCharacters: Record<ChannelId, Map<string, LayerState<Character>>> = {
    cursus: new Map(Object.entries(structuredClone(CANON_CHARACTERS.cursus))),
    otto: new Map(Object.entries(structuredClone(CANON_CHARACTERS.otto))),
  }
  let periodRuns = 0
  /** Месячный лимит канала для джобов опорных; тест опускает его, чтобы увидеть отказ бюджета до очереди */
  const monthlyLimit: Record<ChannelId, number> = {
    cursus: costSummaries.cursus.budget.limit.usd_micro,
    otto: costSummaries.otto.budget.limit.usd_micro,
  }
  let canonJobs = 0
  /** Джобы опорных: ответ постановки — `queued`, а `GET /jobs/{id}` — уже итог. Мок рисует сразу, конец джоба экрану
   *  сообщает поток SSE (в тестах — фейковый) */
  const canonJobRecords = new Map<string, Job>()
  /** Канон выпусков (M5.10): по умолчанию план прибит к последним версиям и листы 6/6; тест задаёт отличия
   *  (`CanonTweak` по сущности), перевод на новые версии их обновляет */
  const episodeCanons = new Map<string, Record<string, CanonTweak>>()
  /** Прибитые версии планов выпусков (`canon_ref`): ставятся при создании версии плана, двигает их только перевод */
  const episodePins = new Map<string, CanonPins>()
  /** Листы обликов (M5.9) — как `sheet.json` и `chosen.json` бэкенда: кандидаты всех сборок и выбор по ракурсу */
  const canonSheets: Record<ChannelId, Map<string, MockSheet>> = { cursus: new Map(), otto: new Map() }
  for (const channel of ['cursus', 'otto'] as const) {
    for (const [id, count] of Object.entries(SHEETS_CHOSEN)) {
      const state = canonCharacters[channel].get(id.split('@')[0]!)
      const first = state?.versions.find((v) => v.data.appearances.some((a) => a.id === id))
      if (!first) continue
      const sheet: MockSheet = { candidates: [], chosen: {} }
      for (const [slot] of SHEET_ANGLES.slice(0, count)) {
        for (let n = 1; n <= ANCHOR_CANDIDATES; n += 1) sheet.candidates.push(mockCandidate(id, first.info.version, slot, n))
        sheet.chosen[slot] = sheet.candidates.at(-ANCHOR_CANDIDATES)!.id
      }
      canonSheets[channel].set(id, sheet)
    }
  }

  /** Создание референса: таймкоды есть — реплики и длительность по ним, нет — 422 как у бэкенда */
  function createReference(body: { channel: ChannelId; url?: string; subtitles: string }): MockResponse {
    const lines = body.subtitles.split('\n')
    const timed = lines.filter((line) => /-->/.test(line) || /^\s*\d{1,2}:\d{2}(?::\d{2})?\b/.test(line))
    const stamps = [...body.subtitles.matchAll(/(\d{1,2}:)?\d{1,2}:\d{2}/g)].map((m) => clockSeconds(m[0]))
    if (!timed.length || !stamps.length) return fail(422, NO_TIMECODES)
    const number = Math.max(0, ...references.map((r) => Number(r.id.slice(3)))) + 1
    const reference: ReferenceVideo = {
      id: `ref${String(number).padStart(4, '0')}`,
      channel: body.channel,
      url: (body.url ?? '').trim(),
      title: '',
      author: '',
      duration_s: Math.max(...stamps) || 1,
      cues: timed.length,
      subtitles: body.subtitles,
      analysis: null,
      metrics: null,
      created_at: NOW,
      analyzed_at: null,
    }
    references.unshift(reference)
    return ok(reference, 201)
  }

  /** Разбор чата: JSON с сегментами (не меньше двух) → разбор и метрики; иначе 422 `BridgeError` */
  function analyzeReference(reference: ReferenceVideo, text: string): MockResponse {
    const start = text.indexOf('{')
    let data: unknown = null
    try {
      data = start < 0 ? null : JSON.parse(text.slice(start, text.lastIndexOf('}') + 1))
    } catch {
      data = null
    }
    const hint = 'Скопируйте ошибки в чат и попросите прислать разбор исправленным, целиком одним блоком ```json.'
    const segments = isPlainObject(data) && Array.isArray(data.segments) ? (data.segments as Record<string, unknown>[]) : []
    if (segments.length < 2) {
      return {
        status: 422,
        body: { message: 'Разбор не прошёл проверку: 1 ошибка.', hint, errors: [{ path: 'segments', message: 'сегментов меньше двух — разбор слишком грубый' }] } satisfies BridgeError,
      }
    }
    const raw = data as Record<string, unknown>
    const analysis: ReferenceAnalysis = {
      title: String(raw.title ?? ''),
      author: String(raw.author ?? ''),
      topic: String(raw.topic ?? ''),
      segments: segments.map((seg) => ({
        kind: seg.kind as Kind,
        label: String(seg.label),
        start: typeof seg.start === 'number' ? seg.start : clockSeconds(String(seg.start)),
        facts: Number(seg.facts ?? 0),
      })),
      techniques: Array.isArray(raw.techniques) ? (raw.techniques as ReferenceAnalysis['techniques']) : [],
    }
    const norm = formats[reference.channel].preset.words_per_minute
    Object.assign(reference, {
      title: analysis.title,
      author: analysis.author,
      analysis,
      metrics: metricsOf(analysis, reference.duration_s, Math.round((reference.duration_s / 60) * 140), norm),
      analyzed_at: NOW,
    })
    return ok(reference)
  }

  /** Выпуск по референсу, как `POST /api/references/{id}/episodes`: разбора нет — 409 */
  function episodeFromReference(reference: ReferenceVideo, mode: 'structure_clone' | 'own_version'): MockResponse {
    if (!reference.analysis) return fail(409, 'Сначала разберите референс: скопируйте промпт разбора и вставьте ответ чата.')
    created += 1
    const episode: EpisodeListItem = {
      id: `${reference.channel[0]}${String(10 + created).padStart(2, '0')}`,
      channel: reference.channel,
      title: 'Новый выпуск',
      short_title: null,
      origin: 'reference',
      stage: 'script',
      status: 'queued',
      slot_date: nextFree(),
      created_at: NOW,
      updated_at: NOW,
      summary: summary({}),
    }
    state.push(episode)
    projectOf(episode).brief = {
      ...emptyBrief,
      idea: mode === 'own_version' ? reference.analysis.topic : '',
      reference_id: reference.id,
      reference_mode: mode,
    }
    return ok(episode, 201)
  }

  /** Сходство плана выпуска по референсу: у мока — 3 % при пороге 10 %, если план есть */
  function similarityOf(episode: EpisodeListItem): MockResponse {
    if (!projectOf(episode).brief?.reference_id) {
      return ok({ similarity: null, reason: 'Выпуск не по референсу — сравнивать не с чем.' } satisfies SimilarityReport)
    }
    if (!effectivePlan(episode)) return ok({ similarity: null, reason: 'Плана ещё нет — сравнивать нечего.' } satisfies SimilarityReport)
    return ok({
      similarity: { ratio: 0.03, threshold: 0.1, ngram: 5, ok: true, matched: 3, total: 100, phrases: [] },
      reason: null,
    } satisfies SimilarityReport)
  }

  /** Следующий номер идеи: глобальный, как у бэкенда */
  const nextIdeaId = () => `i${String(Math.max(0, ...ideas.map((i) => Number(i.id.slice(1)))) + 1).padStart(4, '0')}`

  /** PATCH семян: как `ChannelPatch` бэкенда — пустые выбрасываются, до 20, до 80 знаков, без повторов */
  /** `PATCH /api/channels/{id}`: семена ниши (M4.8) и выключатель проверки анахронизмов (M6.6); поле не прислано — не
   *  меняется */
  function patchChannel(channel: string, body: unknown): MockResponse {
    const profile = profiles.find((p) => p.id === channel)
    if (!profile) return fail(404, `Канал «${channel}» не найден. Создайте каналы: PYTHONPATH=backend uv run python -m app.tools.seed`)
    if (isPlainObject(body) && isPlainObject(body.checks) && typeof body.checks.anachronism === 'boolean') {
      profile.checks = { anachronism: body.checks.anachronism }
    }
    if (!isPlainObject(body) || !('seeds' in body)) return ok(profile)
    const raw = isPlainObject(body) && Array.isArray(body.seeds) ? (body.seeds as unknown[]).map(String) : []
    const seeds = raw.map((seed) => seed.trim()).filter(Boolean)
    const invalid = (msg: string) => ({ status: 422, body: { detail: [{ type: 'value_error', loc: ['body', 'seeds'], msg }] } })
    if (seeds.length > 20) return invalid(`Семян ${seeds.length}, а можно не больше 20 — уберите лишние.`)
    const seen = new Set<string>()
    for (const seed of seeds) {
      if (seed.length > 80) return invalid(`Семя «${seed.slice(0, 40)}…» длиннее 80 знаков — сократите его до пары слов.`)
      if (seen.has(seed.toLowerCase())) return invalid(`Семя «${seed}» повторяется — оставьте одно.`)
      seen.add(seed.toLowerCase())
    }
    profile.seeds = seeds
    return ok(profile)
  }

  function patchIdea(target: Idea, patch: IdeaPatch): MockResponse {
    if (patch.status && patch.status !== target.status) {
      if (patch.status === 'used') {
        return fail(409, 'Статус «взята в выпуск» ставит создание выпуска из идеи: «Начать выпуск» (POST /api/episodes с idea_id).')
      }
      const allowed = IDEA_MOVES[target.status]
      if (!allowed.includes(patch.status)) {
        const options = allowed.map((s) => `«${IDEA_STATUS[s]}»`).join(', ') || 'никуда'
        return fail(409, `Идею со статусом «${IDEA_STATUS[target.status]}» нельзя перевести в «${IDEA_STATUS[patch.status]}»: можно ${options}.`)
      }
    }
    const { status, ...texts } = patch
    Object.assign(target, texts, status ? { status } : {}, { updated_at: NOW })
    return ok(target)
  }

  /** Ответ чата на промпт идей — как `review_proposals`: битая и дубль пропускаются, ни одной принятой — 422 */
  function ideasAnswer(channel: Idea['channel'], text: string): MockResponse {
    const start = text.indexOf('{')
    let data: unknown = null
    try {
      data = start < 0 ? null : JSON.parse(text.slice(start, text.lastIndexOf('}') + 1))
    } catch {
      data = null
    }
    const hint = 'Попросите чат прислать идеи целиком одним блоком ```json вида {"ideas": [...]}.'
    const list = isPlainObject(data) && Array.isArray(data.ideas) ? (data.ideas as unknown[]) : null
    if (!list?.length) return { status: 422, body: { message: 'В ответе нет списка идей: ожидался {"ideas": [...]}.', hint, errors: [] } satisfies BridgeError }
    const taken = new Map<string, string>()
    for (const e of state.filter((e) => e.channel === channel)) taken.set(titleKey(e.title), 'уже есть выпуск с таким названием')
    for (const i of ideas.filter((i) => i.channel === channel && i.status !== 'dropped')) {
      taken.set(titleKey(i.title), { backlog: 'уже в бэклоге', proposed: 'уже предложена', used: 'уже взята в выпуск', dropped: '' }[i.status])
    }
    const created: Idea[] = []
    const skipped: IdeasAnswerResult['skipped'] = []
    list.forEach((item, i) => {
      const index = i + 1
      if (!isPlainObject(item)) return skipped.push({ index, title: null, reason: 'ожидался объект идеи {…}' })
      const title = typeof item.title === 'string' ? item.title.trim() : ''
      const missing = ['angle', 'hook_promise', 'summary'].filter((k) => typeof item[k] !== 'string')
      if (!title) return skipped.push({ index, title: null, reason: 'Название не может быть пустым — введите текст.' })
      if (missing.length) return skipped.push({ index, title, reason: missing.map((k) => `нет поля «${k}»`).join('; ') })
      const reason = taken.get(titleKey(title))
      if (reason) return skipped.push({ index, title, reason: `«${title}» — ${reason}` })
      taken.set(titleKey(title), `повторяет идею ${index} этого ответа`)
      const score = typeof item.score === 'number' ? item.score : null
      const next = idea(Number(nextIdeaId().slice(1)), {
        channel,
        status: 'proposed',
        title,
        angle: String(item.angle),
        hook_promise: String(item.hook_promise),
        summary: String(item.summary),
        score,
        score_reason: typeof item.score_reason === 'string' ? item.score_reason : null,
        created_at: NOW,
        updated_at: NOW,
      })
      ideas.push(next)
      created.push(next)
      return undefined
    })
    const errors = skipped.map((s) => ({ path: `ideas[${s.index - 1}]`, message: `идея ${s.index}: ${s.reason}` }))
    if (!created.length) {
      const word = ru(skipped.length, ['пропущена', 'пропущены', 'пропущено'])
      return { status: 422, body: { message: `Ни одна идея не принята: ${skipped.length} ${word}.`, hint, errors } satisfies BridgeError }
    }
    runs += 1
    return ok({ run_id: `run-${runs}`, created, skipped } satisfies IdeasAnswerResult)
  }

  /** Выпуск из идеи (`idea_id`): идея этого канала и в бэклоге; иначе 404 / 422 / 409, как бэкенд */
  function ideaForEpisode(request: EpisodeCreate): Idea | MockResponse | null {
    if (!request.idea_id) return null
    if (request.origin !== 'backlog') {
      return { status: 422, body: { detail: [{ type: 'idea_origin', loc: ['body'], msg: 'Выпуск из идеи создаётся с origin «backlog» — поправьте origin или уберите idea_id.' }] } }
    }
    const found = ideas.find((i) => i.id === request.idea_id)
    if (!found) return fail(404, `Идея «${request.idea_id}» не найдена.`)
    if (found.channel !== request.channel) {
      return fail(422, `Идея «${found.title}» (${found.id}) — из канала ${found.channel}, а выпуск создаётся в ${request.channel}. Выберите идею этого канала.`)
    }
    if (found.status !== 'backlog') {
      const where = found.status === 'used' && found.episode_id ? ` ${found.episode_id}` : ''
      return fail(409, `Идея «${found.title}» ${IDEA_STATUS[found.status]}${where} — выпуск создаётся только из идеи в бэклоге.`)
    }
    return found
  }

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
      pinEpisode(episode)
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
      if (typeof image.prompt === 'string') errors.push(...promptErrors(id, image.prompt))
      if (typeof merged.vo === 'string' && !merged.vo.trim()) {
        errors.push({ type: 'shot_override', loc: ['shots', id, 'user_override', 'vo'], msg: `кадр ${id}: пустой vo, ожидалось текст закадрового голоса` })
      }
      if (Object.keys(merged).length) next[id] = merged
      else delete next[id]
    }
    if (errors.length) return { status: 422, body: { detail: errors } }
    // Правка промпта или крупности нарисованного кадра — `stale` (`edit_stale`); утверждение остаётся (M6.11)
    for (const id of Object.keys(shots)) {
      const shot = plan?.shots.find((item) => item.id === id)
      if (!shot || !hasPicture(episode, shot)) continue
      const was = (edits[id]?.image ?? {}) as Record<string, unknown>
      const now = (next[id]?.image ?? {}) as Record<string, unknown>
      const reasons = [
        ...(was.prompt !== now.prompt ? ['Промпт изменён вручную'] : []),
        ...(was.shot_size !== now.shot_size ? ['Крупность изменена вручную'] : []),
      ].filter((reason) => !shot.stale_reasons.includes(reason))
      if (reasons.length) Object.assign(shot, { status: 'stale', stale_reasons: [...shot.stale_reasons, ...reasons] })
    }
    overrides.set(episode.id, next)
    const project = projectOf(episode)
    // Выбранная версия и причина сбоя (экран 4) — не правка: остаются как были
    for (const shot of plan?.shots ?? []) {
      project.shots[shot.id] = {
        ...project.shots[shot.id],
        status: shot.status,
        duration_locked: false,
        prompt_locked: false,
        user_override: next[shot.id] ?? null,
        stale_reasons: shot.stale_reasons,
      }
    }
    return null
  }

  /** Проверка действия кадра, как у правки на листе (принцип 13): стоп-лист стилевых токенов и непустое действие */
  function promptErrors(id: string, prompt: string): { type: string; loc: (string | number)[]; msg: string }[] {
    const loc = ['shots', id, 'user_override', 'image', 'prompt']
    if (!prompt.trim()) return [{ type: 'shot_override', loc, msg: `кадр ${id}: пустое действие в image.prompt, ожидалось действие, композиция и ракурс` }]
    if (prompt.includes(STYLE_TOKEN)) {
      return [
        {
          type: 'shot_override',
          loc,
          msg: `кадр ${id}: в image.prompt стилевой токен «cinematic lighting» (lighting), ожидалось только действие, композиция и ракурс — стиль задаёт канон`,
        },
      ]
    }
    return []
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
      pinEpisode(episode)
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

  /** Смета как у `plan_estimate` бэкенда: кадры, голос, клипы, план через мост; остаток месяца — от сводки расходов.
   *  Кадры с годной картинкой (M6.11) — строкой «Уже нарисовано»: выбрана версия, кадр не `stale` и не `failed`; хэшей
   *  запроса мок не считает */
  function estimateOf(episode: EpisodeListItem): MockResponse {
    const plan = effectivePlan(episode)
    if (!plan) return fail(409, 'Плана ещё нет — смета появится, когда план будет собран: вставьте ответ чата или импортируйте JSON.')
    const shots = plan.shots.filter((shot) => shot.status !== 'removed')
    const states = projectOf(episode).shots
    const drawn = shots.filter((shot) => {
      const state = states[shot.id]
      return !!state?.image_version && !state.stale_reasons.length && !state.error && !['stale', 'failed'].includes(state.status)
    }).length
    const toDraw = shots.length - drawn
    const chars = shots.reduce((sum, shot) => sum + shot.vo.length, 0)
    const clips = shots.filter((shot) => shot.animate.recommended)
    const seconds = clips.reduce((sum, shot) => sum + shot.animate.seconds, 0)
    const sameLength = new Set(clips.map((shot) => shot.animate.seconds)).size <= 1
    const clipWord = ru(clips.length, ['клип', 'клипа', 'клипов'])
    const lines = [
      estimateLine('Кадры', `${toDraw} × $0.067`, 'images', 'gemini-3.1-flash-image', [
        { unit: 'image', quantity: toDraw, variant: '1K', usd_micro: PRICE.image * toDraw },
      ]),
      ...(drawn
        ? [
            estimateLine('Уже нарисовано', `${count(drawn)} ${ru(drawn, ['кадр', 'кадра', 'кадров'])}`, 'images', 'gemini-3.1-flash-image', [
              { unit: 'image', quantity: 0, variant: '1K', usd_micro: 0 },
            ]),
          ]
        : []),
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
    const animation = lines.find((line) => line.title === 'Анимация')!.usd.usd_micro
    const budgets = profiles.find((c) => c.id === episode.channel)!.budgets
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
    const changes: ShotChange[] = []
    const shots = director.shots.map((raw) => {
      const shot = raw as PlanShot
      const old = before.get(shot.id)
      if (!old) {
        changes.push({ shot_id: shot.id, section: shot.section, kind: 'added', change: 'Новый кадр', fields: [], stale: false, drawn_at: null, price: null })
        return { ...planShot(1), ...shot, status: 'todo', stale_reasons: [], overridden: [] }
      }
      // Как `diff_shots` бэкенда, без словарного diff: картинку меняют промпт и крупность, VO — нет
      const fields = [
        ...(old.vo !== shot.vo ? ['vo'] : []),
        ...(old.image.prompt !== shot.image?.prompt ? ['image.prompt'] : []),
        ...(old.image.shot_size !== shot.image?.shot_size ? ['image.shot_size'] : []),
      ]
      const drawn = drawnOf(episode, shot.id)
      const stale = hasPicture(episode, old) && fields.some((field) => field.startsWith('image.'))
      const change = fields.map((field) => ({ vo: 'VO изменён', 'image.prompt': 'Промпт изменён', 'image.shot_size': 'Крупность изменена' })[field]).join('; ')
      if (fields.length) changes.push({ shot_id: shot.id, section: shot.section, kind: 'changed', change, fields, stale, ...drawn })
      if (stale) setShot(episode, shot.id, { status: 'stale', stale_reasons: [change] })
      return { ...planShot(1), ...shot, status: stale ? 'stale' : old.status, stale_reasons: stale ? [change] : old.stale_reasons, overridden: [] }
    }) as PlanShot[]
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
    pinEpisode(episode)
    partSets.delete(episode.id) // любой импорт сбрасывает недособранный набор частей моста, как `_clear_parts`
    projectOf(episode).director_version = version
    if (episode.stage === 'generate') Object.assign(episode, { stage: 'script', updated_at: NOW })
    const ids = new Set(shots.map((shot) => shot.id))
    for (const [id, old] of before) {
      if (ids.has(id)) continue
      changes.push({ shot_id: id, section: old.section, kind: 'removed', change: `Кадр убран из плана ${version}`, fields: [], stale: false, ...drawnOf(episode, id) })
    }
    const counted = (kind: ShotChange['kind']) => changes.filter((change) => change.kind === kind).length
    return ok({ version, created: true, added: counted('added'), changed: counted('changed'), removed: counted('removed'), changes } satisfies ImportResult)
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
    const canon = episodeCanonOf(episode)?.problems ?? []
    for (const { message, ...target } of canon) problems.push({ check: 'canon', shot_id: null, message, canon: target })
    if (problems.length) {
      const parts = problems.filter((p) => p.shot_id === null && p.check !== 'canon').map((p) => p.message)
      if (canon.length) parts.push(canonRefusal(canon))
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

  /** Канон текущей версии плана (`GET …/canon`); плана нет — `null` */
  function episodeCanonOf(episode: EpisodeListItem): EpisodeCanon | null {
    const plan = plansOf(episode)
    return plan ? mockEpisodeCanon(plan, episodeCanons.get(episode.id), episodePins.get(episode.id), canonFacts(episode.channel)) : null
  }

  /** Канон канала для канона выпуска; `null` — сущности нет ни в каноне, ни в «нужно каналу» (облики плана
   *  артборда 3, которых нет в артборде 12) — она считается готовой */
  function canonFacts(channel: ChannelId): CanonLookup {
    return (kind, id) => {
      if (kind === 'style') {
        const style = canonStyles[channel]
        return { versions: style.versions.map((v) => v.info.version), draft: style.draft !== null, sheet: () => SHEET_READY }
      }
      const needed = PLAN_REFS[channel]
      if (kind === 'period') {
        const state = canonPeriods[channel].get(id)
        if (!state && !needed.periods.some((item) => item.id === id)) return null
        return { versions: state?.versions.map((v) => v.info.version) ?? [], draft: Boolean(state?.draft), sheet: () => SHEET_READY }
      }
      const character = canonCharacters[channel].get(id.split('@')[0]!)
      const versions = (character?.versions ?? []).filter((v) => v.data.appearances.some((a) => a.id === id)).map((v) => v.info.version)
      const draft = Boolean(character?.draft?.data.appearances.some((a) => a.id === id))
      if (!versions.length && !draft && !needed.appearances.some((item) => item.id === id)) return null
      return {
        versions,
        draft,
        sheet: (version) => {
          const { status, chosen, total } = appearanceAnchors(channel, id, version)
          return { status, chosen, total }
        },
      }
    }
  }

  /** Новая версия плана прибивает новые ссылки (прежние сохраняют версию) — как импорт M5.2 */
  function pinEpisode(episode: EpisodeListItem) {
    const plan = plans.get(episode.id)
    if (plan) episodePins.set(episode.id, pinPlan(plan, episodePins.get(episode.id) ?? {}, canonFacts(episode.channel)))
  }

  /** «Перевести на новые версии», как бэкенд M5.2: новая версия `manual` со ссылками на последние версии; затронутые
   *  кадры — `stale` с причиной «Эпоха …: periods/…/v001 → periods/…/v002»; переводить нечего — `created: false` */
  function updateCanon(episode: EpisodeListItem): MockResponse {
    const plan = plansOf(episode)
    if (!plan) return fail(409, 'Плана ещё нет — переводить на новые версии нечего.')
    const tweaks = { ...episodeCanons.get(episode.id) }
    const pins = { ...episodePins.get(episode.id) }
    const canon = mockEpisodeCanon(plan, tweaks, pins, canonFacts(episode.channel))
    if (!canon.updatable) return ok({ version: plan.version, created: false, added: 0, changed: 0, removed: 0, changes: [] } satisfies ImportResult)
    const moved: { kind: CanonKind; id: string; reason: string }[] = []
    const move = (kind: CanonKind, key: string, item: EpisodeCanonItem, title: string) => {
      if (item.latest === null || item.latest === item.pinned) return
      moved.push({ kind, id: item.id, reason: `${title}: ${item.ref} → ${canonRefOf(kind, item.id, item.latest)}` })
      pins[key] = item.latest
      // Отличия теста в прибитой версии и её находимости уступают переводу
      const next: CanonTweak = { ...tweaks[key] }
      delete next.pinned
      delete next.resolved
      tweaks[key] = next
    }
    move('style', 'style', canon.style, 'Стиль канала')
    for (const item of canon.periods) move('period', `period:${item.id}`, item, `Эпоха ${item.id}`)
    for (const item of canon.appearances) move('appearance', `appearance:${item.id}`, item, `Облик ${item.id}`)
    episodeCanons.set(episode.id, tweaks)
    episodePins.set(episode.id, pins)

    const version = `v${String(Number(plan.version.slice(1)) + 1).padStart(3, '0')}`
    const changes: ShotChange[] = []
    const shots = plan.shots.map((shot): PlanShot => {
      if (shot.status === 'removed') return shot
      const reasons = moved
        .filter(({ kind, id }) => kind === 'style' || (kind === 'period' ? shot.image.period === id : shot.image.appearances.includes(id)))
        .map(({ reason }) => reason)
      if (!reasons.length) return shot
      // Устаревать может только картинка (M6.1): у кадра без неё причины — история, статус прежний
      const pictured = hasPicture(episode, shot)
      changes.push({ shot_id: shot.id, section: shot.section, kind: 'changed', change: reasons.join('; '), fields: [], stale: pictured, ...drawnOf(episode, shot.id) })
      if (!pictured) return { ...shot, stale_reasons: [...new Set([...shot.stale_reasons, ...reasons])] }
      setShot(episode, shot.id, { status: 'stale', stale_reasons: reasons })
      return { ...shot, status: 'stale', stale_reasons: reasons }
    })
    plans.set(episode.id, { ...plan, version, source: 'manual', shots })
    partSets.delete(episode.id) // перевод — тоже импорт: набор частей моста сбрасывается, как у бэкенда
    projectOf(episode).director_version = version
    if (episode.stage === 'generate') Object.assign(episode, { stage: 'script', updated_at: NOW })
    return ok({ version, created: true, added: 0, changed: changes.length, removed: 0, changes } satisfies ImportResult)
  }

  /** У кадра есть картинка: выбрана версия или — у плана артборда 3, где ассетов нет, — кадр «готов» или устарел */
  function hasPicture(episode: EpisodeListItem, shot: PlanShot): boolean {
    return !!projectOf(episode).shots[shot.id]?.image_version || shot.status === 'done' || shot.status === 'stale'
  }

  /** Дата и цена выбранной версии кадра для строки отчёта импорта (M6.11); картинки нет — null */
  function drawnOf(episode: EpisodeListItem, shotId: string): Pick<ShotChange, 'drawn_at' | 'price'> {
    const project = projectOf(episode)
    const version = project.shots[shotId]?.image_version
    const asset = version ? project.assets[`img-${shotId}-v${version}`] : undefined
    if (!asset) return { drawn_at: null, price: null }
    return { drawn_at: asset.created_at ?? null, price: unitMoney(asset.usd_micro ?? 0) }
  }

  /** Предпросмотр запроса кадра действующего плана (`GET …/shots/{id}/prompt`): ничего не пишет и не оплачивает */
  function shotPromptOf(episode: EpisodeListItem, shotId: string): MockResponse {
    const plan = effectivePlan(episode)
    const canon = episodeCanonOf(episode)
    if (!plan || !canon) return fail(409, 'Плана ещё нет — предпросмотр промпта появится, когда план будет собран.')
    const shot = plan.shots.find((item) => item.id === shotId && item.status !== 'removed')
    if (!shot) return fail(404, `Кадра ${shotId} в действующем плане выпуска нет.`)
    return ok(mockShotPrompt(episode.channel, shot, canon))
  }

  /* ---- Канон канала: стиль, версии, кадры стиля (docs/canon_schema.md, «API» и «API опорных») ---- */

  /** Чей слой — для текстов ошибок, как `Layer.genitive` бэкенда: «стиля канала», «эпохи caribbean-1716» */
  interface Noun {
    genitive: string
    /** 404 без черновика и версий */
    missing: string
  }

  const versionDoc = <T,>(file: CanonVersionFile<T>) => ({
    draft: false,
    version: file.info.version,
    based_on: file.info.based_on,
    updated_at: file.info.published_at,
    data: structuredClone(file.data),
  })

  /** Шапка (`version: null`) — черновик, а без него последняя версия; `vNNN` — версия как есть */
  function layerDoc<T>(state: LayerState<T> | undefined, noun: Noun, version: string | null): MockResponse {
    if (version === null) {
      if (state?.draft) {
        const { based_on, saved_at, data } = state.draft
        return ok({ draft: true, version: null, based_on, updated_at: saved_at, data: structuredClone(data) })
      }
      const last = state?.versions.at(-1)
      return last ? ok(versionDoc(last)) : fail(404, noun.missing)
    }
    if (!/^v\d{3}$/.test(version)) {
      return { status: 422, body: { detail: [{ type: 'canon_version', loc: ['query', 'version'], msg: `Версия «${version}» не годится — нужна вида v001.` }] } }
    }
    const file = state?.versions.find((v) => v.info.version === version)
    const have = state?.versions.map((v) => v.info.version).join(', ')
    return file ? ok(versionDoc(file)) : fail(404, `У ${noun.genitive} нет версии ${version} — есть: ${have || 'ни одной'}.`)
  }

  /** Черновик целиком: `based_on` — у прежнего черновика, без него последняя версия (правят то, что видят) */
  function layerPut<T>(state: LayerState<T>, noun: Noun, data: T): MockResponse {
    const based_on = state.draft ? state.draft.based_on : (state.versions.at(-1)?.info.version ?? null)
    state.draft = { based_on, saved_at: NOW, data: structuredClone(data) }
    return layerDoc(state, noun, null)
  }

  function layerFrom<T>(state: LayerState<T> | undefined, noun: Noun, from: string): MockResponse {
    if (state?.draft) return fail(409, `У ${noun.genitive} уже есть черновик — опубликуйте или сбросьте его, потом создавайте черновик из ${from}.`)
    const file = state?.versions.find((v) => v.info.version === from)
    if (!state || !file) return layerDoc(state, noun, from)
    state.draft = { based_on: from, saved_at: NOW, data: structuredClone(file.data) }
    return { ...layerDoc(state, noun, null), status: 201 }
  }

  function layerDiscard<T>(state: LayerState<T> | undefined, noun: Noun): MockResponse {
    if (!state?.draft) return fail(404, `У ${noun.genitive} нет черновика — сбрасывать нечего.`)
    state.draft = null
    return ok(null, 204)
  }

  /** Правила публикации — все нарушения сразу, по фразе на строку; при отказе черновик остаётся */
  function layerPublish<T>(state: LayerState<T> | undefined, noun: Noun, problems: (data: T) => string[]): MockResponse {
    if (!state?.draft) return fail(409, `У ${noun.genitive} нет черновика — публиковать нечего.`)
    const found = problems(state.draft.data)
    if (found.length) return fail(409, found.join('\n'))
    const last = state.versions.at(-1)
    if (last && canonical(last.data) === canonical(state.draft.data)) {
      return fail(409, `Черновик ${noun.genitive} не отличается от ${last.info.version} — публиковать нечего, сбросьте черновик.`)
    }
    const file: CanonVersionFile<T> = {
      info: { version: `v${String(state.versions.length + 1).padStart(3, '0')}`, based_on: state.draft.based_on, published_at: NOW },
      data: state.draft.data,
    }
    state.versions.push(file)
    state.draft = null
    return ok(versionDoc(file), 201)
  }

  const styleNoun = (channel: ChannelId): Noun => ({ genitive: 'стиля канала', missing: `Стиля канала в каноне ${channel} нет — создайте черновик.` })
  const periodNoun = (channel: ChannelId, id: string): Noun => ({ genitive: `эпохи ${id}`, missing: `Эпохи ${id} в каноне ${channel} нет — создайте черновик.` })
  const characterNoun = (channel: ChannelId, id: string): Noun => ({ genitive: `персонажа ${id}`, missing: `Персонажа ${id} в каноне ${channel} нет — создайте черновик.` })


  /** Форма черновика (422): цвет #RRGGBB, не больше 5 образцов — как `Style` бэкенда */
  function styleShape(data: Style): MockResponse | null {
    const bad = data.palette.swatches.findIndex((swatch) => !/^#[0-9a-fA-F]{6}$/.test(swatch.hex))
    if (bad !== -1) {
      const hex = data.palette.swatches[bad]!.hex
      return { status: 422, body: { detail: [{ type: 'canon_hex', loc: ['body', 'palette', 'swatches', bad, 'hex'], msg: `Цвет «${hex}» не годится — нужен код #RRGGBB.` }] } }
    }
    const count = data.palette.swatches.length
    if (count > 5) {
      return { status: 422, body: { detail: [{ type: 'canon_swatches', loc: ['body', 'palette', 'swatches'], msg: `Образцов палитры ${count}, а можно не больше 5 — уберите лишние.` }] } }
    }
    return null
  }

  /** Правила публикации стиля (`Style.publish_problems`): все нарушения сразу, по фразе на строку */
  function stylePublishProblems(data: Style): string[] {
    const problems: string[] = []
    if (!data.render.trim()) problems.push('Стиль без рендера не публикуется — опишите технику изображения в поле render.')
    const count = data.palette.swatches.length
    if (count < 3) problems.push(`Образцов палитры ${count}, а нужно от 3 до 5 — добавьте цвета.`)
    for (const swatch of data.palette.swatches) {
      if (!swatch.role.trim()) problems.push(`У цвета ${swatch.hex} нет роли — напишите в role, для чего он, например shadows.`)
    }
    const cyrillic = /[Ѐ-ӿ]/
    const texts: [string, string][] = [
      ['render', data.render],
      ['material', data.material],
      ['processing', data.processing],
      ...Object.entries(data.optics).map(([key, value]): [string, string] => [`optics.${key}`, value]),
      ...Object.entries(data.light).map(([key, value]): [string, string] => [`light.${key}`, value]),
      ['palette.rule', data.palette.rule],
      ...data.palette.swatches.map((swatch, i): [string, string] => [`palette.swatches[${i}].role`, swatch.role]),
      ['grain', data.grain],
      ['composition', data.composition],
    ]
    for (const [path, text] of texts) {
      if (cyrillic.test(text)) problems.push(`Поле ${path} написано по-русски — текст канона уходит в промпт картинки, пишите по-английски.`)
    }
    if (data.negative_global.some((item) => !item.trim())) problems.push('Пустая позиция в списке negative_global — заполните или удалите её.')
    if (data.negative_global.some((item) => cyrillic.test(item))) {
      problems.push('Список negative_global написан по-русски — текст канона уходит в промпт картинки, пишите по-английски.')
    }
    return problems
  }

  /** Кадры стиля против последней версии: устаревают при смене рендера, оптики или света */
  function styleAnchors(style: StyleState, channel: ChannelId): AnchorSetState {
    const last = style.versions.at(-1)
    const version = last?.info.version ?? null
    const drawn = style.versions.find((v) => v.info.version === style.frames)
    const fields = drawn && last && drawn !== last ? staleStyleFields(drawn.data, last.data) : []
    const stale = fields.length ? `в ${version} изменились ${fields.join(', ')}` : null
    const slots = STYLE_FRAMES.map(([slot, label], i): AnchorSlot => {
      if (!drawn) return { slot, label, hint: '', candidates: [], chosen: null, stale: null }
      const id = `${slot}-1-${(0x3a7f + i * 977).toString(16)}`
      const file = `channels/${channel}/canon/anchors/style/${id}.jpg`
      const seed = 41_000 + i * 131
      return {
        slot,
        label,
        hint: '',
        candidates: [{ id, n: 1, status: 'ready', file, error: null, seed, version: drawn.info.version, ref: null, usd: money(ANCHOR_PRICE), cached: false, created_at: drawn.info.published_at }],
        chosen: { candidate: id, file, seed, version: drawn.info.version, chosen_at: drawn.info.published_at, usd: money(ANCHOR_PRICE) },
        stale,
      }
    })
    const chosen = drawn ? slots.length : 0
    return {
      channel,
      target: 'style',
      version,
      status: chosen === 0 ? 'missing' : stale ? 'outdated' : 'ready',
      chosen,
      total: slots.length,
      stale: stale ? `Кадры стиля устарели: ${stale} — пересоберите их.` : null,
      slots,
      spent: money(chosen * ANCHOR_PRICE),
    }
  }

  /** «Пересобрать кадры стиля»: стиль и эпоха опубликованы, месячный бюджет канала — до очереди (409 `BudgetRefusal`) */
  function collectStyleAnchors(style: StyleState, channel: ChannelId, period: string): MockResponse {
    const last = style.versions.at(-1)
    if (!last) return fail(409, 'Стиль канала не опубликован — опубликуйте его на экране «Канон», потом собирайте опорные.')
    if (!canonPeriods[channel].get(period)?.versions.length) {
      return fail(409, `Эпоха ${period} не опубликована — опубликуйте её на экране «Канон».`)
    }
    const cost = STYLE_FRAMES.length * ANCHOR_PRICE
    const refusal = budgetRefusalOf(channel, cost)
    if (refusal) return refusal
    style.frames = last.info.version // мок «дорисует» кадры: экран увидит их после конечного события джоба
    return canonJob('style_anchors', channel, { channel, target: 'style', period }, cost, {
      target: 'style',
      done: STYLE_FRAMES.length,
      charged: STYLE_FRAMES.length,
      cached: 0,
      failed: 0,
      spent_usd_micro: cost,
    })
  }

  /** Месячный бюджет канала — до очереди: превышение — 409 `BudgetRefusal`, джоб не создаётся (docs/providers.md) */
  function budgetRefusalOf(channel: ChannelId, cost: number): MockResponse | null {
    const { budget } = costSummaries[channel]
    const spent = budget.charged.usd_micro + budget.reserved.usd_micro
    const limit = monthlyLimit[channel]
    if (spent + cost <= limit) return null
    const head =
      spent >= limit
        ? `Месячный лимит ${formatUsd(limit)} исчерпан, потрачено ${formatUsd(spent)}`
        : `Месячный лимит ${formatUsd(limit)}: потрачено ${formatUsd(spent)}, операция — ${formatUsd(cost)}, не хватает ${formatUsd(spent + cost - limit)}`
    return fail(409, {
      code: 'budget_exceeded',
      level: 'month',
      limit_usd_micro: limit,
      spent_usd_micro: spent,
      queued_usd_micro: 0,
      cost_usd_micro: cost,
      message: `${head}; поднять лимит можно в настройках канала.`,
    } satisfies BudgetRefusal as unknown as Record<string, unknown>)
  }

  /** Джоб опорных уровня канала: ответ — `queued`, итог `result` — в `GET /jobs/{id}` */
  function canonJob(kind: string, channel: ChannelId, payload: Job['payload'], cost: number, result: NonNullable<Job['result']>): MockResponse {
    canonJobs += 1
    const job: Job = {
      id: `job-${kind.replaceAll('_', '-')}-${canonJobs}`,
      kind,
      status: 'queued',
      progress: 0,
      message: null,
      payload,
      result: null,
      error: null,
      attempts: 0,
      cancel_requested: false,
      episode_id: null,
      batch_id: null,
      idempotency_key: null,
      created_at: NOW,
      started_at: null,
      finished_at: null,
      cost_usd_micro: cost,
      cost_stage: 'anchors',
      channel,
    }
    const total = Number(result.done)
    canonJobRecords.set(job.id, { ...job, status: 'done', progress: 1, message: `Готово ${total} из ${total}: сбоев 0`, result, attempts: 1, started_at: NOW, finished_at: NOW })
    return ok(job, 201)
  }

  /* ---- Эпохи и персонажи (M5.8): правила публикации, «нужно каналу», мост эпохи, листы обликов, копия облика ---- */

  const CYRILLIC = /[Ѐ-ӿ]/

  /** Кириллица в тексте промпта и пустые позиции списков — как `_text_problems` бэкенда; подписи `label` — для экрана */
  function textProblems(node: Record<string, unknown>, owner = '', prefix = ''): string[] {
    const problems: string[] = []
    for (const [name, value] of Object.entries(node)) {
      if (name === 'label' || name === 'id' || name === 'appearances') continue
      const where = `${prefix}${name}${owner ? ` ${owner}` : ''}`
      if (typeof value === 'string' && CYRILLIC.test(value)) {
        problems.push(`Поле ${where} написано по-русски — текст канона уходит в промпт картинки, пишите по-английски.`)
      } else if (Array.isArray(value)) {
        const texts = value.filter((item): item is string => typeof item === 'string')
        if (texts.some((item) => !item.trim())) problems.push(`Пустая позиция в списке ${where} — заполните или удалите её.`)
        if (texts.some((item) => CYRILLIC.test(item))) {
          problems.push(`Список ${where} написан по-русски — текст канона уходит в промпт картинки, пишите по-английски.`)
        }
      } else if (value && typeof value === 'object' && name !== 'years') {
        problems.push(...textProblems(value as Record<string, unknown>, owner, `${prefix}${name}.`))
      }
    }
    return problems
  }

  /** `Period.publish_problems`: название, регион, годы и хотя бы один запрет (L-007) */
  function periodProblems(data: Period): string[] {
    const problems: string[] = []
    if (!data.label.trim()) problems.push('Эпоха без названия не публикуется — заполните label, например «Карибы, 1716».')
    if (!data.region.trim()) problems.push('Эпоха без региона не публикуется — заполните region, например Caribbean Sea.')
    if (!data.years) problems.push('Эпоха без годов не публикуется — заполните years.from и years.to.')
    if (!data.forbidden.length) problems.push('Эпоха без запретов не публикуется — добавьте хотя бы один анахронизм.')
    return [...problems, ...textProblems(data as unknown as Record<string, unknown>)]
  }

  /** `Character.publish_problems`: имя, черты лица, хотя бы один облик; у облика — название и эпоха */
  function characterProblems(data: Character): string[] {
    const problems: string[] = []
    if (!data.label.trim()) problems.push('Персонаж без имени не публикуется — заполните label.')
    if (!data.nature.face.trim()) problems.push('Персонаж без черт лица не публикуется — заполните nature.face: по ним собирается лист портретов.')
    if (!data.appearances.length) problems.push('Персонаж без обликов не публикуется — добавьте хотя бы один облик.')
    problems.push(...textProblems(data as unknown as Record<string, unknown>))
    for (const appearance of data.appearances) {
      if (!appearance.label.trim()) problems.push(`Облик ${appearance.id} без названия не публикуется — заполните label.`)
      if (!appearance.period.trim()) problems.push(`Облик ${appearance.id} без эпохи не публикуется — укажите period.`)
      problems.push(...textProblems(appearance as unknown as Record<string, unknown>, `облика ${appearance.id}`))
    }
    return problems
  }

  const shapeError = (loc: (string | number)[], msg: string, type = 'canon_shape'): MockResponse => ({ status: 422, body: { detail: [{ type, loc, msg }] } })

  /** Форма тела эпохи и персонажа (422): id совпадает с адресом, годы по порядку, возраст 0–120, облики своего персонажа */
  function entityShape(kind: 'periods' | 'characters', id: string, data: Period | Character): MockResponse | null {
    if (data.id !== id) return shapeError(['body', 'id'], `id «${data.id}» в теле не совпадает с адресом «${id}» — исправьте одно из двух.`)
    if (kind === 'periods') {
      const { years } = data as Period
      if (years && years.from > years.to) {
        return shapeError(['body', 'years'], `Годы эпохи наоборот: from ${years.from} позже to ${years.to} — поменяйте их местами.`, 'canon_years')
      }
      return null
    }
    const seen = new Set<string>()
    for (const [i, appearance] of (data as Character).appearances.entries()) {
      if (!appearance.id.startsWith(`${id}@`)) {
        return shapeError(['body', 'appearances', i, 'id'], `Облик ${appearance.id} не принадлежит персонажу ${id} — id облика начинается с «${id}@».`)
      }
      if (seen.has(appearance.id)) return shapeError(['body', 'appearances', i, 'id'], `Облик ${appearance.id} повторяется — у каждого облика свой id.`)
      seen.add(appearance.id)
      if (appearance.age !== null && (appearance.age < 0 || appearance.age > 120)) {
        return shapeError(['body', 'appearances', i, 'age'], `Возраст ${appearance.age} вне 0–120 — укажите полных лет.`)
      }
    }
    return null
  }

  const headOf = <T,>(state: LayerState<T>): T => (state.draft ? state.draft.data : state.versions.at(-1)!.data)

  /** Последняя опубликованная версия персонажа, где облик есть */
  function latestWith(channel: ChannelId, appearanceId: string): string | null {
    const state = canonCharacters[channel].get(appearanceId.split('@')[0]!)
    const found = [...(state?.versions ?? [])].reverse().find((v) => v.data.appearances.some((a) => a.id === appearanceId))
    return found?.info.version ?? null
  }

  /** Облик в версии персонажа: неизменяемое и сам облик — для устаревания листа */
  function appearanceAt(channel: ChannelId, appearanceId: string, version: string): { nature: Character['nature']; look: Appearance } | null {
    const data = canonCharacters[channel].get(appearanceId.split('@')[0]!)?.versions.find((v) => v.info.version === version)?.data
    const found = data?.appearances.find((a) => a.id === appearanceId)
    return data && found ? { nature: data.nature, look: found } : null
  }

  /** Что изменилось у облика между версией выбора и текущей — как `_sheet_picks` бэкенда; null — ракурс годен */
  function slotStale(channel: ChannelId, appearanceId: string, from: string, to: string, slot: string): MockStale | null {
    if (from === to) return null
    const before = appearanceAt(channel, appearanceId, from)
    const after = appearanceAt(channel, appearanceId, to)
    if (!before || !after) return { whole: [], body: [], missing: true }
    const value = (side: NonNullable<typeof before>, name: string) => JSON.stringify(name === 'nature.face' ? side.nature.face : side.look[name as keyof Appearance])
    const changed = (names: readonly string[]) => names.filter((name) => value(before, name) !== value(after, name))
    const whole = changed(SHEET_FIELDS)
    const body = BODY_ANGLES.has(slot) ? changed(BODY_FIELDS) : []
    return whole.length || body.length ? { whole, body, missing: false } : null
  }

  function sheetOf(channel: ChannelId, appearanceId: string): MockSheet {
    const sheets = canonSheets[channel]
    if (!sheets.has(appearanceId)) sheets.set(appearanceId, { candidates: [], chosen: {} })
    return sheets.get(appearanceId)!
  }

  /** Лист облика против последней опубликованной версии с ним (у канона выпуска — против прибитой): ракурсы по порядку,
   *  устаревание по правилу бэкенда */
  function appearanceAnchors(channel: ChannelId, appearanceId: string, against?: string): AnchorSetState {
    const version = against ?? latestWith(channel, appearanceId)
    const sheet = sheetOf(channel, appearanceId)
    const dir = `channels/${channel}/canon/anchors/${appearanceId}`
    const stale = new Map<string, MockStale>()
    const slots = SHEET_ANGLES.map(([slot, label, hint]): AnchorSlot => {
      const pick = sheet.candidates.find((c) => c.id === sheet.chosen[slot] && c.status === 'ready')
      const reason = pick && version ? slotStale(channel, appearanceId, pick.version, version, slot) : null
      if (reason) stale.set(slot, reason)
      return {
        slot,
        label,
        hint,
        candidates: sheet.candidates
          .filter((c) => c.slot === slot)
          .map((c) => ({
            id: c.id,
            n: c.n,
            status: c.status,
            file: c.status === 'failed' ? null : `${dir}/${c.status === 'rejected' ? 'rejected' : 'candidates'}/${c.id}.jpg`,
            error: c.error,
            seed: c.seed,
            version: c.version,
            ref: null,
            usd: money(c.usd_micro),
            cached: false,
            created_at: c.created_at,
          })),
        chosen: pick ? { candidate: pick.id, file: `${dir}/candidates/${pick.id}.jpg`, seed: pick.seed, version: pick.version, chosen_at: NOW, usd: money(pick.usd_micro) } : null,
        stale: reason ? (reason.missing ? 'версии выбора нет в каноне — пересоберите' : `в ${version} изменились ${[...reason.whole, ...reason.body].join(', ')}`) : null,
      }
    })
    const chosen = slots.filter((slot) => slot.chosen).length
    const reasons = [...stale.values()]
    const whole = [...new Set(reasons.flatMap((r) => r.whole))]
    const summary = !reasons.length
      ? null
      : whole.length
        ? `Лист устарел: в ${version} изменились ${whole.join(', ')} — пересоберите лист.`
        : reasons.some((r) => r.missing)
          ? 'Лист устарел: версии, с которой сделан выбор, нет в каноне — пересоберите лист.'
          : `Устарели ракурсы ${slots
              .filter((slot) => stale.has(slot.slot))
              .map((slot) => `«${slot.label}»`)
              .join(', ')}: в ${version} изменились ${[...new Set(reasons.flatMap((r) => r.body))].join(', ')} — перегенерируйте их.`
    return {
      channel,
      target: appearanceId,
      version,
      status: chosen === 0 ? 'missing' : stale.size ? 'outdated' : chosen < SHEET_ANGLES.length ? 'partial' : 'ready',
      chosen,
      total: SHEET_ANGLES.length,
      stale: summary,
      slots,
      spent: money(sheet.candidates.reduce((sum, c) => sum + c.usd_micro, 0)),
    }
  }

  /** Смета листа по адресу облика: строка `stale` — устаревшие ракурсы */
  function appearanceEstimate(channel: ChannelId, appearanceId: string): AnchorsEstimate {
    const n = appearanceAnchors(channel, appearanceId).slots.filter((slot) => slot.stale).length
    const label = `${n} ${ru(n, ['ракурс', 'ракурса', 'ракурсов'])} × ${ANCHOR_CANDIDATES} кандидата`
    return { ...anchorsEstimate, stale: n ? anchorLine('Пересобрать устаревшие ракурсы', label, n * ANCHOR_CANDIDATES) : null }
  }

  /** Канон листа опубликован — версия персонажа с обликом; нет — 409 с тем, что опубликовать */
  function sheetVersion(channel: ChannelId, appearanceId: string): string | MockResponse {
    if (!canonStyles[channel].versions.length) return fail(409, 'Стиль канала не опубликован — опубликуйте его на экране «Канон», потом собирайте опорные.')
    const version = latestWith(channel, appearanceId)
    if (!version) return fail(409, `Облик ${appearanceId} не опубликован — опубликуйте персонажа с этим обликом на экране «Канон», потом собирайте лист.`)
    const period = appearanceAt(channel, appearanceId, version)!.look.period
    if (!canonPeriods[channel].get(period)?.versions.length) return fail(409, `Эпоха ${period} облика ${appearanceId} не опубликована — опубликуйте её на экране «Канон».`)
    return version
  }

  /** Фас-референс годен: выбранный фас, если лицо с его версии не менялось, или удавшийся фас версии заказа */
  function hasFront(channel: ChannelId, appearanceId: string, version: string): boolean {
    const sheet = sheetOf(channel, appearanceId)
    const pick = sheet.candidates.find((c) => c.id === sheet.chosen.front && c.status === 'ready')
    if (pick && !slotStale(channel, appearanceId, pick.version, version, 'front')) return true
    return sheet.candidates.some((c) => c.slot === 'front' && c.status === 'ready' && c.version === version)
  }

  /** Заказ листа: кандидаты рисуются сразу (тот же кандидат — из «кэша», $0), джоб — с итогом */
  function drawSheet(channel: ChannelId, appearanceId: string, version: string, kind: string, order: [string, number][]): MockResponse {
    const cost = order.length * ANCHOR_PRICE
    const refusal = budgetRefusalOf(channel, cost)
    if (refusal) return refusal
    const sheet = sheetOf(channel, appearanceId)
    let charged = 0
    for (const [slot, n] of order) {
      const candidate = mockCandidate(appearanceId, version, slot, n)
      if (sheet.candidates.some((c) => c.id === candidate.id && c.status !== 'failed')) continue
      sheet.candidates = sheet.candidates.filter((c) => !(c.status === 'failed' && c.slot === slot && c.n === n && c.version === version))
      sheet.candidates.push(candidate)
      charged += 1
    }
    const items = order.map(([slot, n]) => ({ key: `${slot}-${n}`, slot, label: SHEET_ANGLES.find(([id]) => id === slot)![1], n }))
    return canonJob(kind, channel, { channel, target: appearanceId, version, items }, cost, {
      target: appearanceId,
      done: order.length,
      charged,
      cached: order.length - charged,
      failed: 0,
      spent_usd_micro: charged * ANCHOR_PRICE,
    })
  }

  const nextNumber = (sheet: MockSheet, slot: string) => Math.max(0, ...sheet.candidates.filter((c) => c.slot === slot).map((c) => c.n)) + 1
  const numbers = (from: number) => Array.from({ length: ANCHOR_CANDIDATES }, (_, i) => from + i)
  const angleOf = (slot: string) => SHEET_ANGLES.find(([id]) => id === slot)
  const noAngle = (slot: string) => fail(404, `Ракурса «${slot}» в листе нет — есть: ${SHEET_ANGLES.map(([id]) => id).join(', ')}.`)
  const needFront = (appearanceId: string, label: string, version: string) =>
    fail(409, `Для ракурса «${label}» нужен фас облика ${appearanceId} (${version}) — соберите лист или перегенерируйте фас.`)

  function collectSheet(channel: ChannelId, appearanceId: string): MockResponse {
    const version = sheetVersion(channel, appearanceId)
    if (typeof version !== 'string') return version
    return drawSheet(channel, appearanceId, version, 'anchor_sheet', SHEET_ANGLES.flatMap(([slot]) => numbers(1).map((n): [string, number] => [slot, n])))
  }

  function regenerateAngle(channel: ChannelId, appearanceId: string, slot: string): MockResponse {
    const angle = angleOf(slot)
    if (!angle) return noAngle(slot)
    const version = sheetVersion(channel, appearanceId)
    if (typeof version !== 'string') return version
    if (slot !== 'front' && !hasFront(channel, appearanceId, version)) return needFront(appearanceId, angle[1], version)
    const start = nextNumber(sheetOf(channel, appearanceId), slot)
    return drawSheet(channel, appearanceId, version, 'anchor_angle', numbers(start).map((n): [string, number] => [slot, n]))
  }

  function regenerateStale(channel: ChannelId, appearanceId: string): MockResponse {
    const version = sheetVersion(channel, appearanceId)
    if (typeof version !== 'string') return version
    const stale = appearanceAnchors(channel, appearanceId).slots.filter((slot) => slot.stale)
    if (!stale.length) return fail(409, `Устаревших ракурсов в листе ${appearanceId} нет — пересобирать нечего.`)
    if (stale[0]!.slot !== 'front' && !hasFront(channel, appearanceId, version)) return needFront(appearanceId, stale[0]!.label, version)
    const sheet = sheetOf(channel, appearanceId)
    return drawSheet(channel, appearanceId, version, 'anchor_angle', stale.flatMap(({ slot }) => numbers(nextNumber(sheet, slot)).map((n): [string, number] => [slot, n])))
  }

  /** Выбор и отбраковка — одна запись; отказы — тексты бэкенда (docs/canon_schema.md, «API опорных») */
  function pickCandidate(channel: ChannelId, appearanceId: string, slot: string, action: string, candidateId: string): MockResponse | null {
    const angle = angleOf(slot)
    if (!angle) return noAngle(slot)
    const sheet = sheetOf(channel, appearanceId)
    const candidate = sheet.candidates.find((c) => c.id === candidateId && c.slot === slot)
    if (!candidate) return fail(404, `У ракурса «${angle[1]}» облика ${appearanceId} нет кандидата ${candidateId} — обновите лист.`)
    if (action === 'choose') {
      if (candidate.status === 'rejected') return fail(409, `Кандидат ${candidateId} отбракован — выберите другого.`)
      if (candidate.status === 'failed') return fail(409, `Кандидат ${candidateId} не получился — перегенерируйте ракурс «${angle[1]}».`)
      sheet.chosen[slot] = candidateId
      return ok(appearanceAnchors(channel, appearanceId))
    }
    if (action !== 'reject') return null
    if (candidate.status === 'rejected') return fail(409, `Кандидат ${candidateId} уже отбракован.`)
    if (candidate.status === 'failed') return fail(409, `Кандидат ${candidateId} не получился — отбраковывать нечего.`)
    if (sheet.chosen[slot] === candidateId) {
      return fail(409, `Кандидат ${candidateId} выбран для ракурса «${angle[1]}» — выберите другого, потом отбракуйте этого.`)
    }
    candidate.status = 'rejected'
    return ok(appearanceAnchors(channel, appearanceId))
  }

  /** Миниатюра кандидата — SVG-заглушка с ракурсом и номером; ширина 160 или 320, как у бэкенда */
  function candidateThumb(channel: ChannelId, target: string, candidateId: string, width: string | null): MockResponse {
    const w = Number(width ?? 320)
    if (w !== 160 && w !== 320) return shapeError(['query', 'w'], `Ширины миниатюры ${width} нет — есть 160 и 320.`, 'thumb_width')
    const slots = target === 'style' ? styleAnchors(canonStyles[channel], channel).slots : appearanceAnchors(channel, target).slots
    const slot = slots.find((s) => s.candidates.some((c) => c.id === candidateId))
    const candidate = slot?.candidates.find((c) => c.id === candidateId)
    if (!slot || !candidate) return fail(404, `У ${target === 'style' ? 'кадров стиля' : `листа ${target}`} нет кандидата ${candidateId} — обновите страницу.`)
    if (!candidate.file) return fail(404, `Кандидат ${candidateId} не получился, картинки нет — перегенерируйте ракурс.`)
    return { status: 200, body: thumbSvg(`${slot.label} · ${candidate.n}`, w, target === 'style' ? 9 / 16 : 4 / 3), contentType: 'image/svg+xml' }
  }

  function canonSummary(channel: ChannelId, style: StyleState): CanonSummary {
    const sorted = <T,>(store: Map<string, LayerState<T>>) => [...store.entries()].sort(([a], [b]) => a.localeCompare(b))
    return {
      channel,
      style: { versions: style.versions.map((v) => v.info), draft: style.draft !== null },
      periods: sorted(canonPeriods[channel]).map(([id, state]) => {
        const head = headOf(state)
        return {
          id,
          label: head.label,
          region: head.region,
          years: head.years,
          versions: state.versions.map((v) => v.info),
          draft: state.draft !== null,
          forbidden_count: head.forbidden.length,
          episodes: PERIOD_EPISODES[id] ?? 0,
        }
      }),
      characters: sorted(canonCharacters[channel]).map(([id, state]) => {
        const head = headOf(state)
        return {
          id,
          label: head.label,
          versions: state.versions.map((v) => v.info),
          draft: state.draft !== null,
          appearances_count: head.appearances.length,
          sheets_ready: head.appearances.filter((a) => appearanceAnchors(channel, a.id).status === 'ready').length,
          sheets_outdated: head.appearances.filter((a) => appearanceAnchors(channel, a.id).status === 'outdated').length,
        }
      }),
    }
  }

  /** «Нужно каналу»: ссылки планов без опубликованной версии; черновик — `draft: true` */
  function canonNeeded(channel: ChannelId): CanonNeeded {
    const refs = PLAN_REFS[channel]
    const characters = canonCharacters[channel]
    return {
      channel,
      periods: refs.periods
        .filter((item) => !canonPeriods[channel].get(item.id)?.versions.length)
        .map((item) => ({ ...structuredClone(item), draft: Boolean(canonPeriods[channel].get(item.id)?.draft) })),
      appearances: refs.appearances
        .filter((item) => latestWith(channel, item.id) === null)
        .map((item) => {
          const character = characters.get(item.id.split('@')[0]!)
          return {
            ...structuredClone(item),
            draft: Boolean(character?.draft?.data.appearances.some((a) => a.id === item.id)),
            character_exists: character !== undefined,
          }
        }),
    }
  }

  function createNeededPeriod(channel: ChannelId, id: string): MockResponse {
    const state = canonPeriods[channel].get(id)
    const last = state?.versions.at(-1)
    if (last) return fail(409, `Эпоха ${id} уже опубликована (${last.info.version}) — создавать её не нужно.`)
    if (state) return fail(409, `У эпохи ${id} уже есть черновик — откройте его на экране «Канон» и опубликуйте.`)
    const created: LayerState<Period> = { versions: [], draft: null }
    canonPeriods[channel].set(id, created)
    return { ...layerPut(created, periodNoun(channel, id), period({ id, label: '' })), status: 201 }
  }

  function createNeededAppearance(channel: ChannelId, appearanceId: string): MockResponse {
    const characterId = appearanceId.split('@')[0]!
    const published = latestWith(channel, appearanceId)
    if (published) return fail(409, `Облик ${appearanceId} уже опубликован в characters/${characterId}/${published} — создавать его не нужно.`)
    const skeleton = look({ id: appearanceId, label: '', period: '' })
    const state = canonCharacters[channel].get(characterId)
    const noun = characterNoun(channel, characterId)
    if (!state) {
      const created: LayerState<Character> = { versions: [], draft: null }
      canonCharacters[channel].set(characterId, created)
      return { ...layerPut(created, noun, { id: characterId, label: '', nature: { personality: '', posture: '', manner: '', face: '' }, appearances: [skeleton] }), status: 201 }
    }
    const head = headOf(state)
    if (head.appearances.some((a) => a.id === appearanceId)) {
      return fail(409, `Облик ${appearanceId} уже есть в черновике персонажа ${characterId} — откройте его на экране «Канон» и опубликуйте.`)
    }
    return { ...layerPut(state, noun, { ...head, appearances: [...head.appearances, skeleton] }), status: 201 }
  }

  /** «Скопировать облик в другой период»: черты лица, телосложение, волосы, возраст и negative — побайтово */
  function copyAppearance(channel: ChannelId, sourceId: string, body: { period: string; appearance_id: string }): MockResponse {
    const characterId = sourceId.split('@')[0]!
    if (!body.appearance_id.startsWith(`${characterId}@`)) {
      return shapeError(['body', 'appearance_id'], `Облик ${body.appearance_id} не принадлежит персонажу ${characterId} — id облика начинается с «${characterId}@».`)
    }
    const state = canonCharacters[channel].get(characterId)
    const head = state && headOf(state)
    const source = head?.appearances.find((a) => a.id === sourceId)
    if (!state || !head || !source) return fail(404, `Облика ${sourceId} нет в персонаже ${characterId} — копировать нечего.`)
    if (head.appearances.some((a) => a.id === body.appearance_id)) {
      return fail(409, `Облик ${body.appearance_id} уже есть в персонаже ${characterId} — выберите другой id копии.`)
    }
    const copy = look({
      id: body.appearance_id,
      label: '',
      period: body.period,
      age: source.age,
      build: source.build,
      face: source.face,
      hair: source.hair,
      negative_local: [...source.negative_local],
    })
    return { ...layerPut(state, characterNoun(channel, characterId), { ...head, appearances: [...head.appearances, copy] }), status: 201 }
  }

  const PERIOD_FIELDS = ['label', 'region', 'years', 'palette_shift', 'materials', 'light_sources', 'architecture', 'clothing', 'props', 'forbidden'] as const
  const isBlank = (value: unknown) => value === '' || value === null || (Array.isArray(value) && value.length === 0)
  /** Ключ повтора запрета: без регистра, ведущего артикля, лишних пробелов и знака в конце (как `period_bridge`) */
  const forbiddenKey = (text: string) =>
    text
      .toLowerCase()
      .trim()
      .replace(/^(a|an|the)\s+/, '')
      .replace(/[.,;:!?]+$/, '')
      .split(/\s+/)
      .join(' ')

  function periodPrompt(channel: ChannelId, id: string, mode: string | null): MockResponse {
    if (mode !== 'draft' && mode !== 'forbidden') {
      return shapeError(['query', 'mode'], `Режима «${mode}» нет: ожидалось draft (черновик) или forbidden (дополнить запреты).`)
    }
    const state = canonPeriods[channel].get(id)
    if (mode === 'forbidden' && !state) {
      return fail(409, `У эпохи ${id} нет ни черновика, ни версий — дополнять нечего: сначала соберите черновик через мост или заполните его вручную.`)
    }
    periodRuns += 1
    const current = state ? JSON.stringify(headOf(state)) : 'null'
    const text = `You are drafting the historical period "${id}" for the ${channel} channel (mode: ${mode}).\nCurrent draft: ${current}\nReturn exactly one JSON object.`
    return ok({ text, prompt_id: 'canon_period', version: 1, run_id: `run-period-${periodRuns}`, period_id: id, mode } satisfies PeriodPrompt)
  }

  /** Ответ чата → черновик эпохи (docs/bridge.md, «Эпоха»): `draft` заполняет пустые поля, `forbidden` дописывает запреты */
  function periodAnswer(channel: ChannelId, id: string, mode: string | null, text: string): MockResponse {
    if (mode !== 'draft' && mode !== 'forbidden') {
      return shapeError(['query', 'mode'], `Режима «${mode}» нет: ожидалось draft (черновик) или forbidden (дополнить запреты).`)
    }
    const refuse = (message: string, errors: { path: string; message: string }[] = []) => ({
      status: 422,
      body: { message, hint: 'Попросите чат прислать ровно один JSON эпохи по правилам промпта.', errors },
    })
    if (text.includes(STYLE_TOKEN)) {
      return refuse('Ответ эпохи не прошёл проверку: 1 ошибка.', [
        { path: 'materials', message: `materials: стилевой токен «${STYLE_TOKEN}» (lighting) — эпоха описывает факты времени и места, а как выглядит картинка, задаёт стиль канала` },
      ])
    }
    let answer: Record<string, unknown>
    try {
      answer = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, unknown>
    } catch {
      return refuse('В ответе не нашлось JSON эпохи: вставьте ответ чата целиком.')
    }
    let state = canonPeriods[channel].get(id)
    if (mode === 'forbidden' && !state) {
      return fail(409, `У эпохи ${id} нет ни черновика, ни версий — дополнять нечего: сначала соберите черновик через мост или заполните его вручную.`)
    }
    if (!state) {
      state = { versions: [], draft: null }
      canonPeriods[channel].set(id, state)
    }
    const base = state.draft ? state.draft.data : (state.versions.at(-1)?.data ?? period({ id, label: '' }))
    const next: Period = structuredClone(base)
    const filled: string[] = []
    const conflicts: PeriodConflict[] = []
    const added: string[] = []
    const repeats: string[] = []
    if (mode === 'draft') {
      for (const field of PERIOD_FIELDS) {
        if (!(field in answer)) continue
        const proposed = answer[field]
        if (isBlank(base[field])) {
          ;(next as unknown as Record<string, unknown>)[field] = proposed
          filled.push(field)
        } else if (canonical(base[field]) !== canonical(proposed)) {
          conflicts.push({ field, current: base[field], proposed })
        }
      }
    } else {
      const keys = new Set(base.forbidden.map(forbiddenKey))
      for (const item of (answer.forbidden as string[] | undefined) ?? []) {
        const key = forbiddenKey(item)
        if (keys.has(key)) repeats.push(item)
        else {
          keys.add(key)
          added.push(item)
        }
      }
      next.forbidden = [...base.forbidden, ...added]
    }
    const doc = layerPut(state, periodNoun(channel, id), next).body as PeriodAnswerResult['doc']
    periodRuns += 1
    const message =
      mode === 'forbidden'
        ? `Добавлено ${added.length}, повторов ${repeats.length}.`
        : `Черновик эпохи: заполнено ${filled.length} ${ru(filled.length, ['поле', 'поля', 'полей'])}${conflicts.length ? `, чат предложил иначе для ${conflicts.length} — сравните в списке «Чат предложил иначе»` : ''}. Публикует человек.`
    return ok({ run_id: `run-period-${periodRuns}`, period_id: id, mode, doc, filled, conflicts, added, repeats, message } satisfies PeriodAnswerResult)
  }

  /** Эпоха или персонаж по адресу: документ, черновик, публикация — общие для слоёв */
  function entityRoute(method: string, channel: ChannelId, kind: 'periods' | 'characters', id: string, sub: string, query: URLSearchParams, body: unknown): MockResponse | null {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      return shapeError(['path', `${kind === 'periods' ? 'period' : 'character'}_id`], `id «${id}» не годится — только строчные латинские буквы, цифры и дефис, например caribbean-1716.`)
    }
    const store = (kind === 'periods' ? canonPeriods[channel] : canonCharacters[channel]) as Map<string, LayerState<Period | Character>>
    const noun = kind === 'periods' ? periodNoun(channel, id) : characterNoun(channel, id)
    const state = store.get(id)
    if (method === 'GET' && sub === '') return layerDoc(state, noun, query.get('version'))
    if (method === 'PUT' && sub === 'draft') {
      const data = body as Period | Character
      const refusal = entityShape(kind, id, data)
      if (refusal) return refusal
      const target = state ?? { versions: [], draft: null }
      store.set(id, target)
      return layerPut(target, noun, data)
    }
    if (method === 'POST' && sub === 'draft') return layerFrom(state, noun, query.get('from') ?? '')
    if (method === 'DELETE' && sub === 'draft') {
      const response = layerDiscard(state, noun)
      if (state && !state.draft && !state.versions.length) store.delete(id) // скелет без версий — каталог пуст
      return response
    }
    if (method === 'POST' && sub === 'publish') {
      return layerPublish(state, noun, (data) => (kind === 'periods' ? periodProblems(data as Period) : characterProblems(data as Character)))
    }
    if (kind === 'periods' && method === 'POST' && sub === 'prompt') return periodPrompt(channel, id, query.get('mode'))
    if (kind === 'periods' && method === 'POST' && sub === 'answer') return periodAnswer(channel, id, query.get('mode'), (body as { text: string }).text)
    return null
  }

  function canonRoute(method: string, channel: ChannelId, rest: string[], query: URLSearchParams, body: unknown): MockResponse | null {
    const style = canonStyles[channel]
    if (!style) return fail(404, `Канал «${channel}» не найден.`)
    const path = rest.join('/')
    if (method === 'GET' && path === '') return ok(canonSummary(channel, style))
    if (method === 'GET' && path === 'style') return layerDoc(style, styleNoun(channel), query.get('version'))
    if (method === 'PUT' && path === 'style/draft') {
      const data = body as Style
      return styleShape(data) ?? layerPut(style, styleNoun(channel), data)
    }
    if (method === 'POST' && path === 'style/draft') return layerFrom(style, styleNoun(channel), query.get('from') ?? '')
    if (method === 'DELETE' && path === 'style/draft') return layerDiscard(style, styleNoun(channel))
    if (method === 'POST' && path === 'style/publish') return layerPublish(style, styleNoun(channel), stylePublishProblems)
    if (method === 'GET' && path === 'style/anchors') return ok(styleAnchors(style, channel))
    if (method === 'GET' && path === 'style/anchors/estimate') return ok(anchorsEstimate)
    if (method === 'POST' && path === 'style/anchors') return collectStyleAnchors(style, channel, (body as { period: string }).period)
    if (method === 'GET' && rest[0] === 'anchors' && rest[1] && rest[2] && rest[3] === 'thumb' && rest.length === 4) {
      return candidateThumb(channel, rest[1], rest[2], query.get('w'))
    }
    if (method === 'GET' && path === 'needed') return ok(canonNeeded(channel))
    if (method === 'POST' && rest[0] === 'needed' && rest[1] === 'periods' && rest[2]) return createNeededPeriod(channel, rest[2])
    if (method === 'POST' && rest[0] === 'needed' && rest[1] === 'appearances' && rest[2]) return createNeededAppearance(channel, rest[2])
    if (rest[0] === 'appearances' && rest[1]) {
      const id = rest[1]
      if (!/^[a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9-]*$/.test(id)) {
        return shapeError(['path', 'appearance_id'], `id облика «${id}» не годится — нужен вид <персонаж>@<облик>, например you@powder-monkey-11.`)
      }
      const sub = rest.slice(2).join('/')
      if (method === 'GET' && sub === 'anchors') return ok(appearanceAnchors(channel, id))
      if (method === 'GET' && sub === 'anchors/estimate') return ok(appearanceEstimate(channel, id))
      if (method === 'POST' && sub === 'anchors') return collectSheet(channel, id)
      if (method === 'POST' && sub === 'anchors/stale') return regenerateStale(channel, id)
      const [, angle, action] = rest.slice(2)
      if (method === 'POST' && rest[2] === 'anchors' && angle && action === 'regenerate' && rest.length === 5) return regenerateAngle(channel, id, angle)
      if (method === 'POST' && rest[2] === 'anchors' && angle && action && rest.length === 5) {
        return pickCandidate(channel, id, angle, action, (body as { candidate: string }).candidate)
      }
      if (method === 'POST' && sub === 'copy') return copyAppearance(channel, id, body as { period: string; appearance_id: string })
      return null
    }
    if ((rest[0] === 'periods' || rest[0] === 'characters') && rest[1]) {
      return entityRoute(method, channel, rest[0], rest[1], rest.slice(2).join('/'), query, body)
    }
    return null
  }

  /* ---- Генерация кадров (экран 4, M6.7): пачки и джобы кадров — как `batches` и `jobs` бэкенда ---- */

  const batchRows = new Map<string, MockBatch>()
  const shotJobs: Job[] = []
  /** Кадры, которые смета и пачка пропускают с причиной: мок запрос кадра не собирает, проблемы задаёт тест */
  const skippedShots: SkippedShot[] = []
  let batchCount = 0
  let redrawCount = 0

  function batchSummary(row: MockBatch): BatchSummary {
    const rows = shotJobs.filter((job) => job.batch_id === row.id)
    const n = (status: Job['status']) => rows.filter((job) => job.status === status).length
    const jobs = { total: rows.length, queued: n('queued'), running: n('running'), done: n('done'), failed: n('failed'), cancelled: n('cancelled') }
    const finished = jobs.queued === 0 && jobs.running === 0
    const cost = (list: Job[]) => list.reduce((sum, job) => sum + (job.cost_usd_micro ?? 0), 0)
    const { model = IMAGE_CATALOG.default, ...fields } = row
    return {
      ...fields,
      kind: 'shot_image',
      model,
      retry_of: null,
      jobs,
      finished,
      estimate: money(cost(rows.filter((job) => job.status !== 'cancelled'))),
      spent: money(cost(rows.filter((job) => job.status === 'done'))),
      eta_s: finished || row.paused ? null : Math.round((jobs.queued + jobs.running) * GEN_SECONDS_PER_SHOT),
    }
  }

  /** Снимок джобов по фильтру, как `GET /api/jobs?batch=&episode=&kind=&limit=`: последние `limit` по порядку постановки */
  function jobList(query: URLSearchParams): JobList {
    const batch = query.get('batch')
    const episode = query.get('episode')
    const kind = query.get('kind')
    const limit = Number(query.get('limit') ?? 200)
    const items = [...jobs.items, ...shotJobs].filter(
      (job) => (!batch || job.batch_id === batch) && (!episode || job.episode_id === episode) && (!kind || job.kind === kind),
    )
    const n = (status: Job['status']) => items.filter((job) => job.status === status).length
    return {
      items: items.slice(-limit),
      summary: { total: items.length, queued: n('queued'), running: n('running'), done: n('done'), failed: n('failed'), cancelled: n('cancelled') },
      last_event_id: jobs.last_event_id,
    }
  }

  /** Состояние кадра — и в project.json, и статусом в плане: лист экрана 3 показывает его же */
  function setShot(episode: EpisodeListItem, id: string, fields: Partial<ShotState>) {
    const project = projectOf(episode)
    project.shots[id] = { ...(project.shots[id] ?? shotState({})), ...fields }
    const shot = plansOf(episode)?.shots.find((item) => item.id === id)
    if (shot && fields.status) shot.status = fields.status
  }

  /** Незаконченный джоб кадра (`shot_image`); перепроверки (`shot_check`) живут в том же списке, но не рисуют */
  const activeJob = (episodeId: string, shot: string) =>
    shotJobs.find(
      (job) => job.kind === 'shot_image' && job.episode_id === episodeId && job.payload.shot_id === shot && (job.status === 'queued' || job.status === 'running'),
    )

  /** Модель заказа: ключ каталога `images`; нет — профиль по умолчанию; не из каталога — `null` (422) */
  const catalogEntry = (key: string | null | undefined): CatalogEntry | null =>
    IMAGE_CATALOG.models.find((entry) => entry.key === (key || IMAGE_CATALOG.default)) ?? null
  const unknownModel = (key: string | null | undefined) =>
    fail(422, `Модели «${key}» нет в каталоге images — есть ${IMAGE_CATALOG.models.map((entry) => entry.key).join(', ')}.`)

  /** Следующий свободный вариант: после вариантов версий кадра и его незаконченных джобов (`next_variant` бэкенда) */
  function nextVariant(episode: EpisodeListItem, shot: string): number {
    const versions = Object.values(projectOf(episode).assets).filter((asset) => asset.kind === 'image' && asset.shot_id === shot)
    const pending = shotJobs.filter(
      (job) => job.kind === 'shot_image' && job.episode_id === episode.id && job.payload.shot_id === shot && (job.status === 'queued' || job.status === 'running'),
    )
    return Math.max(0, ...versions.map((asset) => asset.variant ?? asset.version), ...pending.map((job) => Number(job.payload.variant ?? 1))) + 1
  }

  /** Кадры пачки (`select_shots` бэкенда): без `shots` — без выбранной картинки и `stale`; с `shots` — названные из
   *  действующего плана; пропущенные тестом — мимо. `redraw` — следующий вариант, иначе вариант 1 */
  function shotsToDraw(episode: EpisodeListItem, named: readonly string[] | null = null): string[] {
    const project = projectOf(episode)
    const skipped = new Set(skippedShots.map((item) => item.shot_id))
    const plan = (effectivePlan(episode)?.shots ?? []).filter((shot) => shot.status !== 'removed' && !skipped.has(shot.id))
    if (named) return named.filter((id) => plan.some((shot) => shot.id === id))
    return plan
      .filter((shot) => {
        const state = project.shots[shot.id]
        return !state?.image_version || state.status === 'stale'
      })
      .map((shot) => shot.id)
  }

  interface BatchQuery {
    shots?: string[] | null
    model?: string | null
    redraw?: boolean
  }

  const batchQueryOf = (query: URLSearchParams): BatchQuery => ({
    shots: query.get('shots')?.split(',').filter(Boolean) ?? null,
    model: query.get('model'),
    redraw: query.get('redraw') === 'true',
  })

  const batchRefusal = (refusal: BatchRefusal) => fail(409, refusal as unknown as Record<string, unknown>)

  function generationRefusal(episode: EpisodeListItem): MockResponse | null {
    const plan = plansOf(episode)
    if (plan && plan.approved_version === plan.version) return null
    const message = plan
      ? 'План не утверждён — утвердите его на экране «Сценарий»: кадры рисуются только по утверждённому плану.'
      : 'Плана ещё нет — соберите его на экране «Сценарий» и утвердите.'
    return batchRefusal({ code: 'plan_not_approved', message, skipped: [], shots: [], batch_id: null })
  }

  function generateEstimate(episode: EpisodeListItem, query: BatchQuery): MockResponse {
    const refusal = generationRefusal(episode)
    if (refusal) return refusal
    const entry = catalogEntry(query.model)
    if (!entry) return unknownModel(query.model)
    const shots = shotsToDraw(episode, query.shots ?? null)
    const unit = entry.price.usd_micro
    return ok({
      model: entry.key,
      model_id: entry.model,
      count: shots.length,
      unit: unitMoney(unit),
      total: money(unit * shots.length),
      shots: shots.map((shot_id) => ({ shot_id, variant: query.redraw ? nextVariant(episode, shot_id) : 1, usd: unitMoney(unit) })),
      skipped: [...skippedShots],
    } satisfies BatchEstimate)
  }

  /** «Сгенерировать N кадров»: утверждение, занятость, бюджет суммой — затем пачка и её джобы `queued` */
  function startBatch(episode: EpisodeListItem, query: BatchQuery): MockResponse {
    const refusal = generationRefusal(episode)
    if (refusal) return refusal
    const entry = catalogEntry(query.model)
    if (!entry) return unknownModel(query.model)
    const shots = shotsToDraw(episode, query.shots ?? null)
    if (!shots.length) {
      return batchRefusal({
        code: 'nothing_to_draw',
        message: 'Рисовать нечего: у кадров плана картинки в силе, остальные пропущены — причины в списке.',
        skipped: [...skippedShots],
        shots: [],
        batch_id: null,
      })
    }
    const busy = shots.filter((shot) => activeJob(episode.id, shot))
    if (busy.length) {
      return batchRefusal({
        code: 'shots_busy',
        message: `Кадры уже рисуются: ${busy.join(', ')} — дождитесь окончания пачки или отмените её.`,
        skipped: [],
        shots: busy,
        batch_id: activeJob(episode.id, busy[0]!)?.batch_id ?? null,
      })
    }
    const budget = budgetRefusalOf(episode.channel, entry.price.usd_micro * shots.length)
    if (budget) return budget
    batchCount += 1
    const row: MockBatch = { id: `batch-${episode.id}-${batchCount}`, episode_id: episode.id, created_at: NOW, paused: false, cancelled: false, model: entry.key }
    batchRows.set(row.id, row)
    for (const shot of shots) {
      shotJobs.push(shotJob(episode.id, row.id, shot, 'queued', { model: entry, variant: query.redraw ? nextVariant(episode, shot) : 1 }))
      setShot(episode, shot, { status: 'queued' })
    }
    Object.assign(episode, { stage: 'generate', status: 'generating', updated_at: NOW })
    return ok({ batch: batchSummary(row), skipped: [...skippedShots], warnings: [] } satisfies BatchResult, 201)
  }

  /** Пауза, продолжение, отмена; отмена снимает `queued`, их кадры — к своему статусу, начатые дорисуются */
  function batchAction(id: string, action: string): MockResponse | null {
    const row = batchRows.get(id)
    if (!row) return fail(404, `Пачка «${id}» не найдена.`)
    if (action === 'pause') row.paused = true
    else if (action === 'resume') row.paused = false
    else if (action === 'cancel') {
      row.cancelled = true
      const episode = one(row.episode_id)
      for (const job of shotJobs) {
        if (job.batch_id !== id || job.status !== 'queued') continue
        Object.assign(job, { status: 'cancelled', finished_at: NOW })
        const shot = String(job.payload.shot_id)
        if (episode) setShot(episode, shot, { status: projectOf(episode).shots[shot]?.image_version ? 'done' : 'todo' })
      }
    } else return null
    return ok(batchSummary(row))
  }

  /** «Перерисовать» и «С правкой…» (`POST …/redraw`): правка проверяется как PATCH до записи (стоп-лист, пустое
   *  действие — 422), затем бюджет — и только потом правка пишется, а джоб следующего варианта встаёт в очередь */
  function redrawShot(episode: EpisodeListItem, shotId: string, body: { model?: string | null; prompt?: string | null }): MockResponse {
    const refusal = generationRefusal(episode)
    if (refusal) return refusal
    const shot = effectivePlan(episode)?.shots.find((item) => item.id === shotId && item.status !== 'removed')
    if (!shot) return fail(404, `Кадра ${shotId} в действующем плане выпуска нет.`)
    const entry = catalogEntry(body.model)
    if (!entry) return unknownModel(body.model)
    const prompt = body.prompt ?? null
    if (prompt !== null) {
      const invalid = promptErrors(shotId, prompt)
      if (invalid.length) return { status: 422, body: { detail: invalid } }
    }
    const budget = budgetRefusalOf(episode.channel, entry.price.usd_micro)
    if (budget) return budget
    if (prompt !== null) patchShots(episode, { [shotId]: { user_override: { image: { prompt } } } })
    redrawCount += 1
    const job = shotJob(episode.id, null, shotId, 'queued', { id: `job-redraw-${redrawCount}-${shotId}`, model: entry, variant: nextVariant(episode, shotId) })
    shotJobs.push(job)
    setShot(episode, shotId, { status: 'queued' })
    return ok(job, 201)
  }

  function redrawEstimate(episode: EpisodeListItem, shotId: string, model: string | null): MockResponse {
    const refusal = generationRefusal(episode)
    if (refusal) return refusal
    if (!effectivePlan(episode)?.shots.some((item) => item.id === shotId && item.status !== 'removed')) {
      return fail(404, `Кадра ${shotId} в действующем плане выпуска нет.`)
    }
    const entry = catalogEntry(model)
    if (!entry) return unknownModel(model)
    return ok({ shot_id: shotId, variant: nextVariant(episode, shotId), model: entry.key, model_id: entry.model, usd: unitMoney(entry.price.usd_micro) } satisfies RedrawEstimate)
  }

  /** Конец джоба кадра, как у воркера: новая версия моделью и вариантом заказа, кадр `done`; итог — в `result`. Версия
   *  выбирается сама, только если выбранной нет или она устарела (E-1, docs/generation.md), — у готового кадра это
   *  вариант на выбор в «Сравнении версий». Событие SSE тест шлёт сам */
  function drawShot(episodeId: string, shot: string): Job | null {
    const episode = one(episodeId)
    if (!episode) return null
    const project = projectOf(episode)
    const job = activeJob(episodeId, shot)
    const entry = catalogEntry(job ? String(job.payload.model) : null) ?? IMAGE_CATALOG.models[1]!
    const version = Object.values(project.assets).filter((asset) => asset.kind === 'image' && asset.shot_id === shot).length + 1
    project.assets[`img-${shot}-v${version}`] = { ...imageAsset(shot, version, entry), variant: job ? Number(job.payload.variant ?? version) : version }
    const state = project.shots[shot]
    const choose = (state?.image_version ?? null) === null || (state?.stale_reasons.length ?? 0) > 0
    setShot(episode, shot, choose ? { status: 'done', image_version: version, error: null, stale_reasons: [] } : { status: 'done', error: null })
    if (job) {
      Object.assign(job, {
        status: 'done',
        progress: 1,
        finished_at: NOW,
        message: `Кадр ${shot} · готово: версия ${version}`,
        result: { shot_id: shot, version, status: 'charged', usd_micro: entry.price.usd_micro },
      })
    }
    return job ?? null
  }

  const vlmOn = (episode: EpisodeListItem) => profiles.find((p) => p.id === episode.channel)?.checks?.anachronism !== false

  /** Что поставит перепроверка кадра (`check_order` бэкенда): кадр в плане, выбранная версия, есть что проверять */
  function checkOrder(episode: EpisodeListItem, shotId: string): { appearances: string[]; usd_micro: number } | string {
    const plan = effectivePlan(episode)
    const shot = plan?.shots.find((item) => item.id === shotId)
    if (!plan || !shot) return `Кадра ${shotId} нет в плане ${plan?.version ?? ''} — проверьте id кадра.`
    if (shot.status === 'removed') return `Кадр ${shotId} убран из плана ${plan.version} — картинок у него нет.`
    const state = projectOf(episode).shots[shotId]
    if ((state?.image_version ?? null) === null) {
      return shotImagesOf(episode, shotId).versions.length
        ? `У кадра ${shotId} не выбрана картинка — выберите версию, потом проверяйте.`
        : `У кадра ${shotId} ещё нет картинок — сначала сгенерируйте кадр.`
    }
    const vlm = vlmOn(episode)
    if (!shot.image.appearances.length && !vlm) {
      return `В кадре ${shotId} нет персонажей, а проверка анахронизмов выключена в профиле канала — проверять нечего.`
    }
    return { appearances: shot.image.appearances, usd_micro: vlm ? CHECK_QUESTION : 0 }
  }

  /** Смета перепроверки (`GET …/check/estimate?shots=`): цена вопроса — и при выключенной проверке, для подписи */
  function checkEstimate(episode: EpisodeListItem, shots: string[]): MockResponse {
    if (!plansOf(episode)) return fail(404, 'План ещё не импортирован — кадров нет. Импортируйте план на экране «Сценарий».')
    const priced: CheckEstimate['shots'] = []
    const skipped: CheckEstimate['skipped'] = []
    for (const shotId of [...new Set(shots)]) {
      const order = checkOrder(episode, shotId)
      if (typeof order === 'string') skipped.push({ shot_id: shotId, reason: order })
      else priced.push({ shot_id: shotId, face: order.appearances.length > 0, usd: unitMoney(order.usd_micro) })
    }
    const total = priced.reduce((sum, shot) => sum + shot.usd.usd_micro, 0)
    return ok({ vlm: vlmOn(episode), question: unitMoney(CHECK_QUESTION), count: priced.length, total: unitMoney(total), shots: priced, skipped } satisfies CheckEstimate)
  }

  let checkCount = 0
  /** «Перепроверить» (`POST …/shots/{id}/check`): джоб `shot_check` в очереди; конец — `finishCheck` теста */
  function checkShot(episode: EpisodeListItem, shotId: string): MockResponse {
    const order = checkOrder(episode, shotId)
    if (typeof order === 'string') return fail(order.startsWith('В кадре') ? 409 : 404, order)
    checkCount += 1
    const job: Job = {
      ...shotJob(episode.id, null, shotId, 'queued', { id: `job-check-${checkCount}-${shotId}` }),
      kind: 'shot_check',
      payload: { shot_id: shotId, version: projectOf(episode).shots[shotId]!.image_version },
      cost_usd_micro: order.usd_micro || null,
      cost_stage: order.usd_micro ? 'check' : null,
    }
    shotJobs.push(job)
    return ok(job, 201)
  }

  /** Конец перепроверки, как у воркера: проверки выбранной версии заменены. Событие SSE тест шлёт сам */
  function finishCheck(episodeId: string, shotId: string, checks: Asset['checks']): Job | null {
    const episode = one(episodeId)
    if (!episode) return null
    const project = projectOf(episode)
    const version = project.shots[shotId]?.image_version
    const asset = project.assets[`img-${shotId}-v${version}`]
    if (asset) asset.checks = { ...asset.checks, ...checks }
    const job = shotJobs.find((item) => item.kind === 'shot_check' && item.payload.shot_id === shotId && item.status === 'queued')
    if (job) Object.assign(job, { status: 'done', progress: 1, finished_at: NOW })
    return job ?? null
  }

  /** Версии кадра, как `GET …/images` (`ShotImages`): новые сверху и выбранная */
  function shotImagesOf(episode: EpisodeListItem, shotId: string): ShotImages {
    const project = projectOf(episode)
    const state = project.shots[shotId]
    const versions = Object.values(project.assets)
      .filter((asset) => asset.kind === 'image' && asset.shot_id === shotId)
      .sort((a, b) => b.version - a.version)
    // Хэшей запроса мок не считает: у кадра в силе все версии по действующему запросу, у устаревшего — ни одной
    const matches_plan = state?.status === 'stale' ? [] : versions.map((asset) => asset.version)
    return { shot_id: shotId, status: state?.status ?? 'todo', image_version: state?.image_version ?? null, versions, matches_plan }
  }

  /** «Выбрать версию N» (`POST …/images/{version}/choose`): кадр `done`, причины устаревания и ошибка сняты; ошибки и
   *  тексты — docs/generation.md, «API»; несуществующая версия project.json не меняет */
  function chooseVersion(episode: EpisodeListItem, shotId: string, version: number): MockResponse {
    const plan = effectivePlan(episode)
    const shot = plan?.shots.find((item) => item.id === shotId)
    if (!plan || !shot) return fail(404, `Кадра ${shotId} нет в плане ${plan?.version ?? ''} — проверьте id кадра.`)
    if (shot.status === 'removed') return fail(404, `Кадр ${shotId} убран из плана ${plan.version} — картинок у него нет.`)
    const numbers = shotImagesOf(episode, shotId).versions.map((asset) => asset.version).reverse()
    if (!numbers.length) return fail(404, `У кадра ${shotId} ещё нет картинок — сначала сгенерируйте кадр.`)
    if (!numbers.includes(version)) return fail(404, `У кадра ${shotId} нет версии ${version} — есть ${numbers.join(', ')}.`)
    setShot(episode, shotId, { status: 'done', image_version: version, stale_reasons: [], error: null })
    return ok(shotImagesOf(episode, shotId))
  }

  /** Отказ модели у джоба кадра, как у воркера: кадр `failed` с причиной, без повтора. Событие SSE тест шлёт сам */
  function refuseShot(episodeId: string, shot: string, error = SAFETY_REFUSAL): Job | null {
    const episode = one(episodeId)
    if (!episode) return null
    const job = activeJob(episodeId, shot)
    if (job) Object.assign(job, { status: 'failed', finished_at: NOW, error: jobError(error) })
    setShot(episode, shot, { status: 'failed', error })
    return job ?? null
  }

  /** «Пираты» на экране 4 по артборду 4: план v004 из 104 кадров утверждён. `drawn` — пачка 78 из 104 с версиями 1–3 и
   *  двумя отказами фильтра (s047, s071); без него — ни картинок, ни пачки (пустое состояние). По умолчанию у «Пиратов»
   *  план артборда 3: его снимают эталоны и тесты экрана 3 (L-048) */
  function generateArtboard({ drawn = true }: { drawn?: boolean } = {}) {
    const episode = one('pirate')!
    const plan = generationPlan(episode)
    plans.set(episode.id, plan)
    overrides.set(episode.id, {})
    pinEpisode(episode)
    Object.assign(projectOf(episode), { director_version: plan.version, approved_version: plan.version, approved_at: NOW, shots: {}, assets: {} })
    Object.assign(episode, { stage: 'generate', status: drawn ? 'generating' : 'queued', updated_at: NOW })
    if (!drawn) {
      episode.summary = summary({ shots_total: plan.shots.length })
      for (const shot of plan.shots) setShot(episode, shot.id, { status: 'todo' })
      return
    }
    const project = projectOf(episode)
    batchRows.set(GEN_BATCH, { id: GEN_BATCH, episode_id: episode.id, created_at: GEN_STARTED, paused: false, cancelled: false })
    plan.shots.forEach((shot, i) => {
      const n = i + 1
      const status: Job['status'] = n > GEN_RUNNING ? 'queued' : n > GEN_FINISHED ? 'running' : GEN_FAILED.has(shot.id) ? 'failed' : 'done'
      shotJobs.push(shotJob(episode.id, GEN_BATCH, shot.id, status))
      if (status === 'done') {
        const compare = shot.id === GEN_COMPARE
        const count = compare ? GEN_COMPARE_VERSIONS.length : genVersions(n)
        const chosen = count === 3 ? 2 : 1
        for (let version = 1; version <= count; version += 1) {
          project.assets[`img-${shot.id}-v${version}`] = compare
            ? compareAsset(shot.id, version, shot.image.appearances[0]!)
            : { ...imageAsset(shot.id, version), checks: version === chosen ? genChecks(shot.id, n, shot.image.appearances[0]) : null }
        }
        setShot(episode, shot.id, { status: 'done', image_version: chosen })
      } else if (status === 'failed') {
        setShot(episode, shot.id, { status: 'failed', error: SAFETY_REFUSAL })
      } else {
        setShot(episode, shot.id, { status: status === 'running' ? 'generating' : 'queued' })
      }
    })
    episode.summary = { ...episode.summary, shots_total: 104, shots_done: 78, shots_failed: 2, shots_generating: 3 }
  }

  function handle(method: string, url: string, body?: unknown): MockResponse {
    const { pathname, searchParams } = new URL(url, 'http://studio.test')
    const path = pathname.replace(/^\/api/, '')
    const channel = searchParams.get('channel') as ChannelId | null
    const parts = path.split('/').filter(Boolean)

    if (method === 'GET' && path === '/channels') return ok(profiles)
    if (parts[0] === 'canon' && parts[1]) {
      const response = canonRoute(method, decodeURIComponent(parts[1]) as ChannelId, parts.slice(2).map(decodeURIComponent), searchParams, body)
      if (response) return response
    }
    if (method === 'PATCH' && parts[0] === 'channels' && parts[1]) return patchChannel(decodeURIComponent(parts[1]), body)
    if (method === 'GET' && path === '/ideas') {
      const status = searchParams.get('status')
      const list = ideas.filter((i) => (!channel || i.channel === channel) && (!status || i.status === status))
      return ok([...list].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)))
    }
    if (method === 'POST' && path === '/ideas') {
      const request = body as IdeaCreate
      if (!request.title?.trim()) {
        return { status: 422, body: { detail: [{ type: 'title_empty', loc: ['body', 'title'], msg: 'Название не может быть пустым — введите текст.' }] } }
      }
      const next = idea(Number(nextIdeaId().slice(1)), {
        ...request,
        title: request.title.trim(),
        score: request.score ?? null,
        score_reason: request.score_reason ?? null,
        status: 'backlog',
        source: 'manual',
        created_at: NOW,
        updated_at: NOW,
      })
      ideas.push(next)
      return ok(next, 201)
    }
    if (method === 'PATCH' && parts[0] === 'ideas' && parts[1]) {
      const target = ideas.find((i) => i.id === decodeURIComponent(parts[1]!))
      return target ? patchIdea(target, body as IdeaPatch) : fail(404, `Идея «${parts[1]}» не найдена.`)
    }
    if (method === 'POST' && path === '/ideas/prompt') {
      const request = body as { channel: Idea['channel']; count?: number }
      const count = request.count ?? 6
      const profile = profiles.find((p) => p.id === request.channel)
      runs += 1
      return ok({
        text: `You are the idea editor of the history channel "${profile?.name}" on YouTube. Propose ${count} new video ideas for it.`,
        prompt_id: 'ideas',
        version: 1,
        run_id: `run-${runs}`,
        count,
      } satisfies IdeasPrompt)
    }
    if (method === 'GET' && path === '/references') {
      return ok(references.filter((r) => !channel || r.channel === channel))
    }
    if (method === 'POST' && path === '/references') return createReference(body as { channel: ChannelId; url?: string; subtitles: string })
    if (parts[0] === 'references' && parts[1]) {
      const reference = references.find((r) => r.id === decodeURIComponent(parts[1]!))
      if (!reference) return fail(404, `Референс «${parts[1]}» не найден.`)
      if (method === 'GET' && parts.length === 2) return ok(reference)
      if (method === 'POST' && parts[2] === 'prompt') {
        runs += 1
        return ok({ text: `Analyse the structure of the video "${reference.url}".`, prompt_id: 'reference', version: 1, run_id: `run-${runs}` })
      }
      if (method === 'POST' && parts[2] === 'answer') return analyzeReference(reference, (body as { text: string }).text)
      if (method === 'POST' && parts[2] === 'episodes') {
        return episodeFromReference(reference, (body as { mode: 'structure_clone' | 'own_version' }).mode)
      }
    }
    if (method === 'POST' && path === '/ideas/answer') {
      const request = body as { channel: Idea['channel']; text: string }
      return ideasAnswer(request.channel, request.text)
    }
    if (method === 'GET' && path === '/episodes') return ok(channel ? state.filter((e) => e.channel === channel) : state)
    if (method === 'GET' && path === '/slots') return ok(currentSlots())
    if (method === 'GET' && path === '/jobs') return ok(jobList(searchParams))
    if (parts[0] === 'jobs' && parts[1]) {
      const id = decodeURIComponent(parts[1])
      const job = canonJobRecords.get(id) ?? jobs.items.find((j) => j.id === id) ?? shotJobs.find((j) => j.id === id)
      if (!job) return fail(404, `Джоба ${id} нет.`)
      if (method === 'GET' && parts.length === 2) return ok(job)
      if (method === 'POST' && parts[2] === 'cancel') {
        const cancelled: Job = { ...job, status: 'cancelled', finished_at: NOW }
        canonJobRecords.set(id, cancelled)
        return ok(cancelled)
      }
    }
    if (parts[0] === 'batches' && parts[1]) {
      const id = decodeURIComponent(parts[1])
      const row = batchRows.get(id)
      if (method === 'GET' && parts.length === 2) return row ? ok(batchSummary(row)) : fail(404, `Пачка «${id}» не найдена.`)
      if (method === 'POST' && parts[2] && parts.length === 3) {
        const response = batchAction(id, parts[2])
        if (response) return response
      }
    }
    if (method === 'GET' && path === '/providers/catalog/images') return ok(IMAGE_CATALOG)
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
      const source = ideaForEpisode(request)
      if (source && !('id' in source)) return source
      created += 1
      const episode: EpisodeListItem = {
        id: request.id ?? `${request.channel[0]}${String(10 + created).padStart(2, '0')}`,
        channel: request.channel,
        title: request.title ?? source?.title ?? 'Новый выпуск',
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
      if (source) {
        // Заявка из идеи (docs/research.md, «Выпуск из идеи»), идея — «взята в выпуск»
        projectOf(episode).brief = {
          ...emptyBrief,
          idea: source.title,
          angle: source.angle,
          hook_promise: source.hook_promise,
          notes: source.summary,
          idea_id: source.id,
        }
        Object.assign(source, { status: 'used', episode_id: episode.id, updated_at: NOW })
      }
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
      if (method === 'GET' && rest === 'similarity') return similarityOf(episode)
      if (method === 'POST' && rest === 'director/validate') {
        const items = checkDirector(episode, body)
        return ok({ ok: !items.length, errors: items.map((item) => item.message), items } satisfies PlanCheck)
      }
      if (method === 'POST' && rest === 'director') return saveVersion(episode, body)
      if (method === 'GET' && parts[2] === 'director' && parts[3]) {
        const plan = plansOf(episode)
        return plan && plan.version === parts[3] ? ok(directorFile(plan)) : fail(404, `Версия ${parts[3]} плана выпуска «${episode.id}» не найдена.`)
      }
      if (method === 'GET' && rest === 'canon') return ok(episodeCanonOf(episode))
      if (method === 'POST' && rest === 'canon/update') return updateCanon(episode)
      if (method === 'GET' && parts[2] === 'shots' && parts[3] && parts[4] === 'prompt') return shotPromptOf(episode, decodeURIComponent(parts[3]))
      if (method === 'GET' && parts[2] === 'shots' && parts[3] && parts[4] === 'images' && parts[5] && parts[6] === 'thumb') {
        const w = Number(searchParams.get('w') ?? 320)
        if (w !== 160 && w !== 320) return shapeError(['query', 'w'], `Ширины миниатюры ${w} нет — есть 160 и 320.`, 'thumb_width')
        return { status: 200, body: thumbSvg(`${decodeURIComponent(parts[3])} · v${parts[5]}`, w, 9 / 16), contentType: 'image/svg+xml' }
      }
      if (method === 'GET' && parts[2] === 'shots' && parts[3] && parts[4] === 'images' && parts[5] && parts[6] === 'file') {
        return { status: 200, body: thumbSvg(`${decodeURIComponent(parts[3])} · v${parts[5]}`, 1280, 9 / 16), contentType: 'image/svg+xml' }
      }
      if (method === 'POST' && parts[2] === 'shots' && parts[3] && parts[4] === 'images' && parts[5] && parts[6] === 'choose') {
        return chooseVersion(episode, decodeURIComponent(parts[3]), Number(parts[5]))
      }
      if (method === 'GET' && rest === 'generate/estimate') return generateEstimate(episode, batchQueryOf(searchParams))
      if (method === 'GET' && rest === 'check/estimate') {
        return checkEstimate(episode, (searchParams.get('shots') ?? '').split(',').filter(Boolean))
      }
      if (method === 'POST' && parts[2] === 'shots' && parts[3] && parts.length === 5 && parts[4] === 'check') {
        return checkShot(episode, decodeURIComponent(parts[3]))
      }
      if (method === 'POST' && rest === 'generate') return startBatch(episode, (body ?? {}) as BatchQuery)
      if (parts[2] === 'shots' && parts[3] && parts.length === 5 && parts[4] === 'redraw' && method === 'POST') {
        return redrawShot(episode, decodeURIComponent(parts[3]), (body ?? {}) as { model?: string | null; prompt?: string | null })
      }
      if (method === 'GET' && parts[2] === 'shots' && parts[3] && parts[4] === 'redraw' && parts[5] === 'estimate') {
        return redrawEstimate(episode, decodeURIComponent(parts[3]), searchParams.get('model'))
      }
      if (method === 'GET' && rest === 'plan/parts') return ok(planParts(episode))
      if (method === 'POST' && rest === 'plan/prompt') return planPrompt(episode, Number(searchParams.get('part') ?? 1))
      if (method === 'POST' && rest === 'plan/answer') return planAnswer(episode, (body as { text: string }).text)
    }
    return fail(404, `Мок API не знает ${method} ${path}.`)
  }

  // План «Пиратов» прибит к канону, каким мок начинается: публикация в тесте не двигает его ссылки (принцип 14)
  plansOf(state.find((episode) => episode.id === 'pirate')!)

  return {
    handle,
    episodes: state,
    projects,
    canon: {
      styles: canonStyles,
      periods: canonPeriods,
      characters: canonCharacters,
      sheets: canonSheets,
      jobs: canonJobRecords,
      monthlyLimit,
      episodes: episodeCanons,
    },
    /** Наборы частей моста по выпуску: принятые части и последний обмен */
    parts: partSets,
    /** Генерация кадров: пачки, джобы кадров, пропущенные кадры смет; `drawShot` — конец джоба кадра, `finishCheck` —
     *  конец перепроверки */
    generation: { batches: batchRows, jobs: shotJobs, skipped: skippedShots, drawShot, refuseShot, finishCheck },
    generateArtboard,
  }
}

export type MockApi = ReturnType<typeof createMockApi>
