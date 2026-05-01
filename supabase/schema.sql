-- ============================================================
-- Investment Dashboard – schemat bazy danych dla Supabase
-- Uruchom poniższy SQL w: Supabase Dashboard → SQL Editor
-- ============================================================

-- Włącz rozszerzenie UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -------------------------------------------------------
-- Tabela: assets
-- Przechowuje aktywa portfela inwestycyjnego.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assets (
    id            UUID            DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id       TEXT            NOT NULL DEFAULT 'default',
    ticker        TEXT            NOT NULL,
    quantity      NUMERIC(20, 8)  NOT NULL CHECK (quantity > 0),
    average_price NUMERIC(20, 8)  NOT NULL CHECK (average_price > 0),
    current_price NUMERIC(20, 8),          -- aktualizowane przez GitHub Actions
    currency      TEXT            NOT NULL DEFAULT 'USD', -- PLN (.WA), EUR (.DE), KRW (.KS/.KQ), USD (NYSE/NASDAQ)
    created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------
-- Tabela: portfolio_history
-- Historia dzienna wartości całego portfela.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.portfolio_history (
    id          UUID           DEFAULT uuid_generate_v4() PRIMARY KEY,
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    total_value NUMERIC(20, 8) NOT NULL CHECK (total_value >= 0)
);

-- -------------------------------------------------------
-- Row Level Security
-- -------------------------------------------------------
ALTER TABLE public.assets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_history ENABLE ROW LEVEL SECURITY;

-- Polityki dla tabeli assets (dostęp anonimowy – klucz anon)
CREATE POLICY "assets_select" ON public.assets FOR SELECT USING (true);
CREATE POLICY "assets_insert" ON public.assets FOR INSERT WITH CHECK (true);
CREATE POLICY "assets_update" ON public.assets FOR UPDATE USING (true);
CREATE POLICY "assets_delete" ON public.assets FOR DELETE USING (true);

-- Polityki dla tabeli portfolio_history
CREATE POLICY "history_select" ON public.portfolio_history FOR SELECT USING (true);
CREATE POLICY "history_insert" ON public.portfolio_history FOR INSERT WITH CHECK (true);
CREATE POLICY "history_update" ON public.portfolio_history FOR UPDATE USING (true);
CREATE POLICY "history_delete" ON public.portfolio_history FOR DELETE USING (true);

-- -------------------------------------------------------
-- Indeksy
-- -------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_assets_ticker     ON public.assets (ticker);
CREATE INDEX IF NOT EXISTS idx_assets_user_id    ON public.assets (user_id);
CREATE INDEX IF NOT EXISTS idx_history_created   ON public.portfolio_history (created_at DESC);

-- -------------------------------------------------------
-- Migracja: uruchom TYLKO jeśli tabela assets już istnieje
-- -------------------------------------------------------
-- ALTER TABLE public.assets
--   ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

-- Migracja: asset_type (stock/etf) - uruchom jeśli kolumna nie istnieje
-- ALTER TABLE public.assets
--   ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'stock';
-- UPDATE public.assets SET asset_type = 'etf' WHERE ticker LIKE '%.DE';

-- Migracja: rozszerzenie portfolio_history o zysk/strata i breakdown
-- ALTER TABLE public.portfolio_history
--   ADD COLUMN IF NOT EXISTS total_pnl   NUMERIC(20,8) NOT NULL DEFAULT 0,
--   ADD COLUMN IF NOT EXISTS value_stocks NUMERIC(20,8) NOT NULL DEFAULT 0,
--   ADD COLUMN IF NOT EXISTS value_etfs  NUMERIC(20,8) NOT NULL DEFAULT 0,
--   ADD COLUMN IF NOT EXISTS pnl_stocks  NUMERIC(20,8) NOT NULL DEFAULT 0,
--   ADD COLUMN IF NOT EXISTS pnl_etfs    NUMERIC(20,8) NOT NULL DEFAULT 0;

-- Migracja: S&P 500 benchmark
-- ALTER TABLE public.portfolio_history
--   ADD COLUMN IF NOT EXISTS sp500_close NUMERIC(20,8);

-- Migracja: skumulowany zrealizowany zysk (z tabeli realized_trades)
-- ALTER TABLE public.portfolio_history
--   ADD COLUMN IF NOT EXISTS realized_pnl_total NUMERIC(20,8) NOT NULL DEFAULT 0;

-- -------------------------------------------------------
-- Tabela: dividends
-- Dywidendy otrzymane od spółek.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dividends (
    id          UUID           DEFAULT uuid_generate_v4() PRIMARY KEY,
    ticker      TEXT           NOT NULL,
    amount_pln  NUMERIC(20, 8) NOT NULL CHECK (amount_pln >= 0),
    year        SMALLINT       NOT NULL CHECK (year >= 1900 AND year <= 2100),
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------
-- Tabela: realized_trades
-- Zrealizowane transakcje (kupno + sprzedaż).
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.realized_trades (
    id          UUID           DEFAULT uuid_generate_v4() PRIMARY KEY,
    ticker      TEXT           NOT NULL,
    quantity    NUMERIC(20, 8) NOT NULL CHECK (quantity > 0),
    buy_price   NUMERIC(20, 8) NOT NULL CHECK (buy_price > 0),
    sell_price  NUMERIC(20, 8) NOT NULL CHECK (sell_price > 0),
    currency    TEXT           NOT NULL DEFAULT 'USD',
    buy_date    DATE           NOT NULL,
    sell_date   DATE           NOT NULL,
    days_held   INTEGER        NOT NULL GENERATED ALWAYS AS (sell_date - buy_date) STORED,
    profit_pln  NUMERIC(20, 8) NOT NULL,
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- RLS dla nowych tabel
ALTER TABLE public.dividends       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.realized_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dividends_select" ON public.dividends FOR SELECT USING (true);
CREATE POLICY "dividends_insert" ON public.dividends FOR INSERT WITH CHECK (true);
CREATE POLICY "dividends_delete" ON public.dividends FOR DELETE USING (true);

CREATE POLICY "trades_select" ON public.realized_trades FOR SELECT USING (true);
CREATE POLICY "trades_insert" ON public.realized_trades FOR INSERT WITH CHECK (true);
CREATE POLICY "trades_delete" ON public.realized_trades FOR DELETE USING (true);
