import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function yfHeaders(cookie = ''): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': YF_UA,
    'Accept': 'application/json',
  }
  if (cookie) h['Cookie'] = cookie
  return h
}

// Fetch a Yahoo Finance session cookie + crumb so the API accepts our requests
async function getYahooSession(): Promise<{ cookie: string; crumb: string } | null> {
  try {
    const homeResp = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': YF_UA, 'Accept': 'text/html,*/*' },
      redirect: 'follow',
    })
    const rawCookie = homeResp.headers.get('set-cookie') ?? ''
    const cookie = rawCookie.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ')

    const crumbResp = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': YF_UA, 'Accept': '*/*', 'Cookie': cookie },
    })
    if (!crumbResp.ok) return null
    const crumb = (await crumbResp.text()).trim()
    if (!crumb || crumb.startsWith('<') || crumb.length > 20) return null
    return { cookie, crumb }
  } catch {
    return null
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

// Supabase client kept for consistency with other edge functions
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
    const rawStart = body?.startDate // ISO date string (YYYY-MM-DD), optional

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

    // Determine time window: from startDate (minus a small buffer) to now
    const nowSec = Math.floor(Date.now() / 1000)
    let startSec: number
    if (typeof rawStart === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawStart)) {
      const parsed = Date.parse(rawStart)
      // 3-day buffer before purchase so the buy point isn't on the very edge
      startSec = Math.floor(parsed / 1000) - 3 * 86400
    } else {
      // Default: 1 year back
      startSec = nowSec - 365 * 86400
    }
    if (startSec >= nowSec) startSec = nowSec - 30 * 86400

    const spanDays = (nowSec - startSec) / 86400
    // Keep payload reasonable: daily up to ~2 years, then weekly
    const interval = spanDays <= 730 ? '1d' : '1wk'

    const session = await getYahooSession()
    const crumbSuffix = session ? `&crumb=${encodeURIComponent(session.crumb)}` : ''
    const cookie = session?.cookie ?? ''

    const url = `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}?period1=${startSec}&period2=${nowSec}&interval=${interval}${crumbSuffix}`
    const resp = await fetchWithRetry(url, cookie)

    if (resp.status === 429) {
      return new Response(JSON.stringify({ error: 'Yahoo Finance rate limit hit, try again in a moment.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '')
      return new Response(JSON.stringify({ error: `Yahoo Finance error: ${resp.status} — ${txt.slice(0, 200)}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const json = await resp.json()
    const result = json?.chart?.result?.[0]
    const timestamps: number[] = result?.timestamp ?? []
    const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? []

    if (!timestamps.length || !closes.length) {
      return new Response(JSON.stringify({ error: 'No price history available for this ticker.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const series: { date: string; close: number }[] = []
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i]
      if (typeof c === 'number' && Number.isFinite(c)) {
        series.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close: Math.round(c * 10000) / 10000 })
      }
    }

    const currency: string = result?.meta?.currency ?? ''

    return new Response(JSON.stringify({ ticker, currency, interval, series }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: `Unexpected error: ${(error as Error).message}` }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
