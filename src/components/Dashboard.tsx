import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import { supabase } from '../lib/supabase'
import { Asset, PortfolioHistory, Transaction, RealizedTrade } from '../types'
import type { ChartPoint, TradeMarker, TimeRange, ScaleType } from './PortfolioLineChart'
import Summary from './Summary'
import AssetTable from './AssetTable'
import ErrorBoundary from './ErrorBoundary'

// Code splitting: ciężkie komponenty (recharts ~575 kB) i zawartość zakładek
// ładowane leniwie, aby zmniejszyć początkowy bundle.
const PortfolioLineChart = lazy(() => import('./PortfolioLineChart'))
const PortfolioPieChart = lazy(() => import('./PortfolioPieChart'))
const AssetPriceChart = lazy(() => import('./AssetPriceChart'))
const DailyReturnsCalendar = lazy(() => import('./DailyReturnsCalendar'))
const Dividends = lazy(() => import('./Dividends'))
const RealizedProfit = lazy(() => import('./RealizedProfit'))
const TransactionHistory = lazy(() => import('./TransactionHistory'))
import { FxRates, fxRateFor, krwPlnFromUsdRates, toPLN as convertToPLN, formatQuantity } from '../lib/currency'
import { useSettings, TranslationKey, Theme, Language, Currency } from '../lib/settings'
import { calculateTWR, calculateMWR, annualizeReturn, calculateCorrelation, CashFlow, ValuationPoint } from '../lib/returns'

interface DashboardProps {
  onLogout: () => void
}

/** Placeholder wyświetlany podczas leniwego ładowania komponentów wykresów/zakładek. */
function LazyFallback() {
  return (
    <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
      <div className="relative w-10 h-10">
        <div className="absolute inset-0 rounded-full border-4 border-stone-300"></div>
        <div className="absolute inset-0 rounded-full border-4 border-stone-600 border-t-transparent animate-spin"></div>
      </div>
      <span className="sr-only">Ładowanie…</span>
    </div>
  )
}

