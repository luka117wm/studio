/// <reference types="node" />
// Контракт слоя токенов:
//  1. копия tokens.css не разошлась с design/handoff;
//  2. hex-литералов нет нигде в src, кроме tokens.css;
//  3. theme.css ссылается только на существующие токены и не содержит hex;
//  4. Tailwind собирает утилиты из моста и не знает дефолтной палитры/шкалы.
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'tailwindcss'
import { describe, expect, test } from 'vitest'
import { compare, TARGET } from '../../../scripts/sync-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(here, '../../..')
const SRC = join(FRONTEND, 'src')
const STYLES = join(SRC, 'styles')

const read = (path: string) => readFileSync(path, 'utf8')
const squash = (css: string) => css.replace(/\s+/g, '').replace(/;}/g, '}')

// Цвет из 3, 4, 6 или 8 hex-символов; после — граница слова, иначе это id-селектор вроде #add-row
const HEX = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![0-9a-z_-])/gi
const TOKEN_DEF = /--([a-z0-9-]+)\s*:/g
const VAR_REF = /var\(--([a-z0-9-]+)\)/g

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx|css)$/.test(e.name))
    .map((e) => join(e.parentPath, e.name))
}

describe('tokens.css', () => {
  test('копия в src совпадает с design/handoff/tokens.css', () => {
    expect(compare().inSync).toBe(true)
  })

  test('hex-литералы живут только в tokens.css', () => {
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      if (file === TARGET) continue
      const text = read(file)
      for (const match of text.matchAll(HEX)) {
        const line = text.slice(0, match.index).split('\n').length
        offenders.push(`${relative(FRONTEND, file)}:${line} ${match[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('theme.css', () => {
  const theme = read(join(STYLES, 'theme.css'))
  const tokens = read(TARGET)

  test('без hex — только ссылки на переменные', () => {
    expect(theme.match(HEX) ?? []).toEqual([])
  })

  test('каждая var(--…) существует в tokens.css', () => {
    const defined = new Set([...tokens.matchAll(TOKEN_DEF)].map((m) => m[1]))
    const missing = [...theme.matchAll(VAR_REF)]
      .map((m) => m[1] as string)
      .filter((name) => !defined.has(name))
    expect(missing).toEqual([])
  })
})

describe('мост в Tailwind', () => {
  const require = createRequire(import.meta.url)
  const NODE_MODULES = join(FRONTEND, 'node_modules')

  // Резолвер импортов для compile(): пакеты — из node_modules, остальное — относительно base
  async function loadStylesheet(id: string, base: string) {
    let path: string
    if (id === 'tailwindcss') {
      path = join(dirname(require.resolve('tailwindcss/package.json')), 'index.css')
    } else if (id.startsWith('.') || id.startsWith('/')) {
      path = resolve(base, id)
    } else {
      path = join(NODE_MODULES, id)
    }
    return { path, base: dirname(path), content: read(path) }
  }

  async function build(candidates: string[]): Promise<string> {
    const compiler = await compile(read(join(SRC, 'index.css')), { base: SRC, loadStylesheet })
    return squash(compiler.build(candidates))
  }

  test('утилиты ссылаются на токены', async () => {
    const css = await build([
      'bg-panel', 'text-ink', 'border-line', 'text-13', 'text-script', 'font-ui', 'font-dense',
      'rounded-control', 'shadow-overlay', 'h-shell-topbar', 'size-icon', 'p-2',
    ])
    expect(css).toContain('.bg-panel{background-color:var(--bg-panel)}')
    expect(css).toContain('.text-ink{color:var(--text-primary)}')
    expect(css).toContain('.border-line{border-color:var(--line)}')
    expect(css).toContain('font-size:var(--text-13)')
    expect(css).toContain('line-height:var(--tw-leading,var(--leading-13))')
    expect(css).toContain('.text-script{font-size:var(--script-body);line-height:var(--tw-leading,var(--script-leading))}')
    expect(css).toContain('.font-ui{font-family:var(--font-ui)}')
    expect(css).toContain('.font-dense{font-family:var(--font-dense)}')
    expect(css).toContain('.rounded-control{border-radius:var(--radius-control)}')
    expect(css).toContain('var(--shadow-overlay)')
    expect(css).toContain('.h-shell-topbar{height:var(--shell-topbar)}')
    expect(css).toContain('.size-icon{width:var(--icon-size);height:var(--icon-size)}')
    expect(css).toContain('.p-2{padding:calc(var(--space-1)*2)}')
  })

  test('дефолтные палитра, шкала, радиусы и тени Tailwind отключены', async () => {
    const css = await build(['bg-red-500', 'text-white', 'text-sm', 'rounded-md', 'shadow-md', 'font-sans'])
    for (const cls of ['.bg-red-500', '.text-white', '.text-sm', '.rounded-md', '.shadow-md', '.font-sans']) {
      expect(css).not.toContain(cls)
    }
  })

  test('preflight берёт шрифты из токенов', async () => {
    const css = await build([])
    expect(css).toContain('--default-font-family:var(--font-ui)')
    expect(css).toContain('--default-mono-font-family:var(--font-script)')
  })
})
