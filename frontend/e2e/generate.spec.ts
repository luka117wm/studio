/* Сквозной сценарий экрана 4 на моках API (M6.12): «утвердить → сгенерировать → пауза → отказ → с правкой → версии →
   выбор → перерисовать выбранные». «Пираты» — план v004 артборда 4 из 104 кадров, ещё не утверждённый
   (`generateArtboard({ approved: false })`); листы боцмана и квартирмейстера, которых в артборде нет, тест собирает сам,
   иначе «Утвердить план» откажет каноном. Воркер — сам тест: `startShot` / `drawShot` / `refuseShot` мока меняют
   джоб и кадр, событие SSE шлёт `./events` — экран читает сводку пачки из `batch.updated`, плитки — перезапросом
   project.json не чаще раза в секунду (`api/live.ts`). Перерисовка по R не меняет выбор (E-1, docs/generation.md),
   поэтому в сравнении выбирается новая версия 2. */
import type { Page } from '@playwright/test'
import type { BatchSummary } from '../src/types/batch'
import { SAFETY_REFUSAL, SHEET_ANGLES, mockCandidate, type MockApi } from '../src/mocks/api'
import { expect, test } from './api'
import { emitBatch, emitJob, installFakeEvents, jobEvent } from './events'

test.skip(({ viewport }) => viewport?.width !== 1536, 'сквозной сценарий идёт на базовой ширине')

const EPISODE = 'pirate'

/** Листы боцмана (3/6) и квартирмейстера (не собран) — 6/6, выбор в первой версии персонажа с обликом, как у моков */
function sheetsReady(api: MockApi) {
  const you = api.canon.characters.cursus.get('you')!
  for (const id of ['you@boatswain-34', 'you@quartermaster-41']) {
    const version = you.versions.find((v) => v.data.appearances.some((look) => look.id === id))!.info.version
    const candidates = SHEET_ANGLES.map(([slot]) => mockCandidate(id, version, slot, 1))
    api.canon.sheets.cursus.set(id, { candidates, chosen: Object.fromEntries(candidates.map((c) => [c.slot, c.id])) })
  }
}

/** Кадр выбирается кликом справа от кнопок слоя действий: в центре плитки наведение успевает поднять слой, и клик
 *  уходит общему предку — кнопке выбора нажатие не достаётся */
const pick = (page: Page, shot: string, shift = false) =>
  page.getByRole('button', { name: `Выбрать ${shot}` }).click({ position: { x: 150, y: 45 }, modifiers: shift ? ['Shift'] : [] })

