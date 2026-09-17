// Синхронизация design/handoff/tokens.css → src/styles/tokens.css.
// Копия нужна, потому что design/ перезаписывается импортом и живёт вне src/.
// Режимы: --write — скопировать; --check — упасть, если файлы разошлись.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const SOURCE = resolve(here, '../../design/handoff/tokens.css')
export const TARGET = resolve(here, '../src/styles/tokens.css')

/** Сравнивает источник и копию побайтно. */
export function compare() {
  const source = readFileSync(SOURCE, 'utf8')
  const target = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null
  return { inSync: source === target, source, target }
}

/** Перезаписывает копию. Возвращает true, если содержимое изменилось. */
export function write() {
  const { inSync, source } = compare()
  if (inSync) return false
  mkdirSync(dirname(TARGET), { recursive: true })
  writeFileSync(TARGET, source)
  return true
}

function main(argv) {
  const mode = argv[2]
  if (mode === '--write') {
    const changed = write()
    console.log(changed ? `tokens: updated ${TARGET}` : 'tokens: already in sync')
    return 0
  }
  if (mode === '--check') {
    const { inSync, target } = compare()
    if (inSync) {
      console.log('tokens: in sync')
      return 0
    }
    console.error(
      target === null
        ? `tokens: ${TARGET} is missing. Run: pnpm tokens:sync`
        : `tokens: ${TARGET} differs from ${SOURCE}. Run: pnpm tokens:sync`,
    )
    return 1
  }
  console.error('usage: node scripts/sync-tokens.mjs --write | --check')
  return 2
}

// Точка входа только при прямом запуске; при import из теста не срабатывает.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv))
}
