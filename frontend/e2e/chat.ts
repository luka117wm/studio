/* Мост через чат в сквозных сценариях: ответы чата из `fixtures/` (проза вокруг JSON, как у настоящего claude.ai) и
   буфер обмена браузера. Промпт читается из буфера после «Скопировать…», ответ вставляется в поле сочетанием клавиш,
   как руками: `fill()` с длинным текстом печатает его в журнал шага целиком и прячет ошибку (L-034). */
import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'

/** Текст ответа чата из `e2e/fixtures/<name>` */
export const chatAnswer = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

/** Разрешение на буфер для origin dev-сервера: без него `readText` в headless Chromium отклоняется */
export async function grantClipboard(page: Page, baseURL: string | undefined) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
}

export const clipboardText = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

/** Ответ чата — в буфер и в поле через ⌘V / Ctrl+V */
export async function pasteAnswer(page: Page, field: Locator, text: string) {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text)
  await field.click()
  await page.keyboard.press('ControlOrMeta+V')
}
