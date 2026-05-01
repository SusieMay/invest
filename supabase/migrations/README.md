# Migracje Supabase

Pliki w tym katalogu są **przygotowawcze** — uruchamiasz je ręcznie w
Supabase Dashboard → SQL Editor. Nie są wpięte w automatyczny deploy.

## 0001_auth_and_rls.sql — prawdziwe RLS per użytkownik

Domyślnie aplikacja używa klucza `anon` + bramki hasłem
(`VITE_AUTH_PASSWORD`), a polityki RLS w `schema.sql` są otwarte
(`USING (true)`). To wygodne dla jednego użytkownika, ale każdy z
kluczem anon ma pełny dostęp do danych.

Migracja `0001` przełącza bazę na RLS oparte o `auth.uid()`, czyli
dostęp tylko do własnych wierszy.

### ⚠️ Zanim uruchomisz

Ta zmiana **zablokuje działającą aplikację**, dopóki frontend nie
loguje się przez Supabase Auth. Kolejność wdrożenia:

1. Włącz logowanie w aplikacji przez Supabase Auth
   (`supabase.auth.signInWithPassword(...)` zamiast obecnej bramki
   `VITE_AUTH_PASSWORD` w `src/components/Auth.tsx`).
2. Utwórz konto użytkownika (Dashboard → Authentication → Users)
   i sprawdź jego `id` (`SELECT id, email FROM auth.users;`).
3. W pliku migracji odkomentuj sekcję `UPDATE ... SET owner_id = ...`
   i wstaw to `id`, aby przypisać istniejące dane do konta.
4. Uruchom całą migrację w SQL Editor.
5. (Opcjonalnie) odkomentuj `ALTER COLUMN owner_id SET NOT NULL`.

### Co z GitHub Actions?

Skrypty w `scripts/` (backup, update_portfolio, restore) używają
klucza `service_role`, który **omija RLS**, więc działają dalej.
Jeśli włączysz kolumny `owner_id NOT NULL`, ustaw `owner_id` również
w tych skryptach przy zapisie danych.
