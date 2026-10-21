/* Сквозной сценарий экрана 3 на моках API: выпуск Otto из бэклога → заявка → промпт части 1 из 2 в буфере → ответ чата
   → «Часть 1 принята» → часть 2 → план на листе → правка VO → «Сохранено 12:41» → «Утвердить план» → рельс на
   «Генерации». Ответы чата — `fixtures/plan-part-*.txt`; мок не разбирает план, а собирает свой по числу частей.
   С M5.2 утверждение ждёт готовый канон: у Otto в моках стиля нет («Задайте стиль канала»), поэтому до сценария он
   опубликован — те же поля, что у Cursus. Эпохи и облики плана моки считают готовыми. */
import type { StyleDoc } from '../src/types/canon'
import { expect, test } from './api'
import { chatAnswer, clipboardText, grantClipboard, pasteAnswer } from './chat'

test.skip(({ viewport }) => viewport?.width !== 1536, 'сквозной сценарий идёт на базовой ширине')

test('идея → выпуск → план из моста частями → правка → утверждение', async ({ page, apiMock, baseURL }) => {
  const style = apiMock.api.handle('GET', '/api/canon/cursus/style').body as StyleDoc
  expect(apiMock.api.handle('PUT', '/api/canon/otto/style/draft', style.data).status).toBe(200)
  expect(apiMock.api.handle('POST', '/api/canon/otto/style/publish').status).toBe(201)
  await grantClipboard(page, baseURL)
  await page.clock.install({ time: new Date('2026-09-11T12:41:00+03:00') })
  await page.goto('/episodes')

  // Выпуск из бэклога: у Otto в бэклоге одна идея, план — две части по 26 кадров
  await page.getByRole('button', { name: 'Новый выпуск' }).click()
  const dialog = page.getByRole('dialog', { name: 'Новый выпуск' })
  await dialog.getByRole('radio', { name: "Otto's Timeline" }).click()
  const backlog = dialog.getByRole('radio', { name: 'Из бэклога идей' })
  await expect(backlog).toBeEnabled()
  // Сам input скрыт (sr-only), клик — по подписи пункта, как мышью
  await dialog.getByText('Из бэклога идей', { exact: true }).click()
  await expect(backlog).toBeChecked()
  await expect(dialog.getByRole('combobox', { name: 'Идея из бэклога' })).toContainText('A Day in Pompeii Before the Eruption')
  await dialog.getByRole('button', { name: 'Создать выпуск' }).click()
  await expect(page).toHaveURL('/episodes/o11/script')
  await expect(page.getByTitle('Переименовать выпуск')).toHaveText('A Day in Pompeii Before the Eruption')

  // 1. Заявка: идея пришла из бэклога, угол дописывается и уходит автосохранением
  const brief = page.getByRole('form', { name: 'Заявка' })
  await expect(brief.getByRole('textbox', { name: 'Идея' })).toHaveValue('A Day in Pompeii Before the Eruption')
  await brief.getByRole('textbox', { name: 'Угол подачи' }).fill('Otto spends the last ordinary day in town')
  await expect(page.getByTestId('save-indicator')).toHaveText('Сохранено 12:41')
  expect(apiMock.api.projects.get('o11')?.brief).toMatchObject({ idea_id: 'i0012', angle: 'Otto spends the last ordinary day in town' })

  // 2. Промпт части 1 из 2 — в буфере; эталон текста живёт в бэкенде, здесь — только начало
  const side = page.getByRole('complementary', { name: 'Источник плана' })
  await side.getByRole('button', { name: 'Скопировать промпт части 1 из 2' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Промпт части 1 из 2 скопирован' })).toBeVisible()
  await expect.poll(() => clipboardText(page)).toMatch(/^Write part 1 of 2 /)

  // 3. Ответ чата с прозой вокруг JSON → часть 1 принята, ждёт часть 2
  const answer = side.getByRole('textbox', { name: 'Ответ из чата' })
  await pasteAnswer(page, answer, chatAnswer('plan-part-1.txt'))
  await side.getByRole('button', { name: 'Применить вставку' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Часть 1 из 2 принята, 26 кадров' })).toBeVisible()
  await expect(side.getByText('Часть 1 вставлена, 26 кадров. Ждёт часть 2.')).toBeVisible()
  await expect(side.getByRole('listitem', { name: 'Часть 1 из 2: принята' })).toHaveAttribute('data-state', 'ready')
  await expect(answer).toHaveValue('')

  // 4. Часть 2 → версия v001, план на листе, стадия «Сценарий»
  await side.getByRole('button', { name: 'Скопировать промпт части 2 из 2' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Промпт части 2 из 2 скопирован' })).toBeVisible()
  await expect.poll(() => clipboardText(page)).toMatch(/^Write part 2 of 2 /)
  await pasteAnswer(page, answer, chatAnswer('plan-part-2.txt'))
  await side.getByRole('button', { name: 'Применить вставку' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'План v001: +52 кадра' })).toBeVisible()
  const sheet = page.getByRole('article', { name: 'Лист сценария' })
  await expect(sheet.getByText(/^v001/)).toBeVisible()
  const rail = page.getByRole('navigation', { name: 'Этапы выпуска' })
  await expect(rail.getByRole('link', { name: 'Сценарий' })).toHaveAttribute('title', 'Сценарий — в работе')

  // 5. Правка VO на листе → одна запись через 800 мс, «Сохранено 12:41», пометка «правка»
  const vo = sheet.getByRole('textbox', { name: 'VO кадра s001' })
  await vo.fill('It is the twenty-third of August, and the whole town smells of bread.')
  await expect(page.getByTestId('save-indicator')).toHaveText('Сохранено 12:41')
  await expect(sheet.getByText('правка').first()).toBeVisible()
  expect(apiMock.api.projects.get('o11')?.shots.s001?.user_override).toEqual({
    vo: 'It is the twenty-third of August, and the whole town smells of bread.',
  })

  // 6. «Утвердить план» → тост, рельс на «Генерации», стадия в моке. На 1536 стек тостов перекрывает кнопку внизу
  //    правой панели (в артборде так же) — клик ждёт автоскрытия, не дольше 4 с
  await side.getByRole('button', { name: 'Утвердить план' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'План v001 утверждён' })).toBeVisible()
  await expect(rail.getByRole('link', { name: 'Генерация' })).toHaveAttribute('title', 'Генерация — в работе')
  await expect(rail.getByRole('link', { name: 'Сценарий' })).toHaveAttribute('title', 'Сценарий — готово')
  expect(apiMock.api.episodes.find((e) => e.id === 'o11')?.stage).toBe('generate')
})
