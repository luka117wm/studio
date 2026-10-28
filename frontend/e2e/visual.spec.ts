/* Снимки оболочки: 11 маршрутов на трёх ширинах; при 1536 — диалог, меню, тост, восемь вкладок каталога (регрессия кита),
   режимы экранов 2 и 3: «План кадров», «JSON», вкладка «Референс» (M4.12), слои и лист экрана 12 и канон выпуска,
   который не готов, на экране 3 (M5.11), экран 4: выбор, сравнение версий, «Подозрительные» и до первой пачки (M6.12).
   Данные — моки API (`./api`), часы — «сейчас» артборда 1 (11 сентября, 12:41), анимации выключены конфигом. Экраны
   выпуска открывают Pirate Ship из моков, экран 1 снимается в режиме «Все каналы»; экран 4 — «Пираты» артборда 4
   (`generateArtboard`), без него у выпуска план артборда 3 и экран 4 — «План не утверждён». */
import type { Page } from '@playwright/test'
import type { MockApi } from '../src/mocks/api'
import type { PeriodDoc } from '../src/types/canon'
import { expect, test } from './api'

const SCREENS: { id: string; path: string; prepare?: (api: MockApi) => void }[] = [
  { id: '01-episodes', path: '/episodes' },
  { id: '02-ideas', path: '/ideas' },
  { id: '03-script', path: '/episodes/pirate/script' },
  { id: '04-generate', path: '/episodes/pirate/generate', prepare: (api) => api.generateArtboard() },
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
  // Экраны 2 и 3 — данные моков на месте, иначе снимок ловит экран до ответа API (L-027)
  if (path === '/ideas') await expect(page.getByRole('region', { name: 'Бэклог идей' }).getByRole('article')).toHaveCount(7)
  if (path === '/episodes/pirate/script') {
    await expect(page.getByRole('article', { name: 'Лист сценария' })).toContainText('Cursus — Every Rank on a Pirate Ship')
    await expect(page.getByRole('region', { name: 'Смета по плану' })).toContainText('Итого')
  }
  // Экран 4 — пачка артборда в полосе очередей, иначе главное действие до первой пачки
  if (path.startsWith('/episodes/pirate/generate')) {
    const strip = page.getByRole('region', { name: 'Очереди генерации' })
    await expect(strip.getByText(/^Кадры: (78 из 104|очередь пуста)$/)).toBeVisible()
  }
  // Экран 12 — форма слоя на месте; кадры стиля — шесть миниатюр
  if (path === '/canon') {
    await expect(page.getByRole('form', { name: 'Стиль канала' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Кадры стиля' }).locator('img')).toHaveCount(6)
  }
  // Каталог состояний — отдельный чанк dev-сборки: без ожидания снимок ловил пустую рабочую зону (эталон M1.6)
  if (path === '/states') await expect(page.getByRole('heading', { name: 'Состояния', level: 1 })).toBeVisible()
  // Данные оболочки на месте: процесс из снимка джобов и риск слота в статус-строке
  const statusBar = page.locator('footer[role="status"]')
  await expect(statusBar).toContainText('78 из 104')
  await expect(statusBar).toContainText('Следующий слот 13 сентября')
  await page.evaluate(() => document.fonts.ready)
  await expect(page.getByRole('main')).toBeVisible()
  await thumbsLoaded(page)
}

/** Миниатюры в окне (SVG-заглушки моков) догрузились — `loading="lazy"`, поэтому только видимые */
async function thumbsLoaded(page: Page) {
  await page.waitForFunction(() =>
    [...document.images].filter((img) => img.getBoundingClientRect().top < window.innerHeight).every((img) => img.complete && img.naturalWidth > 0),
  )
}

/** Канон «Пиратов» не готов: у эпохи caribbean-1716 есть v002 (выпуск прибит к v001), у пороховой обезьяны выбраны
 *  три ракурса из шести */
function pirateCanonNotReady(api: MockApi) {
  const period = api.handle('GET', '/api/canon/cursus/periods/caribbean-1716').body as PeriodDoc
  const data = { ...period.data, light_sources: [...period.data.light_sources, 'moonlight through the gratings'] }
  expect(api.handle('PUT', '/api/canon/cursus/periods/caribbean-1716/draft', data).status).toBe(200)
  expect(api.handle('POST', '/api/canon/cursus/periods/caribbean-1716/publish').status).toBe(201)
  const sheet = api.canon.sheets.cursus.get('you@powder-monkey-11')!
  for (const slot of ['full_body', 'in_action', 'detail']) delete sheet.chosen[slot]
}

test.describe('экраны', () => {
  for (const s of SCREENS) {
    test(s.id, async ({ page, apiMock }) => {
      s.prepare?.(apiMock.api)
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

test.describe('режимы экранов 2 и 3 (только 1536)', () => {
  test.skip(({ viewport }) => viewport?.width !== 1536, 'режимы снимаются на базовой ширине')

  test('план кадров', async ({ page }) => {
    await open(page, '/episodes/pirate/script')
    await page.getByRole('radiogroup', { name: 'Режим' }).getByRole('radio', { name: 'План кадров' }).click()
    await expect(page.getByRole('row').filter({ hasText: 's062' })).toBeVisible()
    await expect(page).toHaveScreenshot('03-script-plan.png')
  })

  test('JSON', async ({ page }) => {
    await open(page, '/episodes/pirate/script')
    await page.getByRole('radiogroup', { name: 'Режим' }).getByRole('radio', { name: 'JSON' }).click()
    await expect(page.getByRole('textbox', { name: 'JSON плана' })).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Проверка плана' })).toContainText('ошибок нет')
    await expect(page).toHaveScreenshot('03-script-json.png')
  })

  test('вкладка «Референс»', async ({ page }) => {
    await open(page, '/ideas?tab=reference')
    const map = page.getByRole('region', { name: 'Карта структуры' })
    await expect(map.getByRole('list', { name: 'Сегменты' }).getByRole('listitem')).toHaveCount(10)
    await expect(map.getByRole('region', { name: 'Приёмы подачи' }).getByRole('listitem')).toHaveCount(4)
    await expect(page.getByRole('region', { name: 'Сходство с референсом' })).toContainText('Выпусков по этому референсу ещё нет')
    await expect(page).toHaveScreenshot('02-ideas-reference.png')
  })
})

test.describe('экран 12 и канон на экране 3 (только 1536)', () => {
  test.skip(({ viewport }) => viewport?.width !== 1536, 'слои канона снимаются на базовой ширине')

  test('периоды', async ({ page }) => {
    await open(page, '/canon?layer=periods')
    await expect(page.getByRole('form', { name: 'Эпоха' }).getByRole('heading', { name: 'Карибы, 1716' })).toBeVisible()
    const needed = page.getByRole('complementary', { name: 'Нужно каналу' })
    await expect(needed).toContainText('edo-1650')
    await expect(needed).toContainText('venice-1560')
    await expect(page).toHaveScreenshot('12-canon-periods.png')
  })

  test('персонажи', async ({ page }) => {
    await open(page, '/canon?layer=characters&character=you')
    const looks = page.getByRole('form', { name: 'Персонаж' }).getByRole('list', { name: 'Облики персонажа' })
    await expect(looks.getByRole('button')).toHaveCount(5)
    await expect(looks.locator('img')).toHaveCount(4) // выбранный фас: три готовых листа и боцман 3/6
    await thumbsLoaded(page)
    await expect(page).toHaveScreenshot('12-canon-characters.png')
  })

  test('лист опорных портретов', async ({ page }) => {
    await open(page, '/canon?layer=characters&character=you&appearance=you%40powder-monkey-11&sheet=you%40powder-monkey-11')
    const sheet = page.getByRole('dialog', { name: /^Лист опорных портретов/ })
    await expect(sheet.getByText('готов 6/6')).toBeVisible()
    await expect(sheet.locator('img').first()).toBeVisible()
    await thumbsLoaded(page)
    await expect(page).toHaveScreenshot('12-canon-sheet.png')
  })

  test('канон выпуска не готов', async ({ page, apiMock }) => {
    pirateCanonNotReady(apiMock.api)
    await open(page, '/episodes/pirate/script')
    const canon = page.getByRole('complementary', { name: 'Источник плана' }).getByRole('region', { name: 'Канон выпуска' })
    await expect(canon.getByRole('button', { name: 'Перевести на новые версии' })).toBeVisible()
    await canon.scrollIntoViewIfNeeded()
    await expect(page.locator('footer[role="status"]')).toContainText('Канон:')
    await expect(page).toHaveScreenshot('03-script-canon.png')
  })
})

test.describe('экран 4 (только 1536)', () => {
  test.skip(({ viewport }) => viewport?.width !== 1536, 'режимы экрана 4 снимаются на базовой ширине')

  /** Кадр выбирается кликом справа от кнопок слоя действий: в центре плитки наведение успевает поднять слой, и клик
   *  уходит общему предку — кнопке выбора нажатие не достаётся */
  const pick = (page: Page, shot: string, shift = false) =>
    page.getByRole('button', { name: `Выбрать ${shot}` }).click({ position: { x: 150, y: 45 }, modifiers: shift ? ['Shift'] : [] })

  test('выбор', async ({ page, apiMock }) => {
    apiMock.api.generateArtboard()
    await open(page, '/episodes/pirate/generate')
    // Как в артборде: выбраны кадры «Able seaman» и начало «Boatswain», среди них отказ фильтра s047
    await page.getByRole('region', { name: 'Able seaman' }).evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await pick(page, 's035')
    await pick(page, 's050', true)
    await page.mouse.move(1376, 400)
    const bar = page.getByRole('region', { name: 'Выбор кадров' })
    await expect(bar).toContainText('Выбрано 16 кадров, из них 1 с ошибкой')
    await expect(bar.getByRole('button', { name: 'Перерисовать выбранные (16, ~$1.07)' })).toBeEnabled()
    await expect(page.getByRole('group', { name: /^Действия кадра/ })).toHaveCount(0)
    await thumbsLoaded(page)
    await expect(page).toHaveScreenshot('04-generate-selection.png')
  })

  test('сравнение версий', async ({ page, apiMock }) => {
    apiMock.api.generateArtboard()
    await open(page, '/episodes/pirate/generate?view=compare&shot=s061')
    await expect(page.getByRole('list', { name: 'Версии кадра s061' }).getByRole('listitem')).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'Добавить версию (~$0.07)' })).toBeEnabled()
    await thumbsLoaded(page)
    await expect(page).toHaveScreenshot('04-generate-compare.png')
  })

  test('подозрительные', async ({ page, apiMock }) => {
    apiMock.api.generateArtboard()
    await open(page, '/episodes/pirate/generate?view=suspects')
    await expect(page.getByRole('list', { name: 'Подозрительные: Смотреть первыми' }).getByRole('listitem')).toHaveCount(4)
    await thumbsLoaded(page)
    await expect(page).toHaveScreenshot('04-generate-suspects.png')
  })

  test('до первой пачки', async ({ page, apiMock }) => {
    apiMock.api.generateArtboard({ drawn: false })
    await open(page, '/episodes/pirate/generate')
    await expect(page.getByRole('button', { name: 'Сгенерировать 104 кадра (~$6.97)' })).toBeEnabled()
    await expect(page).toHaveScreenshot('04-generate-empty.png')
  })
})
