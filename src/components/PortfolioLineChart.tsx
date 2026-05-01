import React, { useMemo } from 'react'
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
  Brush,
} from 'recharts'

export interface TradeMarker {
  type: 'buy' | 'sell'
  ticker: string
  quantity: number
  price: number
  profit_pln?: number
  currency: string
}

export interface ChartPoint {
  date: string
  value: number
  benchmark?: number
  invested?: number
  tradeMarkers?: TradeMarker[]
}

export type TimeRange = '5d' | '1m' | '3m' | 'ytd' | '1y' | 'all'
export type ScaleType = 'linear' | 'log'

interface Props {
  data: ChartPoint[]
  chartType: 'value' | 'pnl'
  timeRange: TimeRange
  scaleType: ScaleType
  showPercent: boolean
  showBenchmark: boolean
  showInvested: boolean
  showRealized: boolean
  showTradeMarkers: boolean
}

const formatDate = (dateStr: string) => {
  // Używamy UTC, bo dane są grupowane per dzień na podstawie daty UTC (created_at.slice(0, 10)).
  // Użycie lokalnej strefy czasowej mogłoby przesunąć wpis z późnej nocy UTC na kolejny dzień
  // lokalnie, co dawało wrażenie dwóch punktów dla tego samego dnia.
  const d = new Date(dateStr)
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`
}

const formatShort = (value: number) => {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}k`
  return `${sign}${abs.toFixed(0)}`
}

