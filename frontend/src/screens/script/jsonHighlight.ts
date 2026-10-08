/* Подсветка и адреса в JSON плана для режима «JSON» (M4.7): строка текста → токены, путь поля → номер строки,
   id кадра → строка кадра. Только синтаксис: доменные правила проверяет бэкенд (`director/validate`).
   Строки JSON не переносятся (перевод строки внутри — `\n`), поэтому строка текста разбирается без состояния. */

export type TokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'space' | 'error'

export interface Token {
  kind: TokenKind
  text: string
}

const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const LITERAL = /true|false|null/y
const WORD = /[A-Za-z_$][\w$]*/y
const SPACE = /[ \t\r]+/y
const PUNCT = new Set(['{', '}', '[', ']', ',', ':'])

/** Конец строки JSON, начатой кавычкой в `start`: индекс после закрывающей кавычки; не закрыта — конец текста.
 *  Обратная косая экранирует следующий символ: `"a\"b"` — одна строка, `"a\\"` закрывается на последней кавычке. */
function stringEnd(line: string, start: number): number {
  let i = start + 1
  while (i < line.length) {
    const ch = line[i]
    if (ch === '\\') i += 2
    else if (ch === '"') return i + 1
    else i += 1
  }
  return line.length
}

function match(re: RegExp, line: string, at: number): string | null {
  re.lastIndex = at
  const found = re.exec(line)
  return found ? found[0] : null
}

/** Строка текста → токены. Ключ — строка, за которой (через пробелы) идёт `:`. Незнакомое — `error`. */
export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < line.length) {
    const ch = line[i]!
    const space = match(SPACE, line, i)
    if (space) {
      tokens.push({ kind: 'space', text: space })
      i += space.length
      continue
    }
    if (ch === '"') {
      const end = stringEnd(line, i)
      SPACE.lastIndex = end
      const after = SPACE.exec(line)?.[0].length ?? 0
      tokens.push({ kind: line[end + after] === ':' ? 'key' : 'string', text: line.slice(i, end) })
      i = end
      continue
    }
    if (PUNCT.has(ch)) {
      tokens.push({ kind: 'punct', text: ch })
      i += 1
      continue
    }
    const number = ch === '-' || (ch >= '0' && ch <= '9') ? match(NUMBER, line, i) : null
    if (number) {
      tokens.push({ kind: 'number', text: number })
      i += number.length
      continue
    }
    const word = match(WORD, line, i)
    if (word) {
      tokens.push({ kind: match(LITERAL, line, i) === word ? 'literal' : 'error', text: word })
      i += word.length
      continue
    }
    tokens.push({ kind: 'error', text: ch })
    i += 1
  }
  return tokens
}

// --- адреса -----------------------------------------------------------------------------------

export interface JsonLocations {
  /** Путь поля (`meta.episode_id`, `shots.3.image.prompt`, элемент массива — `shots.3`) → строка с 1 */
  paths: Map<string, number>
  /** id кадра → индекс в `shots` */
  shots: Map<string, number>
}

interface Frame {
  kind: 'object' | 'array'
  path: string
  key: string | null
  index: number
}

const join = (base: string, part: string | number) => (base === '' ? String(part) : `${base}.${part}`)

function unquote(text: string): string {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'string' ? value : text
  } catch {
    return text.replace(/^"|"$/g, '')
  }
}

const SHOT_PATH = /^shots\.(\d+)$/

