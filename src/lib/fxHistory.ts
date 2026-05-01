/**
 * Historyczne kursy walut (EBC przez api.frankfurter.app).
 *
 * Wartości w portfolio_history są zapisywane w PLN po kursie z dnia migawki, więc
 * przepływy gotówki (zakupy/sprzedaże) też muszą być przeliczane kursem z dnia
 * transakcji. Użycie dzisiejszego kursu do transakcji sprzed lat wprowadzało do
 * TWR/MWR różnicę kursową jako rzekomy zysk z rynku.
 */
import type { FxRates } from './currency'

export interface FxHistory {
  /** Kurs z danego dnia; dla weekendów i świąt – z ostatniej wcześniejszej sesji. */
  rateFor(date: string): FxRates | null
}

type RateMap = Record<string, FxRates>

const CACHE_PREFIX = 'fxHistory.v1:'
const CACHE_TTL_MS = 12 * 60 * 60 * 1000

function buildLookup(rates: RateMap): FxHistory {
  const days = Object.keys(rates).sort()
  return {
    rateFor(date: string): FxRates | null {
      if (days.length === 0) return null
      const exact = rates[date]
      if (exact) return exact
      // Ostatnia sesja nie późniejsza niż szukany dzień.
      let lo = 0
      let hi = days.length - 1
      let found = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (days[mid] <= date) {
          found = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      return rates[days[found >= 0 ? found : 0]]
    },
  }
}

/** Usuwa wpisy cache z innych zakresów dat, żeby nie rosły w nieskończoność. */
function purgeStaleCache(keep: string): void {
  try {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(CACHE_PREFIX) && key !== keep) toRemove.push(key)
    }
    toRemove.forEach((key) => localStorage.removeItem(key))
  } catch {
    // brak localStorage – pomijamy
  }
}

export async function fetchFxHistory(
  startDate: string,
  endDate: string
): Promise<FxHistory | null> {
  const cacheKey = `${CACHE_PREFIX}${startDate}:${endDate}`

  try {
    const raw = localStorage.getItem(cacheKey)
    if (raw) {
      const cached = JSON.parse(raw) as { savedAt: number; rates: RateMap }
      if (Date.now() - cached.savedAt < CACHE_TTL_MS) return buildLookup(cached.rates)
    }
  } catch {
    // uszkodzony cache – pobieramy na nowo
  }

  try {
    const res = await fetch(
      `https://api.frankfurter.app/${startDate}..${endDate}?base=EUR&symbols=PLN,USD,KRW`
    )
    if (!res.ok) return null
    const json = (await res.json()) as {
      rates?: Record<string, { PLN?: number; USD?: number; KRW?: number }>
    }

    const rates: RateMap = {}
    for (const [day, r] of Object.entries(json.rates ?? {})) {
      // Kursy są względem EUR, więc PLN/USD i PLN/KRW wyliczamy przez krzyżówkę.
      if (!r.PLN || !r.USD || !r.KRW) continue
      rates[day] = { eurPln: r.PLN, usdPln: r.PLN / r.USD, krwPln: r.PLN / r.KRW }
    }
    if (Object.keys(rates).length === 0) return null

    try {
      localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), rates }))
      purgeStaleCache(cacheKey)
    } catch {
      // np. przepełniony localStorage – działamy bez cache
    }
    return buildLookup(rates)
  } catch {
    return null
  }
}
