export interface Asset {
  id: string
  user_id: string
  ticker: string
  quantity: number
  average_price: number
  current_price: number | null
  currency: string
  asset_type: 'stock' | 'etf'
  created_at: string
}

export interface PortfolioHistory {
  id: string
  created_at: string
  total_value: number
  total_pnl: number
  value_stocks: number
  value_etfs: number
  pnl_stocks: number
  pnl_etfs: number
  sp500_close: number | null
  realized_pnl_total: number | null
}

export interface NewAsset {
  ticker: string
  quantity: number
  average_price: number
}

export interface Dividend {
  id: string
  ticker: string
  amount_pln: number
  year: number
  created_at: string
}

export interface RealizedTrade {
  id: string
  ticker: string
  quantity: number
  buy_price: number
  sell_price: number
  currency: string
  buy_date: string
  sell_date: string
  days_held: number
  profit_pln: number
  created_at: string
}

export interface Transaction {
  id: string
  ticker: string
  type: 'buy' | 'sell'
  quantity: number
  price: number
  currency: string
  date: string
  platform: string
  notes: string
  created_at: string
}

// ── Master Chart / Fundamental Analysis ──────────────────────────────────────

export type IndicatorKey =
  | 'revenue_ttm'
  | 'revenue_est_fy0'
  | 'revenue_est_fy1'
  | 'revenue_est_fy2'
  | 'total_assets'
  | 'ps_ratio'
  | 'ps_ratio_fwd1'
  | 'ps_ratio_fwd2'
  | 'psg_ratio_2y'

export const INDICATOR_LABELS: Record<IndicatorKey, string> = {
  revenue_ttm:     'Revenue (TTM)',
  revenue_est_fy0: 'Revenue Estimates – Current FY',
  revenue_est_fy1: 'Revenue Estimates – Next FY',
  revenue_est_fy2: 'Revenue Estimates – FY+2',
  total_assets:    'Total Assets (Annual)',
  ps_ratio:        'PS Ratio',
  ps_ratio_fwd1:   'PS Ratio (1-Year Forward)',
  ps_ratio_fwd2:   'PS Ratio (2-Year Forward)',
  psg_ratio_2y:    'PSG Ratio (2Y)',
}

/** One merged row on the time axis — fields are undefined when not available for that date */
export interface ChartDataPoint {
  date: string               // "YYYY-MM-DD"
  revenue_ttm?: number
  revenue_est_fy0?: number
  revenue_est_fy0_lo?: number
  revenue_est_fy0_hi?: number
  revenue_est_fy1?: number
  revenue_est_fy1_lo?: number
  revenue_est_fy1_hi?: number
  revenue_est_fy2?: number
  revenue_est_fy2_lo?: number
  revenue_est_fy2_hi?: number
  total_assets?: number
  ps_ratio?: number
  isForecast?: boolean
}

/** Returned by the fetch-fundamentals edge function — never persisted anywhere */
export interface FundamentalData {
  ticker: string
  chartData: ChartDataPoint[]
  ps_ratio_current: number | null
  ps_ratio_fwd1: number | null
  ps_ratio_fwd2: number | null
  psg_ratio_2y: number | null
  marketCap: number | null
  revenueCurrentTTM: number | null
}
