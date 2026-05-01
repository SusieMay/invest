"""
update_portfolio.py
-------------------
Pobiera aktualne ceny rynkowe (głównie z yfinance / Yahoo Finance, z fallbackiem
na Alpha Vantage i Stooq) dla wszystkich tickerów zapisanych w tabeli `assets`,
aktualizuje pole `current_price`, a następnie zapisuje łączną wartość portfela
w tabeli `portfolio_history`.

Wymagane zmienne środowiskowe (ustawiane jako GitHub Secrets):
  SUPABASE_URL            – URL projektu Supabase
  SUPABASE_SERVICE_KEY    – klucz service_role (nie anon!) z Supabase
  ALPHAVANTAGE_API_KEY    – (opcjonalny) klucz API z alphavantage.co dla fallbacku
"""

import os
import sys
import time
from datetime import datetime, timedelta, timezone

import requests
from supabase import create_client, Client

try:
    import yfinance as yf
    _YF_AVAILABLE = True
except ImportError:
    _YF_AVAILABLE = False
    print("[OSTRZEŻENIE] yfinance niedostępne — użyję Alpha Vantage/Stooq")


# ---------------------------------------------------------------------------
# Konfiguracja
# ---------------------------------------------------------------------------
SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "https://swrpjlcnkrkzbwrmezwf.supabase.co")
SUPABASE_SERVICE_KEY: str | None = os.environ.get("SUPABASE_SERVICE_KEY")

# *** Klucze Alpha Vantage (ustaw jako GitHub Secrets) ***
# Jeden klucz = 25 req/dzień. Dwa klucze = 50 req/dzień.
_key1: str = os.environ.get("ALPHAVANTAGE_API_KEY", "")
_key2: str = os.environ.get("ALPHAVANTAGE_API_KEY_2", "")
ALPHAVANTAGE_API_KEYS: list[str] = [k for k in [_key1, _key2] if k]
if not ALPHAVANTAGE_API_KEYS:
    ALPHAVANTAGE_API_KEYS = ["WKLEJ_KLUCZ_TUTAJ"]

ALPHAVANTAGE_URL = "https://www.alphavantage.co/query"
REQUEST_TIMEOUT = 20  # sekund
REQUEST_DELAY = 12.5  # sekund przerwy między żądaniami (free tier: 5 req/min)

HEADERS = {
    "User-Agent": "invest/1.0",
    "Accept": "application/json",
}


# ---------------------------------------------------------------------------
# Pomocnicze funkcje
# ---------------------------------------------------------------------------

def detect_currency(ticker: str) -> str:
    """Zwraca walutę na podstawie tickera.
    .WA = GPW (PLN), .DE = Xetra (EUR), .KS/.KQ = KOSPI/KOSDAQ (KRW), reszta = USD.
    """
    t = ticker.upper()
    if t.endswith(".WA"):
        return "PLN"
    if t.endswith(".DE"):
        return "EUR"
    if t.endswith(".KS") or t.endswith(".KQ"):
        return "KRW"
    return "USD"


def detect_asset_type(ticker: str) -> str:
    """Zwraca typ aktywa: 'etf' dla .DE (Xetra), 'stock' dla pozostałych."""
    return "etf" if ticker.upper().endswith(".DE") else "stock"


