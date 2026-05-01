-- ============================================================
-- Migracja 0001 — Supabase Auth + Row Level Security per użytkownik
-- ============================================================
--
-- ⚠️  PLIK PRZYGOTOWAWCZY — NIE URUCHAMIAJ NA PRODUKCJI BEZ PRZECZYTANIA
--     README w tym katalogu.
--
-- Obecna aplikacja korzysta z klucza anon i prostej bramki hasłem
-- (VITE_AUTH_PASSWORD) — wszystkie polityki RLS są ustawione na
-- USING (true), więc każdy z kluczem anon ma pełny dostęp.
--
-- Ta migracja zamienia to na prawdziwe RLS oparte o auth.uid().
-- URUCHOM JĄ DOPIERO GDY frontend loguje się przez Supabase Auth
-- (supabase.auth.signInWithPassword / OTP), inaczej zablokujesz
-- działającą aplikację (klient anon straci dostęp do danych).
--
-- Skrypty serwerowe (backup/update/restore) używają klucza
-- service_role, który omija RLS — będą działać dalej.
--
-- Uruchom w: Supabase Dashboard → SQL Editor (jako pojedynczą transakcję).
-- ============================================================

BEGIN;

-- -------------------------------------------------------
-- 1. Kolumny właściciela (owner_id) powiązane z auth.users
-- -------------------------------------------------------
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users (id) ON DELETE CASCADE;

ALTER TABLE public.portfolio_history
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users (id) ON DELETE CASCADE;

ALTER TABLE public.dividends
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users (id) ON DELETE CASCADE;

ALTER TABLE public.realized_trades
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users (id) ON DELETE CASCADE;

-- -------------------------------------------------------
-- 2. Przypisz istniejące dane do konkretnego użytkownika
--    Podmień UUID poniżej na id swojego konta z tabeli auth.users
--    (SELECT id, email FROM auth.users;).
-- -------------------------------------------------------
-- UPDATE public.assets           SET owner_id = '00000000-0000-0000-0000-000000000000' WHERE owner_id IS NULL;
-- UPDATE public.portfolio_history SET owner_id = '00000000-0000-0000-0000-000000000000' WHERE owner_id IS NULL;
-- UPDATE public.dividends        SET owner_id = '00000000-0000-0000-0000-000000000000' WHERE owner_id IS NULL;
-- UPDATE public.realized_trades  SET owner_id = '00000000-0000-0000-0000-000000000000' WHERE owner_id IS NULL;

-- Po uzupełnieniu danych można wymusić NOT NULL:
-- ALTER TABLE public.assets            ALTER COLUMN owner_id SET NOT NULL;
-- ALTER TABLE public.portfolio_history ALTER COLUMN owner_id SET NOT NULL;
-- ALTER TABLE public.dividends         ALTER COLUMN owner_id SET NOT NULL;
-- ALTER TABLE public.realized_trades   ALTER COLUMN owner_id SET NOT NULL;

-- Domyślnie ustawiaj owner_id na zalogowanego użytkownika przy INSERT.
ALTER TABLE public.assets            ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.portfolio_history ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.dividends         ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.realized_trades   ALTER COLUMN owner_id SET DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS idx_assets_owner   ON public.assets (owner_id);
CREATE INDEX IF NOT EXISTS idx_history_owner  ON public.portfolio_history (owner_id);
CREATE INDEX IF NOT EXISTS idx_dividends_owner ON public.dividends (owner_id);
CREATE INDEX IF NOT EXISTS idx_trades_owner   ON public.realized_trades (owner_id);

-- -------------------------------------------------------
-- 3. Usuń otwarte polityki USING (true)
-- -------------------------------------------------------
DROP POLICY IF EXISTS "assets_select" ON public.assets;
DROP POLICY IF EXISTS "assets_insert" ON public.assets;
DROP POLICY IF EXISTS "assets_update" ON public.assets;
DROP POLICY IF EXISTS "assets_delete" ON public.assets;

DROP POLICY IF EXISTS "history_select" ON public.portfolio_history;
DROP POLICY IF EXISTS "history_insert" ON public.portfolio_history;
DROP POLICY IF EXISTS "history_update" ON public.portfolio_history;
DROP POLICY IF EXISTS "history_delete" ON public.portfolio_history;

DROP POLICY IF EXISTS "dividends_select" ON public.dividends;
DROP POLICY IF EXISTS "dividends_insert" ON public.dividends;
DROP POLICY IF EXISTS "dividends_delete" ON public.dividends;

DROP POLICY IF EXISTS "trades_select" ON public.realized_trades;
DROP POLICY IF EXISTS "trades_insert" ON public.realized_trades;
DROP POLICY IF EXISTS "trades_delete" ON public.realized_trades;

-- -------------------------------------------------------
-- 4. Nowe polityki: dostęp tylko do własnych wierszy (auth.uid())
-- -------------------------------------------------------
CREATE POLICY "assets_owner_all" ON public.assets
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "history_owner_all" ON public.portfolio_history
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "dividends_owner_all" ON public.dividends
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "trades_owner_all" ON public.realized_trades
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

COMMIT;