/** Где что лежит в тексте: по токенам, без разбора значений. Битый JSON даёт то, что успел найти. */
export function locate(text: string): JsonLocations {
  const paths = new Map<string, number>()
  const shots = new Map<string, number>()
  const stack: Frame[] = []
  const mark = (path: string, line: number) => {
    if (!paths.has(path)) paths.set(path, line)
  }
  /** Путь значения, которое начинается сейчас: ключ объекта или номер элемента массива */
  const valuePath = (): string | null => {
    const frame = stack[stack.length - 1]
    if (!frame) return ''
    if (frame.kind === 'array') return join(frame.path, frame.index)
    return frame.key === null ? null : join(frame.path, frame.key)
  }

  text.split('\n').forEach((source, i) => {
    const line = i + 1
    for (const token of tokenizeLine(source)) {
      const frame = stack[stack.length - 1]
      if (token.kind === 'space' || token.kind === 'error') continue
      if (token.kind === 'key') {
        if (frame?.kind === 'object') {
          frame.key = unquote(token.text)
          mark(join(frame.path, frame.key), line)
        }
        continue
      }
      if (token.kind === 'punct') {
        if (token.text === '{' || token.text === '[') {
          const path = valuePath() ?? ''
          if (path) mark(path, line)
          stack.push({ kind: token.text === '{' ? 'object' : 'array', path, key: null, index: 0 })
        } else if (token.text === '}' || token.text === ']') {
          stack.pop()
        } else if (token.text === ',' && frame) {
          if (frame.kind === 'array') frame.index += 1
          else frame.key = null
        }
        continue
      }
      // Скаляр: строка, число, литерал
      const path = valuePath()
      if (path !== null && frame?.kind === 'array') mark(path, line)
      const shot = frame?.kind === 'object' && frame.key === 'id' ? SHOT_PATH.exec(frame.path) : null
      if (shot && token.kind === 'string') {
        const id = unquote(token.text)
        if (!shots.has(id)) shots.set(id, Number(shot[1]))
      }
    }
  })
  return { paths, shots }
}

/** Строка ближайшего найденного предка пути: `shots.3.image.prompt` → `shots.3.image` → `shots.3` */
function nearest(paths: Map<string, number>, path: string): number | null {
  let current = path
  while (current) {
    const line = paths.get(current)
    if (line !== undefined) return line
    const dot = current.lastIndexOf('.')
    current = dot < 0 ? '' : current.slice(0, dot)
  }
  return null
}

/** Строка кадра: поле `path` внутри кадра (`vo`, `image.prompt`, можно с префиксом `shots.N.`), без него — строка
 *  `"id"`. `facts[].shot_id` с тем же id кадром не считается. Кадра нет — null. */
export function lineOfShot(text: string, shotId: string, path?: string): number | null {
  return shotLine(locate(text), shotId, path)
}

/** `lineOfShot` по готовому `locate` — когда ошибок много, текст разбирается один раз */
export function shotLine({ paths, shots }: JsonLocations, shotId: string, path?: string): number | null {
  const index = shots.get(shotId)
  if (index === undefined) return null
  const base = `shots.${index}`
  const field = path?.replace(/^shots\.\d+\.?/, '') ?? ''
  if (field) {
    const line = nearest(paths, join(base, field))
    if (line !== null && line !== paths.get(base)) return line
  }
  return paths.get(join(base, 'id')) ?? paths.get(base) ?? null
}

/** Строка поля вне кадров (`meta.episode_id`, `music.0.section`) или ближайшего предка; не нашлось — null */
export function lineOfPath(text: string, path: string): number | null {
  return pathLine(locate(text), path)
}

export function pathLine({ paths }: JsonLocations, path: string): number | null {
  return path ? nearest(paths, path) : null
}

// --- синтаксис --------------------------------------------------------------------------------

export interface SyntaxProblem {
  line: number
  column: number
  /** Что не так — по-русски, для панели проверки */
  message: string
  /** Сообщение `JSON.parse` как есть — техническая деталь */
  detail: string
}

export type Parsed = { ok: true; value: Record<string, unknown> } | { ok: false; problem: SyntaxProblem }

function position(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)))
  const lines = before.split('\n')
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 }
}

/** Где споткнулся `JSON.parse`: «line 3 column 5» (V8 новее, Firefox), «position 45» (V8), иначе — конец текста */
function whereFailed(text: string, message: string): { line: number; column: number } {
  const lineColumn = /line (\d+) column (\d+)/.exec(message)
  if (lineColumn) return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) }
  const offset = /position (\d+)/.exec(message)
  if (offset) return position(text, Number(offset[1]))
  return position(text, text.trimEnd().length)
}

/** Текст редактора → план-объект или синтаксическая ошибка со строкой и столбцом. Запрос с ошибкой не уходит. */
export function parsePlanJson(text: string): Parsed {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const { line, column } = whereFailed(text, detail)
    return {
      ok: false,
      problem: { line, column, detail, message: 'Ошибка синтаксиса JSON — проверьте запятые, кавычки и скобки рядом' },
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      ok: false,
      problem: { line: 1, column: 1, detail: typeof value, message: 'План — объект JSON: текст начинается с «{»' },
    }
  }
  return { ok: true, value: value as Record<string, unknown> }
}
