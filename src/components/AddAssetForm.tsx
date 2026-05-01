import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { detectAssetType, detectCurrency, marketBadgeClass, marketLabel } from '../lib/currency'

interface Props {
  onAdd: () => Promise<void> | void
}

interface FormState {
  ticker: string
  quantity: string
  average_price: string
}

function AddAssetForm({ onAdd }: Props) {
  const [form, setForm] = useState<FormState>({ ticker: '', quantity: '', average_price: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setForm((prev) => ({
      ...prev,
      [name]: name === 'ticker' ? value.toUpperCase() : value,
    }))
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const ticker = form.ticker.trim()
    const quantity = parseFloat(form.quantity)
    const average_price = parseFloat(form.average_price)

    if (!ticker) {
      setError('Podaj ticker aktywa (np. AAPL).')
      return
    }
    if (isNaN(quantity) || quantity <= 0) {
      setError('Ilość musi być liczbą dodatnią.')
      return
    }
    if (isNaN(average_price) || average_price <= 0) {
      setError('Cena zakupu musi być liczbą dodatnią.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const cur = detectCurrency(ticker)

      const { error: supabaseError } = await supabase.from('assets').insert([
        {
          ticker,
          quantity,
          average_price,
          currency: cur,
          asset_type: detectAssetType(ticker),
          user_id: 'default',
        },
      ])
      if (supabaseError) throw supabaseError

      // Zapisz transakcję buy do archiwum
      const today = new Date().toISOString().slice(0, 10)
      await supabase.from('transactions').insert([{
        ticker,
        type: 'buy',
        quantity,
        price: average_price,
        currency: cur,
        date: today,
        platform: '',
        notes: 'Dodanie z formularza portfela',
      }])

      await supabase.functions.invoke('refresh-prices')

      setForm({ ticker: '', quantity: '', average_price: '' })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
      await onAdd()
    } catch (err) {
      console.error(err)
      setError('Błąd podczas dodawania aktywa. Sprawdź połączenie z bazą danych.')
    } finally {
      setLoading(false)
    }
  }

  const currency = form.ticker ? detectCurrency(form.ticker) : 'USD'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="ticker" className="text-sm font-bold text-stone-600">
            Ticker
          </label>
          {form.ticker && (
            <span className={`text-xs font-mono px-2 py-0.5 rounded-sm border border-dotted ${marketBadgeClass(form.ticker)}`}>
              {marketLabel(form.ticker)}
            </span>
          )}
        </div>
        <input
          id="ticker"
          type="text"
          name="ticker"
          value={form.ticker}
          onChange={handleChange}
          placeholder="np. AAPL, XTB.WA, 005930.KS"
          maxLength={20}
          className="w-full bg-[#F4F3ED] text-[#33332D] placeholder-stone-400 border border-dotted border-stone-400 rounded-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-transparent transition-all font-mono"
        />
      </div>

      <div>
        <label htmlFor="quantity" className="block text-sm font-bold text-stone-600 mb-1.5">
          Ilość
        </label>
        <input
          id="quantity"
          type="number"
          name="quantity"
          value={form.quantity}
          onChange={handleChange}
          placeholder="np. 10"
          min="0"
          step="any"
          className="w-full bg-[#F4F3ED] text-[#33332D] placeholder-stone-400 border border-dotted border-stone-400 rounded-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-transparent transition-all"
        />
      </div>

      <div>
        <label htmlFor="average_price" className="block text-sm font-bold text-stone-600 mb-1.5">
          Śr. cena zakupu ({currency})
        </label>
        <input
          id="average_price"
          type="number"
          name="average_price"
          value={form.average_price}
          onChange={handleChange}
          placeholder="np. 150.50"
          min="0"
          step="any"
          className="w-full bg-[#F4F3ED] text-[#33332D] placeholder-stone-400 border border-dotted border-stone-400 rounded-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-transparent transition-all"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-[#A83232]/10 border border-dotted border-[#A83232]/40 rounded-sm px-3 py-2.5">
          <svg className="w-4 h-4 text-[#A83232] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[#A83232] text-sm">{error}</p>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 bg-[#2D6A4F]/10 border border-dotted border-[#2D6A4F]/40 rounded-sm px-3 py-2.5">
          <svg className="w-4 h-4 text-[#2D6A4F] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[#2D6A4F] text-sm">Aktywo zostało dodane pomyślnie!</p>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-stone-700 hover:bg-stone-800 active:bg-stone-900 disabled:opacity-50 disabled:cursor-not-allowed text-[#F4F3ED] font-bold py-3 px-4 rounded-sm transition-colors duration-200 flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Dodawanie...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Dodaj aktywo
          </>
        )}
      </button>
    </form>
  )
}

export default AddAssetForm
