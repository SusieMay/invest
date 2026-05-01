import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Transaction, Asset } from '../types'
import {
  detectAssetType,
  detectCurrency,
  fxRateFor,
  marketBadgeClass,
  marketLabel,
  toPLN,
  FxRates,
} from '../lib/currency'

const formatPLN = (v: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(v)

const formatNative = (v: number, currency: string) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(v)

const formatPercent = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

const calcCAGR = (buyPrice: number, exitPrice: number, days: number): number | null => {
  if (days < 1 || buyPrice <= 0 || exitPrice <= 0) return null
  return (Math.pow(exitPrice / buyPrice, 365 / days) - 1) * 100
}

const daysSince = (dateStr: string): number => {
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)))
}

const daysBetween = (from: string, to: string): number => {
  const diff = new Date(to).getTime() - new Date(from).getTime()
  return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)))
}

/**
 * FIFO matching: returns Map<buyId, sellTransaction>
 * Each buy is paired with the earliest chronologically matching sell of the same ticker.
 */
function buildMatchMap(txs: Transaction[]): Map<string, Transaction> {
  const byTicker = new Map<string, { buys: Transaction[]; sells: Transaction[] }>()
  txs.forEach(tx => {
    if (!byTicker.has(tx.ticker)) byTicker.set(tx.ticker, { buys: [], sells: [] })
    const g = byTicker.get(tx.ticker)!
    tx.type === 'buy' ? g.buys.push(tx) : g.sells.push(tx)
  })
  const result = new Map<string, Transaction>()
  byTicker.forEach(({ buys, sells }) => {
    const sortedBuys = [...buys].sort((a, b) => a.date.localeCompare(b.date))
    const sortedSells = [...sells].sort((a, b) => a.date.localeCompare(b.date))
    const usedSells = new Set<string>()
    sortedBuys.forEach(buy => {
      const match = sortedSells.find(s => !usedSells.has(s.id) && s.date >= buy.date)
      if (match) { result.set(buy.id, match); usedSells.add(match.id) }
    })
  })
  return result
}

interface Props {
  exchangeRate: number
  eurRate: number
  krwRate?: number
  assets: Asset[]
  onDataChange?: () => Promise<void> | void
}

type SortField = 'date' | 'ticker' | 'platform' | 'cagr'
type SortDir = 'asc' | 'desc'