test('утвердить → сгенерировать → пауза → отказ → с правкой → версии → выбор → перерисовать выбранные', async ({ page, apiMock }) => {
  const { api } = apiMock
  api.generateArtboard({ drawn: false, approved: false })
  sheetsReady(api)
  const gen = api.generation
  await installFakeEvents(page)
  await page.clock.install({ time: new Date('2026-09-11T12:41:00+03:00') })
  const toast = (text: string | RegExp) => page.getByRole('status').filter({ hasText: text })
  const tile = (shot: string, state: string) => page.getByRole('listitem', { name: `${shot}, ${state}` })
  const strip = page.getByRole('region', { name: 'Очереди генерации' })

  /** Воркер взял кадр / нарисовал / получил отказ — и событие джоба в поток */
  const run = async (shot: string) => {
    const job = gen.startShot(EPISODE, shot)
    expect(job, `джоб ${shot} в очереди`).not.toBeNull()
    await emitJob(page, ...jobEvent(job!))
  }
  const draw = async (shot: string) => emitJob(page, ...jobEvent(gen.drawShot(EPISODE, shot)!))
  const refuse = async (shot: string) => emitJob(page, ...jobEvent(gen.refuseShot(EPISODE, shot)!))
  const batchUpdated = async (id: string) => emitBatch(page, api.handle('GET', `/api/batches/${id}`).body as BatchSummary)

  // 1. Экран 3: план v004 не утверждён → «Утвердить план» → рельс → экран 4 до первой пачки
  await page.goto(`/episodes/${EPISODE}/script`)
  await expect(page.getByRole('article', { name: 'Лист сценария' })).toContainText('Every Rank on a Pirate Ship')
  const side = page.getByRole('complementary', { name: 'Источник плана' })
  await side.getByRole('button', { name: 'Утвердить план' }).click()
  await expect(toast('План v004 утверждён')).toBeVisible()
  const rail = page.getByRole('navigation', { name: 'Этапы выпуска' })
  await expect(rail.getByRole('link', { name: 'Генерация' })).toHaveAttribute('title', 'Генерация — в работе')
  await rail.getByRole('link', { name: 'Генерация' }).click()
  await expect(page).toHaveURL(`/episodes/${EPISODE}/generate`)
  await expect(strip).toContainText('Кадры: очередь пуста')

  // 2. «Сгенерировать 104 кадра (~$6.97)» — смета мока по каталогу → пачка, 104 плитки в очереди
  await page.getByRole('button', { name: 'Сгенерировать 104 кадра (~$6.97)' }).click()
  await expect(toast('В очереди 104 кадра')).toBeVisible()
  await expect(strip).toContainText('Кадры: 0 из 104')
  await expect(page.getByTestId('shot-grid').locator('li[data-status="queued"]')).toHaveCount(104)
  const batchId = [...gen.batches.keys()].at(-1)!

  //    Прогресс по SSE: три запроса параллельно → «рисуется» → готовые миниатюры
  for (const shot of ['s001', 's002', 's003']) await run(shot)
  await batchUpdated(batchId)
  await expect(strip).toContainText('параллельно 3 запроса')
  for (const shot of ['s001', 's002', 's003']) await expect(tile(shot, 'рисуется')).toBeVisible()
  for (const shot of ['s001', 's002', 's003']) await draw(shot)
  await batchUpdated(batchId)
  await expect(strip).toContainText('Кадры: 3 из 104')
  await expect(strip).toContainText('$0.20 из $6.97 по смете')
  for (const shot of ['s001', 's002', 's003']) {
    await expect(tile(shot, 'готов').locator('img')).toHaveAttribute('src', `/api/projects/${EPISODE}/shots/${shot}/images/1/thumb?w=320`)
  }

  // 3. Пауза: «на паузе», пул не берёт кадры пачки — s004 остаётся в очереди; «Продолжить»
  await strip.getByRole('button', { name: 'Пауза' }).click()
  await expect(toast('Очередь на паузе')).toBeVisible()
  await expect(strip).toContainText('на паузе')
  expect(gen.startShot(EPISODE, 's004'), 'на паузе воркер новых не берёт').toBeNull()
  await batchUpdated(batchId)
  await expect(strip).toContainText('на паузе')
  await expect(tile('s004', 'в очереди')).toBeVisible()
  await strip.getByRole('button', { name: 'Продолжить' }).click()
  await expect(toast('Очередь продолжена')).toBeVisible()
  await expect(strip).toContainText(/осталось ~\d+ мин/)

  // 4. Отказ фильтра у s004 — причина на плитке и «1 ошибка»; пачка идёт дальше
  await run('s004')
  await run('s005')
  await refuse('s004')
  await draw('s005')
  await run('s006')
  await batchUpdated(batchId)
  await expect(strip).toContainText('1 ошибка')
  await expect(tile('s004', 'ошибка')).toContainText(SAFETY_REFUSAL.slice(0, 40))
  await expect(tile('s005', 'готов')).toBeVisible()
  await expect(tile('s006', 'рисуется')).toBeVisible()

  //    «С правкой…» — первым у отказа → новое действие → версия 1 кадра
  await tile('s004', 'ошибка').hover()
  await page.getByRole('group', { name: 'Действия кадра s004' }).getByRole('button', { name: 'С правкой…' }).click()
  const edit = page.getByRole('dialog', { name: 'С правкой: s004' })
  await expect(edit).toContainText(SAFETY_REFUSAL)
  await edit.getByRole('textbox', { name: 'Действие кадра' }).fill('hands a sealed cartridge case to the gun crew, eyes on the deck')
  await edit.getByRole('button', { name: 'Перерисовать с правкой (~$0.07)' }).click()
  await expect(toast('s004: правка записана, новая версия в очереди')).toBeVisible()
  await expect(edit).toHaveCount(0)
  await expect(tile('s004', 'в очереди')).toBeVisible()
  await run('s004')
  await draw('s004')
  await expect(toast('Перерисовано: s004, версия 1, списано $0.07')).toBeVisible()
  await expect(tile('s004', 'готов').getByRole('img', { name: 'Версия 1 из 1, выбрана' })).toBeVisible()

  // 5. R на s004 → версия 2, выбор остаётся на 1 (E-1) → V → сравнение → «Выбрать версию 2» → плитка с версией 2
  await page.getByRole('button', { name: 'Выбрать s004' }).focus()
  await page.keyboard.press('r')
  await expect(tile('s004', 'в очереди')).toBeVisible()
  await run('s004')
  await draw('s004')
  await expect(toast('Перерисовано: s004, версия 2, списано $0.07')).toBeVisible()
  await expect(tile('s004', 'готов').getByRole('img', { name: 'Версия 1 из 2, выбрана' })).toBeVisible()
  await page.keyboard.press('v')
  await expect(page).toHaveURL(/\?view=compare&shot=s004$/)
  const versions = page.getByRole('list', { name: 'Версии кадра s004' })
  await expect(versions.getByRole('listitem')).toHaveCount(2)
  await versions.getByRole('listitem', { name: 'версия 2 из 2' }).getByRole('button', { name: 'Выбрать версию 2' }).click()
  await expect(toast('Выбрана версия 2, остальные в истории кадра')).toBeVisible()
  await expect(versions.getByRole('listitem', { name: 'версия 2 из 2, выбрана' })).toBeVisible()
  await page.getByRole('button', { name: 'К сетке кадров' }).click()
  const chosen = tile('s004', 'готов')
  await expect(chosen.getByRole('img', { name: 'Версия 2 из 2, выбрана' })).toBeVisible()
  await expect(chosen.locator('img').first()).toHaveAttribute('src', `/api/projects/${EPISODE}/shots/s004/images/2/thumb?w=320`)

  // 6. Диапазон s001–s005 → модель Lite → «Перерисовать выбранные (5, ~$0.17)» — сумма по смете мока: 5 × $0.034
  await pick(page, 's001')
  await pick(page, 's005', true)
  const bar = page.getByRole('region', { name: 'Выбор кадров' })
  await expect(bar).toContainText('Выбрано 5 кадров')
  await bar.getByRole('radiogroup', { name: 'Модель перерисовки' }).getByRole('radio', { name: '2 Lite' }).click()
  const redraw = bar.getByRole('button', { name: 'Перерисовать выбранные (5, ~$0.17)' })
  await expect(redraw).toBeEnabled()
  await redraw.click()
  await expect(toast('Поставлено 5 кадров, ~$0.17')).toBeVisible()
  await expect(bar).toContainText('Клик выбирает, ⇧-клик — диапазон, наведение — действия')
  //    Подсказка полосы влезает на 1536 без многоточия (сверка M6.12)
  expect(await bar.locator('p').first().evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  const lite = gen.jobs.filter((job) => job.batch_id === [...gen.batches.keys()].at(-1))
  expect(lite.map((job) => [job.payload.shot_id, job.payload.model])).toEqual(
    ['s001', 's002', 's003', 's004', 's005'].map((shot) => [shot, 'nb2-lite']),
  )
})

/** Лента сравнения доезжает до карточки новой версии (L-057): в jsdom прокрутки нет, поэтому — здесь. У s061 моков три
 *  версии — окно ленты занято, четвёртая карточка встаёт за правым краем */
test('сравнение версий: «Добавить версию» — лента доезжает до новой карточки', async ({ page, apiMock }) => {
  const { api } = apiMock
  api.generateArtboard()
  const gen = api.generation
  await installFakeEvents(page)
  await page.clock.install({ time: new Date('2026-09-11T12:41:00+03:00') })
  await page.goto(`/episodes/${EPISODE}/generate?view=compare&shot=s061`)
  const versions = page.getByRole('list', { name: 'Версии кадра s061' })
  await expect(versions.getByRole('listitem')).toHaveCount(3)
  await page.getByRole('button', { name: 'Добавить версию (~$0.07)' }).click()
  await expect(versions.getByRole('listitem', { name: /^новая версия/ })).toBeInViewport({ ratio: 0.95 })
  const job = gen.startShot(EPISODE, 's061')
  expect(job, 'джоб s061 в очереди').not.toBeNull()
  await emitJob(page, ...jobEvent(job!))
  await emitJob(page, ...jobEvent(gen.drawShot(EPISODE, 's061')!))
  await expect(versions.getByRole('listitem', { name: 'версия 4 из 4' })).toBeInViewport({ ratio: 0.95 })
  await expect(versions.getByRole('listitem', { name: 'версия 2 из 4, выбрана' })).toBeVisible()
})
