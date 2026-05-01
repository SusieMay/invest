import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart'
const REQUEST_TIMEOUT_MS = 15000
const REQUEST_DELAY_MS = 400

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type AssetRow = {
  id: string
  ticker: string
  quantity: number
  average_price: number
  current_price: number | null
  owner_id: string | null
}

const detectCurrency = (ticker: string): string => {
  const t = ticker.toUpperCase()
  if (t.endsWith('.WA')) return 'PLN'
  if (t.endsWith('.DE')) return 'EUR'
  if (t.endsWith('.KS') || t.endsWith('.KQ')) return 'KRW'
  return 'USD'
}

const detectAssetType = (ticker: string): string =>
  ticker.toUpperCase().endsWith('.DE') ? 'etf' : 'stock'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchRates(): Promise<{ usdPln: number; eurPln: number; krwPln: number }> {
  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/USD', {
      headers: { 'Accept': 'application/json' },
    })
    if (!resp.ok) return { usdPln: 4.0, eurPln: 4.3, krwPln: 0.003 }
    const data = await resp.json()
    const usdPln = data?.rates?.PLN
    const eurUsd = data?.rates?.EUR
    const krwUsd = data?.rates?.KRW
    const usdPlnVal = typeof usdPln === 'number' && usdPln > 0 ? usdPln : 4.0
    // EUR/PLN = (1/EUR_per_USD) * USD/PLN
    const eurPlnVal = typeof eurUsd === 'number' && eurUsd > 0 ? (1 / eurUsd) * usdPlnVal : 4.3
    // KRW/PLN = USD/PLN / (KRW per USD)
    const krwPlnVal = typeof krwUsd === 'number' && krwUsd > 0 ? usdPlnVal / krwUsd : 0.003
    return { usdPln: usdPlnVal, eurPln: eurPlnVal, krwPln: krwPlnVal }
  } catch {
    return { usdPln: 4.0, eurPln: 4.3, krwPln: 0.003 }
  }
}

