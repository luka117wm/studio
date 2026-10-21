import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8000' } },
  // jsdom для тестов кита; тесты токенов читают файлы через node:fs — среда им безразлична
  // e2e/ — Playwright, не vitest
  // Не больше 6 воркеров: на 16 jsdom-воркерах тяжёлые тесты экранов не укладываются в 5 с (L-047)
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'], css: false, exclude: ['e2e/**', 'node_modules/**'], maxWorkers: 6 },
})
