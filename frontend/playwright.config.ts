/* Визуальная регрессия оболочки: снимки экранов на трёх ширинах из layout.md (1536 база, 1920, 2560).
   Сервер — dev, потому что каталог /states существует только в dev-сборке. */
import { defineConfig, devices } from '@playwright/test'

const PORT = 5173

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{projectName}-{platform}{ext}',
  expect: {
    toHaveScreenshot: {
      // threshold — допуск на антиалиасинг в цвете пикселя; maxDiffPixels — сдвиг на 2 px даёт сотни пикселей
      threshold: 0.2,
      maxDiffPixels: 100,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  },
  projects: [
    { name: '1536', use: { viewport: { width: 1536, height: 864 } } },
    { name: '1920', use: { viewport: { width: 1920, height: 1080 } } },
    { name: '2560', use: { viewport: { width: 2560, height: 1440 } } },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
