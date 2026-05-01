import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const YAHOO_SUMMARY_URL = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary'
const YAHOO_CHART_URL   = 'https://query1.finance.yahoo.com/v8/finance/chart'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Fetch a Yahoo Finance session cookie + crumb so the API accepts our requests
async function getYahooSession(): Promise<{ cookie: string; crumb: string } | null> {
  try {
    const homeResp = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': YF_UA, 'Accept': 'text/html,*/*' },
      redirect: 'follow',
    })
    // Collect all Set-Cookie values
    const rawCookie = homeResp.headers.get('set-cookie') ?? ''
    const cookie = rawCookie.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ')

    const crumbResp = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: {
        'User-Agent': YF_UA,
        'Accept': '*/*',
        'Cookie': cookie,
      },
    })
    if (!crumbResp.ok) return null
    const crumb = (await crumbResp.text()).trim()
    if (!crumb || crumb.startsWith('<') || crumb.length > 20) return null
    return { cookie, crumb }
  } catch {
    return null
  }
}

interface ChartDataPoint {
  date: string
  revenue_ttm?: number
  revenue_est_fy0?: number; revenue_est_fy0_lo?: number; revenue_est_fy0_hi?: number
  revenue_est_fy1?: number; revenue_est_fy1_lo?: number; revenue_est_fy1_hi?: number
  revenue_est_fy2?: number; revenue_est_fy2_lo?: number; revenue_est_fy2_hi?: number
  total_assets?: number
  ps_ratio?: number
  isForecast?: boolean
}

function tsToDate(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10)
}

function findClosestPrice(
  series: { date: string; price: number }[],
  targetDate: string,
): number | null {
  if (series.length === 0) return null
  const target = new Date(targetDate).getTime()
  let best = series[0]
  let bestDiff = Math.abs(new Date(best.date).getTime() - target)
  for (const p of series) {
    const diff = Math.abs(new Date(p.date).getTime() - target)
    if (diff < bestDiff) { bestDiff = diff; best = p }
  }
  return best.price
}

function yfHeaders(cookie: string): Record<string, string> {
  return {
    'User-Agent': YF_UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com/',
    ...(cookie ? { 'Cookie': cookie } : {}),
  }
}

async function fetchWithRetry(url: string, cookie = ''): Promise<Response> {
  const hdrs = yfHeaders(cookie)
  let resp = await fetch(url, { headers: hdrs })
  if (resp.status === 429) {
    await new Promise(r => setTimeout(r, 1000))
    resp = await fetch(url, { headers: hdrs })
  }
  return resp
}

