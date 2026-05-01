/** Waluta i giełda na podstawie sufiksu tickera (Yahoo Finance). */
export type FxRates = {
  usdPln: number
  eurPln: number
  krwPln: number
}

export function detectCurrency(ticker: string): string {
  const t = ticker.toUpperCase()
  if (t.endsWith('.WA')) return 'PLN'
  if (t.endsWith('.DE')) return 'EUR'
  if (t.endsWith('.KS') || t.endsWith('.KQ')) return 'KRW'
  return 'USD'
}

export function detectAssetType(ticker: string): 'etf' | 'stock' {
  return ticker.toUpperCase().endsWith('.DE') ? 'etf' : 'stock'
}

/** Etykieta waluty · giełda do badge w UI. */
export function marketLabel(ticker: string): string {
  const t = ticker.toUpperCase()
  if (t.endsWith('.WA')) return 'PLN · GPW'
  if (t.endsWith('.DE')) return 'EUR · Xetra'
  if (t.endsWith('.KS')) return 'KRW · KOSPI'
  if (t.endsWith('.KQ')) return 'KRW · KOSDAQ'
  return 'USD · NYSE/NASDAQ'
}

/** Klasy CSS badge dla giełdy. */
export function marketBadgeClass(ticker: string): string {
  const t = ticker.toUpperCase()
  if (t.endsWith('.WA')) return 'bg-[#A83232]/10 text-[#A83232] border-[#A83232]/40'
  if (t.endsWith('.DE')) return 'bg-[#8B6914]/10 text-[#8B6914] border-[#8B6914]/40'
  if (t.endsWith('.KS') || t.endsWith('.KQ')) return 'bg-[#1B4F72]/10 text-[#1B4F72] border-[#1B4F72]/40'
  return 'bg-stone-700/10 text-stone-700 border-stone-400'
}

export function fxRateFor(currency: string, rates: FxRates): number {
  if (currency === 'PLN') return 1
  if (currency === 'EUR') return rates.eurPln
  if (currency === 'KRW') return rates.krwPln
  return rates.usdPln
}

export function toPLN(value: number, currency: string, rates: FxRates): number {
  return value * fxRateFor(currency, rates)
}

/** KRW/PLN z kursów względem USD (open.er-api.com). */
export function krwPlnFromUsdRates(usdPln: number, krwPerUsd: number): number {
  if (usdPln <= 0 || krwPerUsd <= 0) return 0.003
  return usdPln / krwPerUsd
}

/** Formatuje ilość jednostek (szt.) wg locale pl-PL, bez zbędnych zer końcowych. */
export function formatQuantity(value: number): string {
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 8 }).format(value)
}
