/* Снимки оболочки: 11 маршрутов на трёх ширинах; при 1536 — диалог, меню, тост и восемь вкладок каталога (регрессия кита).
   Данные — моки API (`./api`), часы — «сейчас» артборда 1 (11 сентября, 12:41), анимации выключены конфигом.
   Экраны выпуска открывают Pirate Ship из моков, экран 1 снимается в режиме «Все каналы». */
import type { Page } from '@playwright/test'
import { expect, test } from './api'

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

/** Экраны выпуска (03–08) открывают Pirate Ship по пути — его название в шапке; экран 1 — в режиме «Все каналы», как
 *  в артборде; остальные — без открытого выпуска, как в эталонах M1.6. */
async function open(page: Page, path: string) {
  await page.clock.install({ time: new Date('2026-09-11T12:41:00+03:00') })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(path)
  if (path.startsWith('/episodes/pirate/')) {
    await expect(page.getByTitle('Переименовать выпуск')).toHaveText('Pirate Ship: Powder Monkey to Captain')
  }
  if (path === '/episodes') {
    await page.getByRole('radiogroup', { name: 'Фильтр канала' }).getByRole('radio', { name: 'Все' }).click()
    await expect(page.getByText('9 всего, 2 опубликовано')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Слоты публикации' }).getByRole('listitem')).toHaveCount(11)
  }
  // Каталог состояний — отдельный чанк dev-сборки: без ожидания снимок ловил пустую рабочую зону (эталон M1.6)
  if (path === '/states') await expect(page.getByRole('heading', { name: 'Состояния', level: 1 })).toBeVisible()
  // Данные оболочки на месте: процесс из снимка джобов и риск слота в статус-строке
  const statusBar = page.locator('footer[role="status"]')
  await expect(statusBar).toContainText('78 из 104')
  await expect(statusBar).toContainText('Следующий слот 13 сентября')
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

  test('диалог «Новый выпуск»', async ({ page }) => {
    await open(page, '/episodes')
    await page.getByRole('button', { name: 'Новый выпуск' }).click()
    const dialog = page.getByRole('dialog', { name: 'Новый выпуск' })
    await expect(dialog.getByText('~$3.80 за выпуск')).toBeVisible()
    await expect(page).toHaveScreenshot('overlay-new-episode.png')
  })

  test('меню слота', async ({ page }) => {
    await open(page, '/episodes')
    await page.getByRole('button', { name: 'Назначить выпуск на 23 сентября' }).click()
    await expect(page.getByRole('menu', { name: 'Назначить выпуск на 23 сентября' })).toBeVisible()
    await expect(page).toHaveScreenshot('overlay-slot-menu.png')
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