// Supabase client is initialised but unused here — kept for consistency with other edge functions
function getSupabaseClient() {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return createClient(url, key)
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

  try {
    const body = await request.json()
    const rawTicker = body?.ticker

    if (!rawTicker || typeof rawTicker !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid ticker' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const ticker = rawTicker.trim().toUpperCase()
    if (!/^[A-Z0-9.\-\^]{1,20}$/.test(ticker)) {
      return new Response(JSON.stringify({ error: 'Invalid ticker format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const modules = [
      'financialData',
      'defaultKeyStatistics',
      'incomeStatementHistoryQuarterly',
      'incomeStatementHistory',
      'balanceSheetHistory',
      'earningsTrend',
    ].join(',')

    // Get Yahoo Finance session (cookie + crumb) first
    const session = await getYahooSession()
    const crumbSuffix = session ? `&crumb=${encodeURIComponent(session.crumb)}` : ''
    const cookie = session?.cookie ?? ''

    // Fetch quoteSummary and price history in parallel
    const [summaryResp, chartResp] = await Promise.all([
      fetchWithRetry(`${YAHOO_SUMMARY_URL}/${encodeURIComponent(ticker)}?modules=${modules}${crumbSuffix}`, cookie),
      fetchWithRetry(`${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}?interval=3mo&range=5y${crumbSuffix}`, cookie),
    ])

    if (summaryResp.status === 429) {
      return new Response(JSON.stringify({ error: 'Yahoo Finance rate limit hit, try again in a moment.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!summaryResp.ok) {
      const body = await summaryResp.text().catch(() => '')
      return new Response(JSON.stringify({ error: `Yahoo Finance error: ${summaryResp.status} — ${body.slice(0, 200)}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const summaryJson = await summaryResp.json()
    const chartJson   = chartResp.ok ? await chartResp.json() : null

    const result = summaryJson?.quoteSummary?.result?.[0]
    if (!result) {
      return new Response(JSON.stringify({ error: 'Ticker not found or no fundamental data available.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Extract scalars ───────────────────────────────────────────────────────
    const sharesOutstanding: number | null = result.defaultKeyStatistics?.sharesOutstanding?.raw ?? null
    const marketCap: number | null         = result.financialData?.marketCap?.raw ?? null
    const revenueCurrentTTM: number | null = result.financialData?.totalRevenue?.raw ?? null
    const psRatioCurrent: number | null    = result.defaultKeyStatistics?.priceToSalesRatio?.raw ?? null

    // ── Quarterly income statements ───────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quarterlyIncome: Array<{ endDate: { raw: number }; totalRevenue: { raw: number } }> =
      ((result.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? []) as any[])
        .filter((q: any) => q?.endDate?.raw && q?.totalRevenue?.raw)
        .sort((a: any, b: any) => a.endDate.raw - b.endDate.raw)

    // ── Annual income statements ──────────────────────────────────────────────
    const annualIncome: Array<{ endDate: { raw: number }; totalRevenue: { raw: number } }> =
      ((result.incomeStatementHistory?.incomeStatementHistory ?? []) as any[])
        .filter((q: any) => q?.endDate?.raw && q?.totalRevenue?.raw)
        .sort((a: any, b: any) => a.endDate.raw - b.endDate.raw)

    // ── Annual balance sheet (total assets) ───────────────────────────────────
    const annualBalance: Array<{ endDate: { raw: number }; totalAssets: { raw: number } }> =
      ((result.balanceSheetHistory?.balanceSheetStatements ?? []) as any[])
        .filter((b: any) => b?.endDate?.raw && b?.totalAssets?.raw)
        .sort((a: any, b: any) => a.endDate.raw - b.endDate.raw)

    // ── Earnings trend (revenue estimates) ───────────────────────────────────
    const trend: any[] = result.earningsTrend?.trend ?? []

    // ── Historical prices from chart API ─────────────────────────────────────
    const chartResult = chartJson?.chart?.result?.[0]
    const timestamps: number[] = chartResult?.timestamp ?? []
    const closes: (number | null)[] = chartResult?.indicators?.quote?.[0]?.close ?? []
    const priceSeries: { date: string; price: number }[] = timestamps
      .map((ts, i) => ({ date: tsToDate(ts), price: closes[i] as number }))
      .filter(p => p.price != null && Number.isFinite(p.price))

    // ── Compute Revenue TTM series ────────────────────────────────────────────
    const revenueTTMSeries: { date: string; value: number }[] = []
    for (let i = 3; i < quarterlyIncome.length; i++) {
      const ttm = quarterlyIncome.slice(i - 3, i + 1).reduce((s, q) => s + q.totalRevenue.raw, 0)
      revenueTTMSeries.push({ date: tsToDate(quarterlyIncome[i].endDate.raw), value: ttm })
    }
    // Fallback: if < 4 quarters available, use current TTM from financialData
    if (revenueTTMSeries.length === 0 && revenueCurrentTTM && quarterlyIncome.length > 0) {
      const latest = quarterlyIncome[quarterlyIncome.length - 1]
      revenueTTMSeries.push({ date: tsToDate(latest.endDate.raw), value: revenueCurrentTTM })
    }
    // Add "today" as the most recent TTM point if it's significantly newer than the last series point
    if (revenueCurrentTTM && revenueTTMSeries.length > 0) {
      const today = new Date().toISOString().slice(0, 10)
      const lastDate = revenueTTMSeries[revenueTTMSeries.length - 1].date
      const daysDiff = (new Date(today).getTime() - new Date(lastDate).getTime()) / 86400000
      if (daysDiff > 30) {
        revenueTTMSeries.push({ date: today, value: revenueCurrentTTM })
      }
    }

    // ── Revenue Estimates ─────────────────────────────────────────────────────
    const getEstimate = (period: string): { date: string; value: number; low: number; high: number } | null => {
      const t = trend.find((t: any) => t.period === period)
      const rev = t?.revenueEstimate ?? t?.revenue
      if (!rev?.avg?.raw) return null
      const yearOffset = period === '0y' ? 0 : period === '+1y' ? 1 : 2
      const year = new Date().getFullYear() + yearOffset
      return {
        date:  `${year}-12-31`,
        value: rev.avg.raw,
        low:   rev.low?.raw  ?? rev.avg.raw,
        high:  rev.high?.raw ?? rev.avg.raw,
      }
    }
    const estFY0 = getEstimate('0y')
    const estFY1 = getEstimate('+1y')
    const estFY2 = getEstimate('+2y')

    // ── Total Assets (annual) ─────────────────────────────────────────────────
    const totalAssetsSeries = annualBalance.map(b => ({
      date:  tsToDate(b.endDate.raw),
      value: b.totalAssets.raw,
    }))

    // ── Historical PS Ratio ───────────────────────────────────────────────────
    const psRatioSeries: { date: string; value: number }[] = []
    const seenPsDates = new Set<string>()

    // Annual income → annual PS (older history)
    for (const inc of annualIncome) {
      const date = tsToDate(inc.endDate.raw)
      const rev  = inc.totalRevenue.raw
      if (!sharesOutstanding || rev <= 0 || seenPsDates.has(date)) continue
      const price = findClosestPrice(priceSeries, date)
      if (price == null) continue
      psRatioSeries.push({ date, value: (price * sharesOutstanding) / rev })
      seenPsDates.add(date)
    }

    // Quarterly TTM → quarterly PS (recent, more accurate)
    for (const { date, value: rev } of revenueTTMSeries) {
      if (!sharesOutstanding || rev <= 0 || seenPsDates.has(date)) continue
      const price = findClosestPrice(priceSeries, date)
      if (price == null) continue
      psRatioSeries.push({ date, value: (price * sharesOutstanding) / rev })
      seenPsDates.add(date)
    }

    // Add current PS Ratio as the most recent accurate point
    if (psRatioCurrent) {
      const today = new Date().toISOString().slice(0, 10)
      if (!seenPsDates.has(today)) {
        psRatioSeries.push({ date: today, value: psRatioCurrent })
        seenPsDates.add(today)
      }
    }

    psRatioSeries.sort((a, b) => a.date.localeCompare(b.date))

    // ── Forward PS (scalars only — not added to chart line) ───────────────────
    const psFwd1 = (marketCap && estFY0 && estFY0.value > 0) ? marketCap / estFY0.value : null
    const psFwd2 = (marketCap && estFY1 && estFY1.value > 0) ? marketCap / estFY1.value : null

    // ── PSG Ratio 2Y ──────────────────────────────────────────────────────────
    let psgRatio2Y: number | null = null
    if (psRatioCurrent && estFY2 && revenueCurrentTTM && revenueCurrentTTM > 0 && estFY2.value > 0) {
      const cagr = (Math.pow(estFY2.value / revenueCurrentTTM, 0.5) - 1) * 100
      if (cagr > 0) {
        psgRatio2Y = parseFloat((psRatioCurrent / cagr).toFixed(4))
      }
    }

    // ── Merge all series into a unified chartData timeline ────────────────────
    const dateMap = new Map<string, ChartDataPoint>()
    const getOrCreate = (date: string): ChartDataPoint => {
      if (!dateMap.has(date)) dateMap.set(date, { date })
      return dateMap.get(date)!
    }

    for (const { date, value } of revenueTTMSeries) {
      getOrCreate(date).revenue_ttm = value
    }
    // Annual revenue bars for years not already covered by TTM
    for (const inc of annualIncome) {
      const date = tsToDate(inc.endDate.raw)
      if (!dateMap.has(date)) {
        // Only add if no TTM point within 45 days of this annual date
        const annualTs = new Date(date).getTime()
        const covered = [...dateMap.keys()].some(
          d => Math.abs(new Date(d).getTime() - annualTs) < 45 * 86400000
        )
        if (!covered) getOrCreate(date).revenue_ttm = inc.totalRevenue.raw
      }
    }
    for (const { date, value } of totalAssetsSeries) {
      getOrCreate(date).total_assets = value
    }
    for (const { date, value } of psRatioSeries) {
      getOrCreate(date).ps_ratio = value
    }
    if (estFY0) {
      const pt = getOrCreate(estFY0.date)
      pt.revenue_est_fy0    = estFY0.value
      pt.revenue_est_fy0_lo = estFY0.low
      pt.revenue_est_fy0_hi = estFY0.high
      pt.isForecast = true
    }
    if (estFY1) {
      const pt = getOrCreate(estFY1.date)
      pt.revenue_est_fy1    = estFY1.value
      pt.revenue_est_fy1_lo = estFY1.low
      pt.revenue_est_fy1_hi = estFY1.high
      pt.isForecast = true
    }
    if (estFY2) {
      const pt = getOrCreate(estFY2.date)
      pt.revenue_est_fy2    = estFY2.value
      pt.revenue_est_fy2_lo = estFY2.low
      pt.revenue_est_fy2_hi = estFY2.high
      pt.isForecast = true
    }

    const chartData = [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date))

    return new Response(
      JSON.stringify({
        data: {
          ticker,
          chartData,
          ps_ratio_current: psRatioCurrent,
          ps_ratio_fwd1:    psFwd1,
          ps_ratio_fwd2:    psFwd2,
          psg_ratio_2y:     psgRatio2Y,
          marketCap,
          revenueCurrentTTM,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('fetch-fundamentals error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
