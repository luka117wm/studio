/* Ответы API с контентом артборда 1 «Выпуски» (сентябрь 2026, «сегодня» — пятница, 11 сентября) — для vitest и e2e
   (`page.route`, M3.7). Формы — сгенерированные типы через `satisfies`: смена модели на бэкенде ломает сборку тестов,
   а не молча моки. Числа — как в артборде, иначе сверка скриншотов даст шум (приём M1.3).
   В production-код не импортируется (решение 7 устава M3). */
import type { ChannelProfile, FormatPreview } from '@/types/channel'
import type { CostSummary, Money } from '@/types/cost'
import type { EpisodeCreate, EpisodeListItem, EpisodePatch, EpisodeSummary } from '@/types/episode'
import type { BridgeError, BridgeRun, BridgeSettings } from '@/types/bridge'
import type { JobList } from '@/types/job'
import type { EffectivePlan, PlanAnswerResult, PlanParts, PlanPrompt, PlanShot } from '@/types/plan'
import type { EpisodeBrief, Project } from '@/types/project'
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
  const plans = new Map<string, EffectivePlan>()
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

  /** План в работе у «Пиратов» (стадия «Монтаж») — версия v002 из пяти кадров; у остальных — нет */
  function plansOf(episode: EpisodeListItem): EffectivePlan | null {
    if (!plans.has(episode.id) && episode.id === 'pirate') plans.set(episode.id, mockPlan(episode, 'v002', 5))
    return plans.get(episode.id) ?? null
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
        const patch = body as { brief?: Partial<EpisodeBrief> | null }
        if ('brief' in patch) project.brief = patch.brief === null ? null : { ...(project.brief ?? emptyBrief), ...patch.brief }
        project.updated_at = NOW
        return ok(project)
      }
      if (method === 'GET' && rest === 'plan') return ok(plansOf(episode))
      if (method === 'GET' && rest === 'plan/parts') return ok(planParts(episode))
      if (method === 'POST' && rest === 'plan/prompt') return planPrompt(episode, Number(searchParams.get('part') ?? 1))
      if (method === 'POST' && rest === 'plan/answer') return planAnswer(episode, (body as { text: string }).text)
    }
    return fail(404, `Мок API не знает ${method} ${path}.`)
  }

  return { handle, episodes: state, projects }
}

export type MockApi = ReturnType<typeof createMockApi>
