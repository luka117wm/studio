export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Округление к сетке шага от origin с подавлением хвоста float (0.1 + 0.2). */
export function snap(value: number, step: number, origin = 0): number {
  if (!(step > 0)) return value
  const base = Number.isFinite(origin) ? origin : 0
  const decimals = Math.max(countDecimals(step), countDecimals(base))
  return Number((base + Math.round((value - base) / step) * step).toFixed(decimals))
}

function countDecimals(n: number): number {
  const text = String(n)
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}
