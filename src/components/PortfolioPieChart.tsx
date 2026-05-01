import React, { useState } from 'react'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Sector,
} from 'recharts'
import { Asset } from '../types'
import { toPLN } from '../lib/currency'

interface Props {
  assets: Asset[]
  exchangeRate: number
  eurRate?: number
  krwRate?: number
}

const COLORS = ['#57534E', '#78716C', '#A83232', '#8B6914', '#2D6A4F', '#4A5568', '#92400E', '#5B6B5B', '#6B5B4F', '#7C6F64']

const plnFmt = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 })

/** Aktywny (podświetlony) sektor – lekko powiększony z zewnętrznym pierścieniem. */
function renderActiveShape(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props
  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={outerRadius + 8}
        outerRadius={outerRadius + 10}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        opacity={0.5}
      />
    </g>
  )
}

function PortfolioPieChart({ assets, exchangeRate, eurRate = 4.3, krwRate = 0.003 }: Props) {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined)
  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-52 text-stone-500 gap-2">
        <svg className="w-10 h-10 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
        </svg>
        <span className="text-sm">Brak aktywów</span>
      </div>
    )
  }

  const rates = { usdPln: exchangeRate, eurPln: eurRate, krwPln: krwRate }
  const data = assets.map((asset) => {
    const nativeValue = (asset.current_price ?? asset.average_price) * asset.quantity
    const valuePLN = toPLN(nativeValue, asset.currency ?? 'USD', rates)
    return { name: asset.ticker, value: parseFloat(valuePLN.toFixed(2)) }
  })

  const total = data.reduce((sum, d) => sum + d.value, 0)
  const active = activeIndex !== undefined ? data[activeIndex] : undefined
  const centerLabel = active ? active.name : 'Razem'
  const centerValue = active ? active.value : total
  const centerPct = active && total > 0 ? (active.value / total) * 100 : undefined

  return (
    <div className="relative">
      {/* Donut w górnej sekcji; legenda renderowana osobno poniżej, żeby nie przesuwała środka wykresu */}
      <div className="relative">
        <ResponsiveContainer width="100%" height={190}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={58}
              outerRadius={86}
              paddingAngle={2}
              cornerRadius={4}
              dataKey="value"
              stroke="rgb(var(--c-surface))"
              strokeWidth={2}
              activeIndex={activeIndex}
              activeShape={renderActiveShape}
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(undefined)}
            >
              {data.map((_entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/* Etykieta wycentrowana dokładnie w środku pierścienia (cx=50%, cy=50%) */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[11px] uppercase tracking-wide text-stone-500 font-medium">{centerLabel}</span>
          <span className="text-base font-bold text-[#33332D] tabular-nums leading-tight">{plnFmt.format(centerValue)}</span>
          {centerPct !== undefined && (
            <span className="text-[11px] text-stone-500 tabular-nums">{centerPct.toFixed(1)}%</span>
          )}
        </div>
      </div>

      {/* Legenda niezależna od obszaru rysowania wykresu */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-2 px-2">
        {data.map((entry, index) => (
          <span
            key={entry.name}
            className="flex items-center gap-1.5 text-[12px]"
            style={{ color: 'rgb(var(--c-stone-600))' }}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: COLORS[index % COLORS.length] }}
            />
            {entry.name}
          </span>
        ))}
      </div>
    </div>
  )
}

export default PortfolioPieChart
