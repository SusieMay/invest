import { describe, expect, it } from 'vitest'
import {
  annualizeReturn,
  calculateCorrelation,
  calculateMWR,
  calculateTWR,
  CashFlow,
  deriveCashFlows,
  netCashFlowBetween,
  PortfolioSnapshot,
  ValuationPoint,
} from './returns'
import { fxRateFor, krwPlnFromUsdRates, toPLN, detectCurrency } from './currency'

describe('calculateTWR', () => {
  it('zwraca 0 przy mniej niż 2 wycenach', () => {
    expect(calculateTWR([{ date: '2024-01-01', value: 1000 }], [])).toBe(0)
  })

  it('prosty wzrost bez przepływów: 1000 → 1100 = +10%', () => {
    const vals: ValuationPoint[] = [
      { date: '2024-01-01', value: 1000 },
      { date: '2024-01-31', value: 1100 },
    ]
    expect(calculateTWR(vals, [])).toBeCloseTo(0.1, 10)
  })

  it('łączy podokresy: +10% potem -5% → 1.1*0.95-1 = +4.5%', () => {
    const vals: ValuationPoint[] = [
      { date: '2024-01-01', value: 1000 },
      { date: '2024-02-01', value: 1100 },
      { date: '2024-03-01', value: 1045 },
    ]
    expect(calculateTWR(vals, [])).toBeCloseTo(0.045, 10)
  })

  it('odejmuje wpłatę z podokresu (nie liczy jej jako zysku)', () => {
    // V0=1000, wpłata 500, V1=1600 → zwrot = (1600-500-1000)/1000 = 10%
    const vals: ValuationPoint[] = [
      { date: '2024-01-01', value: 1000 },
      { date: '2024-01-15', value: 1600 },
    ]
    const flows: CashFlow[] = [{ date: '2024-01-10', amount: 500 }]
    expect(calculateTWR(vals, flows)).toBeCloseTo(0.1, 10)
  })

  it('sumuje przepływ z weekendu do następnej migawki roboczej', () => {
    // Piątek 1000, sobota wpłata 200, poniedziałek 1250
    // (1250 - 200 - 1000) / 1000 = 5%
    const vals: ValuationPoint[] = [
      { date: '2024-01-05', value: 1000 }, // piątek
      { date: '2024-01-08', value: 1250 }, // poniedziałek
    ]
    const flows: CashFlow[] = [{ date: '2024-01-06', amount: 200 }]
    expect(calculateTWR(vals, flows)).toBeCloseTo(0.05, 10)
  })

  it('ignoruje przepływy w dniu pierwszej wyceny lub wcześniej', () => {
    const vals: ValuationPoint[] = [
      { date: '2024-01-10', value: 1000 },
      { date: '2024-01-20', value: 1100 },
    ]
    const flows: CashFlow[] = [
      { date: '2024-01-01', amount: 1000 },
      { date: '2024-01-10', amount: 50 },
    ]
    expect(calculateTWR(vals, flows)).toBeCloseTo(0.1, 10)
  })

  it('pierwszy zakup po pustej migawce nie jest liczony jako strata', () => {
    // Portfel startuje pusty, następnego dnia wpłata 1000, potem +10%
    const vals: ValuationPoint[] = [
      { date: '2024-01-01', value: 0 },
      { date: '2024-01-02', value: 1000 },
      { date: '2024-01-03', value: 1100 },
    ]
    const flows: CashFlow[] = [{ date: '2024-01-02', amount: 1000 }]
    expect(calculateTWR(vals, flows)).toBeCloseTo(0.1, 10)
  })

  it('pusty portfel w środku historii nie zeruje całego TWR', () => {
    // Sprzedaż wszystkiego, potem ponowne wejście i +10%
    const vals: ValuationPoint[] = [
      { date: '2024-01-01', value: 1000 },
      { date: '2024-01-02', value: 0 },
      { date: '2024-01-03', value: 2000 },
      { date: '2024-01-04', value: 2200 },
    ]
    const flows: CashFlow[] = [
      { date: '2024-01-02', amount: -1000 },
      { date: '2024-01-03', amount: 2000 },
    ]
    expect(calculateTWR(vals, flows)).toBeCloseTo(0.1, 10)
  })

  it('nie odwraca znaku, gdy dane dają podokres poniżej -100%', () => {
    // Zawyżony przepływ (np. zła waluta) nie może dać dodatniego TWR przez zmianę znaku
    const vals: ValuationPoint[] = [
      { date: '2024-01-01', value: 1000 },
      { date: '2024-01-02', value: 100 },
      { date: '2024-01-03', value: 50 },
    ]
    const flows: CashFlow[] = [{ date: '2024-01-02', amount: 500 }]
    expect(calculateTWR(vals, flows)).toBe(-1)
  })

  it('uwzględnia wypłatę (ujemny CF) przy sprzedaży', () => {
    // V0=1000, wypłata 300, V1=750 → (750 - (-300) - 1000)/1000 = 5%
    const vals: ValuationPoint[] = [
      { date: '2024-01-01', value: 1000 },
      { date: '2024-01-20', value: 750 },
    ]
    const flows: CashFlow[] = [{ date: '2024-01-15', amount: -300 }]
    expect(calculateTWR(vals, flows)).toBeCloseTo(0.05, 10)
  })
})