const formatPercent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`

const formatFull = (value: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value)

function filterByTimeRange(data: ChartPoint[], range: TimeRange): ChartPoint[] {
  if (range === 'all' || data.length === 0) return data
  const now = new Date()
  let cutoff: Date
  switch (range) {
    case '5d':  cutoff = new Date(now.getTime() - 5 * 86400000); break
    case '1m':  cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()); break
    case '3m':  cutoff = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); break
    case 'ytd': cutoff = new Date(now.getFullYear(), 0, 1); break
    case '1y':  cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break
  }
  const filtered = data.filter(d => new Date(d.date) >= cutoff)
  return filtered.length > 0 ? filtered : data.slice(-1)
}

/** Normalizes both portfolio value and benchmark to % change from start of filtered range */
function normalizeToRange(data: ChartPoint[]): ChartPoint[] {
  if (data.length === 0) return data
  const baseValue = data[0].value
  // Use first non-null benchmark as base to survive null entries at data[0]
  const baseBenchmark = data.find(d => d.benchmark != null)?.benchmark
  return data.map(d => ({
    date: d.date,
    value: d.value - baseValue,
    benchmark:
      d.benchmark != null && baseBenchmark != null && baseBenchmark !== 0
        ? ((d.benchmark - baseBenchmark) / Math.abs(baseBenchmark)) * 100
        : undefined,
  }))
}

/** Gradient offset so the fill is green above 0 and red below 0 */
function getGradientOffset(data: { value: number }[]): number {
  const values = data.map(d => d.value)
  const max = Math.max(...values)
  const min = Math.min(...values)
  if (max <= 0) return 0
  if (min >= 0) return 1
  return max / (max - min)
}

/** Crosshair cursor – vertical + horizontal dashed lines */
const Crosshair = (props: any) => {
  const { points, top, left, width, height } = props
  if (!points?.[0]) return null
  const { x, y } = points[0]
  const t = typeof top === 'number' ? top : 5
  const l = typeof left === 'number' ? left : 5
  const w = typeof width === 'number' ? width : 600
  const h = typeof height === 'number' ? height : 260
  return (
    <g>
      <line x1={x} y1={t} x2={x} y2={t + h} stroke="rgb(var(--c-line))" strokeDasharray="3 3" strokeWidth={1} />
      <line x1={l} y1={y} x2={l + w} y2={y} stroke="rgb(var(--c-line))" strokeDasharray="3 3" strokeWidth={1} />
    </g>
  )
}

/** Custom tooltip that deduplicates entries (Area + Line share the same dataKey) */
const CustomTooltip = ({ active, payload, label, isPercentMode, mainLabel }: any) => {
  if (!active || !payload?.length) return null
  // Deduplicate by dataKey name
  const seen = new Set<string>()
  const unique = payload.filter((entry: any) => {
    if (seen.has(entry.dataKey)) return false
    seen.add(entry.dataKey)
    return true
  })
  // Check for buy/sell markers in the data point
  const dataPoint = payload[0]?.payload
  const tradeMarkers: TradeMarker[] = dataPoint?.tradeMarkers ?? []
  const buyMarkers = tradeMarkers.filter(m => m.type === 'buy')
  const sellMarkers = tradeMarkers.filter(m => m.type === 'sell')
  return (
    <div style={{
      backgroundColor: 'rgb(var(--c-surface))',
      border: '1px dotted rgb(var(--c-line))',
      borderRadius: '2px',
      padding: '8px 12px',
      fontFamily: 'IBM Plex Mono, monospace',
      fontSize: '12px',
      maxWidth: 280,
    }}>
      <p style={{ color: 'rgb(var(--c-stone-500))', marginBottom: 4 }}>{label}</p>
      {unique.map((entry: any) => {
        const value = entry.value as number
        const formatted = isPercentMode
          ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
          : formatFull(value)
        const seriesLabel =
          entry.dataKey === 'benchmark'
            ? 'S&P 500'
            : entry.dataKey === 'invested'
            ? 'Wpłacony kapitał'
            : mainLabel
        return (
          <p key={entry.dataKey} style={{ color: entry.color || 'rgb(var(--c-ink))', margin: '2px 0' }}>
            <span style={{ color: 'rgb(var(--c-stone-500))' }}>{seriesLabel}: </span>{formatted}
          </p>
        )
      })}
      {tradeMarkers.length > 0 && (
        <div style={{ borderTop: '1px dotted rgb(var(--c-line))', marginTop: 4, paddingTop: 4 }}>
          {buyMarkers.length > 0 && (
            <>
              <p style={{ color: '#2D6A4F', fontWeight: 600, margin: '0 0 2px' }}>Kupno:</p>
              {buyMarkers.map((m, i) => (
                <p key={`buy-${i}`} style={{ color: 'rgb(var(--c-ink))', margin: '1px 0', fontSize: 11 }}>
                  ▲ {m.ticker} × {m.quantity} @ {m.price.toFixed(2)} {m.currency}
                </p>
              ))}
            </>
          )}
          {sellMarkers.length > 0 && (
            <>
              <p style={{ color: '#A83232', fontWeight: 600, margin: buyMarkers.length > 0 ? '4px 0 2px' : '0 0 2px' }}>Sprzedaż:</p>
              {sellMarkers.map((m, i) => (
                <p key={`sell-${i}`} style={{ color: 'rgb(var(--c-ink))', margin: '1px 0', fontSize: 11 }}>
                  ▼ {m.ticker} × {m.quantity} @ {m.price.toFixed(2)} {m.currency}
                  {typeof m.profit_pln === 'number' && (
                    <span style={{ color: m.profit_pln >= 0 ? '#2D6A4F' : '#A83232', marginLeft: 4 }}>
                      {m.profit_pln >= 0 ? '+' : ''}{formatFull(m.profit_pln)}
                    </span>
                  )}
                </p>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PortfolioLineChart({ data, chartType, timeRange, scaleType, showPercent, showBenchmark, showInvested, showTradeMarkers }: Props) {
  const memoizedData = useMemo(() => {
    if (data.length === 0) return null

    const hasPnl = chartType === 'pnl'
    const isPercentMode = !hasPnl && (showPercent || showBenchmark)

    let filtered = filterByTimeRange(data, timeRange)
    // Gdy S&P włączony, pokaż tylko zakres od pierwszego dnia z danymi benchmarku
    if (showBenchmark) {
      const firstBenchmarkIdx = filtered.findIndex(d => d.benchmark != null)
      if (firstBenchmarkIdx > 0) {
        filtered = filtered.slice(firstBenchmarkIdx)
      }
    }
    const processed = isPercentMode ? normalizeToRange(filtered) : filtered
    const hasBenchmarkData = showBenchmark && processed.some(d => d.benchmark != null)
    const hasInvestedData =
      showInvested && !hasPnl && !isPercentMode && processed.some(d => d.invested != null)
    const useLog = scaleType === 'log' && !isPercentMode && !hasPnl && processed.every(d => d.value > 0)

    const lineColor = chartType === 'pnl' ? '#2D6A4F' : 'rgb(var(--c-stone-600))'
    const lineColorDot = chartType === 'pnl' ? '#1B4332' : 'rgb(var(--c-ink))'
    const label = isPercentMode ? 'Portfel %' : hasPnl ? 'Zysk / Strata' : 'Wartość portfela'
    const offset = (hasPnl || isPercentMode) ? getGradientOffset(processed) : 1

    const chartData = processed.map(item => ({
      date: formatDate(item.date),
      value: item.value,
      ...(hasBenchmarkData && item.benchmark != null ? { benchmark: item.benchmark } : {}),
      ...(hasInvestedData && item.invested != null ? { invested: item.invested } : {}),
      ...(item.tradeMarkers && item.tradeMarkers.length > 0 ? { tradeMarkers: item.tradeMarkers } : {}),
    }))

    // Indeksy punktów z transakcjami (do renderowania markerów)
    const tradeIndices: number[] = []
    if (showTradeMarkers) {
      chartData.forEach((d, i) => { if ((d as any).tradeMarkers) tradeIndices.push(i) })
    }

    return { chartData, hasPnl, isPercentMode, hasBenchmarkData, hasInvestedData, useLog, lineColor, lineColorDot, label, offset, tradeIndices }
  }, [data, chartType, timeRange, scaleType, showPercent, showBenchmark, showInvested, showTradeMarkers])

  if (!memoizedData) {
    return (
      <div className="flex flex-col items-center justify-center h-52 text-stone-500 gap-2">
        <svg className="w-10 h-10 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <span className="text-sm">Brak danych historycznych</span>
        <span className="text-xs text-stone-400">Dane pojawią się po pierwszym uruchomieniu automatyzacji</span>
      </div>
    )
  }

  const { chartData, hasPnl, isPercentMode, hasBenchmarkData, hasInvestedData, useLog, lineColor, lineColorDot, label, offset, tradeIndices } = memoizedData

  // Custom dot renderer for buy/sell markers
  const renderTradeDot = (props: any) => {
    const { cx, cy, index } = props
    if (!tradeIndices.includes(index)) return <g key={`empty-${index}`} />
    const markers: TradeMarker[] = props?.payload?.tradeMarkers ?? []
    const hasBuy = markers.some(m => m.type === 'buy')
    const hasSell = markers.some(m => m.type === 'sell')
    const color = hasBuy && hasSell ? '#B45309' : hasSell ? '#A83232' : '#2D6A4F'

    return (
      <g key={`trade-${index}`}>
        <circle cx={cx} cy={cy} r={7} fill={color} fillOpacity={0.2} stroke="none" />
        <circle cx={cx} cy={cy} r={4} fill={color} stroke="#fff" strokeWidth={1.5} />
      </g>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
        <defs>
          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            {hasPnl || isPercentMode ? (
              <>
                <stop offset="0%" stopColor="#2D6A4F" stopOpacity={0.25} />
                <stop offset={`${offset * 100}%`} stopColor="#2D6A4F" stopOpacity={0.04} />
                <stop offset={`${offset * 100}%`} stopColor="#A83232" stopOpacity={0.04} />
                <stop offset="100%" stopColor="#A83232" stopOpacity={0.25} />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.18} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
              </>
            )}
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-stone-300))" />
        {(hasPnl || isPercentMode) && <ReferenceLine y={0} stroke="rgb(var(--c-line))" strokeDasharray="4 4" />}
        <XAxis
          dataKey="date"
          stroke="rgb(var(--c-line))"
          tick={{ fill: 'rgb(var(--c-stone-500))', fontSize: 11 }}
          tickLine={false}
        />
        <YAxis
          stroke="rgb(var(--c-line))"
          tick={{ fill: 'rgb(var(--c-stone-500))', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={isPercentMode ? formatPercent : formatShort}
          width={65}
          scale={useLog ? 'log' : 'linear'}
          domain={useLog ? ['auto', 'auto'] : undefined}
          allowDataOverflow={useLog}
        />
        <Tooltip
          cursor={<Crosshair />}
          content={<CustomTooltip isPercentMode={isPercentMode} mainLabel={label} />}
        />
        <Area
          type="monotone"
          dataKey="value"
          fill="url(#areaGradient)"
          stroke="none"
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={lineColor}
          strokeWidth={2.5}
          dot={tradeIndices.length > 0 ? renderTradeDot : false}
          activeDot={{ r: 5, fill: lineColor, stroke: lineColorDot, strokeWidth: 2 }}
        />
        {hasInvestedData && (
          <Line
            type="monotone"
            dataKey="invested"
            stroke="#B45309"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
            activeDot={{ r: 4, fill: '#B45309', stroke: '#78350F', strokeWidth: 2 }}
          />
        )}
        {hasBenchmarkData && (
          <Line
            type="monotone"
            dataKey="benchmark"
            stroke="#6366F1"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
            activeDot={{ r: 4, fill: '#6366F1', stroke: '#4338CA', strokeWidth: 2 }}
          />
        )}
        <Brush
          dataKey="date"
          height={28}
          stroke="rgb(var(--c-line))"
          fill="rgb(var(--c-canvas))"
          travellerWidth={8}
          tickFormatter={() => ''}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export default React.memo(PortfolioLineChart)
