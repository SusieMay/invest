/**
 * Obliczanie TWR (Time-Weighted Return) i MWR (Money-Weighted Return / XIRR)
 * na podstawie dziennych wycen portfela i przepływów gotówki (zakupy/sprzedaże).
 */

export interface CashFlow {
  /** Data w formacie YYYY-MM-DD */
  date: string
  /** Kapitał wpłacony do portfela: dodatni = zakup (wpłata), ujemny = sprzedaż (wypłata) */
  amount: number
}

export interface ValuationPoint {
  /** Data w formacie YYYY-MM-DD */
  date: string
  value: number
}

export interface PortfolioSnapshot {
  /** Data w formacie YYYY-MM-DD */
  date: string
  /** Wartość portfela w PLN */
  value: number
  /** Koszt nabycia trzymanych pozycji w PLN (total_value − total_pnl) */
  cost: number
  /** Skumulowany zrealizowany zysk w PLN (realized_pnl_total) */
  realized: number
  /**
   * Zmiana kosztu nabycia wynikająca wyłącznie z ruchu kursów walut od poprzedniej
   * migawki. Koszt jest zapisywany w PLN, więc bez tej korekty różnica kursowa na
   * kapitale wyglądałaby jak wpłata lub wypłata.
   */
  fxCostDrift?: number
}

/**
 * Odtwarza przepływy gotówki z samych migawek portfela, zamiast z dat transakcji.
 *
 * Data transakcji to dzień zakupu na giełdzie, a nie dzień, w którym pozycja trafiła
 * do portfolio_history — wpis do aplikacji potrafi być spóźniony o dni albo lata.
 * Przy takiej rozbieżności TWR widzi najpierw duży spadek (wpłata bez wzrostu wartości),
 * a potem duży wzrost (wzrost wartości bez wpłaty). Iloczyn takiej pary jest zawsze
 * mniejszy od 1, więc każdy zakup zaniżał wynik, nawet jeśli nic nie stracił.
 *
 * Koszt nabycia rośnie w dokładnie tej samej migawce, w której rośnie wartość, więc:
 *   przepływ = Δkoszt − Δzrealizowany − dryf_kursowy
 * Przy zakupie Δkoszt to kwota zakupu. Przy sprzedaży koszt spada o koszt sprzedanych
 * sztuk, a zrealizowany zysk rośnie o wynik transakcji — ich różnica daje przychód
 * ze sprzedaży ze znakiem minus, czyli wypłatę.
 */
export function deriveCashFlows(snapshots: PortfolioSnapshot[]): CashFlow[] {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))
  const flows: CashFlow[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    const amount =
      curr.cost - prev.cost - (curr.realized - prev.realized) - (curr.fxCostDrift ?? 0)
    // Poniżej grosza to zaokrąglenia zapisu migawki, nie realny przepływ.
    if (Math.abs(amount) >= 0.01) flows.push({ date: curr.date, amount })
  }
  return flows
}

/**
 * Time-Weighted Return – łączy zwroty z kolejnych podokresów między dniami wyceny,
 * eliminując wpływ wielkości i momentu wpłat/wypłat. Zwraca ułamek (0.05 = +5%)
 * skumulowany od pierwszej dostępnej wyceny.
 *
 * Migawki portfolio_history istnieją tylko w dni robocze (cron nie działa w weekendy),
 * a transakcje mogą mieć dowolną datę. Dlatego przepływy gotówki NIE są dopasowywane
 * do dnia dokładnie równego dacie migawki, tylko sumowane za cały okres od poprzedniej
 * migawki (wyłącznie) do bieżącej (włącznie) – inaczej przepływ z soboty/niedzieli
 * nigdy nie zostałby uwzględniony i cały poniedziałkowy skok wartości portfela
 * zostałby błędnie policzony jako zwrot z rynku.
 */
export function calculateTWR(valuations: ValuationPoint[], cashFlows: CashFlow[]): number {
  const sorted = [...valuations].sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length < 2) return 0

  const firstDate = sorted[0].date
  // Przepływy sprzed pierwszej wyceny są już odzwierciedlone w jej wartości – pomijamy je.
  const flows = cashFlows
    .filter((cf) => cf.date > firstDate)
    .sort((a, b) => a.date.localeCompare(b.date))
  let flowIdx = 0

  let cumulative = 1
  for (let i = 1; i < sorted.length; i++) {
    // Przepływy konsumujemy zawsze, również dla pomijanych podokresów. Inaczej wpłata
    // z dnia, w którym portfel był jeszcze pusty, przeszłaby do kolejnego podokresu
    // i została tam odjęta jako strata bliska -100%.
    let flow = 0
    while (flowIdx < flows.length && flows[flowIdx].date <= sorted[i].date) {
      flow += flows[flowIdx].amount
      flowIdx++
    }

    const prevValue = sorted[i - 1].value
    // Zerowy portfel na starcie podokresu: nie ma kapitału, którego zwrot można zważyć.
    if (prevValue <= 0) continue

    // Odejmujemy przepływ z danego okresu, żeby nie liczyć wpłaty/wypłaty jako "zysku"
    const periodReturn = (sorted[i].value - flow - prevValue) / prevValue
    // Mnożnik poniżej zera odwracałby znak całego TWR, a strata nie schodzi poniżej -100%.
    cumulative *= Math.max(0, 1 + periodReturn)
  }
  return cumulative - 1
}

