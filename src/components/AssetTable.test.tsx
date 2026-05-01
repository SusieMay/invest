import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AssetTable from './AssetTable'
import { Asset } from '../types'
import { FxRates } from '../lib/currency'

const fxRates: FxRates = { usdPln: 4, eurPln: 4.3, krwPln: 0.003 }

// AAA: 200 USD → 800 PLN, BBB: 500 PLN → 500 PLN.
// Wg ceny natywnej AAA(200) < BBB(500), ale wg PLN AAA(800) > BBB(500).
const assets: Asset[] = [
  {
    id: '1',
    user_id: 'default',
    ticker: 'AAA',
    quantity: 1,
    average_price: 200,
    current_price: 200,
    currency: 'USD',
    asset_type: 'stock',
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '2',
    user_id: 'default',
    ticker: 'BBB',
    quantity: 1,
    average_price: 500,
    current_price: 500,
    currency: 'PLN',
    asset_type: 'stock',
    created_at: '2024-01-02T00:00:00Z',
  },
]

function tickerOrder(): (string | null)[] {
  const rows = screen.getAllByRole('row').slice(1) // pomiń nagłówek
  return rows.map((r) => within(r).getByText(/^(AAA|BBB)$/).textContent)
}

describe('AssetTable', () => {
  it('renderuje kolumnę "Wartość pozycji"', () => {
    render(<AssetTable assets={assets} onDelete={vi.fn()} fxRates={fxRates} />)
    expect(screen.getByText('Wartość pozycji')).toBeInTheDocument()
  })

  it('sortuje kolumnę wartości pozycji po kwocie przeliczonej na PLN', async () => {
    const user = userEvent.setup()
    render(<AssetTable assets={assets} onDelete={vi.fn()} fxRates={fxRates} />)

    // Pierwszy klik → malejąco: AAA(800 PLN) przed BBB(500 PLN)
    await user.click(screen.getByText('Wartość pozycji'))
    expect(tickerOrder()).toEqual(['AAA', 'BBB'])

    // Drugi klik → rosnąco: BBB(500 PLN) przed AAA(800 PLN)
    await user.click(screen.getByText('Wartość pozycji'))
    expect(tickerOrder()).toEqual(['BBB', 'AAA'])
  })

  it('sortuje cenę rynkową po wartości w PLN, a nie natywnej', async () => {
    const user = userEvent.setup()
    render(<AssetTable assets={assets} onDelete={vi.fn()} fxRates={fxRates} />)

    // Cena rynkowa w PLN: AAA = 200*4 = 800, BBB = 500. Malejąco → AAA, BBB.
    await user.click(screen.getByText('Cena rynkowa'))
    expect(tickerOrder()).toEqual(['AAA', 'BBB'])
  })
})
