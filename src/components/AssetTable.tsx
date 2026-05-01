import React, { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Asset } from '../types'
import { FxRates, toPLN, formatQuantity } from '../lib/currency'
import Toast from './Toast'

interface Props {
  assets: Asset[]
  onDelete: () => void
  fxRates: FxRates
}

type EditMode = 'buy' | 'sell'
type SortField = 'ticker' | 'quantity' | 'avgPrice' | 'currentPrice' | 'positionValue' | 'pnl'
type SortDir = 'asc' | 'desc'

interface EditState {
  asset: Asset
  mode: EditMode
  quantity: string
  price: string
}

const formatNative = (value: number | null, currency = 'USD') =>
  value != null
    ? new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(value)
    : '—'

const formatPln = (value: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value)

/** Kwota w walucie natywnej; po najechaniu pokazuje przeliczenie na PLN (gdy waluta ≠ PLN). */
function NativeAmount({
  value,
  currency,
  rates,
  prefix = '',
  className = '',
}: {
  value: number | null
  currency: string
  rates: FxRates
  prefix?: string
  className?: string
}) {
  if (value == null) return <span className={className}>—</span>
  const text = `${prefix}${formatNative(value, currency)}`
  if (currency === 'PLN') return <span className={className}>{text}</span>
  const pln = toPLN(value, currency, rates)
  return (
    <span className={`relative group cursor-help ${className}`}>
      <span className="border-b border-dotted border-stone-400/60">{text}</span>
      <span className="pointer-events-none absolute bottom-full right-0 mb-1 hidden group-hover:block whitespace-nowrap bg-[#33332D] text-[#F4F3ED] text-xs px-2 py-1 rounded-sm shadow-sm z-20">
        ≈ {prefix}{formatPln(pln)}
      </span>
    </span>
  )
}

