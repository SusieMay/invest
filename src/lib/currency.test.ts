import { describe, it, expect } from 'vitest'
import {
  detectCurrency,
  detectAssetType,
  fxRateFor,
  toPLN,
  krwPlnFromUsdRates,
  formatQuantity,
  FxRates,
} from './currency'

const rates: FxRates = { usdPln: 4, eurPln: 4.3, krwPln: 0.003 }

describe('detectCurrency', () => {
  it('rozpoznaje walutę na podstawie sufiksu tickera', () => {
    expect(detectCurrency('PKN.WA')).toBe('PLN')
    expect(detectCurrency('EUNL.DE')).toBe('EUR')
    expect(detectCurrency('005930.KS')).toBe('KRW')
    expect(detectCurrency('035720.KQ')).toBe('KRW')
    expect(detectCurrency('AAPL')).toBe('USD')
  })

  it('jest niewrażliwe na wielkość liter', () => {
    expect(detectCurrency('pkn.wa')).toBe('PLN')
  })
})

describe('detectAssetType', () => {
  it('traktuje tickery .DE jako ETF, resztę jako akcje', () => {
    expect(detectAssetType('EUNL.DE')).toBe('etf')
    expect(detectAssetType('AAPL')).toBe('stock')
    expect(detectAssetType('PKN.WA')).toBe('stock')
  })
})

describe('fxRateFor', () => {
  it('zwraca poprawny kurs dla waluty', () => {
    expect(fxRateFor('PLN', rates)).toBe(1)
    expect(fxRateFor('EUR', rates)).toBe(4.3)
    expect(fxRateFor('KRW', rates)).toBe(0.003)
    expect(fxRateFor('USD', rates)).toBe(4)
  })

  it('dla nieznanej waluty przyjmuje kurs USD', () => {
    expect(fxRateFor('GBP', rates)).toBe(4)
  })
})

describe('toPLN', () => {
  it('przelicza wartość na złotówki', () => {
    expect(toPLN(100, 'USD', rates)).toBe(400)
    expect(toPLN(100, 'EUR', rates)).toBeCloseTo(430)
    expect(toPLN(100, 'PLN', rates)).toBe(100)
    expect(toPLN(10000, 'KRW', rates)).toBeCloseTo(30)
  })
})

describe('krwPlnFromUsdRates', () => {
  it('wylicza kurs KRW/PLN z kursów względem USD', () => {
    // 1 USD = 4 PLN, 1 USD = 1200 KRW → 1 KRW = 4/1200 PLN
    expect(krwPlnFromUsdRates(4, 1200)).toBeCloseTo(4 / 1200)
  })

  it('zwraca wartość zapasową dla niepoprawnych danych', () => {
    expect(krwPlnFromUsdRates(0, 1200)).toBe(0.003)
    expect(krwPlnFromUsdRates(4, 0)).toBe(0.003)
  })
})

describe('formatQuantity', () => {
  it('formatuje ilość bez zbędnych zer końcowych', () => {
    expect(formatQuantity(5)).toBe('5')
    expect(formatQuantity(2.5)).toBe('2,5')
  })
})
