// Контракт кита: каждый компонент экспортируется из src/ui, в исходниках нет hex-цветов.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import * as ui from '../index'

const UI = dirname(dirname(fileURLToPath(import.meta.url)))
const HEX = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![0-9a-z_-])/gi

const COMPONENTS = [
  'Button', 'IconButton', 'Input', 'Textarea', 'NumberInput', 'Select', 'SegmentedControl', 'Slider',
  'Toggle', 'Checkbox', 'Radio', 'Chip', 'StatusGlyph', 'StatusBadge', 'Toast', 'ToastStack', 'Dialog',
  'EmptyState', 'Tooltip', 'Popover', 'DropdownMenu', 'Tabs', 'TabPanel', 'ProgressBar', 'Skeleton',
  'Divider', 'ScrollArea', 'KeyHint',
] as const

describe('src/ui', () => {
  test.each(COMPONENTS)('%s экспортируется', (name) => {
    expect(typeof ui[name]).toBe('function')
  })

  test('в исходниках кита нет hex', () => {
    const files = readdirSync(UI, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && /\.(ts|tsx|css)$/.test(e.name))
      .map((e) => join(e.parentPath, e.name))
    expect(files.length).toBeGreaterThan(COMPONENTS.length)
    const offenders = files.filter((f) => HEX.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
