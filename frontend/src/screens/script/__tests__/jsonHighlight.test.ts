// Подсветка JSON плана: строка → токены, адреса полей и кадров, синтаксическая ошибка со строкой и столбцом.
import { describe, expect, test } from 'vitest'
import { lineOfPath, lineOfShot, locate, parsePlanJson, tokenizeLine, type Token } from '../jsonHighlight'

/** Токены строкой «вид:текст» без пробелов — таблица читается глазами */
const kinds = (line: string) =>
  tokenizeLine(line)
    .filter((t: Token) => t.kind !== 'space')
    .map((t) => `${t.kind}:${t.text}`)

describe('tokenizeLine', () => {
  test.each([
    ['ключ и строка', '  "vo": "You are eleven.",', ['key:"vo"', 'punct::', 'string:"You are eleven."', 'punct:,']],
    ['ключ с пробелом до двоеточия', '"id" : "s001"', ['key:"id"', 'punct::', 'string:"s001"']],
    ['вложенность', '{"motion": {"strength": 0.08}}', ['punct:{', 'key:"motion"', 'punct::', 'punct:{', 'key:"strength"', 'punct::', 'number:0.08', 'punct:}', 'punct:}']],
    ['массив строк', '["a", "b"]', ['punct:[', 'string:"a"', 'punct:,', 'string:"b"', 'punct:]']],
    ['экранированная кавычка', '"say \\"aye\\"": 1', ['key:"say \\"aye\\""', 'punct::', 'number:1']],
    ['обратная косая перед кавычкой', '"path": "C:\\\\"', ['key:"path"', 'punct::', 'string:"C:\\\\"']],
    ['\\u-последовательность', '"t": "\\u00e9t\\u00e9"', ['key:"t"', 'punct::', 'string:"\\u00e9t\\u00e9"']],
    ['юникод и эмодзи', '"claim": "Порох — 1716 ⚓ 🏴‍☠️"', ['key:"claim"', 'punct::', 'string:"Порох — 1716 ⚓ 🏴‍☠️"']],
    ['числа: минус, дробь, экспонента', '[-1, 0.5, 1e-3, 2E+10]', ['punct:[', 'number:-1', 'punct:,', 'number:0.5', 'punct:,', 'number:1e-3', 'punct:,', 'number:2E+10', 'punct:]']],
    ['литералы', '[true, false, null]', ['punct:[', 'literal:true', 'punct:,', 'literal:false', 'punct:,', 'literal:null', 'punct:]']],
    ['незакрытая строка — до конца строки', '"vo": "unfinished', ['key:"vo"', 'punct::', 'string:"unfinished']],
    ['мусор — error', '"a": nope, @', ['key:"a"', 'punct::', 'error:nope', 'punct:,', 'error:@']],
    ['двоеточие внутри строки не делает её ключом', '"a:b", 1', ['string:"a:b"', 'punct:,', 'number:1']],
  ])('%s', (_name, line, expected) => {
    expect(kinds(line)).toEqual(expected)
  })

  test('токены собирают строку обратно без потерь', () => {
    const line = '    "prompt": "carries a \\"case\\" — down", "n": -2.5e3, "ok": true }'
    expect(
      tokenizeLine(line)
        .map((t) => t.text)
        .join(''),
    ).toBe(line)
  })
})

const PLAN = JSON.stringify(
  {
    meta: { episode_id: 'c01', part: 1 },
    shots: [
      { id: 's001', vo: 'One', image: { prompt: 'deck', period: 'caribbean-1716' } },
      { id: 's002', vo: '', image: { prompt: 'hold' } },
    ],
    facts: [{ claim: 'x', shot_id: 's002' }],
  },
  null,
  2,
)
const LINES = PLAN.split('\n')
/** Строка (с 1) первого вхождения `needle` после строки `after` */
const lineOf = (needle: string, after = 0) => LINES.findIndex((l, i) => i >= after && l.includes(needle)) + 1

describe('адреса', () => {
  test('пути полей и индексы кадров', () => {
    const { paths, shots } = locate(PLAN)
    expect(paths.get('meta.episode_id')).toBe(lineOf('"episode_id"'))
    expect(paths.get('shots.1.image.prompt')).toBe(lineOf('"hold"'))
    expect([...shots]).toEqual([
      ['s001', 0],
      ['s002', 1],
    ])
  })

  test('lineOfShot: строка id, поле кадра, путь с префиксом, нет кадра', () => {
    expect(lineOfShot(PLAN, 's002')).toBe(lineOf('"id": "s002"'))
    expect(lineOfShot(PLAN, 's002', 'vo')).toBe(lineOf('"vo": ""'))
    expect(lineOfShot(PLAN, 's001', 'shots.0.image.prompt')).toBe(lineOf('"deck"'))
    // Поля нет — ближайший предок внутри кадра, а не строка начала кадра
    expect(lineOfShot(PLAN, 's002', 'image.period')).toBe(lineOf('"image"', lineOf('"id": "s002"')))
    expect(lineOfShot(PLAN, 's999')).toBeNull()
  })

  test('shot_id в фактах кадром не считается', () => {
    const facts = lineOf('"shot_id"')
    expect(lineOfShot(PLAN, 's002')).not.toBe(facts)
  })

  test('lineOfPath: поле вне кадров и ближайший предок', () => {
    expect(lineOfPath(PLAN, 'meta.episode_id')).toBe(lineOf('"episode_id"'))
    expect(lineOfPath(PLAN, 'meta.channel')).toBe(lineOf('"meta"'))
    expect(lineOfPath(PLAN, '')).toBeNull()
  })
})

describe('parsePlanJson', () => {
  test('объект — разобран', () => {
    expect(parsePlanJson('{"a": 1}')).toEqual({ ok: true, value: { a: 1 } })
  })

  test('пропущенная запятая — строка и столбец места ошибки', () => {
    const text = '{\n  "a": 1\n  "b": 2\n}'
    const parsed = parsePlanJson(text)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.problem.line).toBe(3)
    expect(parsed.problem.column).toBe(3)
    expect(parsed.problem.message).toMatch(/^Ошибка синтаксиса JSON/)
  })

  test('обрыв текста — последняя строка', () => {
    const parsed = parsePlanJson('{\n  "a": [1,\n')
    expect(parsed.ok ? null : parsed.problem.line).toBe(2)
  })

  test('не объект — своя ошибка', () => {
    const parsed = parsePlanJson('[1, 2]')
    expect(parsed.ok ? null : parsed.problem.message).toBe('План — объект JSON: текст начинается с «{»')
  })
})
