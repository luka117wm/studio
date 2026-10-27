/* Сквозной сценарий канона на моках API (M5.11): «нужно каналу → эпоха через мост → публикация → облик → лист →
   утверждение». План Samurai импортирован до канона: эпоха edo-1650 и облик you@ashigaru-17 прибиты к заготовкам v001
   (M5.2), даймё уже опубликован с листом 6/6 — его в «Нужно каналу» нет. Ответ чата — `fixtures/period-edo-1650.txt`,
   прогресс сборки листа — поток SSE теста (`./events`). Облик появился в новой версии персонажа, поэтому ссылка плана
   на v001 его не находит: перед утверждением выпуск переводится на новые версии, как ответит бэкенд. */
import { readFileSync } from 'node:fs'
import type { CharacterDoc } from '../src/types/canon'
import { SHEET_ANGLES, mockCandidate, type MockApi } from '../src/mocks/api'
import { expect, test } from './api'
import { chatAnswer, clipboardText, grantClipboard, pasteAnswer } from './chat'
import { channelJob, emitJob, installFakeEvents } from './events'

test.skip(({ viewport }) => viewport?.width !== 1536, 'сквозной сценарий идёт на базовой ширине')

const SAMURAI_PLAN = JSON.parse(readFileSync(new URL('./fixtures/samurai-plan.json', import.meta.url), 'utf8')) as unknown
const DAIMYO = 'daimyo@edo-1650'

/** План Samurai из чата до канона; даймё — опубликованный облик с листом 6/6, собранным раньше */
function prepare(api: MockApi) {
  expect(api.handle('POST', '/api/projects/samurai/director?source=manual', SAMURAI_PLAN).status).toBe(200)
  expect(api.handle('POST', `/api/canon/cursus/needed/appearances/${encodeURIComponent(DAIMYO)}`).status).toBe(201)
  const doc = api.handle('GET', '/api/canon/cursus/characters/daimyo').body as CharacterDoc
  const data = {
    ...doc.data,
    label: 'Даймё',
    nature: { ...doc.data.nature, face: 'long narrow face, thin moustache, heavy-lidded eyes' },
    appearances: doc.data.appearances.map((look) => ({
      ...look,
      label: 'даймё',
      period: 'edo-1650',
      age: 52,
      build: 'lean, stooped shoulders',
      clothing: 'dark silk haori over a grey kosode',
    })),
  }
  expect(api.handle('PUT', '/api/canon/cursus/characters/daimyo/draft', data).status).toBe(200)
  expect(api.handle('POST', '/api/canon/cursus/characters/daimyo/publish').status).toBe(201)
  const candidates = SHEET_ANGLES.map(([slot]) => mockCandidate(DAIMYO, 'v001', slot, 1))
  api.canon.sheets.cursus.set(DAIMYO, { candidates, chosen: Object.fromEntries(candidates.map((c) => [c.slot, c.id])) })
}