/**
 * Zamienia skumulowaną stopę zwrotu (np. TWR od początku inwestycji) na stopę roczną,
 * uwzględniając liczbę dni, przez jaką kapitał był zainwestowany.
 * Zwraca ułamek roczny (0.08 = +8%/rok).
 */
export function annualizeReturn(cumulativeReturn: number, days: number): number {
  if (days <= 0) return 0
  const years = days / 365
  if (years < 1 / 365) return 0
  const base = 1 + cumulativeReturn
  if (base <= 0) return -1
  return Math.pow(base, 1 / years) - 1
}

/**
 * Money-Weighted Return (XIRR) – roczna stopa zwrotu uwzględniająca wielkość
 * i moment wpłat/wypłat. Rozwiązywana metodą Newtona dla NPV = 0.
 * Zwraca ułamek roczny (0.08 = +8%/rok).
 */
export function calculateMWR(cashFlows: CashFlow[], finalValue: number, finalDate: string): number {
  // Z perspektywy inwestora: wpłata do portfela = odpływ gotówki z jego kieszeni (-),
  // końcowa wartość portfela = potencjalny wpływ, gdyby spieniężyć dziś (+).
  const flows = cashFlows
    .filter((cf) => cf.amount !== 0)
    .map((cf) => ({ date: new Date(cf.date), amount: -cf.amount }))
  flows.push({ date: new Date(finalDate), amount: finalValue })
  flows.sort((a, b) => a.date.getTime() - b.date.getTime())

  if (flows.length < 2) return 0

  const t0 = flows[0].date.getTime()
  const yearsSince = (d: Date) => (d.getTime() - t0) / (365 * 86400000)

  const npv = (rate: number) =>
    flows.reduce((sum, f) => sum + f.amount / Math.pow(1 + rate, yearsSince(f.date)), 0)
  const npvDerivative = (rate: number) =>
    flows.reduce((sum, f) => {
      const t = yearsSince(f.date)
      return t === 0 ? sum : sum - (t * f.amount) / Math.pow(1 + rate, t + 1)
    }, 0)

  let rate = 0.1
  for (let i = 0; i < 100; i++) {
    const value = npv(rate)
    const deriv = npvDerivative(rate)
    if (Math.abs(deriv) < 1e-10) break
    const next = Math.max(rate - value / deriv, -0.999)
    if (!Number.isFinite(next)) break
    const converged = Math.abs(next - rate) < 1e-7
    rate = next
    if (converged) break
  }
  return Number.isFinite(rate) ? rate : 0
}

/**
 * Suma przepływów gotówki w przedziale (afterDate, untilDate] — exclusive start, inclusive end.
 * Używane do korekty dziennych zmian wartości o wpłaty/wypłaty.
 */
export function netCashFlowBetween(
  cashFlows: CashFlow[],
  afterDate: string,
  untilDate: string
): number {
  let sum = 0
  for (const cf of cashFlows) {
    if (cf.date > afterDate && cf.date <= untilDate) sum += cf.amount
  }
  return sum
}

/**
 * Współczynnik korelacji Pearsona między dziennymi zwrotami portfela a dziennymi
 * zwrotami benchmarku (np. S&P 500). Wartość z zakresu [-1, 1]: bliska 1 oznacza,
 * że portfel porusza się prawie identycznie jak rynek, bliska -1 – odwrotnie,
 * bliska 0 – brak liniowej zależności. Zwraca null, gdy danych jest zbyt mało
 * (np. brak nakładających się dni z wyceną benchmarku).
 *
 * Opcjonalne cashFlows korygują zwroty portfela tak jak TWR: (V₁ − CF − V₀) / V₀,
 * żeby dokupienia/sprzedaże nie psuły korelacji z rynkiem.
 */
export function calculateCorrelation(
  portfolio: ValuationPoint[],
  benchmark: ValuationPoint[],
  cashFlows: CashFlow[] = []
): number | null {
  const sortedPortfolio = [...portfolio].sort((a, b) => a.date.localeCompare(b.date))
  const benchmarkMap = new Map(benchmark.map((b) => [b.date, b.value]))
  const flows = [...cashFlows].sort((a, b) => a.date.localeCompare(b.date))

  const portfolioReturns: number[] = []
  const benchmarkReturns: number[] = []
  for (let i = 1; i < sortedPortfolio.length; i++) {
    const prev = sortedPortfolio[i - 1]
    const curr = sortedPortfolio[i]
    const bPrev = benchmarkMap.get(prev.date)
    const bCurr = benchmarkMap.get(curr.date)
    if (prev.value <= 0 || bPrev == null || bCurr == null || bPrev <= 0) continue
    const flow = netCashFlowBetween(flows, prev.date, curr.date)
    portfolioReturns.push((curr.value - flow - prev.value) / prev.value)
    benchmarkReturns.push((bCurr - bPrev) / bPrev)
  }

  const n = portfolioReturns.length
  if (n < 2) return null

  const mean = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length
  const meanP = mean(portfolioReturns)
  const meanB = mean(benchmarkReturns)

  let cov = 0
  let varP = 0
  let varB = 0
  for (let i = 0; i < n; i++) {
    const dp = portfolioReturns[i] - meanP
    const db = benchmarkReturns[i] - meanB
    cov += dp * db
    varP += dp * dp
    varB += db * db
  }
  if (varP === 0 || varB === 0) return null
  return cov / Math.sqrt(varP * varB)
}
