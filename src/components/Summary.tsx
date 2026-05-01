import React, { useRef, useState, useCallback, useEffect } from 'react'
import { useSettings, FxRatesLite } from '../lib/settings'

interface SummaryProps {
  totalValue: number
  totalCost: number
  totalPnL: number
  totalPnLPercent: number
  dailyChange: { value: number; percent: number }
  twr: number
  mwr: number
  twrAnnualized: number
  correlation: number | null
  rates: FxRatesLite
}

/** Szerokość karty w rzędzie: 1 kolumna na mobile, 2 na sm, 4 na xl (z uwzględnieniem gap-4). */
const CARD_WIDTH_CLASS = 'w-full sm:w-[calc(50%-0.5rem)] xl:w-[calc(25%-0.75rem)] shrink-0 snap-start'

function Summary({ totalValue, totalCost, totalPnL, totalPnLPercent, dailyChange, twr, mwr, twrAnnualized, correlation, rates }: SummaryProps) {
  const { t, currency, formatMoney } = useSettings()
  const formatCurrency = (value: number) => formatMoney(value, rates)
  const formatPercent = (value: number) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
  const formatCorrelation = (value: number | null) => (value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}`)
  const isPositive = totalPnL >= 0
  const dailyPositive = dailyChange.value >= 0
  const twrPositive = twr >= 0
  const mwrPositive = mwr >= 0
  const twrAnnualizedPositive = twrAnnualized >= 0

  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    updateScrollState()
    window.addEventListener('resize', updateScrollState)
    return () => window.removeEventListener('resize', updateScrollState)
  }, [updateScrollState])

  const scrollByOneCard = (direction: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    const firstCard = el.firstElementChild as HTMLElement | null
    const gap = 16 // gap-4
    const step = (firstCard?.getBoundingClientRect().width ?? el.clientWidth / 4) + gap
    el.scrollBy({ left: direction * step, behavior: 'smooth' })
  }

  return (
    <div className="relative">
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollByOneCard(-1)}
          aria-label="Poprzednie karty"
          className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 w-8 h-12 flex items-center justify-center bg-[#EAE8E0] border border-dotted border-stone-400 rounded-sm text-stone-600 hover:text-[#33332D] hover:bg-stone-300/40 shadow-sm transition-colors"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
          </svg>
        </button>
      )}

      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className={`${CARD_WIDTH_CLASS} bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none`}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-stone-300/50 rounded-sm flex items-center justify-center">
              <svg className="w-5 h-5 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-stone-500 text-sm font-bold">{t('summary.value')}</p>
          </div>
          <p className="text-2xl font-bold text-[#33332D] font-mono">{formatCurrency(totalValue)}</p>
          <p className="text-stone-500 text-xs mt-1">{t('summary.value.sub')} · {currency}</p>
        </div>

        <div className={`${CARD_WIDTH_CLASS} bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none`}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-stone-300/50 rounded-sm flex items-center justify-center">
              <svg className="w-5 h-5 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
            <p className="text-stone-500 text-sm font-bold">{t('summary.cost')}</p>
          </div>
          <p className="text-2xl font-bold text-[#33332D] font-mono">{formatCurrency(totalCost)}</p>
          <p className="text-stone-500 text-xs mt-1">{t('summary.cost.sub')} · {currency}</p>
        </div>

        <div className={`${CARD_WIDTH_CLASS} rounded-sm p-6 border border-dotted shadow-none ${isPositive ? 'bg-[#2D6A4F]/5 border-[#2D6A4F]/30' : 'bg-[#A83232]/5 border-[#A83232]/30'}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-sm flex items-center justify-center ${isPositive ? 'bg-[#2D6A4F]/10' : 'bg-[#A83232]/10'}`}>
              <svg className={`w-5 h-5 ${isPositive ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isPositive ? 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' : 'M13 17h8m0 0V9m0 8l-8-8-4 4-6-6'} />
              </svg>
            </div>
            <p className="text-stone-500 text-sm font-bold">{t('summary.pnl')}</p>
          </div>
          <p className={`text-2xl font-bold font-mono ${isPositive ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
            {isPositive ? '+' : ''}{formatCurrency(totalPnL)}
          </p>
          <p className={`text-sm mt-1 font-medium font-mono ${isPositive ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
            {isPositive ? '+' : ''}{totalPnLPercent.toFixed(2)}%
          </p>
        </div>

        <div className={`${CARD_WIDTH_CLASS} rounded-sm p-6 border border-dotted shadow-none ${dailyPositive ? 'bg-[#2D6A4F]/5 border-[#2D6A4F]/30' : 'bg-[#A83232]/5 border-[#A83232]/30'}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-sm flex items-center justify-center ${dailyPositive ? 'bg-[#2D6A4F]/10' : 'bg-[#A83232]/10'}`}>
              <svg className={`w-5 h-5 ${dailyPositive ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-stone-500 text-sm font-bold">{t('summary.daily')}</p>
          </div>
          <p className={`text-2xl font-bold font-mono ${dailyPositive ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
            {dailyPositive ? '+' : ''}{formatCurrency(dailyChange.value)}
          </p>
          <p className={`text-sm mt-1 font-medium font-mono ${dailyPositive ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
            {dailyPositive ? '+' : ''}{dailyChange.percent.toFixed(2)}%
          </p>
        </div>

        <div className={`${CARD_WIDTH_CLASS} bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none`}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-stone-300/50 rounded-sm flex items-center justify-center">
              <svg className="w-5 h-5 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <p className="text-stone-500 text-sm font-bold">{t('summary.returns')}</p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-stone-500 text-[11px] font-medium">{t('summary.returns.twr')}</p>
              <p className={`text-xl font-bold font-mono ${twrPositive ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
                {formatPercent(twr)}
              </p>
            </div>
            <div>
              <p className="text-stone-500 text-[11px] font-medium">{t('summary.returns.mwr')}</p>
              <p className={`text-xl font-bold font-mono ${mwrPositive ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
                {formatPercent(mwr)}
              </p>
            </div>
          </div>
          <p className="text-stone-500 text-xs mt-2">{t('summary.returns.sub')}</p>
        </div>

        <div className={`${CARD_WIDTH_CLASS} bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none`}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-stone-300/50 rounded-sm flex items-center justify-center">
              <svg className="w-5 h-5 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-stone-500 text-sm font-bold">{t('summary.returns.annualized')}</p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-stone-500 text-[11px] font-medium">{t('summary.returns.twr')}</p>
              <p className={`text-xl font-bold font-mono ${twrAnnualizedPositive ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
                {formatPercent(twrAnnualized)}
              </p>
            </div>
            <div>
              <p className="text-stone-500 text-[11px] font-medium">{t('summary.returns.correlation')}</p>
              <p className="text-xl font-bold font-mono text-stone-700">
                {formatCorrelation(correlation)}
              </p>
            </div>
          </div>
          <p className="text-stone-500 text-xs mt-2">{t('summary.returns.annualized.sub')}</p>
        </div>
      </div>

      {canScrollRight && (
        <button
          type="button"
          onClick={() => scrollByOneCard(1)}
          aria-label="Następne karty"
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10 w-8 h-12 flex items-center justify-center bg-[#EAE8E0] border border-dotted border-stone-400 rounded-sm text-stone-600 hover:text-[#33332D] hover:bg-stone-300/40 shadow-sm transition-colors"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z" />
          </svg>
        </button>
      )}
    </div>
  )
}

export default Summary
