/** Цена в подписи платного действия: USD до цента, «~$1.61».
    Округление half-up через центы с эпсилоном: toFixed на 1.605 даёт «1.60». */
export function formatPrice(usd: number): string {
  const cents = Math.round(usd * 100 + 1e-9)
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}~$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
