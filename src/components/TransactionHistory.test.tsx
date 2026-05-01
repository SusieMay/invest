import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import TransactionHistory from './TransactionHistory'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    functions: { invoke: vi.fn() },
  },
}))

vi.mock('./AssetPriceChart', () => ({
  default: ({ ticker, avgPrice, startDate, endDate }: { ticker: string; avgPrice: number; startDate: string; endDate?: string }) => (
    <div
      data-testid="asset-price-chart"
      data-ticker={ticker}
      data-average-price={avgPrice}
      data-start-date={startDate}
      data-end-date={endDate}
    />
  ),
}))

const transactions = [
  {
    id: 'buy-1',
    ticker: 'AAPL',
    type: 'buy',
    quantity: 10,
    price: 100,
    currency: 'USD',
    date: '2024-01-01',
    platform: 'XTB',
    notes: '',
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'sell-1',
    ticker: 'AAPL',
    type: 'sell',
    quantity: 10,
    price: 140,
    currency: 'USD',
    date: '2024-06-01',
    platform: 'XTB',
    notes: '',
    created_at: '2024-06-01T00:00:00Z',
  },
]

describe('TransactionHistory', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockFrom.mockImplementation((table: string) => {
      if (table === 'transactions') {
        return {
          select: () => ({
            order: () => Promise.resolve({ data: transactions }),
          }),
        }
      }

      return {
        select: () => ({
          eq: () => ({
            limit: () => Promise.resolve({ data: [] }),
          }),
        }),
        insert: () => Promise.resolve({ error: null }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }
    })
  })

  it('pokazuje kolumnę zysku/straty dla zamkniętej pozycji', async () => {
    render(<TransactionHistory exchangeRate={4} eurRate={4.3} krwRate={0.003} assets={[]} onDataChange={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Archiwum transakcji')).toBeInTheDocument())

    expect(screen.getByRole('columnheader', { name: /zysk \/ strata/i })).toBeInTheDocument()
    expect(screen.getByText(/\+\s*1\s*600,00\s*zł/i)).toBeInTheDocument()
  })

  it('otwiera z tickera wykres od kupna do sprzedaży', async () => {
    render(<TransactionHistory exchangeRate={4} eurRate={4.3} krwRate={0.003} assets={[]} onDataChange={vi.fn()} />)

    const tickerButton = await screen.findByRole('button', { name: 'AAPL' })
    fireEvent.click(tickerButton)

    const chart = screen.getByTestId('asset-price-chart')
    expect(tickerButton.closest('tr')?.nextElementSibling).toBe(chart.closest('tr'))
    expect(chart).toHaveAttribute('data-ticker', 'AAPL')
    expect(chart).toHaveAttribute('data-average-price', '100')
    expect(chart).toHaveAttribute('data-start-date', '2024-01-01')
    expect(chart).toHaveAttribute('data-end-date', '2024-06-01')
  })
})