function TransactionHistory({ exchangeRate, eurRate, krwRate = 0.003, assets, onDataChange }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // add-transaction form
  const [type, setType] = useState<'buy' | 'sell'>('buy')
  const [ticker, setTicker] = useState('')
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [date, setDate] = useState('')
  const [platform, setPlatform] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [formLoading, setFormLoading] = useState(false)
  const [formSuccess, setFormSuccess] = useState(false)
  const [customRate, setCustomRate] = useState('')

  // inline action row
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [closePrice, setClosePrice] = useState('')
  const [closeDate, setCloseDate] = useState('')
  const [closeError, setCloseError] = useState<string | null>(null)
  const [closeLoading, setCloseLoading] = useState(false)

  // filters / sort
  const [filterPlatform, setFilterPlatform] = useState<string>('all')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const currency = ticker ? detectCurrency(ticker) : 'USD'
  const fxRates: FxRates = { usdPln: exchangeRate, eurPln: eurRate, krwPln: krwRate }

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .order('date', { ascending: false })
    setTransactions(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  // current price lookup from open positions
  const currentPriceMap = new Map<string, number>()
  assets.forEach(a => { if (a.current_price != null) currentPriceMap.set(a.ticker, a.current_price) })

  const matchMap = buildMatchMap(transactions) // buyId → sell tx
  const sellMatchMap = new Map<string, Transaction>()   // sellId → buy tx
  matchMap.forEach((sell, buyId) => {
    const buy = transactions.find(t => t.id === buyId)
    if (buy) sellMatchMap.set(sell.id, buy)
  })

  // Enrich transactions with computed metrics
  const enriched = transactions.map(tx => {
    let exitPrice: number | null = null
    let holdDays = 0
    let matchedSell: Transaction | null = null
    let matchedBuy: Transaction | null = null

    if (tx.type === 'buy') {
      matchedSell = matchMap.get(tx.id) ?? null
      if (matchedSell) {
        exitPrice = matchedSell.price
        holdDays = daysBetween(tx.date, matchedSell.date)
      } else {
        exitPrice = currentPriceMap.get(tx.ticker) ?? null
        holdDays = daysSince(tx.date)
      }
    } else {
      matchedBuy = sellMatchMap.get(tx.id) ?? null
    }

    const cagr = exitPrice != null ? calcCAGR(tx.price, exitPrice, holdDays) : null
    const roi = exitPrice != null ? ((exitPrice - tx.price) / tx.price) * 100 : null
    const isRealized = tx.type === 'buy' && matchedSell != null
    const valuePLN = toPLN(tx.quantity * tx.price, tx.currency, fxRates)

    return { ...tx, matchedSell, matchedBuy, exitPrice, holdDays, cagr, roi, isRealized, valuePLN }
  })

  // Only show BUY transactions as position rows (each buy = one position)
  const positions = enriched.filter(tx => tx.type === 'buy')

  const filtered = positions.filter(tx => {
    if (filterPlatform !== 'all' && tx.platform !== filterPlatform) return false
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    switch (sortField) {
      case 'date':     return dir * a.date.localeCompare(b.date)
      case 'ticker':   return dir * a.ticker.localeCompare(b.ticker)
      case 'platform': return dir * a.platform.localeCompare(b.platform)
      case 'cagr':     return dir * ((a.cagr ?? -Infinity) - (b.cagr ?? -Infinity))
      default: return 0
    }
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const t = ticker.trim().toUpperCase()
    const qty = parseFloat(quantity)
    const p = parseFloat(price)
    const cur = detectCurrency(t)
    if (!t) { setFormError('Podaj ticker.'); return }
    if (isNaN(qty) || qty <= 0) { setFormError('Ilość musi być dodatnia.'); return }
    if (isNaN(p) || p <= 0) { setFormError('Cena musi być dodatnia.'); return }
    if (!date) { setFormError('Podaj datę transakcji.'); return }
    setFormLoading(true); setFormError(null)

    try {
      // 1. Zapisz transakcję
      const { error } = await supabase.from('transactions').insert([{
        ticker: t, type, quantity: qty, price: p, currency: cur,
        date, platform: platform.trim(), notes: '',
      }])
      if (error) throw error

      // 2. Synchronizuj z portfelem (assets) i realized_trades
      const { data: existingAssets } = await supabase
        .from('assets')
        .select('*')
        .eq('ticker', t)
        .limit(1)
      const existing = existingAssets?.[0]

      if (type === 'buy') {
        if (existing) {
          // Dokupienie: uśrednij cenę
          const oldCost = existing.average_price * existing.quantity
          const newQty = existing.quantity + qty
          const newAvg = (oldCost + p * qty) / newQty
          await supabase.from('assets')
            .update({ quantity: newQty, average_price: parseFloat(newAvg.toFixed(4)) })
            .eq('id', existing.id)
        } else {
          // Nowe aktywo
          await supabase.from('assets').insert([{
            ticker: t, quantity: qty, average_price: p, currency: cur,
            asset_type: detectAssetType(t),
            user_id: 'default',
          }])
        }
      } else {
        // Sprzedaż
        if (existing) {
          const profitNative = (p - existing.average_price) * qty
          // Zrealizowany zysk
          await supabase.from('realized_trades').insert({
            ticker: t, quantity: qty,
            buy_price: existing.average_price, sell_price: p,
            currency: cur, buy_date: existing.created_at.slice(0, 10),
            sell_date: date, profit_pln: profitNative,
          })
          const newQty = existing.quantity - qty
          if (newQty <= 0) {
            await supabase.from('assets').delete().eq('id', existing.id)
          } else {
            await supabase.from('assets')
              .update({ quantity: parseFloat(newQty.toFixed(8)) })
              .eq('id', existing.id)
          }
        }
      }

      // Po zmianie portfela odśwież ceny rynkowe i dashboard.
      await supabase.functions.invoke('refresh-prices')

      setTicker(''); setQuantity(''); setPrice(''); setDate(''); setPlatform(''); setCustomRate('')
      setFormSuccess(true)
      setTimeout(() => setFormSuccess(false), 3000)
      await onDataChange?.()
      fetchTransactions()
    } catch (err) {
      console.error(err)
      setFormError('Błąd zapisu. Spróbuj ponownie.')
    } finally {
      setFormLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    await supabase.from('transactions').delete().eq('id', id)
    setDeletingId(null)
    setExpandedId(null)
    fetchTransactions()
  }

  const handleClosePosition = async (buyTx: Transaction) => {
    const cp = parseFloat(closePrice)
    if (isNaN(cp) || cp <= 0) { setCloseError('Podaj poprawną cenę sprzedaży.'); return }
    if (!closeDate) { setCloseError('Podaj datę sprzedaży.'); return }
    if (closeDate < buyTx.date) { setCloseError('Data sprzedaży nie może być przed datą kupna.'); return }
    setCloseLoading(true); setCloseError(null)

    try {
      // 1. Transakcja sell
      const { error } = await supabase.from('transactions').insert([{
        ticker: buyTx.ticker,
        type: 'sell',
        quantity: buyTx.quantity,
        price: cp,
        currency: buyTx.currency,
        date: closeDate,
        platform: buyTx.platform,
        notes: `Zamknięcie pozycji (kupno ${buyTx.date})`,
      }])
      if (error) throw error

      // 2. Synchronizuj z portfelem
      const { data: existingAssets } = await supabase
        .from('assets')
        .select('*')
        .eq('ticker', buyTx.ticker)
        .limit(1)
      const existing = existingAssets?.[0]

      if (existing) {
        const profitNative = (cp - existing.average_price) * buyTx.quantity
        await supabase.from('realized_trades').insert({
          ticker: buyTx.ticker, quantity: buyTx.quantity,
          buy_price: existing.average_price, sell_price: cp,
          currency: buyTx.currency, buy_date: buyTx.date,
          sell_date: closeDate, profit_pln: profitNative,
        })
        const newQty = existing.quantity - buyTx.quantity
        if (newQty <= 0) {
          await supabase.from('assets').delete().eq('id', existing.id)
        } else {
          await supabase.from('assets')
            .update({ quantity: parseFloat(newQty.toFixed(8)) })
            .eq('id', existing.id)
        }
      }

      await supabase.functions.invoke('refresh-prices')

      setExpandedId(null); setClosePrice(''); setCloseDate('')
      await onDataChange?.()
      fetchTransactions()
    } catch (err) {
      console.error(err)
      setCloseError('Błąd zapisu. Spróbuj ponownie.')
    } finally {
      setCloseLoading(false)
    }
  }

  const toggleExpanded = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null); setClosePrice(''); setCloseDate(''); setCloseError(null)
    } else {
      setExpandedId(id); setClosePrice(''); setCloseDate(''); setCloseError(null)
    }
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const totalBuys = enriched.filter(t => t.type === 'buy').length
  const totalSells = enriched.filter(t => t.type === 'sell').length
  const uniquePlatforms = [...new Set(transactions.map(t => t.platform).filter(Boolean))]

  // Niezrealizowany zysk = otwarte pozycje: obecna wartość - koszt
  const unrealizedProfit = enriched
    .filter(t => t.type === 'buy' && !t.isRealized && t.exitPrice != null)
    .reduce((s, t) => {
      const currentVal = toPLN(t.exitPrice! * t.quantity, t.currency, fxRates)
      return s + (currentVal - t.valuePLN)
    }, 0)

  // Zrealizowany zysk = zamknięte pozycje: cena sprzedaży - cena kupna
  const realizedProfit = enriched
    .filter(t => t.type === 'buy' && t.isRealized && t.exitPrice != null)
    .reduce((s, t) => {
      const sellVal = toPLN(t.exitPrice! * t.quantity, t.currency, fxRates)
      return s + (sellVal - t.valuePLN)
    }, 0)

  const currentFxRate = fxRateFor(currency, fxRates)
  const effectiveRate = currency === 'PLN' ? 1
    : customRate && !isNaN(parseFloat(customRate)) && parseFloat(customRate) > 0
      ? parseFloat(customRate)
      : currentFxRate

  const previewValuePLN = price && quantity
    ? parseFloat(price) * parseFloat(quantity) * effectiveRate
    : null

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className="ml-0.5 text-stone-400 inline-block w-3 text-xs">
      {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </span>
  )

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-stone-300/50 rounded-sm flex items-center justify-center">
              <svg className="w-5 h-5 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <p className="text-stone-500 text-sm font-bold">Wszystkich transakcji</p>
          </div>
          <p className="text-2xl font-bold text-[#33332D] font-mono">{transactions.length}</p>
        </div>

        <div className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-stone-300/50 rounded-sm flex items-center justify-center">
              <svg className="w-5 h-5 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </div>
            <p className="text-stone-500 text-sm font-bold">Kupna / Sprzedaże</p>
          </div>
          <p className="text-2xl font-bold font-mono">
            <span className="text-[#2D6A4F]">{totalBuys}</span>
            <span className="text-stone-400 mx-1">/</span>
            <span className="text-[#A83232]">{totalSells}</span>
          </p>
        </div>

        <div className={`rounded-sm p-6 border border-dotted shadow-none ${unrealizedProfit >= 0 ? 'bg-[#2D6A4F]/5 border-[#2D6A4F]/30' : 'bg-[#A83232]/5 border-[#A83232]/30'}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-sm flex items-center justify-center ${unrealizedProfit >= 0 ? 'bg-[#2D6A4F]/10' : 'bg-[#A83232]/10'}`}>
              <svg className={`w-5 h-5 ${unrealizedProfit >= 0 ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <p className="text-stone-500 text-sm font-bold">Niezrealizowany zysk</p>
          </div>
          <p className={`text-2xl font-bold font-mono ${unrealizedProfit >= 0 ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
            {formatPLN(unrealizedProfit)}
          </p>
          <p className="text-stone-500 text-xs mt-1">Otwarte pozycje</p>
        </div>

        <div className={`rounded-sm p-6 border border-dotted shadow-none ${realizedProfit >= 0 ? 'bg-[#2D6A4F]/5 border-[#2D6A4F]/30' : 'bg-[#A83232]/5 border-[#A83232]/30'}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-sm flex items-center justify-center ${realizedProfit >= 0 ? 'bg-[#2D6A4F]/10' : 'bg-[#A83232]/10'}`}>
              <svg className={`w-5 h-5 ${realizedProfit >= 0 ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-stone-500 text-sm font-bold">Zrealizowany zysk</p>
          </div>
          <p className={`text-2xl font-bold font-mono ${realizedProfit >= 0 ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
            {formatPLN(realizedProfit)}
          </p>
          <p className="text-stone-500 text-xs mt-1">Zamknięte pozycje</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Form */}
        <div className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
          <h2 className="text-base font-bold text-[#33332D] mb-1">Dodaj transakcję</h2>
          <p className="text-xs text-stone-500 mb-5">Zapisz kupno lub sprzedaż do archiwum</p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm font-bold text-stone-600 mb-1.5">Typ transakcji</label>
              <div className="flex gap-1 bg-[#E5E3DA] rounded-sm p-1 border border-dotted border-stone-400">
                <button type="button" onClick={() => setType('buy')}
                  className={`flex-1 px-3 py-2 rounded-sm text-sm font-bold transition-colors ${type === 'buy' ? 'bg-[#2D6A4F] text-[#F4F3ED]' : 'text-stone-500 hover:text-[#33332D]'}`}>
                  ▲ Kupno
                </button>
                <button type="button" onClick={() => setType('sell')}
                  className={`flex-1 px-3 py-2 rounded-sm text-sm font-bold transition-colors ${type === 'sell' ? 'bg-[#A83232] text-[#F4F3ED]' : 'text-stone-500 hover:text-[#33332D]'}`}>
                  ▼ Sprzedaż
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-bold text-stone-600">Ticker</label>
                {ticker && (
                  <span className={`text-xs font-mono px-2 py-0.5 rounded-sm border border-dotted ${marketBadgeClass(ticker)}`}>
                    {marketLabel(ticker)}
                  </span>
                )}
              </div>
              <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())}
                placeholder="np. AAPL, CDR.WA, 005930.KS" maxLength={20}
                className="w-full bg-[#F4F3ED] text-[#33332D] placeholder-stone-400 border border-dotted border-stone-400 rounded-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-stone-500 transition-all font-mono" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-bold text-stone-600 mb-1.5">Ilość</label>
                <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)}
                  placeholder="np. 10" min="0" step="any"
                  className="w-full bg-[#F4F3ED] text-[#33332D] placeholder-stone-400 border border-dotted border-stone-400 rounded-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-stone-500 transition-all" />
              </div>
              <div>
                <label className="block text-sm font-bold text-stone-600 mb-1.5">Cena ({currency})</label>
                <input type="number" value={price} onChange={e => setPrice(e.target.value)}
                  placeholder="0.00" min="0" step="any"
                  className="w-full bg-[#F4F3ED] text-[#33332D] placeholder-stone-400 border border-dotted border-stone-400 rounded-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-stone-500 transition-all" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-stone-600 mb-1.5">Data transakcji</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full bg-[#F4F3ED] text-[#33332D] border border-dotted border-stone-400 rounded-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-stone-500 transition-all" />
            </div>

            {currency !== 'PLN' && (
              <div>
                <label className="block text-sm font-bold text-stone-600 mb-1.5">
                  Kurs {currency}/PLN
                </label>
                <div className="flex items-center gap-2">
                  <input type="number" value={customRate} onChange={e => setCustomRate(e.target.value)}
                    placeholder={`Obecny: ${currentFxRate.toFixed(currency === 'KRW' ? 6 : 4)}`}
                    min="0" step="any"
                    className="w-full bg-[#F4F3ED] text-[#33332D] placeholder-stone-400 border border-dotted border-stone-400 rounded-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-stone-500 transition-all" />
                  <button type="button"
                    onClick={() => setCustomRate(currentFxRate.toFixed(currency === 'KRW' ? 6 : 4))}
                    className="shrink-0 text-xs text-stone-500 hover:text-[#33332D] bg-stone-300/50 border border-dotted border-stone-400 rounded-sm px-2.5 py-2.5 transition-colors"
                    title="Wstaw obecny kurs"
                  >
                    Obecny
                  </button>
                </div>
                <p className="text-xs text-stone-400 mt-1">
                  Aktualny kurs: <span className="font-mono">{currentFxRate.toFixed(currency === 'KRW' ? 6 : 4)}</span> PLN
                  {customRate && !isNaN(parseFloat(customRate)) && parseFloat(customRate) > 0 && parseFloat(customRate) !== currentFxRate && (
                    <span className="ml-1">· Używany: <span className="font-mono font-medium text-[#33332D]">{parseFloat(customRate).toFixed(currency === 'KRW' ? 6 : 4)}</span></span>
                  )}
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-stone-600 mb-1.5">Platforma</label>
              <input value={platform} onChange={e => setPlatform(e.target.value)}
                placeholder="np. XTB, DEGIRO, mBank" maxLength={60}
                className="w-full bg-[#F4F3ED] text-[#33332D] placeholder-stone-400 border border-dotted border-stone-400 rounded-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-stone-500 transition-all" />
            </div>

            {previewValuePLN != null && price && quantity && (
              <div className="bg-stone-200/50 rounded-sm px-4 py-3 space-y-1 text-sm">
                <div className="flex justify-between text-stone-500">
                  <span>Wartość transakcji:</span>
                  <span className="text-[#33332D] font-mono font-bold">
                    {formatNative(parseFloat(price) * parseFloat(quantity), currency)}
                  </span>
                </div>
                <div className="flex justify-between text-stone-500">
                  <span>Wartość (PLN):</span>
                  <span className="text-[#33332D] font-mono font-bold">{formatPLN(previewValuePLN)}</span>
                </div>
                {type === 'buy' && date && daysSince(date) > 0 && (
                  <div className="flex justify-between text-stone-500">
                    <span>Trzymasz od:</span>
                    <span className="text-[#33332D] font-mono font-bold">{daysSince(date)} dni</span>
                  </div>
                )}
              </div>
            )}

            {formError && (
              <div className="bg-[#A83232]/10 border border-dotted border-[#A83232]/40 rounded-sm px-3 py-2.5">
                <p className="text-[#A83232] text-sm">{formError}</p>
              </div>
            )}
            {formSuccess && (
              <div className="bg-[#2D6A4F]/10 border border-dotted border-[#2D6A4F]/40 rounded-sm px-3 py-2.5">
                <p className="text-[#2D6A4F] text-sm">Transakcja zapisana!</p>
              </div>
            )}
            <button type="submit" disabled={formLoading}
              className="w-full bg-stone-700 hover:bg-stone-800 disabled:opacity-50 text-[#F4F3ED] font-bold py-3 rounded-sm transition-colors">
              {formLoading ? 'Zapisywanie...' : `+ Dodaj ${type === 'buy' ? 'kupno' : 'sprzedaż'}`}
            </button>
          </form>
        </div>

        {/* Table */}
        <div className="xl:col-span-2 bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
          <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-bold text-[#33332D]">Archiwum transakcji</h2>
              <p className="text-xs text-stone-500 mt-0.5">{sorted.length} pozycji · CAGR/ROI: zrealizowane lub vs. cena bieżąca</p>
            </div>
            {uniquePlatforms.length > 1 && (
              <select value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}
                className="bg-[#E5E3DA] text-stone-600 border border-dotted border-stone-400 rounded-sm px-2 py-1 text-xs focus:outline-none">
                <option value="all">Wszystkie platformy</option>
                {uniquePlatforms.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-4 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-stone-500 gap-2">
              <svg className="w-10 h-10 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <p className="text-sm">Brak transakcji w archiwum</p>
              <p className="text-xs text-stone-400">Dodaj pierwsze kupno lub sprzedaż</p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-stone-500 text-left border-perf">
                    <th className="pb-3 px-2 font-bold cursor-pointer select-none hover:text-[#33332D]" onClick={() => handleSort('ticker')}>Ticker <SortIcon field="ticker" /></th>
                    <th className="pb-3 px-2 font-bold text-right">Ilość</th>
                    <th className="pb-3 px-2 font-bold cursor-pointer select-none hover:text-[#33332D]" onClick={() => handleSort('date')}>Kupno <SortIcon field="date" /></th>
                    <th className="pb-3 px-2 font-bold">Sprzedaż</th>
                    <th className="pb-3 px-2 font-bold cursor-pointer select-none hover:text-[#33332D]" onClick={() => handleSort('platform')}>Platforma <SortIcon field="platform" /></th>
                    <th className="pb-3 px-2 font-bold text-right cursor-pointer select-none hover:text-[#33332D]" onClick={() => handleSort('cagr')}>CAGR <SortIcon field="cagr" /></th>
                    <th className="pb-3 px-2 font-bold text-right">ROI</th>
                    <th className="pb-3 px-2 font-bold text-center w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(tx => {
                    const isExpanded = expandedId === tx.id
                    const isUnmatchedBuy = !tx.isRealized
                    return (
                      <React.Fragment key={tx.id}>
                        <tr className={`border-perf transition-colors ${isExpanded ? 'bg-stone-200/60' : 'hover:bg-stone-200/50'}`}>
                          <td className="py-3 px-2">
                            <span className="font-bold text-[#33332D] bg-stone-300/50 border border-dotted border-stone-400 rounded-sm px-2 py-0.5 text-xs font-mono">
                              {tx.ticker}
                            </span>
                            {tx.isRealized && (
                              <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-sm bg-[#2D6A4F]/10 text-[#2D6A4F] border border-dotted border-[#2D6A4F]/30">
                                ✓
                              </span>
                            )}
                            {tx.notes && (
                              <p className="text-xs text-stone-400 mt-0.5 truncate max-w-[120px]" title={tx.notes}>
                                {tx.notes}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-2 text-right text-stone-600 font-mono">{tx.quantity}</td>
                          <td className="py-3 px-2 whitespace-nowrap">
                            <div className="text-stone-600 font-mono text-xs">{tx.date}</div>
                            <div className="text-stone-600 font-mono text-xs">{formatNative(tx.price, tx.currency)}</div>
                          </td>
                          <td className="py-3 px-2 whitespace-nowrap">
                            {tx.matchedSell ? (
                              <>
                                <div className="text-stone-600 font-mono text-xs">{tx.matchedSell.date}</div>
                                <div className="text-stone-600 font-mono text-xs">{formatNative(tx.matchedSell.price, tx.currency)}</div>
                              </>
                            ) : (
                              <span className="text-stone-400 text-xs">—</span>
                            )}
                          </td>
                          <td className="py-3 px-2 whitespace-nowrap">
                            {tx.platform && (
                              <span className="text-xs text-stone-500 bg-stone-200/80 rounded-sm px-2 py-0.5">
                                {tx.platform}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-2 text-right whitespace-nowrap">
                            {tx.cagr != null ? (
                              <span className={`font-mono font-bold text-xs ${tx.cagr >= 0 ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
                                {formatPercent(tx.cagr)}
                              </span>
                            ) : (
                              <span className="text-stone-400 text-xs">—</span>
                            )}
                          </td>
                          <td className="py-3 px-2 text-right whitespace-nowrap">
                            {tx.roi != null ? (
                              <span className={`font-mono font-bold text-xs ${tx.roi >= 0 ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
                                {formatPercent(tx.roi)}
                              </span>
                            ) : (
                              <span className="text-stone-400 text-xs">—</span>
                            )}
                          </td>
                          <td className="py-3 px-2 text-center">
                            <button
                              onClick={() => toggleExpanded(tx.id)}
                              className={`transition-colors p-1.5 rounded-sm ${isExpanded ? 'text-[#33332D] bg-stone-300/70' : 'text-stone-400 hover:text-stone-600 hover:bg-stone-300/40'}`}
                              aria-label="Opcje"
                            >
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <circle cx="12" cy="5" r="1.5" />
                                <circle cx="12" cy="12" r="1.5" />
                                <circle cx="12" cy="19" r="1.5" />
                              </svg>
                            </button>
                          </td>
                        </tr>

                        {/* Expanded action row */}
                        {isExpanded && (
                          <tr className="bg-stone-100/70">
                            <td colSpan={8} className="px-5 py-4">
                              <div className="space-y-4">

                                {/* Close position form — only for unmatched BUY */}
                                {isUnmatchedBuy && (
                                  <div>
                                    <p className="text-xs font-bold text-stone-600 mb-2">
                                      Zamknij pozycję — wpisz cenę i datę sprzedaży
                                    </p>
                                    <div className="flex gap-2 items-end flex-wrap">
                                      <div>
                                        <label className="block text-xs text-stone-500 mb-1">
                                          Cena sprzedaży ({tx.currency})
                                        </label>
                                        <input
                                          type="number" value={closePrice}
                                          onChange={e => setClosePrice(e.target.value)}
                                          placeholder="0.00" min="0" step="any"
                                          className="w-36 bg-[#F4F3ED] text-[#33332D] placeholder-stone-400 border border-dotted border-stone-400 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-500 transition-all"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-xs text-stone-500 mb-1">Data sprzedaży</label>
                                        <input
                                          type="date" value={closeDate} min={tx.date}
                                          onChange={e => setCloseDate(e.target.value)}
                                          className="bg-[#F4F3ED] text-[#33332D] border border-dotted border-stone-400 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-500 transition-all"
                                        />
                                      </div>

                                      {/* Live preview inside close form */}
                                      {closePrice && closeDate && (() => {
                                        const cp = parseFloat(closePrice)
                                        if (isNaN(cp) || cp <= 0) return null
                                        const d = daysBetween(tx.date, closeDate)
                                        const r = ((cp - tx.price) / tx.price) * 100
                                        const c = calcCAGR(tx.price, cp, d)
                                        return (
                                          <div className={`text-xs font-bold pb-2 ${r >= 0 ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
                                            ROI {formatPercent(r)}
                                            {c != null && <> · CAGR {formatPercent(c)}</>}
                                            <span className="text-stone-400 font-normal ml-1">({d} dni)</span>
                                          </div>
                                        )
                                      })()}

                                      <button
                                        onClick={() => handleClosePosition(tx)}
                                        disabled={closeLoading}
                                        className="bg-[#A83232] hover:bg-[#8B2020] disabled:opacity-50 text-white font-bold px-4 py-2 rounded-sm text-sm transition-colors whitespace-nowrap"
                                      >
                                        {closeLoading ? 'Zapisuję...' : '▼ Zamknij pozycję'}
                                      </button>
                                    </div>
                                    {closeError && (
                                      <p className="text-[#A83232] text-xs mt-1.5">{closeError}</p>
                                    )}
                                  </div>
                                )}

                                {/* Delete row */}
                                <div className={`flex items-center gap-2 ${isUnmatchedBuy ? 'pt-3 border-t border-dotted border-stone-300' : ''}`}>
                                  <span className="text-xs text-stone-400">Usuń wpis z archiwum:</span>
                                  <button
                                    onClick={() => handleDelete(tx.id)}
                                    disabled={deletingId === tx.id}
                                    className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-[#A83232] disabled:opacity-30 transition-colors px-2 py-1 rounded-sm hover:bg-[#A83232]/10"
                                  >
                                    {deletingId === tx.id ? (
                                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                      </svg>
                                    ) : (
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    )}
                                    Usuń transakcję
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TransactionHistory
