"""
backfill_sp500.py
-----------------
Jednorazowy skrypt uzupełniający kolumnę sp500_close w tabeli portfolio_history.
Pobiera historyczne ceny zamknięcia SPY z Alpha Vantage (TIME_SERIES_DAILY)
i dopasowuje do istniejących rekordów na podstawie daty.

Wymagane zmienne środowiskowe:
  SUPABASE_URL          – URL projektu Supabase
  SUPABASE_SERVICE_KEY  – klucz service_role z Supabase
  ALPHAVANTAGE_API_KEY  – klucz API z alphavantage.co

Uruchomienie:
  export SUPABASE_SERVICE_KEY="..."
  export ALPHAVANTAGE_API_KEY="..."
  python scripts/backfill_sp500.py
"""

import os
import sys

import requests
from supabase import create_client, Client


SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "https://swrpjlcnkrkzbwrmezwf.supabase.co")
SUPABASE_SERVICE_KEY: str | None = os.environ.get("SUPABASE_SERVICE_KEY")
ALPHAVANTAGE_API_KEY: str = os.environ.get("ALPHAVANTAGE_API_KEY", "")
ALPHAVANTAGE_URL = "https://www.alphavantage.co/query"


def get_supabase_client() -> Client:
    if not SUPABASE_SERVICE_KEY:
        print("BŁĄD: Zmienna SUPABASE_SERVICE_KEY nie jest ustawiona.")
        sys.exit(1)
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def fetch_spy_history() -> dict[str, float]:
    """
    Pobiera historyczne ceny zamknięcia SPY z Alpha Vantage.
    Zwraca dict: { "YYYY-MM-DD": close_price, ... }
    """
    if not ALPHAVANTAGE_API_KEY:
        print("BŁĄD: Zmienna ALPHAVANTAGE_API_KEY nie jest ustawiona.")
        sys.exit(1)

    params = {
        "function": "TIME_SERIES_DAILY",
        "symbol": "SPY",
        "outputsize": "compact",  # ostatnie ~100 dni
        "apikey": ALPHAVANTAGE_API_KEY,
    }
    print("Pobieranie historycznych cen SPY z Alpha Vantage...")
    resp = requests.get(ALPHAVANTAGE_URL, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    if "Note" in data or "Information" in data:
        print(f"BŁĄD API: {data.get('Note') or data.get('Information')}")
        sys.exit(1)

    time_series = data.get("Time Series (Daily)", {})
    if not time_series:
        print("BŁĄD: Brak danych w odpowiedzi Alpha Vantage.")
        sys.exit(1)

    prices: dict[str, float] = {}
    for date_str, ohlcv in time_series.items():
        close = ohlcv.get("4. close")
        if close:
            prices[date_str] = float(close)

    print(f"  Pobrano {len(prices)} dni danych SPY.")
    return prices


def main() -> None:
    supabase = get_supabase_client()
    spy_prices = fetch_spy_history()

    # Pobierz wszystkie rekordy portfolio_history bez sp500_close
    result = supabase.table("portfolio_history") \
        .select("id, created_at, sp500_close") \
        .is_("sp500_close", "null") \
        .order("created_at", desc=False) \
        .execute()

    records = result.data or []
    if not records:
        print("Wszystkie rekordy mają już sp500_close. Nic do zrobienia.")
        return

    print(f"\nZnaleziono {len(records)} rekordów bez sp500_close. Uzupełniam...")

    updated = 0
    for record in records:
        # created_at jest w formacie ISO, np. "2026-05-01T12:34:56+00:00"
        record_date = record["created_at"][:10]  # "YYYY-MM-DD"

        spy_close = spy_prices.get(record_date)
        if spy_close is None:
            # Jeśli brak danych na ten dzień (weekend/święto), szukaj ostatniego dnia handlowego
            sorted_dates = sorted(spy_prices.keys())
            prev_dates = [d for d in sorted_dates if d <= record_date]
            if prev_dates:
                spy_close = spy_prices[prev_dates[-1]]

        if spy_close is not None:
            supabase.table("portfolio_history") \
                .update({"sp500_close": round(spy_close, 4)}) \
                .eq("id", record["id"]) \
                .execute()
            updated += 1
            print(f"  {record_date} → SPY = {spy_close:.2f}")
        else:
            print(f"  {record_date} → brak danych SPY (za wcześnie?)")

    print(f"\nGotowe. Zaktualizowano {updated}/{len(records)} rekordów.")


if __name__ == "__main__":
    main()