describe('deriveCashFlows', () => {
  it('zakup: przepływ równy wzrostowi kosztu nabycia', () => {
    const snaps: PortfolioSnapshot[] = [
      { date: '2024-01-01', value: 1000, cost: 1000, realized: 0 },
      { date: '2024-01-02', value: 1600, cost: 1500, realized: 0 },
    ]
    expect(deriveCashFlows(snaps)).toEqual([{ date: '2024-01-02', amount: 500 }])
  })

  it('sprzedaż: wypłata to koszt sprzedanych plus zrealizowany zysk', () => {
    // Sprzedano pozycję o koszcie 400 z zyskiem 150 → przychód 550
    const snaps: PortfolioSnapshot[] = [
      { date: '2024-01-01', value: 1200, cost: 1000, realized: 0 },
      { date: '2024-01-02', value: 650, cost: 600, realized: 150 },
    ]
    expect(deriveCashFlows(snaps)).toEqual([{ date: '2024-01-02', amount: -550 }])
  })

  it('sam ruch cen nie tworzy przepływu', () => {
    const snaps: PortfolioSnapshot[] = [
      { date: '2024-01-01', value: 1000, cost: 800, realized: 0 },
      { date: '2024-01-02', value: 1300, cost: 800, realized: 0 },
    ]
    expect(deriveCashFlows(snaps)).toEqual([])
  })

  it('różnica kursowa na koszcie nie jest wpłatą', () => {
    // Koszt w PLN urósł o 80 wyłącznie przez kurs walutowy
    const snaps: PortfolioSnapshot[] = [
      { date: '2024-01-01', value: 1000, cost: 800, realized: 0 },
      { date: '2024-01-02', value: 1100, cost: 880, realized: 0, fxCostDrift: 80 },
    ]
    expect(deriveCashFlows(snaps)).toEqual([])
  })

  it('TWR nie zaniża wyniku, gdy zakup wpadł do migawki później niż data transakcji', () => {
    // Zakup 5000 widoczny dopiero w migawce z 3.01, mimo że transakcja ma datę 2.01.
    const snaps: PortfolioSnapshot[] = [
      { date: '2024-01-01', value: 10000, cost: 10000, realized: 0 },
      { date: '2024-01-02', value: 10000, cost: 10000, realized: 0 },
      { date: '2024-01-03', value: 15000, cost: 15000, realized: 0 },
      { date: '2024-01-04', value: 16500, cost: 15000, realized: 0 },
    ]
    const valuations: ValuationPoint[] = snaps.map(s => ({ date: s.date, value: s.value }))

    // Przepływ po dacie transakcji tworzy sztuczną parę spadek/wzrost i zaniża TWR
    const byTransactionDate: CashFlow[] = [{ date: '2024-01-02', amount: 5000 }]
    expect(calculateTWR(valuations, byTransactionDate)).toBeLessThan(0)

    // Przepływ odtworzony z migawek daje sam zwrot rynkowy: +10%
    expect(calculateTWR(valuations, deriveCashFlows(snaps))).toBeCloseTo(0.1, 10)
  })
})

describe('calculateMWR (XIRR)', () => {
  it('jedna wpłata i wartość po roku: +10% → MWR ≈ 10%', () => {
    // Dokładnie 365 dni (bez 29.02) — konwencja XIRR /365
    const flows: CashFlow[] = [{ date: '2025-01-01', amount: 1000 }]
    const mwr = calculateMWR(flows, 1100, '2026-01-01')
    expect(mwr).toBeCloseTo(0.1, 4)
  })

  it('strata: 1000 → 900 po roku → MWR ≈ -10%', () => {
    const flows: CashFlow[] = [{ date: '2025-01-01', amount: 1000 }]
    const mwr = calculateMWR(flows, 900, '2026-01-01')
    expect(mwr).toBeCloseTo(-0.1, 4)
  })

  it('dwie równe wpłaty: późniejsza wpłata nie psuje XIRR względem TWR', () => {
    // 1000 na start → rośnie do 1100 w pół roku, potem +1000, końcówka 2200 po kolejnym półroczu
    // (prosty case: flat 0% po drugiej wpłacie, wcześniej +10% w 0.5y)
    const flows: CashFlow[] = [
      { date: '2025-01-01', amount: 1000 },
      { date: '2025-07-01', amount: 1000 },
    ]
    const mwr = calculateMWR(flows, 2200, '2026-01-01')
    // Oczekujemy dodatni wynik; dokładna wartość XIRR ~9.5–10% w skali roku
    expect(mwr).toBeGreaterThan(0.05)
    expect(mwr).toBeLessThan(0.15)
  })

  it('zwraca 0 gdy brak przepływów', () => {
    expect(calculateMWR([], 1000, '2024-01-01')).toBe(0)
  })
})

