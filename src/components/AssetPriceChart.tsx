import React, { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { Transaction } from '../types'

interface Props {
  ticker: string
  avgPrice: number
  currency: string
  startDate: string // ISO date of first purchase (YYYY-MM-DD)
  endDate?: string // ISO date of sale (YYYY-MM-DD) for a closed position
  transactions?: Transaction[]
}

interface PricePoint {
  date: string
  close: number
}

interface ChartPoint extends PricePoint {
  averagePrice: number | null
}

export const buildPriceSeries = (prices: PricePoint[], transactions: Transaction[]): ChartPoint[] => {
  const orderedTransactions = [...transactions].sort((a, b) =>
    a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at)
  )
  let transactionIndex = 0
  let quantity = 0
  let cost = 0

  return prices.map(point => {
    while (transactionIndex < orderedTransactions.length && orderedTransactions[transactionIndex].date <= point.date) {
      const transaction = orderedTransactions[transactionIndex]
      if (transaction.type === 'buy') {
        cost += transaction.price * transaction.quantity
        quantity += transaction.quantity
      } else if (quantity > 0) {
        const soldQuantity = Math.min(transaction.quantity, quantity)
        cost -= (cost / quantity) * soldQuantity
        quantity -= soldQuantity
        if (quantity < 1e-8) {
          quantity = 0
          cost = 0
        }
      }
      transactionIndex += 1
    }

    return {
      ...point,
      averagePrice: quantity > 0 ? cost / quantity : null,
    }
  })
}

const formatPrice = (v: number, currency: string) => {
  const suffix = currency === 'PLN' ? 'zł' : currency === 'EUR' ? '€' : currency === 'KRW' ? '₩' : '$'
  return `${v.toFixed(2)} ${suffix}`
}

function AssetPriceChart({ ticker, avgPrice, currency, startDate, endDate, transactions }: Props) {
  const [series, setSeries] = useState<PricePoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      setSeries([])
      try {
        const { data, error: fnError } = await supabase.functions.invoke('fetch-price-history', {
          body: { ticker, startDate, endDate },
        })
        if (fnError) throw fnError
        const payload = data as { series?: PricePoint[]; error?: string } | null
        if (payload?.error) throw new Error(payload.error)
        if (!cancelled) setSeries(payload?.series ?? [])
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Nie udało się pobrać historii cen.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [ticker, startDate, endDate])

  const chartData = useMemo(
    () => transactions?.length ? buildPriceSeries(series, transactions) : series.map(point => ({ ...point, averagePrice: null })),
    [series, transactions]
  )
  const hasDynamicAverage = Boolean(transactions?.length)

  const { minY, maxY, firstClose, lastClose } = useMemo(() => {
    if (chartData.length === 0) return { minY: 0, maxY: 0, firstClose: 0, lastClose: 0 }
    let lo = Infinity
    let hi = -Infinity
    for (const p of chartData) {
      if (p.close < lo) lo = p.close
      if (p.close > hi) hi = p.close
      if (p.averagePrice != null) {
        lo = Math.min(lo, p.averagePrice)
        hi = Math.max(hi, p.averagePrice)
      }
    }
    if (!hasDynamicAverage) {
      lo = Math.min(lo, avgPrice)
      hi = Math.max(hi, avgPrice)
    }
    const pad = (hi - lo) * 0.08 || hi * 0.05
    return {
      minY: Math.max(0, lo - pad),
      maxY: hi + pad,
      firstClose: chartData[0].close,
      lastClose: chartData[chartData.length - 1].close,
    }
  }, [chartData, avgPrice, hasDynamicAverage])

  const changePct = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0
  const isUp = lastClose >= firstClose

  const prevClose = series.length >= 2 ? series[series.length - 2].close : 0
  const dailyPct = prevClose > 0 ? ((lastClose - prevClose) / prevClose) * 100 : 0
  const dailyUp = lastClose >= prevClose

  return (
    <div className="mt-4 pt-4 border-t border-dotted border-stone-400">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-500 font-medium">
            {endDate ? 'Wykres ceny od zakupu do sprzedaży:' : 'Wykres ceny od zakupu:'}
          </span>
          <span className="font-bold text-[#33332D] bg-stone-300/50 border border-dotted border-stone-400 rounded-sm px-2 py-0.5 text-xs tracking-wider">
            {ticker}
          </span>
        </div>
        {series.length > 0 && (
          <div className="flex items-center gap-3">
            <span className={`text-xs font-mono font-bold ${dailyUp ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
              dzienna: {dailyUp ? '+' : ''}{dailyPct.toFixed(2)}%
            </span>
            <span className={`text-xs font-mono font-bold ${isUp ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
              od zakupu: {isUp ? '+' : ''}{changePct.toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center h-56 text-stone-500 gap-2">
          <div className="w-5 h-5 rounded-full border-2 border-stone-400 border-t-transparent animate-spin"></div>
          <span className="text-sm">Ładowanie historii cen...</span>
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center justify-center h-56 text-stone-500">
          <span className="text-sm">{error}</span>
        </div>
      )}

      {!loading && !error && series.length > 0 && (
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="assetPriceFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isUp ? '#2D6A4F' : '#A83232'} stopOpacity={0.25} />
                <stop offset="100%" stopColor={isUp ? '#2D6A4F' : '#A83232'} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="rgb(var(--c-stone-300))" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: 'rgb(var(--c-stone-500))' }}
              minTickGap={40}
              tickFormatter={(d: string) => d.slice(2)}
            />
            <YAxis
              domain={[minY, maxY]}
              tick={{ fontSize: 10, fill: 'rgb(var(--c-stone-500))' }}
              width={52}
              tickFormatter={(v: number) => v.toFixed(0)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgb(var(--c-surface))',
                border: '1px dotted rgb(var(--c-stone-500))',
                borderRadius: '2px',
                fontSize: '12px',
                fontFamily: 'monospace',
              }}
              formatter={(v: number, name: string) => [formatPrice(v, currency), name]}
              labelStyle={{ color: 'rgb(var(--c-stone-600))' }}
            />
            {!hasDynamicAverage && (
              <ReferenceLine
                y={avgPrice}
                stroke="rgb(var(--c-stone-600))"
                strokeDasharray="4 4"
                label={{ value: `śr. zakup ${avgPrice.toFixed(2)}`, position: 'insideTopLeft', fontSize: 10, fill: 'rgb(var(--c-stone-600))' }}
              />
            )}
            <Area
              type="monotone"
              dataKey="close"
              name="Cena"
              stroke={isUp ? '#2D6A4F' : '#A83232'}
              strokeWidth={1.75}
              fill="url(#assetPriceFill)"
              dot={false}
              isAnimationActive={false}
            />
            {hasDynamicAverage && (
              <Line
                type="stepAfter"
                dataKey="averagePrice"
                name="Śr. cena zakupu"
                stroke="rgb(var(--c-stone-600))"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

export default AssetPriceChart
