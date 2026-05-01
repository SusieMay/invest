import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

export type Theme = 'light' | 'dark'
export type Language = 'pl' | 'en'
export type Currency = 'PLN' | 'USD' | 'EUR'

export interface FxRatesLite {
  usdPln: number
  eurPln: number
}

interface SettingsContextValue {
  theme: Theme
  language: Language
  currency: Currency
  setTheme: (t: Theme) => void
  setLanguage: (l: Language) => void
  setCurrency: (c: Currency) => void
  t: (key: TranslationKey) => string
  /** Konwertuje kwotę wyrażoną w PLN na wybraną walutę i formatuje. */
  formatMoney: (amountPln: number, rates: FxRatesLite) => string
}

const STORAGE_KEY = 'dashboard-settings'

const DEFAULTS = {
  theme: 'light' as Theme,
  language: 'pl' as Language,
  currency: 'PLN' as Currency,
}

// ── Translations ────────────────────────────────────────────────
const TRANSLATIONS = {
  pl: {
    'app.title': 'Dashboard Inwestycyjny',
    'header.refresh': 'Odśwież ceny',
    'header.logout': 'Wyloguj',
    'header.autoRefresh': 'Automatyczne odświeżanie danych co 5 min',
    'settings.title': 'Ustawienia',
    'settings.theme': 'Motyw',
    'settings.theme.light': 'Jasny',
    'settings.theme.dark': 'Ciemny',
    'settings.language': 'Język',
    'settings.language.pl': 'Polski',
    'settings.language.en': 'Angielski',
    'settings.currency': 'Waluta',
    'tab.portfolio': 'Portfel',
    'tab.dividends': 'Dywidendy',
    'tab.realized': 'Zrealizowany zysk',
    'tab.history': 'Archiwum',
    'summary.value': 'Wartość portfela',
    'summary.value.sub': 'Wartość rynkowa',
    'summary.cost': 'Zainwestowany kapitał',
    'summary.cost.sub': 'Koszt zakupu',
    'summary.pnl': 'Zysk / Strata',
    'summary.daily': 'Zmiana dzienna',
    'summary.returns': 'Stopa zwrotu',
    'summary.returns.sub': 'Od początku inwestycji',
    'summary.returns.twr': 'TWR',
    'summary.returns.mwr': 'MWR',
    'summary.returns.annualized': 'Stopa zwrotu (roczna)',
    'summary.returns.annualized.sub': 'TWR w skali roku i korelacja z rynkiem',
    'summary.returns.correlation': 'Korelacja z S&P 500',
  },
  en: {
    'app.title': 'Investment Dashboard',
    'header.refresh': 'Refresh prices',
    'header.logout': 'Log out',
    'header.autoRefresh': 'Automatic data refresh every 5 min',
    'settings.title': 'Settings',
    'settings.theme': 'Theme',
    'settings.theme.light': 'Light',
    'settings.theme.dark': 'Dark',
    'settings.language': 'Language',
    'settings.language.pl': 'Polish',
    'settings.language.en': 'English',
    'settings.currency': 'Currency',
    'tab.portfolio': 'Portfolio',
    'tab.dividends': 'Dividends',
    'tab.realized': 'Realized profit',
    'tab.history': 'History',
    'summary.value': 'Portfolio value',
    'summary.value.sub': 'Market value',
    'summary.cost': 'Invested capital',
    'summary.cost.sub': 'Purchase cost',
    'summary.pnl': 'Profit / Loss',
    'summary.daily': 'Daily change',
    'summary.returns': 'Rate of return',
    'summary.returns.sub': 'Since inception',
    'summary.returns.twr': 'TWR',
    'summary.returns.mwr': 'MWR',
    'summary.returns.annualized': 'Rate of return (annualized)',
    'summary.returns.annualized.sub': 'Annualized TWR and correlation with the market',
    'summary.returns.correlation': 'Correlation with S&P 500',
  },
} as const

export type TranslationKey = keyof typeof TRANSLATIONS['pl']

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return {
      theme: parsed.theme === 'dark' ? 'dark' : 'light',
      language: parsed.language === 'en' ? 'en' : 'pl',
      currency: ['PLN', 'USD', 'EUR'].includes(parsed.currency) ? parsed.currency : 'PLN',
    } as typeof DEFAULTS
  } catch {
    return { ...DEFAULTS }
  }
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const initial = loadSettings()
  const [theme, setThemeState] = useState<Theme>(initial.theme)
  const [language, setLanguageState] = useState<Language>(initial.language)
  const [currency, setCurrencyState] = useState<Currency>(initial.currency)

  // Persist + apply theme class to <html>
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, language, currency }))
  }, [theme, language, currency])

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('theme-dark', theme === 'dark')
  }, [theme])

  const setTheme = useCallback((t: Theme) => setThemeState(t), [])
  const setLanguage = useCallback((l: Language) => setLanguageState(l), [])
  const setCurrency = useCallback((c: Currency) => setCurrencyState(c), [])

  const t = useCallback(
    (key: TranslationKey) => TRANSLATIONS[language][key] ?? key,
    [language],
  )

  const formatMoney = useCallback(
    (amountPln: number, rates: FxRatesLite) => {
      let value = amountPln
      if (currency === 'USD') value = rates.usdPln > 0 ? amountPln / rates.usdPln : amountPln
      else if (currency === 'EUR') value = rates.eurPln > 0 ? amountPln / rates.eurPln : amountPln
      const locale = language === 'pl' ? 'pl-PL' : 'en-US'
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
    },
    [currency, language],
  )

  const value: SettingsContextValue = {
    theme,
    language,
    currency,
    setTheme,
    setLanguage,
    setCurrency,
    t,
    formatMoney,
  }

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
