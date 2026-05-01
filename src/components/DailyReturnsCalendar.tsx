import React, { useMemo, useState } from 'react'
import { PortfolioHistory } from '../types'

interface Props {
  history: PortfolioHistory[]
  /** Aktualna, żywa wartość portfela (PLN) – nadpisuje migawkę dzisiejszego dnia,
   *  żeby wynik zgadzał się z kartą "Zmiana dzienna". */
  liveTotalValue?: number
}

const WEEKDAYS = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nie']
const MONTHS = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

/** Zwraca indeks kolumny (0 = poniedziałek ... 6 = niedziela) dla obiektu Date. */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}

const plnFmt = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
})

/**
 * Kalendarz dziennych wyników portfela – zielone kwadraty w dni na plus,
 * czerwone w dni na minus. Dzienny wynik liczony jako zmiana wartości portfela
 * (total_value) względem poprzedniego dnia z danymi – ta sama metryka co karta
 * "Zmiana dzienna". Dla dzisiejszego dnia używana jest żywa wartość (liveTotalValue),
 * żeby nie polegać na potencjalnie nieaktualnej migawce sprzed ostatniego odświeżenia.
 */
function DailyReturnsCalendar({ history, liveTotalValue }: Props) {
  // Mapa: data (YYYY-MM-DD) -> dzienny wynik (zmiana total_value dzień do dnia)
  const { returns, months } = useMemo(() => {
    // Deduplikacja – ostatni wpis z każdego dnia
    const byDayValue = new Map<string, number>()
    for (const h of history) {
      byDayValue.set(h.created_at.slice(0, 10), h.total_value)
    }

    const today = new Date().toISOString().slice(0, 10)
    if (liveTotalValue !== undefined) {
      byDayValue.set(today, liveTotalValue)
    }

    const days = Array.from(byDayValue.keys()).sort()

    const returns = new Map<string, number>()
    let prevValue: number | null = null
    for (const day of days) {
      const value = byDayValue.get(day)!
      if (prevValue !== null) {
        returns.set(day, value - prevValue)
      }
      prevValue = value
    }

    // Lista dostępnych miesięcy (rosnąco) do nawigacji
    const monthSet = new Set<string>()
    for (const day of days) monthSet.add(day.slice(0, 7))
    const months = Array.from(monthSet).sort()

    return { returns, months }
  }, [history, liveTotalValue])

  const [monthIdx, setMonthIdx] = useState(() => Math.max(0, months.length - 1))

  // Klamruj indeks gdy zmieni się liczba miesięcy
  const safeIdx = Math.min(monthIdx, Math.max(0, months.length - 1))
  const currentMonth = months[safeIdx] // 'YYYY-MM'

  const maxAbs = useMemo(() => {
    let m = 0
    for (const v of returns.values()) m = Math.max(m, Math.abs(v))
    return m || 1
  }, [returns])

  const monthTotal = useMemo(() => {
    if (!currentMonth) return 0
    let sum = 0
    for (const [day, v] of returns) {
      if (day.slice(0, 7) === currentMonth) sum += v
    }
    return sum
  }, [returns, currentMonth])

  if (!currentMonth) {
    return (
      <div className="text-center text-xs text-stone-500 py-6">
        Brak danych historycznych
      </div>
    )
  }

  const [year, month] = currentMonth.split('-').map(Number)
  const firstOfMonth = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const leadingBlanks = mondayIndex(firstOfMonth)

  // Buduj siatkę komórek (null = pusty placeholder przed 1. dniem)
  const cells: (number | null)[] = []
  for (let i = 0; i < leadingBlanks; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const cellStyle = (val: number | undefined): React.CSSProperties => {
    if (val === undefined) {
      return { backgroundColor: 'rgb(var(--c-line) / 0.25)' }
    }
    if (val === 0) {
      return { backgroundColor: 'rgb(var(--c-line) / 0.4)' }
    }
    const intensity = 0.45 + 0.55 * Math.min(1, Math.abs(val) / maxAbs)
    return val > 0
      ? { backgroundColor: `rgba(22, 163, 74, ${intensity.toFixed(2)})` }
      : { backgroundColor: `rgba(225, 29, 46, ${intensity.toFixed(2)})` }
  }

  return (
    <div className="mt-6 pt-5 border-t border-dotted border-stone-400">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-[#33332D]">Kalendarz wyników</h3>
          <p className="text-[11px] text-stone-500 mt-0.5">Dzienny wynik portfela</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonthIdx(Math.max(0, safeIdx - 1))}
            disabled={safeIdx <= 0}
            className="p-1 rounded-sm text-stone-500 hover:text-[#33332D] hover:bg-stone-300/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Poprzedni miesiąc"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-xs font-semibold text-[#33332D] tabular-nums min-w-[110px] text-center">
            {MONTHS[month - 1]} {year}
          </span>
          <button
            type="button"
            onClick={() => setMonthIdx(Math.min(months.length - 1, safeIdx + 1))}
            disabled={safeIdx >= months.length - 1}
            className="p-1 rounded-sm text-stone-500 hover:text-[#33332D] hover:bg-stone-300/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Następny miesiąc"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-[10px] font-medium text-stone-500">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`b-${i}`} className="aspect-square" />
          }
          const isWeekend = i % 7 >= 5
          const dateStr = `${currentMonth}-${String(day).padStart(2, '0')}`
          const val = returns.get(dateStr)
          if (isWeekend) {
            return (
              <div
                key={dateStr}
                title={`${dateStr}: weekend`}
                style={{ backgroundColor: 'rgb(var(--c-line) / 0.2)' }}
                className="aspect-square rounded-[3px] flex items-center justify-center cursor-default"
              >
                <span className="text-[10px] font-medium tabular-nums text-stone-400">{day}</span>
              </div>
            )
          }
          const title =
            val === undefined
              ? `${dateStr}: brak danych`
              : `${dateStr}: ${val >= 0 ? '+' : ''}${plnFmt.format(val)}`
          return (
            <div
              key={dateStr}
              title={title}
              style={cellStyle(val)}
              className="aspect-square rounded-[3px] flex items-center justify-center transition-transform hover:scale-110 hover:ring-1 hover:ring-stone-500/40 cursor-default"
            >
              <span
                className={`text-[10px] font-medium tabular-nums ${
                  val !== undefined ? 'text-white/90' : 'text-stone-500'
                }`}
              >
                {day}
              </span>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between mt-3 text-[11px]">
        <div className="flex items-center gap-3 text-stone-500">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: 'rgb(22, 163, 74)' }} />
            zysk
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: 'rgb(225, 29, 46)' }} />
            strata
          </span>
        </div>
        <span
          className={`font-semibold tabular-nums ${
            monthTotal > 0 ? 'text-[#16A34A]' : monthTotal < 0 ? 'text-[#E11D2E]' : 'text-stone-500'
          }`}
        >
          {monthTotal >= 0 ? '+' : ''}
          {plnFmt.format(monthTotal)}
        </span>
      </div>
    </div>
  )
}

export default DailyReturnsCalendar
