// Типы фронта из Pydantic: `app.tools.gen_schema` → JSON Schema → json-schema-to-typescript → src/types/*.ts.
// Источник правды — модели бэкенда; `src/types/` руками не правится (кроме fixtures.ts до M3).
// Режимы: --write — записать схемы (docs/director.schema.json, docs/schema/) и типы (src/types/);
//         --check — сгенерировать в памяти и упасть, если файлы на диске разошлись. Дерево не трогается,
//         поэтому проверка честна и на незакоммиченном коде (приём tokens:check).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'json-schema-to-typescript'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(here, '../..')
export const TYPES_DIR = resolve(here, '../src/types')
export const REGENERATE = 'pnpm -C frontend typegen'
/** Файлы src/types, которые пишутся руками (временные типы оболочки, уходят в M3). */
export const MANUAL = new Set(['fixtures.ts'])
const HASH_MARK = '@generated sha256:'

const COMPILE_OPTIONS = {
  bannerComment: '',
  // Модели на BaseModel не пишут additionalProperties: без этого у каждой был бы [k: string]: unknown.
  additionalProperties: false,
  // Каждое определение компилируется отдельно; ссылки на соседей — по имени, без повторного объявления.
  declareExternallyReferenced: false,
  unreachableDefinitions: false,
  format: true,
  style: { singleQuote: true, semi: false, printWidth: 100, trailingComma: 'all' },
}

/** docs/director.schema.json → director.ts; docs/schema/job.schema.json → job.ts. */
export function targetOf(source) {
  return join(TYPES_DIR, `${basename(source).replace(/\.schema\.json$/, '')}.ts`)
}

/** Схемы из бэкенда: { 'docs/…schema.json': содержимое }. Python ничего не пишет (`--stdout`). */
export function loadSchemas() {
  const out = execFileSync('uv', ['run', 'python', '-m', 'app.tools.gen_schema', '--stdout'], {
    cwd: REPO,
    env: { ...process.env, PYTHONPATH: join(REPO, 'backend') },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return JSON.parse(out)
}

/** Заголовки `title` у полей pydantic ставит всем подряд; json-schema-to-typescript делает из них
 *  отдельные именованные типы (Status, Kind…), которые сталкиваются между моделями. Оставляем
 *  `title` только у определений — это имена типов. */
function stripFieldTitles(node) {
  if (Array.isArray(node)) return node.map(stripFieldTitles)
  if (node === null || typeof node !== 'object') return node
  const out = {}
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'title') out[key] = stripFieldTitles(value)
  }
  return out
}

/** Определения схемы по имени: `$defs` и корень, если корень сам модель (director). */
function definitions(schema) {
  const defs = {}
  for (const [name, def] of Object.entries(schema.$defs ?? {})) {
    defs[name] = { ...stripFieldTitles(def), title: name }
  }
  if (schema.type === 'object' && schema.properties) {
    const { $defs: _defs, $schema: _dialect, $id: _id, ...root } = schema
    defs[schema.title] = { ...stripFieldTitles(root), title: schema.title }
  }
  return defs
}

export function bodyHash(body) {
  return createHash('sha256').update(body).digest('hex')
}

export function header(source, body) {
  return [
    '/*',
    ` * Сгенерировано \`${REGENERATE}\` из ${source} (Pydantic-модели бэкенда).`,
    ' * Не править руками: меняется модель, затем команда выше.',
    ` * ${HASH_MARK}${bodyHash(body)}`,
    ' */',
    '',
  ].join('\n')
}

/** Разбор сгенерированного файла: хэш из шапки и тело после неё; null — файл не из typegen. */
export function parseGenerated(text) {
  const match = /^\/\*\n(?: \*.*\n)*? \* @generated sha256:([0-9a-f]{64})\n \*\/\n/.exec(text)
  if (!match) return null
  return { hash: match[1], body: text.slice(match[0].length) }
}

export async function schemaToTs(schema, source) {
  const defs = definitions(schema)
  const parts = []
  for (const name of Object.keys(defs).sort()) {
    parts.push(await compile({ ...defs[name], $defs: defs }, name, COMPILE_OPTIONS))
  }
  const body = parts.join('\n')
  return header(source, body) + body
}

/** Все файлы генерации: абсолютный путь → содержимое. */
export async function generate(schemas = loadSchemas()) {
  const files = new Map()
  for (const [source, text] of Object.entries(schemas)) {
    files.set(join(REPO, source), text)
    files.set(targetOf(source), await schemaToTs(JSON.parse(text), source))
  }
  return files
}

/** Сгенерированные раньше типы, для которых схемы больше нет (группу убрали из бэкенда). */
function obsolete(files) {
  if (!existsSync(TYPES_DIR)) return []
  return readdirSync(TYPES_DIR)
    .filter((name) => name.endsWith('.ts') && !MANUAL.has(name))
    .map((name) => join(TYPES_DIR, name))
    .filter((path) => !files.has(path) && parseGenerated(readFileSync(path, 'utf8')) !== null)
}

/** Пути, где диск разошёлся с генерацией (включая лишние сгенерированные файлы). */
export async function check(schemas) {
  const files = await generate(schemas)
  const stale = [...files]
    .filter(([path, text]) => !existsSync(path) || readFileSync(path, 'utf8') !== text)
    .map(([path]) => path)
  return [...stale, ...obsolete(files)]
}

export async function write(schemas) {
  const files = await generate(schemas)
  const changed = []
  for (const [path, text] of files) {
    if (existsSync(path) && readFileSync(path, 'utf8') === text) continue
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
    changed.push(path)
  }
  for (const path of obsolete(files)) {
    rmSync(path)
    changed.push(path)
  }
  return changed
}

async function main(argv) {
  const mode = argv[2]
  const show = (paths) => paths.map((path) => `  ${relative(REPO, path)}`).join('\n')
  if (mode === '--write') {
    const changed = await write()
    console.log(changed.length ? `typegen: updated\n${show(changed)}` : 'typegen: up to date')
    return 0
  }
  if (mode === '--check') {
    const stale = await check()
    if (stale.length === 0) {
      console.log('typegen: up to date')
      return 0
    }
    console.error(`typegen: types are stale or edited by hand:\n${show(stale)}\nRun: ${REGENERATE}`)
    return 1
  }
  console.error('usage: node scripts/typegen.mjs --write | --check')
  return 2
}

// Точка входа только при прямом запуске; при import из теста не срабатывает.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv))
}
