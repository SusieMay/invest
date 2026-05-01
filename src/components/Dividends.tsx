import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { Dividend } from '../types'

const COLORS = ['#57534E', '#78716C', '#A83232', '#8B6914', '#2D6A4F', '#4A5568', '#92400E']

const formatPLN = (v: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(v)

const currentYear = new Date().getFullYear()

type DivSortField = 'ticker' | 'year' | 'amount'
type DivSortDir = 'asc' | 'desc'

function Dividends() {
  const [dividends, setDividends] = useState<Dividend[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // form
  const [ticker, setTicker] = useState('')
  const [amountPln, setAmountPln] = useState('')
  const [year, setYear] = useState(String(currentYear))
  const [formError, setFormError] = useState<string | null>(null)
  const [formLoading, setFormLoading] = useState(false)
  const [formSuccess, setFormSuccess] = useState(false)

  // sort
  const [divSortField, setDivSortField] = useState<DivSortField>('year')
  const [divSortDir, setDivSortDir] = useState<DivSortDir>('desc')

  const handleDivSort = (field: DivSortField) => {
    if (divSortField === field) setDivSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setDivSortField(field); setDivSortDir('desc') }
  }

  const DivSortIcon = ({ field }: { field: DivSortField }) => (
    <span className="ml-0.5 text-stone-400 inline-block w-3 text-xs">
      {divSortField === field ? (divSortDir === 'asc' ? '↑' : '↓') : ''}
    </span>
  )

  const fetchDividends = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('dividends')
      .select('*')
      .order('year', { ascending: false })
      .order('created_at', { ascending: false })
    setDividends(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchDividends() }, [fetchDividends])

  // Aggregacja dywidend wg roku dla wykresu
  const chartData = Object.values(
    dividends.reduce<Record<number, { year: number; total: number }>>((acc, d) => {
      if (!acc[d.year]) acc[d.year] = { year: d.year, total: 0 }
      acc[d.year].total += d.amount_pln
      return acc
    }, {})
  ).sort((a, b) => a.year - b.year)

  const totalDividends = dividends.reduce((s, d) => s + d.amount_pln, 0)

  const sortedDividends = useMemo(() => {
    return [...dividends].sort((a, b) => {
      const dir = divSortDir === 'asc' ? 1 : -1
      switch (divSortField) {
        case 'ticker': return dir * a.ticker.localeCompare(b.ticker)
        case 'year': return dir * (a.year - b.year)
        case 'amount': return dir * (a.amount_pln - b.amount_pln)
        default: return 0
      }
    })
  }, [dividends, divSortField, divSortDir])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const t = ticker.trim().toUpperCase()
    const amount = parseFloat(amountPln)
    const y = parseInt(year, 10)

    if (!t) { setFormError('Podaj ticker spółki.'); return }
    if (isNaN(amount) || amount <= 0) { setFormError('Kwota musi być liczbą dodatnią.'); return }
    if (isNaN(y) || y < 1900 || y > 2100) { setFormError('Podaj prawidłowy rok.'); return }

    setFormLoading(true)
    setFormError(null)
    const { error } = await supabase.from('dividends').insert([{ ticker: t, amount_pln: amount, year: y }])
    setFormLoading(false)
    if (error) { setFormError('Błąd zapisu. Spróbuj ponownie.'); return }
    setTicker(''); setAmountPln(''); setYear(String(currentYear))
    setFormSuccess(true)
    setTimeout(() => setFormSuccess(false), 3000)
    fetchDividends()
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    await supabase.from('dividends').delete().eq('id', id)
    setDeletingId(null)
    fetchDividends()
  }

  return (
    <div className="space-y-6">
      {/* Summary card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
          <p className="text-stone-500 text-sm mb-1">Łączne dywidendy</p>
          <p className="text-2xl font-bold text-[#2D6A4F] font-mono">{formatPLN(totalDividends)}</p>
        </div>
        <div className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
          <p className="text-stone-500 text-sm mb-1">Liczba wypłat</p>
          <p className="text-2xl font-bold text-[#33332D] font-mono">{dividends.length}</p>
        </div>
        <div className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
          <p className="text-stone-500 text-sm mb-1">Rok bieżący</p>
          <p className="text-2xl font-bold text-[#33332D] font-mono">
            {formatPLN(dividends.filter(d => d.year === currentYear).reduce((s, d) => s + d.amount_pln, 0))}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Wykres */}
        <div className="xl:col-span-2 bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
          <h2 className="text-base font-bold text-[#33332D] mb-1">Dywidendy wg roku</h2>
          <p className="text-xs text-stone-500 mb-4">Łączna kwota w PLN</p>
          {chartData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-stone-500 gap-2">
              <svg className="w-10 h-10 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-sm">Brak danych – dodaj pierwszą dywidendę</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-stone-300))" />
                <XAxis dataKey="year" stroke="rgb(var(--c-line))" tick={{ fill: 'rgb(var(--c-stone-500))', fontSize: 11 }} tickLine={false} />
                <YAxis
                  stroke="rgb(var(--c-line))"
                  tick={{ fill: 'rgb(var(--c-stone-500))', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  width={50}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: 'rgb(var(--c-surface))', border: '1px dotted rgb(var(--c-line))', borderRadius: '2px', color: 'rgb(var(--c-ink))', boxShadow: 'none', fontFamily: 'IBM Plex Mono, monospace' }}
                  formatter={(v: number) => [formatPLN(v), 'Dywidendy']}
                  labelStyle={{ color: 'rgb(var(--c-stone-500))', marginBottom: 4 }}
                />
                <Bar dataKey="total" radius={[2, 2, 0, 0]}>
                  {chartData.map((_e, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Formularz dodawania */}
        <div className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
          <h2 className="text-base font-bold text-[#33332D] mb-1">Dodaj dywidendę</h2>
          <p className="text-xs text-stone-500 mb-5">Wpisz otrzymaną wypłatę</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-stone-600 mb-1.5">Ticker</label>
              <input
                value={ticker}
                onChange={e => setTicker(e.target.value.toUpperCase())}
                placeholder="np. XTB.WA, NVO"
                maxLength={20}
                className="w-full bg-[#F4F3ED] text-[#33332D] placeholder-stone-400 border border-dotted border-stone-400 rounded-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-stone-500 transition-all font-mono"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-stone-600 mb-1.5">Kwota (PLN)</label>
              <input
                type="number"
                value={amountPln}
                onChange={e => setAmountPln(e.target.value)}
                placeholder="np. 250.00"
                min="0"
                step="any"
                className="w-full bg-[#F4F3ED] text-[#33332D] placeholder-stone-400 border border-dotted border-stone-400 rounded-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-stone-500 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-stone-600 mb-1.5">Rok</label>
              <input
                type="number"
                value={year}
                onChange={e => setYear(e.target.value)}
                min="1900"
                max="2100"
                className="w-full bg-[#F4F3ED] text-[#33332D] placeholder-stone-400 border border-dotted border-stone-400 rounded-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-stone-500 transition-all"
              />
            </div>
            {formError && (
              <div className="flex items-start gap-2 bg-[#A83232]/10 border border-dotted border-[#A83232]/40 rounded-sm px-3 py-2.5">
                <p className="text-[#A83232] text-sm">{formError}</p>
              </div>
            )}
            {formSuccess && (
              <div className="flex items-center gap-2 bg-[#2D6A4F]/10 border border-dotted border-[#2D6A4F]/40 rounded-sm px-3 py-2.5">
                <p className="text-[#2D6A4F] text-sm">Dywidenda dodana!</p>
              </div>
            )}
            <button
              type="submit"
              disabled={formLoading}
              className="w-full bg-[#2D6A4F] hover:bg-[#1B4332] disabled:opacity-50 text-[#F4F3ED] font-bold py-3 rounded-sm transition-colors flex items-center justify-center gap-2"
            >
              {formLoading ? 'Zapisywanie...' : '+ Dodaj dywidendę'}
            </button>
          </form>
        </div>
      </div>

      {/* Tabela dywidend */}
      <div className="bg-[#EAE8E0] rounded-sm p-6 border border-dotted border-stone-400 shadow-none">
        <h2 className="text-base font-bold text-[#33332D] mb-4">Historia dywidend</h2>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
          </div>
        ) : dividends.length === 0 ? (
          <p className="text-stone-500 text-sm text-center py-8">Brak wpisów</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[400px]">
              <thead>
                <tr className="text-stone-500 text-left border-perf">
                  <th className="pb-3 px-2 font-bold cursor-pointer select-none" onClick={() => handleDivSort('ticker')}>Ticker<DivSortIcon field="ticker" /></th>
                  <th className="pb-3 px-2 font-bold text-right cursor-pointer select-none" onClick={() => handleDivSort('year')}>Rok<DivSortIcon field="year" /></th>
                  <th className="pb-3 px-2 font-bold text-right cursor-pointer select-none" onClick={() => handleDivSort('amount')}>Kwota (PLN)<DivSortIcon field="amount" /></th>
                  <th className="pb-3 px-2 font-bold text-right">Akcje</th>
                </tr>
              </thead>
              <tbody>
                {sortedDividends.map(d => (
                  <tr key={d.id} className="border-perf hover:bg-stone-200/50 transition-colors">
                    <td className="py-3 px-2">
                      <span className="font-bold text-[#33332D] bg-[#2D6A4F]/10 border border-dotted border-[#2D6A4F]/30 rounded-sm px-2 py-0.5 text-xs font-mono">
                        {d.ticker}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-right text-stone-600">{d.year}</td>
                    <td className="py-3 px-2 text-right font-mono text-[#2D6A4F] font-medium">{formatPLN(d.amount_pln)}</td>
                    <td className="py-3 px-2 text-right">
                      <button
                        onClick={() => handleDelete(d.id)}
                        disabled={deletingId === d.id}
                        className="text-stone-400 hover:text-[#A83232] disabled:opacity-30 transition-colors p-1 rounded-sm"
                      >
                        {deletingId === d.id ? (
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default Dividends
