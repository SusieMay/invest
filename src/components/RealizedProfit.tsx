import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Transaction } from '../types'
import { FxRates, toPLN } from '../lib/currency'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
} from 'recharts'

const formatPLN = (v: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(v)

const formatNative = (v: number, currency: string) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(v)

const formatPercent = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

const daysBetween = (from: string, to: string): number => {
  if (!from || !to) return 0
  const diff = new Date(to).getTime() - new Date(from).getTime()
  return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)))
}

interface ClosedPosition {
  buyId: string
  ticker: string
  quantity: number
  buyPrice: number
  sellPrice: number
  currency: string
  buyDate: string
  sellDate: string
  daysHeld: number
  profitPln: number
  roi: number
  platform: string
}

function buildClosedPositions(
  txs: Transaction[],
  rates: FxRates
): ClosedPosition[] {
  const byTicker = new Map<string, { buys: Transaction[]; sells: Transaction[] }>()
  txs.forEach(tx => {
    if (!byTicker.has(tx.ticker)) byTicker.set(tx.ticker, { buys: [], sells: [] })
    const g = byTicker.get(tx.ticker)!
    tx.type === 'buy' ? g.buys.push(tx) : g.sells.push(tx)
  })

  const results: ClosedPosition[] = []
  byTicker.forEach(({ buys, sells }) => {
    const sortedBuys = [...buys].sort((a, b) => a.date.localeCompare(b.date))
    const sortedSells = [...sells].sort((a, b) => a.date.localeCompare(b.date))
    const usedSells = new Set<string>()

    sortedBuys.forEach(buy => {
      const sell = sortedSells.find(s => !usedSells.has(s.id) && s.date >= buy.date)
      if (!sell) return
      usedSells.add(sell.id)

      const profitNative = (sell.price - buy.price) * buy.quantity
      const profitPln = toPLN(profitNative, buy.currency, rates)
      const roi = ((sell.price - buy.price) / buy.price) * 100

      results.push({
        buyId: buy.id,
        ticker: buy.ticker,
        quantity: buy.quantity,
        buyPrice: buy.price,
        sellPrice: sell.price,
        currency: buy.currency,
        buyDate: buy.date,
        sellDate: sell.date,
        daysHeld: daysBetween(buy.date, sell.date),
        profitPln,
        roi,
        platform: buy.platform || '',
      })
    })
  })

  return results.sort((a, b) => b.sellDate.localeCompare(a.sellDate))
}

type SortField = 'ticker' | 'buyDate' | 'sellDate' | 'days' | 'profit' | 'roi'
type SortDir = 'asc' | 'desc'

