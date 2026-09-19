/* Снимки оболочки: 11 маршрутов на трёх ширинах; при 1536 — диалог, меню, тост и восемь вкладок каталога (регрессия кита).
   Часы заморожены (обратный отсчёт, автоскрытие тостов), анимации выключены конфигом. */
import { expect, test, type Page } from '@playwright/test'

const SCREENS: { id: string; path: string }[] = [
  { id: '01-episodes', path: '/episodes' },
  { id: '02-ideas', path: '/ideas' },
  { id: '03-script', path: '/episodes/pirate/script' },
  { id: '04-generate', path: '/episodes/pirate/generate' },
  { id: '05-edit', path: '/episodes/pirate/edit' },
  { id: '06-inspector', path: '/episodes/pirate/edit/s004' },
  { id: '07-export', path: '/episodes/pirate/export' },
  { id: '08-publish', path: '/episodes/pirate/publish' },
  { id: '09-settings', path: '/settings' },
  { id: '10-states', path: '/states' },
  { id: '12-canon', path: '/canon' },
]

const CATALOG_TABS = ['Управление', 'Ввод', 'Слои', 'Обратная связь', 'Пустые состояния', 'Состояния ошибок', 'Продукт', 'Клавиатура']

async function open(page: Page, path: string) {
  await page.clock.install({ time: new Date('2026-09-19T12:41:00') })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(path)
  await page.evaluate(() => document.fonts.ready)
  await expect(page.getByRole('main')).toBeVisible()
}

test.describe('экраны', () => {
  for (const s of SCREENS) {
    test(s.id, async ({ page }) => {
      await open(page, s.path)
      await expect(page).toHaveScreenshot(`${s.id}.png`)
    })
  }
})

test.describe('слои и каталог (только 1536)', () => {
  test.skip(({ viewport }) => viewport?.width !== 1536, 'слои и вкладки каталога снимаются на базовой ширине')

  test('окно горячих клавиш', async ({ page }) => {
    await open(page, '/episodes/pirate/edit')
    await page.getByRole('button', { name: 'Горячие клавиши (?)' }).click()
    await expect(page.getByRole('dialog', { name: 'Горячие клавиши' })).toBeVisible()
    await expect(page).toHaveScreenshot('overlay-help.png')
  })

  test('меню', async ({ page }) => {
    await open(page, '/states')
    await page.getByRole('tab', { name: 'Слои' }).click()
    await page.getByRole('button', { name: 'Действия' }).click()
    await expect(page.getByRole('menu', { name: 'Действия' })).toBeVisible()
    await expect(page).toHaveScreenshot('overlay-menu.png')
  })

  test('тосты', async ({ page }) => {
    await open(page, '/states')
    await page.getByRole('tab', { name: 'Обратная связь' }).click()
    await page.getByRole('button', { name: 'Показать 5 тостов' }).click()
    await expect(page.getByText('и ещё 2')).toBeVisible()
    await expect(page).toHaveScreenshot('overlay-toasts.png')
  })

  for (const tab of CATALOG_TABS) {
    test(`каталог: ${tab}`, async ({ page }) => {
      await open(page, '/states')
      await page.getByRole('tab', { name: tab }).click()
      await expect(page.getByRole('tabpanel', { name: tab })).toBeVisible()
      await expect(page).toHaveScreenshot(`catalog-${CATALOG_TABS.indexOf(tab) + 1}.png`)
    })
  }
})
