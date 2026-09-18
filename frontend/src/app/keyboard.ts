/* Реестр горячих клавиш — единственное место, где перечислены сочетание, область, описание и обработчик.
   Из него строятся диспетчер (один слушатель keydown на документе), окно помощи и подсказки статус-строки:
   список клавиш нигде не ведётся вторым местом. Сочетания — только из handoff (layout.md, «Клавиатура»).

   Нотация: 'Mod+1', 'Alt+3', 'Shift+ArrowRight', '?', 'Escape', 'Space'. Mod — ⌘ на Mac, Ctrl на остальных.
   Цифры, буквы и Space матчатся по event.code (не зависят от раскладки: ⌥1 на Mac даёт key '¡',
   русская раскладка меняет буквы), остальное — по event.key. */

export type HotkeyScope = 'global' | 'screen' | 'modal'

export interface Hotkey {
  id: string
  keys: string
  /** global — оболочка; screen — пока смонтирован экран/панель; modal — только при открытом модальном слое */
  scope: HotkeyScope
  /** Группа в окне помощи */
  group: string
  description: string
  handler: (event: KeyboardEvent) => void
  /** Включено ли сейчас; выключенные не срабатывают и не показываются */
  when?: () => boolean
  /** Срабатывает и в полях ввода (для сочетаний без модификаторов, например Escape) */
  inInputs?: boolean
  /** Срабатывает и при открытом модальном слое — только для сочетаний, которые этот слой закрывают («?») */
  inModal?: boolean
  /** Короткая подпись для статус-строки; без неё сочетание там не показывается */
  hint?: string
}

export type Platform = 'mac' | 'other'

interface Combo {
  mod: boolean
  alt: boolean
  shift: boolean
  /** Токен клавиши как в нотации: '1', 'S', 'Space', 'Escape', 'ArrowLeft', '?' */
  key: string
}

/* Браузерные сочетания, которые страница не должна перехватывать (п. 4 задания) */
const RESERVED = new Set(['Mod+W', 'Mod+T', 'Mod+N', 'Mod+Q', 'Mod+Shift+T', 'Mod+Shift+N', 'Mod+Shift+W'])

let platform: Platform = detectPlatform()

export function detectPlatform(): Platform {
  const ua = typeof navigator === 'undefined' ? '' : `${navigator.platform} ${navigator.userAgent}`
  return /Mac|iPhone|iPad/.test(ua) ? 'mac' : 'other'
}

/** Для тестов и настроек: какой модификатор считается Mod и как рисовать клавиши */
export function setPlatform(next: Platform): void {
  platform = next
  emit()
}

export function getPlatform(): Platform {
  return platform
}

export function parseCombo(keys: string): Combo {
  const parts = keys.split('+').map((p) => p.trim())
  const key = parts.pop()
  if (!key) throw new Error(`Пустое сочетание: «${keys}»`)
  const mods = new Set(parts.map((p) => p.toLowerCase()))
  const known = new Set(['mod', 'alt', 'shift'])
  for (const m of mods) if (!known.has(m)) throw new Error(`Неизвестный модификатор «${m}» в «${keys}»`)
  return { mod: mods.has('mod'), alt: mods.has('alt'), shift: mods.has('shift'), key: normalizeToken(key) }
}

function normalizeToken(token: string): string {
  if (token === ' ') return 'Space'
  if (/^[a-z]$/i.test(token)) return token.toUpperCase()
  return token
}

/** Сочетание без модификаторов — символ, цифра, стрелка: в полях ввода такие не срабатывают */
export function isPlainKey(combo: Combo): boolean {
  return !combo.mod && !combo.alt
}

export function matches(event: KeyboardEvent, combo: Combo): boolean {
  const primary = platform === 'mac' ? event.metaKey : event.ctrlKey
  const secondary = platform === 'mac' ? event.ctrlKey : event.metaKey
  if (primary !== combo.mod || secondary) return false
  if (event.altKey !== combo.alt) return false
  const k = combo.key
  if (/^[0-9]$/.test(k)) return event.code === `Digit${k}` && event.shiftKey === combo.shift
  if (/^[A-Z]$/.test(k)) return event.code === `Key${k}` && event.shiftKey === combo.shift
  if (k === 'Space') return event.code === 'Space' && event.shiftKey === combo.shift
  // Печатные символы вроде «?» уже включают Shift — его не сверяем
  if (k.length === 1) return event.key === k
  return event.key === k && event.shiftKey === combo.shift
}

const KEY_LABEL: Record<string, string> = {
  Escape: 'Esc',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Delete: 'Del',
  Enter: 'Enter',
}

/** Клавиши для KeyHint: ['⌘', '1'] на Mac, ['Ctrl', '1'] на остальных */
export function formatKeys(keys: string): string[] {
  const combo = parseCombo(keys)
  const out: string[] = []
  if (combo.mod) out.push(platform === 'mac' ? '⌘' : 'Ctrl')
  if (combo.alt) out.push(platform === 'mac' ? '⌥' : 'Alt')
  if (combo.shift) out.push(platform === 'mac' ? '⇧' : 'Shift')
  out.push(KEY_LABEL[combo.key] ?? combo.key)
  return out
}

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'file', 'color'].includes(target.type)
  }
  return false
}

/* ---- Реестр ---- */

const entries = new Map<string, Hotkey>()
const listeners = new Set<() => void>()
let snapshot: Hotkey[] = []
let modalDepth = 0

function emit(): void {
  snapshot = Array.from(entries.values())
  for (const l of listeners) l()
}

/** Регистрирует сочетание; повторный id заменяет запись на том же месте. Возвращает функцию снятия. */
export function register(hotkey: Hotkey): () => void {
  const combo = parseCombo(hotkey.keys)
  const canonical = `${combo.mod ? 'Mod+' : ''}${combo.shift ? 'Shift+' : ''}${combo.key}`
  if (RESERVED.has(canonical)) throw new Error(`Сочетание ${hotkey.keys} перехватывает браузерное — запрещено`)
  entries.set(hotkey.id, hotkey)
  emit()
  return () => {
    if (entries.get(hotkey.id) === hotkey) {
      entries.delete(hotkey.id)
      emit()
    }
  }
}

/** Все записи в порядке регистрации (стабильный снимок для useSyncExternalStore) */
export function list(): Hotkey[] {
  return snapshot
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Модальный слой открыт — срабатывают только modal-сочетания */
export function pushModal(): void {
  modalDepth += 1
  emit()
}

export function popModal(): void {
  modalDepth = Math.max(0, modalDepth - 1)
  emit()
}

export function isModalOpen(): boolean {
  return modalDepth > 0
}

export function isEnabled(hotkey: Hotkey): boolean {
  return hotkey.when ? hotkey.when() : true
}

/** Диспетчер: первое подходящее сочетание получает событие, остальные не рассматриваются. */
export function dispatch(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return
  const modal = isModalOpen()
  const editable = isEditable(event.target)
  for (const hotkey of snapshot) {
    if (modal ? hotkey.scope !== 'modal' && !hotkey.inModal : hotkey.scope === 'modal') continue
    if (!isEnabled(hotkey)) continue
    const combo = parseCombo(hotkey.keys)
    if (!matches(event, combo)) continue
    if (editable && !hotkey.inInputs && isPlainKey(combo)) continue
    event.preventDefault()
    hotkey.handler(event)
    return
  }
}

/** Только для тестов: сбросить реестр и модальную глубину */
export function resetRegistry(): void {
  entries.clear()
  modalDepth = 0
  emit()
}
