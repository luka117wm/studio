/* Сквозной сценарий версии канона на моках API (M5.11): «новая версия стиля → перевод выпуска → stale». Pirate Ship
   прибит к стилю v003 и готов; правка света на экране 12 публикует v004 — выпуск не тронут (принцип 14), экран 3
   показывает «есть v004», перевод — явное действие: новая версия плана, кадры stale с причиной на листе. */
import { expect, test } from './api'

test.skip(({ viewport }) => viewport?.width !== 1536, 'сквозной сценарий идёт на базовой ширине')

test('новая версия стиля → перевод выпуска → stale', async ({ page, apiMock }) => {
  await page.clock.install({ time: new Date('2026-09-11T12:41:00+03:00') })
  const toast = (text: string | RegExp) => page.getByRole('status').filter({ hasText: text })

  // 1. Экран 3: канон выпуска готов, стиль прибит к v003, переводить нечего
  await page.goto('/episodes/pirate/script')
  const side = page.getByRole('complementary', { name: 'Источник плана' })
  const canon = side.getByRole('region', { name: 'Канон выпуска' })
  const style = canon.getByRole('listitem').filter({ hasText: 'Стиль канала' })
  await expect(style).toContainText('v003')
  await expect(style).toContainText('готов')
  await expect(canon.getByRole('button', { name: 'Перевести на новые версии' })).toHaveCount(0)

  // 2. Экран 12 по ссылке строки: правка света → черновик из v003 → «Опубликовать v004» со списком изменений
  await style.getByRole('link').click()
  await expect(page).toHaveURL(/\/canon$/)
  const form = page.getByRole('form', { name: 'Стиль канала' })
  await form.getByRole('textbox', { name: 'Свет: Направление' }).fill('Top light')
  await expect(page.getByRole('button', { name: /^Черновик из v003/ })).toBeVisible()
  await page.getByRole('button', { name: 'Опубликовать v004' }).click()
  const publish = page.getByRole('dialog', { name: 'Опубликовать v004' })
  await expect(publish.getByRole('list', { name: 'Изменения к прошлой версии' })).toHaveText('Направление светаTop light')
  await publish.getByRole('button', { name: 'Опубликовать v004' }).click()
  await expect(toast('Опубликована v004: выпуски на прежних версиях не затронуты')).toBeVisible()
  expect(apiMock.api.canon.styles.cursus.versions.map((v) => v.info.version)).toEqual(['v001', 'v002', 'v003', 'v004'])

  // 3. Экран 3: выпуск по-прежнему на v003, есть новее → подтверждение со списком → перевод
  await page.goto('/episodes/pirate/script')
  await expect(style).toContainText('v003')
  await expect(style).toContainText('есть v004')
  await canon.getByRole('button', { name: 'Перевести на новые версии' }).click()
  const confirm = page.getByRole('dialog', { name: 'Перевести на новые версии' })
  await expect(confirm.getByRole('list', { name: 'Что сменится' })).toHaveText('стиль канала: v003 → v004, 8 кадров')
  await expect(confirm.getByText('Затронутые кадры станут stale, картинки останутся.')).toBeVisible()
  await confirm.getByRole('button', { name: 'Перевести', exact: true }).click()
  // Устаревает только картинка (M6.1): s004 и s005 в очереди без неё — их статус прежний, как у бэкенда
  await expect(toast('План v004 на новых версиях канона: 6 кадров stale')).toBeVisible()

  // 4. Новая версия плана прибита к v004; на листе у s001 — stale с причиной смены стиля
  await expect(style).toContainText('v004')
  await expect(canon.getByRole('button', { name: 'Перевести на новые версии' })).toHaveCount(0)
  const sheet = page.getByRole('article', { name: 'Лист сценария' })
  await expect(sheet.locator('[data-shot]').getByRole('img', { name: 'Статус: проверить' })).toHaveCount(6)
  const glyph = sheet.locator('[data-shot="s001"]').getByRole('img', { name: 'Статус: проверить' })
  await glyph.hover()
  await expect(page.getByRole('tooltip')).toHaveText('Стиль канала: style/v003 → style/v004')
})
