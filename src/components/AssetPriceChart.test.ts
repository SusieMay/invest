import { describe, expect, it } from 'vitest'
import { Transaction } from '../types'
import { buildPriceSeries } from './AssetPriceChart'

const transaction = (
  id: string,
  type: 'buy' | 'sell',
  quantity: number,
  price: number,
  date: string
): Transaction => ({
  id,
  ticker: 'TEST',
  type,
  quantity,
  price,
  currency: 'USD',
  date,
  platform: '',
  notes: '',
  created_at: `${date}T12:00:00Z`,
})

describe('buildPriceSeries', () => {
  it('zmienia średnią ważoną w dniach zakupów i zachowuje ją po częściowej sprzedaży', () => {
    const prices = ['2024-01-01', '2024-01-03', '2024-01-04', '2024-01-05']
      .map(date => ({ date, close: 120 }))
    const transactions = [
      transaction('b1', 'buy', 10, 100, '2024-01-01'),
      transaction('b2', 'buy', 10, 120, '2024-01-03'),
      transaction('s1', 'sell', 5, 140, '2024-01-04'),
      transaction('b3', 'buy', 5, 130, '2024-01-05'),
    ]

    expect(buildPriceSeries(prices, transactions).map(point => point.averagePrice)).toEqual([
      100,
      110,
      110,
      115,
    ])
  })
})