async function fetchPrice(ticker: string): Promise<number | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'application/json',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Yahoo Finance returned ${response.status}`)
    }

    const payload = await response.json()
    const price = payload?.chart?.result?.[0]?.meta?.regularMarketPrice

    return typeof price === 'number' && Number.isFinite(price) ? price : null
  } catch (error) {
    console.error(`Price refresh failed for ${ticker}:`, error)
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Missing Supabase environment variables' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: assets, error: assetsError } = await supabase
    .from('assets')
    .select('id, ticker, quantity, average_price, current_price, owner_id')
    .order('created_at', { ascending: true })

  if (assetsError) {
    return new Response(JSON.stringify({ error: assetsError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const assetRows = (assets ?? []) as AssetRow[]

  if (assetRows.length === 0) {
    return new Response(JSON.stringify({ updatedAssets: 0, updatedTickers: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Fetch SPY (S&P 500 ETF proxy) first – matches backfill data which also uses SPY
  const sp500PriceFetched = await fetchPrice('SPY')
  await sleep(REQUEST_DELAY_MS)

  const uniqueTickers = [...new Set(assetRows.map((asset) => asset.ticker))]
  const prices = new Map<string, number>()

  for (const ticker of uniqueTickers) {
    const price = await fetchPrice(ticker)

    if (price != null) {
      prices.set(ticker, price)
    }

    await sleep(REQUEST_DELAY_MS)
  }

  if (prices.size === 0) {
    return new Response(JSON.stringify({ error: 'No prices fetched from Yahoo Finance' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let updatedAssets = 0

  for (const asset of assetRows) {
    const currentPrice = prices.get(asset.ticker)

    if (currentPrice == null) {
      continue
    }

    const { error: updateError } = await supabase
      .from('assets')
      .update({
        current_price: currentPrice,
        currency: detectCurrency(asset.ticker),
      })
      .eq('id', asset.id)

    if (updateError) {
      console.error(`Database update failed for ${asset.ticker}:`, updateError)
      continue
    }

    updatedAssets += 1
  }

  const rates = await fetchRates()

  // Use the price fetched before the loop; if it failed, sp500PriceFetched is null
  const sp500Price = sp500PriceFetched

  // Fetch cumulative realized PnL from realized_trades, grouped per owner
  const { data: realizedRows } = await supabase
    .from('realized_trades')
    .select('profit_pln, owner_id')
  const realizedByOwner = new Map<string | null, number>()
  for (const r of (realizedRows ?? []) as { profit_pln: number | null; owner_id: string | null }[]) {
    const key = r.owner_id ?? null
    realizedByOwner.set(key, (realizedByOwner.get(key) ?? 0) + (r.profit_pln ?? 0))
  }

  // Day boundaries (used for delete + sp500 fallback)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const tomorrowStart = new Date(todayStart)
  tomorrowStart.setDate(tomorrowStart.getDate() + 1)

  // Preserve today's existing sp500_close as fallback when the fresh fetch failed
  let fallbackSp500: number | null = null
  if (sp500Price == null) {
    const { data: todayRows } = await supabase
      .from('portfolio_history')
      .select('sp500_close')
      .gte('created_at', todayStart.toISOString())
      .lt('created_at', tomorrowStart.toISOString())
      .not('sp500_close', 'is', null)
      .limit(1)
    fallbackSp500 = (todayRows?.[0] as { sp500_close: number | null } | undefined)?.sp500_close ?? null
  }

  const sp500Value = sp500Price != null
    ? Math.round(sp500Price * 10000) / 10000
    : fallbackSp500

  // --- Portfolio history: one record per day per owner ---
  const assetsByOwner = new Map<string | null, AssetRow[]>()
  for (const asset of assetRows) {
    const key = asset.owner_id ?? null
    const bucket = assetsByOwner.get(key)
    if (bucket) bucket.push(asset)
    else assetsByOwner.set(key, [asset])
  }

  for (const [ownerId, ownerAssets] of assetsByOwner) {
    let totalValue = 0
    let totalPnl = 0
    let valueStocks = 0
    let valueEtfs = 0
    let pnlStocks = 0
    let pnlEtfs = 0

    for (const asset of ownerAssets) {
      const cp = prices.get(asset.ticker) ?? asset.current_price
      if (cp == null) continue
      const qty = Number(asset.quantity)
      const avg = Number(asset.average_price)
      const cur = detectCurrency(asset.ticker)
      const atype = detectAssetType(asset.ticker)
      const rate = cur === 'PLN' ? 1
        : cur === 'EUR' ? rates.eurPln
        : cur === 'KRW' ? rates.krwPln
        : rates.usdPln

      const valuePln = cp * qty * rate
      const pnlPln = (cp - avg) * qty * rate

      totalValue += valuePln
      totalPnl += pnlPln
      if (atype === 'etf') { valueEtfs += valuePln; pnlEtfs += pnlPln }
      else { valueStocks += valuePln; pnlStocks += pnlPln }
    }

    // Delete existing record(s) for today for this owner, then insert fresh one
    const deleteQuery = supabase
      .from('portfolio_history')
      .delete()
      .gte('created_at', todayStart.toISOString())
      .lt('created_at', tomorrowStart.toISOString())
    if (ownerId == null) {
      await deleteQuery.is('owner_id', null)
    } else {
      await deleteQuery.eq('owner_id', ownerId)
    }

    const realizedPnlTotal = realizedByOwner.get(ownerId) ?? 0

    const record: Record<string, unknown> = {
      total_value: Math.round(totalValue * 10000) / 10000,
      total_pnl: Math.round(totalPnl * 10000) / 10000,
      value_stocks: Math.round(valueStocks * 10000) / 10000,
      value_etfs: Math.round(valueEtfs * 10000) / 10000,
      pnl_stocks: Math.round(pnlStocks * 10000) / 10000,
      pnl_etfs: Math.round(pnlEtfs * 10000) / 10000,
      sp500_close: sp500Value,
      realized_pnl_total: Math.round(realizedPnlTotal * 10000) / 10000,
    }
    if (ownerId != null) record.owner_id = ownerId

    await supabase.from('portfolio_history').insert(record)
  }

  return new Response(JSON.stringify({
    updatedAssets,
    updatedTickers: prices.size,
    usdPln: rates.usdPln,
    eurPln: rates.eurPln,
    krwPln: rates.krwPln,
    refreshedAt: new Date().toISOString(),
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})