function AssetTable({ assets, onDelete, fxRates }: Props) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(new Set())
  const [editState, setEditState] = useState<EditState | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [sortField, setSortField] = useState<SortField>('ticker')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  // Wspólne propsy dla sortowalnych nagłówków: dostępne z klawiatury + aria-sort.
  const headerProps = (field: SortField) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-sort': (sortField === field
      ? (sortDir === 'asc' ? 'ascending' : 'descending')
      : 'none') as React.AriaAttributes['aria-sort'],
    onClick: () => handleSort(field),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleSort(field)
      }
    },
  })

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className="ml-0.5 text-stone-400 inline-block w-3 text-xs">
      {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </span>
  )

  const sortedAssets = useMemo(() => {
    return [...assets].filter(a => !pendingDelete.has(a.id)).sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      switch (sortField) {
        case 'ticker': return dir * a.ticker.localeCompare(b.ticker)
        case 'quantity': return dir * (a.quantity - b.quantity)
        case 'avgPrice': {
          const avgAPln = toPLN(a.average_price, a.currency ?? 'USD', fxRates)
          const avgBPln = toPLN(b.average_price, b.currency ?? 'USD', fxRates)
          return dir * (avgAPln - avgBPln)
        }
        case 'currentPrice': {
          const currentAPln = toPLN(a.current_price ?? 0, a.currency ?? 'USD', fxRates)
          const currentBPln = toPLN(b.current_price ?? 0, b.currency ?? 'USD', fxRates)
          return dir * (currentAPln - currentBPln)
        }
        case 'positionValue': {
          const valueA = (a.current_price ?? a.average_price) * a.quantity
          const valueB = (b.current_price ?? b.average_price) * b.quantity
          const valueAPln = toPLN(valueA, a.currency ?? 'USD', fxRates)
          const valueBPln = toPLN(valueB, b.currency ?? 'USD', fxRates)
          return dir * (valueAPln - valueBPln)
        }
        case 'pnl': {
          const pnlA = ((a.current_price ?? a.average_price) - a.average_price) * a.quantity
          const pnlB = ((b.current_price ?? b.average_price) - b.average_price) * b.quantity
          const pnlAPln = toPLN(pnlA, a.currency ?? 'USD', fxRates)
          const pnlBPln = toPLN(pnlB, b.currency ?? 'USD', fxRates)
          return dir * (pnlAPln - pnlBPln)
        }
        default: return 0
      }
    })
  }, [assets, sortField, sortDir, fxRates, pendingDelete])

  const handleDeleteRequest = (id: string) => {
    setConfirmId(id)
  }

  const handleDeleteConfirm = async () => {
    if (!confirmId) return
    const id = confirmId
    setDeletingId(id)
    setConfirmId(null)
    // Optimistic UI: ukryj wiersz od razu, przywróć w razie błędu.
    setPendingDelete(prev => new Set(prev).add(id))
    try {
      const { error } = await supabase.from('assets').delete().eq('id', id)
      if (error) throw error
      onDelete()
    } catch (err) {
      console.error('Błąd usuwania:', err)
      setActionError('Nie udało się usunąć aktywa. Spróbuj ponownie.')
      setPendingDelete(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    } finally {
      setDeletingId(null)
    }
  }

  const openEdit = (asset: Asset) => {
    setEditState({ asset, mode: 'buy', quantity: '', price: '' })
    setEditError(null)
  }

  const handleEditSubmit = async () => {
    if (!editState) return
    const qty = parseFloat(editState.quantity)
    const price = parseFloat(editState.price)
    if (isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0) {
      setEditError('Podaj poprawną ilość i cenę (> 0)')
      return
    }

    const { asset, mode } = editState
    let newQuantity: number
    let newAvgPrice: number

    if (mode === 'buy') {
      // Dokupienie: nowa średnia = (stary_koszt + nowy_koszt) / (stara_ilość + nowa_ilość)
      const oldCost = asset.average_price * asset.quantity
      const addCost = price * qty
      newQuantity = asset.quantity + qty
      newAvgPrice = (oldCost + addCost) / newQuantity
    } else {
      // Sprzedaż: ilość się zmniejsza, średnia cena zakupu nie zmienia się
      if (qty > asset.quantity) {
        setEditError(`Nie możesz sprzedać więcej niż posiadasz (${asset.quantity} szt.)`)
        return
      }
      newQuantity = asset.quantity - qty
      newAvgPrice = asset.average_price // średnia się nie zmienia przy sprzedaży
    }

    setEditLoading(true)
    setEditError(null)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const cur = asset.currency ?? 'USD'

      // Zapisz transakcję do archiwum
      await supabase.from('transactions').insert([{
        ticker: asset.ticker,
        type: mode,
        quantity: qty,
        price,
        currency: cur,
        date: today,
        platform: '',
        notes: mode === 'buy' ? 'Dokupienie z portfela' : 'Sprzedaż z portfela',
      }])

      // Przy sprzedaży: zapisz zrealizowany zysk do realized_trades
      if (mode === 'sell') {
        const profitNative = (price - asset.average_price) * qty
        await supabase.from('realized_trades').insert({
          ticker: asset.ticker,
          quantity: qty,
          buy_price: asset.average_price,
          sell_price: price,
          currency: cur,
          buy_date: asset.created_at.slice(0, 10),
          sell_date: today,
          profit_pln: profitNative,
        })
      }

      // Aktualizuj portfel
      if (mode === 'sell' && newQuantity <= 0) {
        // Sprzedaż całości — usuń aktywo
        await supabase.from('assets').delete().eq('id', asset.id)
      } else {
        await supabase.from('assets')
          .update({ quantity: newQuantity, average_price: parseFloat(newAvgPrice.toFixed(4)) })
          .eq('id', asset.id)
      }

      setEditState(null)
      onDelete() // refresh data
    } catch (err) {
      console.error(err)
      setEditError('Błąd zapisu do bazy danych')
    } finally {
      setEditLoading(false)
    }
  }

  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-stone-500 gap-2">
        <svg className="w-10 h-10 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <p className="text-sm">Brak aktywów w portfelu</p>
        <p className="text-xs text-stone-400">Dodaj pierwsze aktywo za pomocą formularza</p>
      </div>
    )
  }

  return (
    <>
      {actionError && (
        <Toast message={actionError} type="error" onClose={() => setActionError(null)} />
      )}
      {confirmId && (
        <div className="fixed inset-0 bg-[#33332D]/40 flex items-center justify-center z-50 px-4">
          <div className="bg-[#EAE8E0] rounded-sm p-6 w-full max-w-sm border border-dotted border-stone-400 shadow-none">
            <h3 className="text-[#33332D] font-bold text-lg mb-2">Usunąć aktywo?</h3>
            <p className="text-stone-500 text-sm mb-6">Ta operacja jest nieodwracalna.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmId(null)}
                className="flex-1 bg-stone-300 hover:bg-stone-400 text-[#33332D] py-2.5 rounded-sm transition-colors text-sm font-medium"
              >
                Anuluj
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="flex-1 bg-[#A83232] hover:bg-[#8B2828] text-[#F4F3ED] py-2.5 rounded-sm transition-colors text-sm font-medium"
              >
                Usuń
              </button>
            </div>
          </div>
        </div>
      )}

      {editState && (
        <div className="fixed inset-0 bg-[#33332D]/40 flex items-center justify-center z-50 px-4">
          <div className="bg-[#EAE8E0] rounded-sm p-6 w-full max-w-sm border border-dotted border-stone-400 shadow-none">
            <h3 className="text-[#33332D] font-bold text-lg mb-1">
              Edytuj: {editState.asset.ticker}
            </h3>
            <p className="text-stone-500 text-xs mb-4">
              Obecna ilość: {editState.asset.quantity} szt. · Śr. cena: {formatNative(editState.asset.average_price, editState.asset.currency ?? 'USD')}
            </p>

            {/* Przełącznik Kup / Sprzedaj */}
            <div className="flex gap-1 bg-stone-300/50 rounded-sm p-1 mb-4">
              <button
                onClick={() => setEditState({ ...editState, mode: 'buy' })}
                className={`flex-1 py-2 rounded-sm text-sm font-medium transition-colors ${
                  editState.mode === 'buy'
                    ? 'bg-[#2D6A4F] text-[#F4F3ED]'
                    : 'text-stone-500 hover:text-[#33332D]'
                }`}
              >
                Dokup
              </button>
              <button
                onClick={() => setEditState({ ...editState, mode: 'sell' })}
                className={`flex-1 py-2 rounded-sm text-sm font-medium transition-colors ${
                  editState.mode === 'sell'
                    ? 'bg-[#A83232] text-[#F4F3ED]'
                    : 'text-stone-500 hover:text-[#33332D]'
                }`}
              >
                Sprzedaj
              </button>
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs text-stone-500 font-medium mb-1 block">Ilość (szt.)</label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  value={editState.quantity}
                  onChange={(e) => setEditState({ ...editState, quantity: e.target.value })}
                  className="w-full bg-[#F4F3ED] border border-dotted border-stone-400 rounded-sm px-3 py-2 text-sm text-[#33332D] focus:outline-none focus:border-[#33332D]"
                  placeholder="np. 5"
                />
              </div>
              <div>
                <label className="text-xs text-stone-500 font-medium mb-1 block">
                  Cena {editState.mode === 'buy' ? 'zakupu' : 'sprzedaży'} ({editState.asset.currency ?? 'USD'})
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  value={editState.price}
                  onChange={(e) => setEditState({ ...editState, price: e.target.value })}
                  className="w-full bg-[#F4F3ED] border border-dotted border-stone-400 rounded-sm px-3 py-2 text-sm text-[#33332D] focus:outline-none focus:border-[#33332D]"
                  placeholder="np. 120.50"
                />
              </div>
            </div>

            {/* Preview */}
            {editState.quantity && editState.price && !isNaN(parseFloat(editState.quantity)) && !isNaN(parseFloat(editState.price)) && (
              <div className="bg-stone-300/30 border border-dotted border-stone-400 rounded-sm p-3 mb-4 text-xs text-stone-600">
                {editState.mode === 'buy' ? (
                  <>
                    <p>Nowa ilość: <span className="font-mono font-medium text-[#33332D]">{(editState.asset.quantity + parseFloat(editState.quantity)).toFixed(2)} szt.</span></p>
                    <p>Nowa śr. cena: <span className="font-mono font-medium text-[#33332D]">
                      {formatNative(
                        (editState.asset.average_price * editState.asset.quantity + parseFloat(editState.price) * parseFloat(editState.quantity)) / (editState.asset.quantity + parseFloat(editState.quantity)),
                        editState.asset.currency ?? 'USD'
                      )}
                    </span></p>
                  </>
                ) : (
                  <>
                    <p>Nowa ilość: <span className="font-mono font-medium text-[#33332D]">{(editState.asset.quantity - parseFloat(editState.quantity)).toFixed(2)} szt.</span></p>
                    <p>Śr. cena zakupu: <span className="font-mono font-medium text-[#33332D]">bez zmian</span></p>
                  </>
                )}
              </div>
            )}

            {editError && (
              <p className="text-[#A83232] text-xs mb-3">{editError}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setEditState(null)}
                className="flex-1 bg-stone-300 hover:bg-stone-400 text-[#33332D] py-2.5 rounded-sm transition-colors text-sm font-medium"
              >
                Anuluj
              </button>
              <button
                onClick={handleEditSubmit}
                disabled={editLoading}
                className={`flex-1 py-2.5 rounded-sm transition-colors text-sm font-medium text-[#F4F3ED] disabled:opacity-50 ${
                  editState.mode === 'buy'
                    ? 'bg-[#2D6A4F] hover:bg-[#245A42]'
                    : 'bg-[#A83232] hover:bg-[#8B2828]'
                }`}
              >
                {editLoading ? 'Zapisuję...' : editState.mode === 'buy' ? 'Dokup' : 'Sprzedaj'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-stone-500 text-left border-perf">
              <th className="pb-3 px-2 font-bold cursor-pointer select-none" {...headerProps('ticker')}>Ticker<SortIcon field="ticker" /></th>
              <th className="pb-3 px-2 font-bold text-right cursor-pointer select-none" {...headerProps('quantity')}>Ilość<SortIcon field="quantity" /></th>
              <th className="pb-3 px-2 font-bold text-right cursor-pointer select-none" {...headerProps('avgPrice')}>Śr. cena zakupu<SortIcon field="avgPrice" /></th>
              <th className="pb-3 px-2 font-bold text-right cursor-pointer select-none" {...headerProps('currentPrice')}>Cena rynkowa<SortIcon field="currentPrice" /></th>
              <th className="pb-3 px-2 font-bold text-right cursor-pointer select-none" {...headerProps('positionValue')}>Wartość pozycji<SortIcon field="positionValue" /></th>
              <th className="pb-3 px-2 font-bold text-right cursor-pointer select-none" {...headerProps('pnl')}>Zysk / Strata<SortIcon field="pnl" /></th>
              <th className="pb-3 px-2 font-bold text-right">Akcje</th>
            </tr>
          </thead>
          <tbody>
            {sortedAssets.map((asset) => {
              const currentPrice = asset.current_price ?? asset.average_price
              const positionValue = currentPrice * asset.quantity
              const pnl = (currentPrice - asset.average_price) * asset.quantity
              const pnlPercent =
                asset.average_price > 0
                  ? ((currentPrice - asset.average_price) / asset.average_price) * 100
                  : 0
              const isPositive = pnl >= 0

              return (
                <tr
                  key={asset.id}
                  className="border-perf hover:bg-stone-200/50 transition-colors"
                >
                  <td className="py-3.5 px-2">
                    <span className="font-bold text-[#33332D] bg-stone-300/50 border border-dotted border-stone-400 rounded-sm px-2 py-0.5 text-xs tracking-wider">
                      {asset.ticker}
                    </span>
                  </td>
                  <td className="py-3.5 px-2 text-right text-stone-600 font-mono">
                    {formatQuantity(asset.quantity)}
                  </td>
                  <td className="py-3.5 px-2 text-right text-stone-600 font-mono">
                    <NativeAmount value={asset.average_price} currency={asset.currency ?? 'USD'} rates={fxRates} />
                  </td>
                  <td className="py-3.5 px-2 text-right font-mono">
                    {asset.current_price != null ? (
                      <NativeAmount value={asset.current_price} currency={asset.currency ?? 'USD'} rates={fxRates} className="text-[#33332D]" />
                    ) : (
                      <span className="text-stone-400 text-xs">Oczekuje aktualizacji</span>
                    )}
                  </td>
                  <td className="py-3.5 px-2 text-right text-[#33332D] font-mono font-medium">
                    <NativeAmount value={positionValue} currency={asset.currency ?? 'USD'} rates={fxRates} />
                  </td>
                  <td className="py-3.5 px-2 text-right">
                    <div className={`flex flex-col items-end ${isPositive ? 'text-[#2D6A4F]' : 'text-[#A83232]'}`}>
                      <NativeAmount
                        value={pnl}
                        currency={asset.currency ?? 'USD'}
                        rates={fxRates}
                        prefix={isPositive ? '+' : ''}
                        className="font-mono font-medium"
                      />
                      <span className="text-xs opacity-75">
                        {isPositive ? '+' : ''}{pnlPercent.toFixed(2)}%
                      </span>
                    </div>
                  </td>
                  <td className="py-3.5 px-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(asset)}
                        className="text-stone-400 hover:text-[#33332D] transition-colors p-1 rounded-sm"
                        aria-label={`Edytuj ${asset.ticker}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteRequest(asset.id)}
                        disabled={deletingId === asset.id}
                        className="text-stone-400 hover:text-[#A83232] disabled:opacity-30 transition-colors p-1 rounded-sm"
                        aria-label={`Usuń ${asset.ticker}`}
                      >
                      {deletingId === asset.id ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      )}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default AssetTable