function RealizedProfit({ exchangeRate, eurRate, krwRate = 0.003 }: { exchangeRate: number; eurRate: number; krwRate?: number }) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [sortField, setSortField] = useState<SortField>('sellDate')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className="ml-0.5 text-stone-400 inline-block w-3 text-xs">
      {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </span>
  )

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

  const rates: FxRates = { usdPln: exchangeRate, eurPln: eurRate, krwPln: krwRate }
  const closed = buildClosedPositions(transactions, rates)

  const sortedClosed = useMemo(() => {
    return [...closed].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      switch (sortField) {
        case 'ticker': return dir * a.ticker.localeCompare(b.ticker)
        case 'buyDate': return dir * a.buyDate.localeCompare(b.buyDate)
        case 'sellDate': return dir * a.sellDate.localeCompare(b.sellDate)
        case 'days': return dir * (a.daysHeld - b.daysHeld)
        case 'profit': return dir * (a.profitPln - b.profitPln)
        case 'roi': return dir * (a.roi - b.roi)
        default: return 0
      }
    })
  }, [closed, sortField, sortDir])

  const totalProfit = closed.reduce((s, t) => s + t.profitPln, 0)
  const wins = closed.filter(t => t.profitPln > 0).length
  const losses = closed.filter(t => t.profitPln <= 0).length

  const yearlyData = useMemo(() => {
    const byYear = new Map<number, number>()
    for (const pos of closed) {
      const year = new Date(pos.sellDate).getFullYear()
      byYear.set(year, (byYear.get(year) ?? 0) + pos.profitPln)
    }
    return Array.from(byYear.entries())
      .sort(([a], [b]) => a - b)
      .map(([year, profit]) => ({ year: String(year), profit }))
  }, [closed])

  return (
    <div className="space-y-6">
      {/* Karty podsumowania */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className={`rounded-sm p-6 border border-dotted shadow-none ${totalProfit >= 0 ? 'bg-[#2D6A4F]/5 border-[#2D6A4F]/30' : 'bg-[#A83232]/5 border-[#A83232]/30'}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-sm flex items-center justify-center ${totalProfit >= 0 ? 'bg-[#2D6A4F]/10' : 'bg-[#A83232]/10'}`}>
              <svg className={`w-5 h-5 ${totalProfit >= 0 ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={totalProfit >= 0 ? 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' : 'M13 17h8m0 0V9m0 8l-8-8-4 4-6-6'} />
              </svg>
            </div>
            <p className="text-stone-500 text-sm font-bold">Łączny zysk (PLN)</p>
          </div>
          <p className={`text-2xl font-bold font-mono ${totalProfit >= 0 ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
            {totalProfit >= 0 ? '+' : ''}{formatPLN(totalProfit)}
          </p>
        </div>
        <div className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-stone-300/50 rounded-sm flex items-center justify-center">
              <svg className="w-5 h-5 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-stone-500 text-sm font-bold">Zamkniętych pozycji</p>
          </div>
          <p className="text-2xl font-bold text-[#33332D] font-mono">{closed.length}</p>
        </div>
        <div className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-[#2D6A4F]/10 rounded-sm flex items-center justify-center">
              <svg className="w-5 h-5 text-[#2D6A4F]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-stone-500 text-sm font-bold">Zyskownych</p>
          </div>
          <p className="text-2xl font-bold text-[#2D6A4F] font-mono">{wins}</p>
        </div>
        <div className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-[#A83232]/10 rounded-sm flex items-center justify-center">
              <svg className="w-5 h-5 text-[#A83232]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-stone-500 text-sm font-bold">Stratnych</p>
          </div>
          <p className="text-2xl font-bold text-[#A83232] font-mono">{losses}</p>
        </div>
      </div>

      {/* Wykres roczny */}
      {yearlyData.length > 0 && (
        <div className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
          <div className="mb-4">
            <h2 className="text-base font-bold text-[#33332D]">Zrealizowany zysk wg roku</h2>
            <p className="text-xs text-stone-500 mt-0.5">Suma zamkniętych pozycji w PLN</p>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={yearlyData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-stone-300))" />
              <ReferenceLine y={0} stroke="rgb(var(--c-line))" strokeDasharray="4 4" />
              <XAxis
                dataKey="year"
                stroke="rgb(var(--c-line))"
                tick={{ fill: 'rgb(var(--c-stone-500))', fontSize: 12 }}
                tickLine={false}
              />
              <YAxis
                stroke="rgb(var(--c-line))"
                tick={{ fill: 'rgb(var(--c-stone-500))', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => {
                  const abs = Math.abs(v)
                  const sign = v < 0 ? '-' : ''
                  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}k`
                  return `${sign}${abs.toFixed(0)}`
                }}
                width={65}
              />
              <Tooltip
                cursor={{ fill: 'rgb(var(--c-stone-300))', opacity: 0.3 }}
                content={({ active, payload, label }: any) => {
                  if (!active || !payload?.length) return null
                  const value = payload[0].value as number
                  return (
                    <div style={{
                      backgroundColor: 'rgb(var(--c-surface))',
                      border: '1px dotted rgb(var(--c-line))',
                      borderRadius: '2px',
                      padding: '8px 12px',
                      fontFamily: 'IBM Plex Mono, monospace',
                      fontSize: '12px',
                    }}>
                      <p style={{ color: 'rgb(var(--c-stone-500))', marginBottom: 4 }}>{label}</p>
                      <p style={{ color: value >= 0 ? '#2D6A4F' : '#A83232', fontWeight: 'bold' }}>
                        {formatPLN(value)}
                      </p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="profit" radius={[3, 3, 0, 0]} maxBarSize={60}>
                {yearlyData.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={entry.profit >= 0 ? '#2D6A4F' : '#A83232'}
                    fillOpacity={0.85}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tabela */}
      <div className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
        <div className="mb-4">
          <h2 className="text-base font-bold text-[#33332D]">Zamknięte pozycje</h2>
          <p className="text-xs text-stone-500 mt-0.5">Automatycznie z archiwum transakcji (FIFO)</p>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
          </div>
        ) : closed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-stone-500 gap-2">
            <svg className="w-10 h-10 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm">Brak zamkniętych pozycji</p>
            <p className="text-xs text-stone-400">Zamknij pozycję w zakładce Archiwum</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-stone-500 text-left border-perf">
                  <th className="pb-3 px-2 font-bold cursor-pointer select-none" onClick={() => handleSort('ticker')}>Ticker<SortIcon field="ticker" /></th>
                  <th className="pb-3 px-2 font-bold text-right">Ilość</th>
                  <th className="pb-3 px-2 font-bold cursor-pointer select-none" onClick={() => handleSort('buyDate')}>Kupno<SortIcon field="buyDate" /></th>
                  <th className="pb-3 px-2 font-bold cursor-pointer select-none" onClick={() => handleSort('sellDate')}>Sprzedaż<SortIcon field="sellDate" /></th>
                  <th className="pb-3 px-2 font-bold text-right cursor-pointer select-none" onClick={() => handleSort('days')}>Dni<SortIcon field="days" /></th>
                  <th className="pb-3 px-2 font-bold text-right cursor-pointer select-none" onClick={() => handleSort('profit')}>Zysk (PLN)<SortIcon field="profit" /></th>
                  <th className="pb-3 px-2 font-bold text-right cursor-pointer select-none" onClick={() => handleSort('roi')}>ROI<SortIcon field="roi" /></th>
                </tr>
              </thead>
              <tbody>
                {sortedClosed.map(t => {
                  const isPos = t.profitPln >= 0
                  return (
                    <tr key={t.buyId} className="border-perf hover:bg-stone-200/50 transition-colors">
                      <td className="py-3 px-2">
                        <span className="font-bold text-[#33332D] bg-stone-300/50 border border-dotted border-stone-400 rounded-sm px-2 py-0.5 text-xs font-mono">{t.ticker}</span>
                        {t.platform && (
                          <span className="ml-1.5 text-xs text-stone-400">{t.platform}</span>
                        )}
                      </td>
                      <td className="py-3 px-2 text-right text-stone-600 font-mono">{t.quantity}</td>
                      <td className="py-3 px-2 whitespace-nowrap">
                        <div className="text-stone-600 font-mono text-xs">{t.buyDate}</div>
                        <div className="text-stone-600 font-mono text-xs">{formatNative(t.buyPrice, t.currency)}</div>
                      </td>
                      <td className="py-3 px-2 whitespace-nowrap">
                        <div className="text-stone-600 font-mono text-xs">{t.sellDate}</div>
                        <div className="text-stone-600 font-mono text-xs">{formatNative(t.sellPrice, t.currency)}</div>
                      </td>
                      <td className="py-3 px-2 text-right text-stone-500 font-mono whitespace-nowrap">{t.daysHeld}d</td>
                      <td className="py-3 px-2 text-right">
                        <span className={`font-mono font-bold ${isPos ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
                          {isPos ? '+' : ''}{formatPLN(t.profitPln)}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right">
                        <span className={`font-mono font-bold text-xs ${isPos ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
                          {formatPercent(t.roi)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default RealizedProfit
