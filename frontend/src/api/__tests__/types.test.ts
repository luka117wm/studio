/// <reference types="node" />
// src/types/ — только генерация из Pydantic (`pnpm typegen`), кроме временного fixtures.ts:
//  1. у каждого файла шапка typegen, и sha256 тела сходится с ней — ручную правку видно сразу;
//  2. набор файлов совпадает со схемами в docs/ — ни лишних, ни пропавших.
// Устаревание относительно моделей ловит `pnpm typegen:check` (нужен Python, поэтому не здесь).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, expectTypeOf, test } from 'vitest'
import type { Director } from '@/types/director'
import type { JobEventData } from '@/types/job'
import {
  bodyHash,
  MANUAL,
  parseGenerated,
  REPO,
  targetOf,
  TYPES_DIR,
} from '../../../scripts/typegen.mjs'

const typeFiles = () =>
  readdirSync(TYPES_DIR)
    .filter((name) => name.endsWith('.ts') && !MANUAL.has(name))
    .map((name) => join(TYPES_DIR, name))

const schemaSources = () => [
  'docs/director.schema.json',
  ...readdirSync(join(REPO, 'docs/schema'))
    .filter((name) => name.endsWith('.schema.json'))
    .map((name) => `docs/schema/${name}`),
]

describe('src/types', () => {
  test('каждый файл сгенерирован и не правлен руками', () => {
    const edited: string[] = []
    for (const path of typeFiles()) {
      const parsed = parseGenerated(readFileSync(path, 'utf8'))
      if (parsed === null || bodyHash(parsed.body) !== parsed.hash) edited.push(path)
    }
    expect(edited, 'перегенерируйте: pnpm -C frontend typegen').toEqual([])
  })

  test('набор типов совпадает со схемами в docs/', () => {
    const expected = schemaSources().map(targetOf).sort()
    expect(typeFiles().sort()).toEqual(expected)
  })

  test('типы доступны по алиасу @/types', () => {
    expectTypeOf<Director['shots'][number]['id']>().toEqualTypeOf<string>()
    expectTypeOf<JobEventData['status']>().toEqualTypeOf<
      'queued' | 'running' | 'done' | 'failed' | 'cancelled'
    >()
  })
})