def fetch_rates() -> tuple[float, float, float]:
    """Pobiera kursy USD/PLN, EUR/PLN i KRW/PLN. Zwraca (usdpln, eurpln, krwpln)."""
    try:
        resp = requests.get("https://open.er-api.com/v6/latest/USD", timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()["rates"]
        usd_pln = float(data["PLN"])
        eur_usd = float(data["EUR"])  # EUR wyrażone w USD (np. 0.92)
        eur_pln = (1.0 / eur_usd) * usd_pln
        krw_usd = float(data["KRW"])  # ile KRW za 1 USD
        krw_pln = usd_pln / krw_usd
        return usd_pln, eur_pln, krw_pln
    except (requests.RequestException, KeyError, ValueError) as exc:
        print(f"  [OSTRZEŻENIE] Nie można pobrać kursów walut: {exc}")
        return 4.0, 4.3, 0.003  # wartości awaryjne


def get_supabase_client() -> Client:
    if not SUPABASE_SERVICE_KEY:
        print("BŁĄD: Zmienna środowiskowa SUPABASE_SERVICE_KEY nie jest ustawiona.")
        sys.exit(1)
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


_fetch_counter = 0


def fetch_price(ticker: str) -> float | None:
    """
    Pobiera aktualną cenę rynkową z Alpha Vantage (GLOBAL_QUOTE).
    Rotuje klucze API jeśli skonfigurowano więcej niż jeden.
    Zwraca None, jeśli wystąpił błąd lub ticker jest nieznany.
    """
    global _fetch_counter
    api_key = ALPHAVANTAGE_API_KEYS[_fetch_counter % len(ALPHAVANTAGE_API_KEYS)]
    _fetch_counter += 1
    params = {
        "function": "GLOBAL_QUOTE",
        "symbol": ticker,
        "apikey": api_key,
    }
    try:
        resp = requests.get(ALPHAVANTAGE_URL, params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()

        # Wykryj limit API
        if "Note" in data:
            print(f"  [LIMIT API] Alpha Vantage: {data['Note']}")
            return None
        if "Information" in data:
            print(f"  [INFO API] Alpha Vantage: {data['Information']}")
            return None

        price_str = data.get("Global Quote", {}).get("05. price")
        if not price_str:
            print(f"  [OSTRZEŻENIE] Brak ceny dla {ticker} (brak w odpowiedzi)")
            return None

        return float(price_str)
    except (requests.RequestException, KeyError, TypeError, ValueError) as exc:
        print(f"  [OSTRZEŻENIE] Nie można pobrać ceny dla {ticker}: {exc}")
        return None


def fetch_price_stooq(ticker: str) -> float | None:
    """
    Pobiera cenę z Stooq (GPW i inne giełdy europejskie).
    Ticker .WA → Stooq używa samej nazwy (np. XTB.WA → XTB).
    """
    # Stooq ticker: XTB.WA → xtb, ASB.WA → asb
    stooq_ticker = ticker.split(".")[0].lower()
    url = f"https://stooq.com/q/l/?s={stooq_ticker}&f=sd2t2ohlcv&h&e=csv"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        lines = resp.text.strip().split("\n")
        if len(lines) < 2:
            print(f"  [OSTRZEŻENIE] Stooq: brak danych dla {ticker}")
            return None
        # CSV: Symbol,Date,Time,Open,High,Low,Close,Volume
        values = lines[1].split(",")
        close_str = values[6].strip()
        if close_str in ("N/D", ""):
            print(f"  [OSTRZEŻENIE] Stooq: brak ceny zamknięcia dla {ticker}")
            return None
        return float(close_str)
    except (requests.RequestException, IndexError, ValueError) as exc:
        print(f"  [OSTRZEŻENIE] Nie można pobrać ceny z Stooq dla {ticker}: {exc}")
        return None


def fetch_price_yfinance(ticker: str) -> float | None:
    """
    Pobiera aktualną cenę z yfinance (Yahoo Finance).
    Główne źródło — obsługuje US, Xetra (.DE), GPW (.WA) i KOSPI/KOSDAQ (.KS/.KQ).
    Zwraca None, jeśli yfinance niedostępne lub cena nieznana.
    """
    if not _YF_AVAILABLE:
        return None
    try:
        t = yf.Ticker(ticker)
        price: float | None = None
        # fast_info jest najszybsze
        try:
            fi = t.fast_info
            price = fi.get("last_price") if hasattr(fi, "get") else getattr(fi, "last_price", None)
        except Exception:
            price = None
        # fallback: ostatnie zamknięcie z historii śróddziennej
        if price is None or not (isinstance(price, (int, float)) and price > 0):
            hist = t.history(period="1d", interval="1m")
            if hist is not None and not hist.empty:
                price = float(hist["Close"].dropna().iloc[-1])
        if price is not None and isinstance(price, (int, float)) and price > 0:
            return float(price)
    except Exception as exc:
        print(f"  [yfinance] Błąd dla {ticker}: {exc}")
    return None


def fetch_price_auto(ticker: str) -> float | None:
    """
    Główne źródło: yfinance. Jeśli zawiedzie — fallback na Alpha Vantage / Stooq.
    """
    price = fetch_price_yfinance(ticker)
    if price is not None:
        return price
    print(f"  [FALLBACK] {ticker} — yfinance zawiodło, używam Alpha Vantage/Stooq")
    time.sleep(REQUEST_DELAY)
    if ticker.upper().endswith(".WA"):
        return fetch_price_stooq(ticker)
    return fetch_price(ticker)


# ---------------------------------------------------------------------------
# Główna logika
# ---------------------------------------------------------------------------

def main() -> None:
    supabase = get_supabase_client()

    # 1. Pobierz wszystkie aktywa
    result = supabase.table("assets").select("*").execute()
    assets: list[dict] = result.data or []

    if not assets:
        print("Brak aktywów w bazie. Zakończono.")
        return

    print(f"Znaleziono {len(assets)} aktywów.")

    # 2. Pobierz unikalne tickery
    tickers = list({asset["ticker"] for asset in assets})
    print(f"Pobieranie cen dla: {', '.join(tickers)}\n")

    usdpln, eurpln, krwpln = fetch_rates()
    print(f"Kurs USD/PLN: {usdpln:.4f}  EUR/PLN: {eurpln:.4f}  KRW/PLN: {krwpln:.6f}\n")

    # Pobierz cenę S&P 500 (SPY) jako benchmark
    sp500_price = fetch_price_yfinance("SPY") or fetch_price("SPY")
    if sp500_price is not None:
        print(f"  {'S&P 500 (SPY)':12s}  {sp500_price:>12.4f} USD")
    else:
        print("  [OSTRZEŻENIE] Nie udało się pobrać ceny S&P 500 (SPY)")

    prices: dict[str, float] = {}
    for ticker in tickers:
        price = fetch_price_auto(ticker)
        if price is not None:
            prices[ticker] = price
            cur = detect_currency(ticker)
            print(f"  {ticker:12s}  {price:>12.4f} {cur}")

    if not prices:
        print("\nNie udało się pobrać żadnej ceny. Przerywam.")
        sys.exit(1)

    # 3. Zaktualizuj current_price i asset_type w tabeli assets
    print("\nAktualizowanie cen w bazie danych...")
    for asset in assets:
        ticker = asset["ticker"]
        if ticker in prices:
            supabase.table("assets").update({
                "current_price": prices[ticker],
                "currency": detect_currency(ticker),
                "asset_type": detect_asset_type(ticker),
            }).eq("id", asset["id"]).execute()

    # 3b. Skumulowany zrealizowany zysk z zamkniętych transakcji – per właściciel
    realized_result = supabase.table("realized_trades").select("profit_pln, owner_id").execute()
    realized_by_owner: dict[str | None, float] = {}
    for r in (realized_result.data or []):
        if r.get("profit_pln") is None:
            continue
        owner = r.get("owner_id")
        realized_by_owner[owner] = realized_by_owner.get(owner, 0.0) + float(r["profit_pln"])

    # 4. Oblicz wartości i zyski/straty w PLN z podziałem na akcje/ETFy – per właściciel
    now_utc = datetime.now(timezone.utc)
    today_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow_start = today_start + timedelta(days=1)

    # Grupuj aktywa po owner_id, aby zapisać osobną historię dla każdego użytkownika
    assets_by_owner: dict[str | None, list[dict]] = {}
    for asset in assets:
        assets_by_owner.setdefault(asset.get("owner_id"), []).append(asset)

    for owner_id, owner_assets in assets_by_owner.items():
        total_value_pln: float = 0.0
        total_pnl: float = 0.0
        value_stocks: float = 0.0
        value_etfs: float = 0.0
        pnl_stocks: float = 0.0
        pnl_etfs: float = 0.0

        print(f"\n[Portfel] owner_id={owner_id}")
        for asset in owner_assets:
            ticker = asset["ticker"]
            # Priorytet: świeżo pobrana cena > current_price z bazy
            if ticker in prices:
                current_price = prices[ticker]
            elif asset.get("current_price") is not None:
                current_price = float(asset["current_price"])
                print(f"  [FALLBACK] {ticker} — używam poprzedniej ceny z bazy: {current_price}")
            else:
                print(f"  [POMINIĘTO] {ticker} — brak jakiejkolwiek ceny, pomijam")
                continue
            avg_price = float(asset.get("average_price", 0))
            qty = float(asset["quantity"])
            cur = detect_currency(ticker)
            atype = detect_asset_type(ticker)

            value_native = current_price * qty
            cost_native = avg_price * qty
            pnl_native = value_native - cost_native

            if cur == "PLN":
                value_pln = value_native
                pnl_pln = pnl_native
            elif cur == "EUR":
                value_pln = value_native * eurpln
                pnl_pln = pnl_native * eurpln
            elif cur == "KRW":
                value_pln = value_native * krwpln
                pnl_pln = pnl_native * krwpln
            else:
                value_pln = value_native * usdpln
                pnl_pln = pnl_native * usdpln

            total_value_pln += value_pln
            total_pnl += pnl_pln

            if atype == "etf":
                value_etfs += value_pln
                pnl_etfs += pnl_pln
            else:
                value_stocks += value_pln
                pnl_stocks += pnl_pln

            print(f"  {ticker:12s}  [{atype:5s}]  {value_native:>12.4f} {cur}  →  {value_pln:>12.2f} PLN  (P&L: {pnl_pln:+.2f} PLN)")

        realized_pnl_total = realized_by_owner.get(owner_id, 0.0)
        print(f"  Skumulowany zrealizowany zysk: {realized_pnl_total:+,.2f} PLN")

        # 5. Zapisz do portfolio_history (jeden wpis na dzień – nadpisz istniejący) dla tego właściciela
        delete_query = supabase.table("portfolio_history") \
            .delete() \
            .gte("created_at", today_start.isoformat()) \
            .lt("created_at", tomorrow_start.isoformat())
        if owner_id is None:
            delete_query = delete_query.is_("owner_id", "null")
        else:
            delete_query = delete_query.eq("owner_id", owner_id)
        delete_query.execute()

        record = {
            "total_value":        round(total_value_pln, 4),
            "total_pnl":          round(total_pnl, 4),
            "value_stocks":       round(value_stocks, 4),
            "value_etfs":         round(value_etfs, 4),
            "pnl_stocks":         round(pnl_stocks, 4),
            "pnl_etfs":           round(pnl_etfs, 4),
            "sp500_close":        round(sp500_price, 4) if sp500_price is not None else None,
            "realized_pnl_total": round(realized_pnl_total, 4),
            "created_at":         now_utc.isoformat(),
        }
        if owner_id is not None:
            record["owner_id"] = owner_id
        supabase.table("portfolio_history").insert(record).execute()

        print(f"  Łączna wartość portfela: {total_value_pln:,.2f} PLN  (P&L: {total_pnl:+,.2f} PLN)")
        print(f"    Akcje: {value_stocks:,.2f} PLN  (P&L: {pnl_stocks:+,.2f} PLN)")
        print(f"    ETFy:  {value_etfs:,.2f} PLN  (P&L: {pnl_etfs:+,.2f} PLN)")

    print("\nHistoria portfela zaktualizowana pomyślnie.")


if __name__ == "__main__":
    main()