describe('annualizeReturn', () => {
  it('+10% w 365 dni → +10% rocznie', () => {
    expect(annualizeReturn(0.1, 365)).toBeCloseTo(0.1, 10)
  })

  it('+10% w 182.5 dni (~0.5 roku) → ~21% rocznie', () => {
    expect(annualizeReturn(0.1, 182.5)).toBeCloseTo(Math.pow(1.1, 2) - 1, 10)
  })

  it('zwraca 0 dla days <= 0', () => {
    expect(annualizeReturn(0.5, 0)).toBe(0)
  })

  it('ruina kapitału (cumulative <= -100%) → -1', () => {
    expect(annualizeReturn(-1, 365)).toBe(-1)
    expect(annualizeReturn(-1.5, 365)).toBe(-1)
  })
})

describe('calculateCorrelation', () => {
  it('identyczne zwroty → korelacja 1', () => {
    const series: ValuationPoint[] = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 110 },
      { date: '2024-01-03', value: 105 },
      { date: '2024-01-04', value: 120 },
    ]
    expect(calculateCorrelation(series, series)).toBeCloseTo(1, 10)
  })

  it('odwrotne zwroty → korelacja -1', () => {
    // Zwroty P: +10%, -10%, +10%  oraz B: -10%, +10%, -10%
    const portfolio: ValuationPoint[] = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 110 },
      { date: '2024-01-03', value: 99 },
      { date: '2024-01-04', value: 108.9 },
    ]
    const benchmark: ValuationPoint[] = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 90 },
      { date: '2024-01-03', value: 99 },
      { date: '2024-01-04', value: 89.1 },
    ]
    expect(calculateCorrelation(portfolio, benchmark)).toBeCloseTo(-1, 10)
  })

  it('koryguje zwrot portfela o wpłatę (jak TWR)', () => {
    // Bez korekty: (1600-1000)/1000 = 60%; z korektą CF 500: 10%, potem +5%
    // Zwroty muszą mieć wariancję > 0 (stałe +10%/+10% → null w Pearsonie)
    const portfolio: ValuationPoint[] = [
      { date: '2024-01-01', value: 1000 },
      { date: '2024-01-02', value: 1600 },
      { date: '2024-01-03', value: 1680 },
    ]
    const benchmark: ValuationPoint[] = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 110 },
      { date: '2024-01-03', value: 115.5 },
    ]
    // Po korekcie: +10%, +5% — jak benchmark
    expect(
      calculateCorrelation(portfolio, benchmark, [{ date: '2024-01-02', amount: 500 }])
    ).toBeCloseTo(1, 10)
  })

  it('za mało nakładających się dni → null', () => {
    expect(
      calculateCorrelation(
        [{ date: '2024-01-01', value: 100 }, { date: '2024-01-02', value: 110 }],
        [{ date: '2024-01-01', value: 100 }]
      )
    ).toBeNull()
  })
})

describe('netCashFlowBetween', () => {
  it('sumuje przepływy w (after, until]', () => {
    const flows: CashFlow[] = [
      { date: '2024-01-01', amount: 100 },
      { date: '2024-01-02', amount: 50 },
      { date: '2024-01-03', amount: -20 },
    ]
    expect(netCashFlowBetween(flows, '2024-01-01', '2024-01-03')).toBe(30)
    expect(netCashFlowBetween(flows, '2024-01-01', '2024-01-02')).toBe(50)
  })
})

describe('portfolio PnL / FX (spójność z Dashboard)', () => {
  const rates = { usdPln: 4, eurPln: 4.3, krwPln: 0.003 }

  it('totalPnL = value - cost w PLN', () => {
    const qty = 10
    const avg = 100
    const current = 120
    const value = toPLN(current * qty, 'USD', rates)
    const cost = toPLN(avg * qty, 'USD', rates)
    expect(value - cost).toBe(800) // (1200-1000)*4
    expect(((value - cost) / cost) * 100).toBeCloseTo(20)
  })

  it('KRW: toPLN i fxRateFor są spójne', () => {
    expect(fxRateFor('KRW', rates)).toBe(0.003)
    expect(toPLN(23900 * 50, 'KRW', rates)).toBeCloseTo(23900 * 50 * 0.003)
  })

  it('krwPlnFromUsdRates', () => {
    expect(krwPlnFromUsdRates(4, 1300)).toBeCloseTo(4 / 1300)
  })

  it('detectCurrency dla Korei', () => {
    expect(detectCurrency('458870.KQ')).toBe('KRW')
    expect(detectCurrency('458870.KS')).toBe('KRW')
  })
})

/**
 * Reprodukcja błędu: profit_pln zapisywany jako zysk w walucie natywnej
 * (bez mnożenia przez FX) — niezgodne z nazwą kolumny.
 */
describe('realized profit_pln bug (dokumentacja)', () => {
  it('profitNative bez FX ≠ profit w PLN dla USD', () => {
    const qty = 10
    const buy = 100
    const sell = 120
    const profitNative = (sell - buy) * qty // 200 USD
    const usdPln = 4
    const profitPlnCorrect = profitNative * usdPln // 800 PLN
    expect(profitNative).not.toBe(profitPlnCorrect)
    // Kod w AssetTable/TransactionHistory zapisuje profitNative do profit_pln
    expect(profitNative).toBe(200)
  })
})