type Tab = 'portfolio' | 'dividends' | 'realized' | 'history'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'portfolio', label: 'Portfel', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
  { id: 'dividends', label: 'Dywidendy', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'realized', label: 'Zrealizowany zysk', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { id: 'history', label: 'Archiwum', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
]

type FilterType = 'all' | 'stocks' | 'etfs'
type ChartView = 'value' | 'pnl'

function Dashboard({ onLogout }: DashboardProps) {
  const { t, theme, setTheme, language, setLanguage, currency, setCurrency, formatMoney } = useSettings()

  const [activeTab, setActiveTab] = useState<Tab>('portfolio')
  const [assets, setAssets] = useState<Asset[]>([])
  const [history, setHistory] = useState<PortfolioHistory[]>([])
  const [buyTransactions, setBuyTransactions] = useState<Transaction[]>([])
  const [realizedTrades, setRealizedTrades] = useState<RealizedTrade[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshingPrices, setRefreshingPrices] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exchangeRate, setExchangeRate] = useState<number>(4.0)
  const [eurRate, setEurRate] = useState<number>(4.3)
  const [krwRate, setKrwRate] = useState<number>(0.003)
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [chartView, setChartView] = useState<ChartView>('value')
  const [chartTimeRange, setChartTimeRange] = useState<TimeRange>('all')
  const [chartScale, setChartScale] = useState<ScaleType>('linear')
  const [chartPercent, setChartPercent] = useState(false)
  const [showBenchmark, setShowBenchmark] = useState(false)
  const [showInvested, setShowInvested] = useState(false)
  const [showRealized, setShowRealized] = useState(false)
  const [showTradeMarkers, setShowTradeMarkers] = useState(true)
  const [selectedAssetTicker, setSelectedAssetTicker] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  const formatFull = (v: number) => formatMoney(v, { usdPln: exchangeRate, eurPln: eurRate })

  useEffect(() => {
    if (!settingsOpen) return
    const onClick = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [settingsOpen])

  // Ceny w bazie aktualizuje GitHub Actions (yfinance) co ~10 min.
  // Frontend co 5 min po prostu pobiera świeże dane z bazy (bez wywoływania funkcji).
  const DATA_REFRESH_INTERVAL = 300 // 5 minut w sekundach

  const [countdown, setCountdown] = useState(DATA_REFRESH_INTERVAL)

  const formatCountdown = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [assetsResult, historyResult, rateResult, txResult, tradesResult] = await Promise.allSettled([
        supabase.from('assets').select('*').order('created_at', { ascending: true }),
        supabase
          .from('portfolio_history')
          .select('*')
          .order('created_at', { ascending: true }),
        fetch('https://open.er-api.com/v6/latest/USD').then((r) => r.json()),
        supabase.from('transactions').select('*').eq('type', 'buy').order('date', { ascending: true }),
        supabase.from('realized_trades').select('*').order('sell_date', { ascending: true }),
      ])

      if (assetsResult.status === 'fulfilled') {
        if (assetsResult.value.error) throw assetsResult.value.error
        setAssets(assetsResult.value.data ?? [])
      } else {
        throw new Error('Błąd pobierania aktywów')
      }

      if (historyResult.status === 'fulfilled' && !historyResult.value.error) {
        setHistory(historyResult.value.data ?? [])
      }

      if (txResult.status === 'fulfilled' && !txResult.value.error) {
        setBuyTransactions(txResult.value.data ?? [])
      }
      if (tradesResult.status === 'fulfilled' && !tradesResult.value.error) {
        setRealizedTrades(tradesResult.value.data ?? [])
      }

      if (rateResult.status === 'fulfilled') {
        const rateData = rateResult.value as { rates?: { PLN?: number; EUR?: number; KRW?: number } }
        const usdPln = rateData?.rates?.PLN
        const eurUsd = rateData?.rates?.EUR
        const krwUsd = rateData?.rates?.KRW
        if (typeof usdPln === 'number' && usdPln > 0) {
          setExchangeRate(usdPln)
          if (typeof eurUsd === 'number' && eurUsd > 0) {
            setEurRate((1 / eurUsd) * usdPln)
          }
          if (typeof krwUsd === 'number' && krwUsd > 0) {
            setKrwRate(krwPlnFromUsdRates(usdPln, krwUsd))
          }
        }
      }
    } catch (err) {
      console.error(err)
      setError('Błąd podczas ładowania danych. Sprawdź połączenie z bazą danych.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData().then(() => setLastUpdated(new Date()))
  }, [fetchData])

  // Realtime: natychmiastowa aktualizacja po zmianach w tabeli assets (zamiast czekać na poll).
  useEffect(() => {
    const channel = supabase
      .channel('assets-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assets' }, () => {
        fetchData(true).then(() => setLastUpdated(new Date()))
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchData])

  // Auto-refresh danych: co 5 min pobiera świeże ceny z bazy (aktualizowane przez GitHub Actions)
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchData(true).then(() => setLastUpdated(new Date()))
          return DATA_REFRESH_INTERVAL
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    if (refreshingPrices) return
    setRefreshingPrices(true)
    setError(null)
    try {
      const { data: refreshData, error: refreshError } = await supabase.functions.invoke('refresh-prices')
      if (refreshError) throw refreshError
      const rates = refreshData as { usdPln?: number; eurPln?: number; krwPln?: number } | null
      if (typeof rates?.usdPln === 'number' && rates.usdPln > 0) setExchangeRate(rates.usdPln)
      if (typeof rates?.eurPln === 'number' && rates.eurPln > 0) setEurRate(rates.eurPln)
      if (typeof rates?.krwPln === 'number' && rates.krwPln > 0) setKrwRate(rates.krwPln)
      await fetchData()
      setLastUpdated(new Date())
      setCountdown(DATA_REFRESH_INTERVAL)
    } catch (err) {
      console.error(err)
      setError('Nie udało się odświeżyć cen rynkowych. Sprawdź konfigurację funkcji Supabase.')
    } finally {
      setRefreshingPrices(false)
    }
  }

  const fxRates: FxRates = useMemo(
    () => ({ usdPln: exchangeRate, eurPln: eurRate, krwPln: krwRate }),
    [exchangeRate, eurRate, krwRate]
  )
  const toPLN = (value: number, currency: string) => convertToPLN(value, currency, fxRates)

  const totalValue = assets.reduce(
    (sum, asset) =>
      sum + toPLN((asset.current_price ?? asset.average_price) * asset.quantity, asset.currency ?? 'USD'),
    0
  )
  const totalCost = assets.reduce(
    (sum, asset) => sum + toPLN(asset.average_price * asset.quantity, asset.currency ?? 'USD'),
    0
  )
  const totalPnL = totalValue - totalCost
  const totalPnLPercent = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0

  // Dzienna zmiana portfela: aktualna wartość vs ostatni wpis historii (poprzedni dzień)
  const dailyChange = useMemo(() => {
    if (history.length === 0) return { value: 0, percent: 0 }
    const sorted = [...history]
      .map(h => ({ day: h.created_at.slice(0, 10), val: h.total_value }))
      .sort((a, b) => b.day.localeCompare(a.day))
    const today = new Date().toISOString().slice(0, 10)
    // Znajdź ostatni dzień PRZED dzisiaj (lub wczorajszy snapshot)
    const prev = sorted.find(s => s.day < today) ?? sorted[0]
    const change = totalValue - prev.val
    const pct = prev.val > 0 ? (change / prev.val) * 100 : 0
    return { value: change, percent: pct }
  }, [history, totalValue])

  // TWR (Time-Weighted Return) i MWR (Money-Weighted Return / XIRR) portfela
  const portfolioReturns = useMemo(() => {
    if (history.length === 0) return { twr: 0, mwr: 0, twrAnnualized: 0, correlation: null as number | null }

    const byDayValue = new Map<string, number>()
    for (const h of history) {
      byDayValue.set(h.created_at.slice(0, 10), h.total_value)
    }
    const today = new Date().toISOString().slice(0, 10)
    byDayValue.set(today, totalValue)

    const valuations: ValuationPoint[] = Array.from(byDayValue.entries()).map(([date, value]) => ({ date, value }))
    const sortedDates = valuations.map(v => v.date).sort()
    const daysElapsed = Math.round(
      (new Date(sortedDates[sortedDates.length - 1]).getTime() - new Date(sortedDates[0]).getTime()) / 86400000
    )

    const cashFlows: CashFlow[] = [
      ...buyTransactions.map(tx => ({
        date: tx.date.slice(0, 10),
        amount: Number(tx.price) * Number(tx.quantity) * fxRateFor(tx.currency, fxRates),
      })),
      ...realizedTrades.map(rt => ({
        date: rt.sell_date.slice(0, 10),
        amount: -(Number(rt.sell_price) * Number(rt.quantity) * fxRateFor(rt.currency, fxRates)),
      })),
    ]

    const twr = calculateTWR(valuations, cashFlows)
    const mwr = calculateMWR(cashFlows, totalValue, today)
    // MWR (XIRR) jest z definicji już roczna – nie trzeba jej dodatkowo anualizować.
    const twrAnnualized = annualizeReturn(twr, daysElapsed)

    // Korelacja dziennych zwrotów portfela z S&P 500 (benchmark zapisywany w portfolio_history.sp500_close)
    const sp500Valuations: ValuationPoint[] = history
      .filter(h => h.sp500_close != null)
      .map(h => ({ date: h.created_at.slice(0, 10), value: h.sp500_close as number }))
    const correlation = calculateCorrelation(valuations, sp500Valuations)

    return { twr, mwr, twrAnnualized, correlation }
  }, [history, buyTransactions, realizedTrades, fxRates, totalValue])

  // Filtrowanie aktywów: all / stocks / etfs
  const filteredAssets = filterType === 'all'
    ? assets
    : assets.filter(a => (a.asset_type ?? 'stock') === (filterType === 'stocks' ? 'stock' : 'etf'))

  // Zainwestowany kapitał – krok-funkcja na bazie transakcji (nie zależy od historycznego kursu walut)
  const detectTickerType = (ticker: string): string =>
    ticker.toUpperCase().endsWith('.DE') ? 'etf' : 'stock'

  // Dane do wykresu liniowego zależne od filtra i widoku
  // Deduplikacja: zachowaj tylko ostatni wpis z każdego dnia
  const lineChartData: ChartPoint[] = useMemo(() => {
    const byDay = new Map<string, PortfolioHistory>()
    for (const h of history) {
      const day = h.created_at.slice(0, 10)
      byDay.set(day, h)
    }
    const deduplicatedHistory = Array.from(byDay.values())

    const shouldIncludeTicker = (ticker: string) => {
      if (filterType === 'all') return true
      const atype = detectTickerType(ticker)
      return filterType === 'stocks' ? atype === 'stock' : atype === 'etf'
    }

    // Prefix-sum: skumulowany zainwestowany kapitał per dzień w jednym przejściu (O(n) zamiast O(n²)).
    // buyTransactions i realizedTrades są posortowane rosnąco, więc dla dni w kolejności rosnącej
    // wystarczy przesuwać dwa wskaźniki i akumulować koszt.
    const investedByDay = new Map<string, number>()
    {
      const sortedDays = deduplicatedHistory
        .map(h => h.created_at.slice(0, 10))
        .sort()
      let acc = 0
      let bi = 0
      let ri = 0
      for (const day of sortedDays) {
        while (bi < buyTransactions.length && buyTransactions[bi].date <= day) {
          const tx = buyTransactions[bi++]
          if (shouldIncludeTicker(tx.ticker)) {
            acc += tx.price * tx.quantity * fxRateFor(tx.currency, fxRates)
          }
        }
        while (ri < realizedTrades.length && realizedTrades[ri].sell_date <= day) {
          const rt = realizedTrades[ri++]
          if (shouldIncludeTicker(rt.ticker)) {
            acc -= rt.buy_price * rt.quantity * fxRateFor(rt.currency, fxRates)
          }
        }
        investedByDay.set(day, acc)
      }
    }

    // Buduj mapę kupna/sprzedaży per dzień (markery na wykresie)
    const tradesByDay = new Map<string, TradeMarker[]>()
    if (showTradeMarkers) {
      for (const tx of buyTransactions) {
        if (!shouldIncludeTicker(tx.ticker)) continue
        const buyDay = tx.date.slice(0, 10)
        if (!tradesByDay.has(buyDay)) tradesByDay.set(buyDay, [])
        tradesByDay.get(buyDay)!.push({
          type: 'buy',
          ticker: tx.ticker,
          quantity: Number(tx.quantity),
          price: Number(tx.price),
          currency: tx.currency,
        })
      }

      for (const rt of realizedTrades) {
        if (!shouldIncludeTicker(rt.ticker)) continue
        const sellDay = rt.sell_date.slice(0, 10)
        if (!tradesByDay.has(sellDay)) tradesByDay.set(sellDay, [])
        tradesByDay.get(sellDay)!.push({
          type: 'sell',
          ticker: rt.ticker,
          quantity: Number(rt.quantity),
          price: Number(rt.sell_price),
          profit_pln: Number(rt.profit_pln),
          currency: rt.currency,
        })
      }
    }

    return deduplicatedHistory.map(h => {
      let value: number
      const isPercentActive = chartPercent || showBenchmark
      const day = h.created_at.slice(0, 10)

      const invested = investedByDay.get(day) ?? 0

      if (isPercentActive && chartView === 'value') {
        let unrealizedPnl: number, totalVal: number
        if (filterType === 'all') {
          unrealizedPnl = h.total_pnl ?? 0
          totalVal = h.total_value
        } else if (filterType === 'stocks') {
          unrealizedPnl = h.pnl_stocks ?? 0
          totalVal = h.value_stocks ?? 0
        } else {
          unrealizedPnl = h.pnl_etfs ?? 0
          totalVal = h.value_etfs ?? 0
        }
        const realizedPnl = filterType === 'all' ? (h.realized_pnl_total ?? 0) : 0
        const cost = totalVal - unrealizedPnl
        value = cost > 0 ? ((unrealizedPnl + realizedPnl) / cost) * 100 : 0
      } else if (filterType === 'all') {
        value = chartView === 'value' ? h.total_value : (h.total_pnl ?? 0)
      } else if (filterType === 'stocks') {
        value = chartView === 'value' ? (h.value_stocks ?? 0) : (h.pnl_stocks ?? 0)
      } else {
        value = chartView === 'value' ? (h.value_etfs ?? 0) : (h.pnl_etfs ?? 0)
      }

      // Dodaj zrealizowany zysk do wartości PnL gdy showRealized jest włączony
      if (showRealized && chartView === 'pnl' && filterType === 'all') {
        value += (h.realized_pnl_total ?? 0)
      }

      const point: ChartPoint = {
        date: h.created_at,
        value,
        benchmark: h.sp500_close ?? undefined,
        invested,
      }

      // Dodaj markery sprzedaży
      const markers = tradesByDay.get(day)
      if (markers) {
        point.tradeMarkers = markers
      }

      return point
    })
  }, [history, filterType, chartView, chartPercent, showBenchmark, showRealized, showTradeMarkers, buyTransactions, realizedTrades, fxRates])

  // Statystyki wybranego aktywa
  const selectedAsset = selectedAssetTicker
    ? assets.find(a => a.ticker === selectedAssetTicker) ?? null
    : null
  const selectedStats = selectedAsset
    ? (() => {
        const cur = selectedAsset.currency ?? 'USD'
        const cp = selectedAsset.current_price ?? selectedAsset.average_price
        const valuePln = toPLN(cp * selectedAsset.quantity, cur)
        const costPln = toPLN(selectedAsset.average_price * selectedAsset.quantity, cur)
        const pnl = valuePln - costPln
        const pnlPct = costPln > 0 ? (pnl / costPln) * 100 : 0
        const weight = totalValue > 0 ? (valuePln / totalValue) * 100 : 0
        return { valuePln, costPln, pnl, pnlPct, weight, currentPrice: cp, currency: cur }
      })()
    : null

  // Data pierwszego zakupu wybranego aktywa (z transakcji, fallback: created_at)
  const selectedBuyDate = selectedAsset
    ? (() => {
        const buys = buyTransactions
          .filter(t => t.ticker === selectedAsset.ticker)
          .map(t => t.date)
          .sort()
        return buys[0] ?? selectedAsset.created_at.slice(0, 10)
      })()
    : null

  return (
    <div className="min-h-screen bg-[#F4F3ED] text-[#33332D] font-mono">
      {/* Header */}
      <header className="bg-[#EAE8E0] border-b-0 sticky top-0 z-40 px-6 py-4">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-stone-700 rounded-sm flex items-center justify-center">
              <svg className="w-5 h-5 text-[#F4F3ED]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#33332D] leading-none">{t('app.title')}</h1>
              <p className="text-xs text-stone-500 mt-0.5">
                USD/PLN: <span className="text-stone-600">{exchangeRate.toFixed(4)}</span>
                {' · '}
                EUR/PLN: <span className="text-stone-600">{eurRate.toFixed(4)}</span>
                {' · '}
                KRW/PLN: <span className="text-stone-600">{krwRate.toFixed(6)}</span>
                {lastUpdated && (
                  <>
                    {' · '}
                    <span className="text-stone-400">
                      {lastUpdated.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Auto-refresh countdown */}
            <span
              className="flex items-center gap-1.5 text-xs font-medium py-1.5 px-2.5 rounded-sm bg-[#2D6A4F]/10 border border-dotted border-[#2D6A4F]/40 text-[#2D6A4F]"
              title={`${t('header.autoRefresh')}${lastUpdated ? ` · ${lastUpdated.toLocaleTimeString(language === 'pl' ? 'pl-PL' : 'en-US')}` : ''}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="font-mono tabular-nums">{formatCountdown(countdown)}</span>
            </span>
            <button
              onClick={handleRefresh}
              disabled={loading || refreshingPrices}
              className="text-stone-500 hover:text-[#33332D] disabled:opacity-40 transition-colors p-2 rounded-sm hover:bg-stone-300/50"
              aria-label={t('header.refresh')}
              title={t('header.refresh')}
            >
              <svg
                className={`w-4 h-4 ${loading || refreshingPrices ? 'animate-spin' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              onClick={onLogout}
              className="text-stone-500 hover:text-[#33332D] text-sm transition-colors flex items-center gap-1.5 py-1.5 px-3 rounded-sm hover:bg-stone-300/50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {t('header.logout')}
            </button>

            {/* Settings (gear) */}
            <div className="relative" ref={settingsRef}>
              <button
                onClick={() => setSettingsOpen(o => !o)}
                className={`transition-colors p-2 rounded-sm hover:bg-stone-300/50 ${settingsOpen ? 'text-[#33332D] bg-stone-300/50' : 'text-stone-500 hover:text-[#33332D]'}`}
                aria-label={t('settings.title')}
                title={t('settings.title')}
                aria-expanded={settingsOpen}
              >
                <svg className={`w-4 h-4 transition-transform ${settingsOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              {settingsOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-[#EAE8E0] border border-dotted border-stone-400 rounded-sm shadow-lg z-50 p-4 space-y-4">
                  <p className="text-sm font-bold text-[#33332D]">{t('settings.title')}</p>

                  {/* Theme */}
                  <div>
                    <p className="text-xs font-bold text-stone-500 mb-1.5">{t('settings.theme')}</p>
                    <div className="flex gap-1 bg-[#E5E3DA] rounded-sm p-1 border border-dotted border-stone-400">
                      {([
                        { id: 'light', label: t('settings.theme.light') },
                        { id: 'dark', label: t('settings.theme.dark') },
                      ] as { id: Theme; label: string }[]).map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => setTheme(opt.id)}
                          className={`flex-1 px-2 py-1.5 rounded-sm text-xs font-medium transition-colors ${
                            theme === opt.id ? 'bg-stone-700 text-[#F4F3ED]' : 'text-stone-500 hover:text-[#33332D]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Language */}
                  <div>
                    <p className="text-xs font-bold text-stone-500 mb-1.5">{t('settings.language')}</p>
                    <div className="flex gap-1 bg-[#E5E3DA] rounded-sm p-1 border border-dotted border-stone-400">
                      {([
                        { id: 'pl', label: 'Polski' },
                        { id: 'en', label: 'English' },
                      ] as { id: Language; label: string }[]).map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => setLanguage(opt.id)}
                          className={`flex-1 px-2 py-1.5 rounded-sm text-xs font-medium transition-colors ${
                            language === opt.id ? 'bg-stone-700 text-[#F4F3ED]' : 'text-stone-500 hover:text-[#33332D]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Currency */}
                  <div>
                    <p className="text-xs font-bold text-stone-500 mb-1.5">{t('settings.currency')}</p>
                    <div className="flex gap-1 bg-[#E5E3DA] rounded-sm p-1 border border-dotted border-stone-400">
                      {(['PLN', 'USD', 'EUR'] as Currency[]).map(opt => (
                        <button
                          key={opt}
                          onClick={() => setCurrency(opt)}
                          className={`flex-1 px-2 py-1.5 rounded-sm text-xs font-medium font-mono transition-colors ${
                            currency === opt ? 'bg-stone-700 text-[#F4F3ED]' : 'text-stone-500 hover:text-[#33332D]'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="perf-line max-w-[1600px] mx-auto mt-3"></div>

        {/* Tabs */}
        <div className="max-w-[1600px] mx-auto mt-3 flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-sm text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-stone-700 text-[#F4F3ED]'
                  : 'text-stone-500 hover:text-[#33332D] hover:bg-stone-300/50'
              }`}
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
              </svg>
              {t(('tab.' + tab.id) as TranslationKey)}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8">
        {loading && (
          <div className="space-y-6 animate-pulse" aria-hidden="true">
            {/* Karty podsumowania */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400">
                  <div className="h-3 w-24 bg-stone-300 rounded-sm mb-3"></div>
                  <div className="h-6 w-32 bg-stone-300 rounded-sm"></div>
                </div>
              ))}
            </div>
            {/* Wykres */}
            <div className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400">
              <div className="h-4 w-48 bg-stone-300 rounded-sm mb-4"></div>
              <div className="h-64 w-full bg-stone-300/60 rounded-sm"></div>
            </div>
            {/* Tabela */}
            <div className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400">
              <div className="h-4 w-40 bg-stone-300 rounded-sm mb-4"></div>
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-8 w-full bg-stone-300/60 rounded-sm"></div>
                ))}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 bg-[#A83232]/10 border border-dotted border-[#A83232]/40 rounded-sm p-4 mb-6">
            <svg className="w-5 h-5 text-[#A83232] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-[#A83232] font-medium text-sm">Błąd ładowania danych</p>
              <p className="text-[#A83232]/70 text-xs mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {!loading && (
          <ErrorBoundary>
            {activeTab === 'portfolio' && (
              <div className="space-y-6">
                <Summary
                  totalValue={totalValue}
                  totalCost={totalCost}
                  totalPnL={totalPnL}
                  totalPnLPercent={totalPnLPercent}
                  dailyChange={dailyChange}
                  twr={portfolioReturns.twr}
                  mwr={portfolioReturns.mwr}
                  twrAnnualized={portfolioReturns.twrAnnualized}
                  correlation={portfolioReturns.correlation}
                  rates={{ usdPln: exchangeRate, eurPln: eurRate }}
                />

                {/* Filtr: Wszystkie / Akcje / ETFy */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-500 font-medium">Widok:</span>
                  <div className="flex gap-1 bg-[#E5E3DA] rounded-sm p-1 border border-dotted border-stone-400">
                    {([
                      { id: 'all', label: 'Wszystkie' },
                      { id: 'stocks', label: 'Akcje' },
                      { id: 'etfs', label: 'ETFy' },
                    ] as { id: FilterType; label: string }[]).map(f => (
                      <button
                        key={f.id}
                        onClick={() => setFilterType(f.id)}
                        className={`px-3 py-1.5 rounded-sm text-sm font-medium transition-colors ${
                          filterType === f.id
                            ? 'bg-stone-700 text-[#F4F3ED]'
                            : 'text-stone-500 hover:text-[#33332D] hover:bg-stone-300/50'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-3 bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h2 className="text-base font-bold text-[#33332D] mb-1">
                          Historia {chartView === 'value' ? 'wartości' : 'zysku / straty'} portfela
                        </h2>
                        <p className="text-xs text-stone-500">
                          {filterType === 'all' ? 'Cały portfel' : filterType === 'stocks' ? 'Akcje' : 'ETFy'}
                          {chartPercent ? ' · zmiana %' : ' · PLN'}
                        </p>
                      </div>
                      {/* Przełącznik Wartość / Zysk·Strata */}
                      <div className="flex gap-1 bg-[#E5E3DA] rounded-sm p-1">
                        {([
                          { id: 'value', label: 'Wartość' },
                          { id: 'pnl', label: 'Zysk / Strata' },
                        ] as { id: ChartView; label: string }[]).map(v => (
                          <button
                            key={v.id}
                            onClick={() => {
                              setChartView(v.id)
                              if (v.id === 'pnl') {
                                setChartPercent(false)
                                setShowBenchmark(false)
                              }
                            }}
                            className={`px-3 py-1 rounded-sm text-xs font-medium transition-colors ${
                              chartView === v.id
                                ? 'bg-stone-700 text-[#F4F3ED]'
                                : 'text-stone-500 hover:text-[#33332D]'
                            }`}
                          >
                            {v.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Zakres czasu + opcje wykresu */}
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      <div className="flex gap-0.5 bg-[#E5E3DA] rounded-sm p-0.5">
                        {([
                          { id: '5d', label: '5D' },
                          { id: '1m', label: '1M' },
                          { id: '3m', label: '3M' },
                          { id: 'ytd', label: 'YTD' },
                          { id: '1y', label: '1R' },
                          { id: 'all', label: 'MAX' },
                        ] as { id: TimeRange; label: string }[]).map(t => (
                          <button
                            key={t.id}
                            onClick={() => setChartTimeRange(t.id)}
                            className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-colors ${
                              chartTimeRange === t.id
                                ? 'bg-stone-700 text-[#F4F3ED]'
                                : 'text-stone-500 hover:text-[#33332D]'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-1 ml-auto">
                        <button
                          onClick={() => setShowTradeMarkers(v => !v)}
                          className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-colors border border-dotted ${
                            showTradeMarkers
                              ? 'bg-stone-700 text-[#F4F3ED] border-stone-700'
                              : 'text-stone-500 hover:text-[#33332D] border-stone-400 bg-[#E5E3DA]'
                          }`}
                          title="Pokaż/ukryj ikony kupna i sprzedaży na wykresie"
                        >
                          {showTradeMarkers ? '▲▼ ON' : '▲▼ OFF'}
                        </button>
                        {chartView === 'pnl' && (
                          <button
                            onClick={() => setShowRealized(b => !b)}
                            className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-colors border border-dotted ${
                              showRealized
                                ? 'bg-[#A83232] text-white border-[#A83232]'
                                : 'text-stone-500 hover:text-[#33332D] border-stone-400 bg-[#E5E3DA]'
                            }`}
                            title="Dodaj zrealizowany zysk do wykresu + markery sprzedaży"
                          >
                            + Zreal.
                          </button>
                        )}
                        {chartView !== 'pnl' && (
                          <>
                            <button
                              onClick={() => setShowInvested(b => !b)}
                              className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-colors border border-dotted ${
                                showInvested
                                  ? 'bg-[#B45309] text-white border-[#B45309]'
                                  : 'text-stone-500 hover:text-[#33332D] border-stone-400 bg-[#E5E3DA]'
                              }`}
                              title="Wpłacony kapitał (koszt)"
                              disabled={chartPercent || showBenchmark}
                            >
                              Wpłaty
                            </button>
                            <button
                              onClick={() => setShowBenchmark(b => !b)}
                              className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-colors border border-dotted ${
                                showBenchmark
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'text-stone-500 hover:text-[#33332D] border-stone-400 bg-[#E5E3DA]'
                              }`}
                              title="Benchmark S&P 500 (porównanie %)"
                            >
                              S&P
                            </button>
                            <button
                              onClick={() => setChartPercent(p => !p)}
                              className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-colors border border-dotted ${
                                chartPercent || showBenchmark
                                  ? 'bg-stone-700 text-[#F4F3ED] border-stone-700'
                                  : 'text-stone-500 hover:text-[#33332D] border-stone-400 bg-[#E5E3DA]'
                              }`}
                              title="Zmiana procentowa"
                              disabled={showBenchmark}
                            >
                              %
                            </button>
                            <button
                              onClick={() => setChartScale(s => s === 'linear' ? 'log' : 'linear')}
                              className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-colors border border-dotted ${
                                chartScale === 'log'
                                  ? 'bg-stone-700 text-[#F4F3ED] border-stone-700'
                                  : 'text-stone-500 hover:text-[#33332D] border-stone-400 bg-[#E5E3DA]'
                              }`}
                              title="Skala logarytmiczna"
                            >
                              LOG
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <Suspense fallback={<LazyFallback />}>
                      <PortfolioLineChart
                        data={lineChartData}
                        chartType={chartView}
                        timeRange={chartTimeRange}
                        scaleType={chartScale}
                        showPercent={chartPercent}
                        showBenchmark={showBenchmark}
                        showInvested={showInvested}
                        showRealized={showRealized}
                        showTradeMarkers={showTradeMarkers}
                      />
                    </Suspense>
                    {/* Wybór aktywa + statystyki */}
                    <div className="mt-4 pt-4 border-t border-dotted border-stone-400">
                      <div className="flex items-center gap-3 flex-wrap">
                        <label className="text-xs text-stone-500 font-medium">Statystyki aktywa:</label>
                        <select
                          value={selectedAssetTicker ?? ''}
                          onChange={e => setSelectedAssetTicker(e.target.value || null)}
                          className="text-xs bg-[#E5E3DA] border border-dotted border-stone-400 rounded-sm px-2.5 py-1.5 text-[#33332D] font-mono focus:outline-none focus:border-stone-600"
                        >
                          <option value="">— wybierz —</option>
                          {assets.map(a => (
                            <option key={a.id} value={a.ticker}>{a.ticker}</option>
                          ))}
                        </select>
                      </div>
                      {selectedAsset && selectedStats && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                          <div className="bg-[#E5E3DA] rounded-sm px-3 py-2">
                            <p className="text-[10px] text-stone-500 uppercase tracking-wide">Wartość</p>
                            <p className="text-sm font-bold text-[#33332D]">{formatFull(selectedStats.valuePln)}</p>
                          </div>
                          <div className="bg-[#E5E3DA] rounded-sm px-3 py-2">
                            <p className="text-[10px] text-stone-500 uppercase tracking-wide">Koszt</p>
                            <p className="text-sm font-bold text-[#33332D]">{formatFull(selectedStats.costPln)}</p>
                          </div>
                          <div className="bg-[#E5E3DA] rounded-sm px-3 py-2">
                            <p className="text-[10px] text-stone-500 uppercase tracking-wide">Zysk / Strata</p>
                            <p className={`text-sm font-bold ${selectedStats.pnl >= 0 ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
                              {selectedStats.pnl >= 0 ? '+' : ''}{formatFull(selectedStats.pnl)}
                              <span className="text-[10px] ml-1">({selectedStats.pnlPct >= 0 ? '+' : ''}{selectedStats.pnlPct.toFixed(1)}%)</span>
                            </p>
                          </div>
                          <div className="bg-[#E5E3DA] rounded-sm px-3 py-2">
                            <p className="text-[10px] text-stone-500 uppercase tracking-wide">Udział</p>
                            <p className="text-sm font-bold text-[#33332D]">{selectedStats.weight.toFixed(1)}%</p>
                          </div>
                          <div className="bg-[#E5E3DA] rounded-sm px-3 py-2">
                            <p className="text-[10px] text-stone-500 uppercase tracking-wide">Cena</p>
                            <p className="text-sm font-bold text-[#33332D]">{selectedStats.currentPrice.toFixed(2)} {selectedStats.currency}</p>
                          </div>
                          <div className="bg-[#E5E3DA] rounded-sm px-3 py-2">
                            <p className="text-[10px] text-stone-500 uppercase tracking-wide">Śr. cena zakupu</p>
                            <p className="text-sm font-bold text-[#33332D]">{selectedAsset.average_price.toFixed(2)} {selectedStats.currency}</p>
                          </div>
                          <div className="bg-[#E5E3DA] rounded-sm px-3 py-2">
                            <p className="text-[10px] text-stone-500 uppercase tracking-wide">Ilość</p>
                            <p className="text-sm font-bold text-[#33332D]">{formatQuantity(selectedAsset.quantity)}</p>
                          </div>
                          <div className="bg-[#E5E3DA] rounded-sm px-3 py-2">
                            <p className="text-[10px] text-stone-500 uppercase tracking-wide">Typ</p>
                            <p className="text-sm font-bold text-[#33332D]">{(selectedAsset.asset_type ?? 'stock') === 'etf' ? 'ETF' : 'Akcja'}</p>
                          </div>
                        </div>
                      )}
                      {selectedAsset && selectedStats && selectedBuyDate && (
                        <Suspense fallback={<LazyFallback />}>
                          <AssetPriceChart
                            ticker={selectedAsset.ticker}
                            avgPrice={selectedAsset.average_price}
                            currency={selectedStats.currency}
                            startDate={selectedBuyDate}
                          />
                        </Suspense>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                  <div className="xl:col-span-2 bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-base font-bold text-[#33332D]">Portfel aktywów</h2>
                        <p className="text-xs text-stone-500 mt-0.5">{filteredAssets.length} pozycji</p>
                      </div>
                    </div>
                    <AssetTable assets={filteredAssets} onDelete={fetchData} fxRates={fxRates} />
                  </div>
                  <div className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none self-start">
                    <h2 className="text-base font-bold text-[#33332D] mb-1">Skład portfela</h2>
                    <p className="text-xs text-stone-500 mb-4">
                      {filterType === 'all' ? 'Wszystkie aktywa' : filterType === 'stocks' ? 'Akcje' : 'ETFy'} wg wartości (PLN)
                    </p>
                    <Suspense fallback={<LazyFallback />}>
                      <PortfolioPieChart assets={filteredAssets} exchangeRate={exchangeRate} eurRate={eurRate} krwRate={krwRate} />
                    </Suspense>
                    <Suspense fallback={<LazyFallback />}>
                      <DailyReturnsCalendar history={history} liveTotalValue={totalValue} />
                    </Suspense>
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB: Dywidendy ── */}
            {activeTab === 'dividends' && (
              <Suspense fallback={<LazyFallback />}>
                <Dividends />
              </Suspense>
            )}

            {/* ── TAB: Zrealizowany zysk ── */}
            {activeTab === 'realized' && (
              <Suspense fallback={<LazyFallback />}>
                <RealizedProfit exchangeRate={exchangeRate} eurRate={eurRate} krwRate={krwRate} />
              </Suspense>
            )}

            {/* ── TAB: Archiwum transakcji ── */}
            {activeTab === 'history' && (
              <Suspense fallback={<LazyFallback />}>
                <TransactionHistory exchangeRate={exchangeRate} eurRate={eurRate} krwRate={krwRate} assets={assets} onDataChange={fetchData} />
              </Suspense>
            )}
          </ErrorBoundary>
        )}
      </main>
    </div>
  )
}

export default Dashboard