test('нужно каналу → эпоха через мост → публикация → облик → лист → утверждение', async ({ page, apiMock, baseURL }) => {
  prepare(apiMock.api)
  await installFakeEvents(page)
  await grantClipboard(page, baseURL)
  await page.clock.install({ time: new Date('2026-09-11T12:41:00+03:00') })
  const toast = (text: string | RegExp) => page.getByRole('status').filter({ hasText: text })

  // 1. Экран 3: канон не готов — утверждение отказывает и ведёт на экран 12
  await page.goto('/episodes/samurai/script')
  const side = page.getByRole('complementary', { name: 'Источник плана' })
  const canon = side.getByRole('region', { name: 'Канон выпуска' })
  await expect(canon).toContainText('1 эпоха не опубликована, 1 облик не опубликован')
  await expect(page.locator('footer[role="status"]')).toContainText('Канон: 1 эпоха не опубликована, 1 облик не опубликован')
  await side.getByRole('button', { name: 'Утвердить план' }).click()
  const refusal = side.getByRole('alert')
  await expect(refusal).toContainText('Канон не готов: 1 эпоха не опубликована, 1 облик не опубликован — экран «Канон».')
  await refusal.getByRole('link', { name: /^эпоха edo-1650 не опубликована/ }).click()
  await expect(page).toHaveURL(/\/canon\?layer=periods&period=edo-1650$/)

  // 2. «Нужно каналу» → скелет эпохи
  const needed = page.getByRole('complementary', { name: 'Нужно каналу' })
  const edo = needed.getByRole('listitem').filter({ hasText: /^edo-1650/ })
  await expect(edo).toContainText('Samurai Household: every rank')
  await edo.getByRole('button', { name: 'Создать' }).click()
  const period = page.getByRole('form', { name: 'Эпоха' })
  await expect(period.getByRole('heading', { name: 'edo-1650' })).toBeVisible()

  // 3. Промпт эпохи — в буфере после тоста
  const bridge = period.getByRole('region', { name: 'Эпоха через чат' })
  await bridge.getByRole('button', { name: 'Скопировать промпт эпохи' }).click()
  await expect(toast('Промпт эпохи edo-1650 скопирован')).toBeVisible()
  await expect.poll(() => clipboardText(page)).toContain('"edo-1650"')

  // 4. Ответ чата с прозой вокруг JSON → черновик заполнен
  await pasteAnswer(page, bridge.getByRole('textbox', { name: 'Ответ из чата' }), chatAnswer('period-edo-1650.txt'))
  await bridge.getByRole('button', { name: 'Применить вставку' }).click()
  await expect(page.getByText(/Черновик эпохи: заполнено 10 полей/)).toBeVisible()
  await expect(period.getByRole('heading', { name: 'Эдо, 1650' })).toBeVisible()
  expect(apiMock.api.canon.periods.cursus.get('edo-1650')?.draft?.data.forbidden).toHaveLength(11)

  // 5. «Опубликовать v001»
  await page.getByRole('button', { name: 'Опубликовать v001' }).click()
  const publish = page.getByRole('dialog', { name: 'Опубликовать v001' })
  await publish.getByRole('button', { name: 'Опубликовать v001' }).click()
  await expect(toast('Опубликована v001: выпуски на прежних версиях не затронуты')).toBeVisible()
  expect(apiMock.api.canon.periods.cursus.get('edo-1650')?.versions.map((v) => v.info.version)).toEqual(['v001'])
  await expect(needed.getByRole('listitem').filter({ hasText: /^edo-1650/ })).toHaveCount(0)

  // 6. Облик из «Нужно каналу» — в черновик персонажа you, подпись и эпоха, публикация v003
  await page.getByRole('radiogroup', { name: 'Слой канона' }).getByRole('radio', { name: 'Персонажи' }).click()
  const ashigaru = needed.getByRole('listitem').filter({ hasText: /^you@ashigaru-17/ })
  await ashigaru.getByRole('button', { name: 'Создать' }).click()
  const character = page.getByRole('form', { name: 'Персонаж' })
  const look = character.getByRole('region', { name: 'Облик you@ashigaru-17' })
  await look.getByRole('textbox', { name: 'Облик: подпись' }).fill('ашигару')
  await look.getByRole('combobox', { name: 'Облик: эпоха' }).click()
  await page.getByRole('option', { name: 'Эдо, 1650' }).click()
  await look.getByRole('textbox', { name: 'Облик: возраст' }).fill('17')
  await page.getByRole('button', { name: 'Опубликовать v003' }).click()
  await page.getByRole('dialog', { name: 'Опубликовать v003' }).getByRole('button', { name: 'Опубликовать v003' }).click()
  await expect(toast('Опубликована v003: выпуски на прежних версиях не затронуты')).toBeVisible()

  // 7. Лист: сборка с ценой до клика → прогресс по SSE → кандидаты → выбор шести → «готов 6/6»
  await character.getByRole('list', { name: 'Облики персонажа' }).getByRole('button', { name: /ашигару/ }).click()
  const sheet = page.getByRole('dialog', { name: /^Лист опорных портретов: You · ашигару/ })
  await sheet.getByRole('button', { name: 'Собрать лист (6 ракурсов × 2 кандидата, ~$1.61)' }).click()
  const progress = sheet.getByLabel('Сборка листа')
  await expect(progress).toContainText('В очереди')
  const jobId = [...apiMock.api.canon.jobs.keys()].at(-1)!
  await emitJob(page, 'job.progress', channelJob(jobId, 'anchor_sheet', 'running', 0.5, 'Кандидат 6 из 12 · Профиль, 2'))
  await expect(progress).toContainText('Кандидат 6 из 12 · Профиль, 2')
  await expect(progress).toContainText('50%')
  await expect(sheet.getByRole('button', { name: 'Деталь, кандидат 2' })).toBeVisible()
  await emitJob(page, 'job.done', channelJob(jobId, 'anchor_sheet', 'done', 1, 'Готово 12 из 12: сбоев 0'))
  await expect(toast('Лист собран, списано $1.61')).toBeVisible()
  await expect(progress).toHaveCount(0)
  for (const [, label] of SHEET_ANGLES) {
    const first = sheet.getByRole('button', { name: `${label}, кандидат 1` })
    await first.click()
    await expect(first).toHaveAttribute('aria-pressed', 'true')
  }
  await expect(sheet.getByText('готов 6/6')).toBeVisible()
  await page.keyboard.press('Escape')

  // 8. Экран 3: облик в v003, ссылка плана на v001 его не находит → перевод → утверждение → «Генерация»
  await page.goto('/episodes/samurai/script')
  await expect(canon.getByRole('listitem').filter({ hasText: 'you@ashigaru-17' })).toContainText('не находится, есть v003')
  await canon.getByRole('button', { name: 'Перевести на новые версии' }).click()
  const confirm = page.getByRole('dialog', { name: 'Перевести на новые версии' })
  await expect(confirm.getByRole('list', { name: 'Что сменится' })).toHaveText('облик you@ashigaru-17: v001 → v003, 4 кадра')
  await confirm.getByRole('button', { name: 'Перевести', exact: true }).click()
  // Картинок у кадров ещё нет — устаревать нечему (M6.1), как у бэкенда
  await expect(toast('План v002 на новых версиях канона: 0 кадров stale')).toBeVisible()
  await expect(canon).toContainText('готов')
  // Тост перевода перекрывает кнопку внизу правой панели (как в script.spec) — клик ждёт автоскрытия, не дольше 4 с
  await side.getByRole('button', { name: 'Утвердить план' }).click()
  await expect(toast('План v002 утверждён')).toBeVisible()
  const rail = page.getByRole('navigation', { name: 'Этапы выпуска' })
  await expect(rail.getByRole('link', { name: 'Генерация' })).toHaveAttribute('title', 'Генерация — в работе')
  expect(apiMock.api.episodes.find((e) => e.id === 'samurai')?.stage).toBe('generate')
})
