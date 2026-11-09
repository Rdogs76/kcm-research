// Dealer trading results, entered by hand from earnings releases (no free API reports FICC by bank).
// UPDATE EACH EARNINGS SEASON: US banks report mid-Jan/Apr/Jul/Oct; Canadian banks late Feb/May/Aug and early Dec.
// After `nextUpdate`, the dashboard shows a "stale" warning and leaves these figures out of the rates-thesis score.
// Revenue in billions of reporting currency; yoy in %. `primary: false` marks a secondary (news) source.
export const TRADING = {
  quarter: "Q3 2026 (US, quarter ended Sept 30) · Q3 FY2026 (Canada, quarter ended July 31)",
  asOf: "2026-10-15",
  nextUpdate: { US: "2027-01-20", CA: "2026-12-05" },
  note: "Q3 2026 was an equities quarter, not a FICC quarter. FICC was flat to down at most US dealers while equities trading rose 11–72%. Rates products were weaker at JPMorgan, Goldman and Citi despite the Fed's September hike. The FICC gains came from currencies and from financing (prime and structured lending).",
  rows: [
    { symbol: "JPM", region: "US", name: "JPMorgan Chase", ficc: 5.4, ficcYoY: -4, eq: null, eqYoY: 49, driver: "Lower commodities, rates, credit and public finance; currencies & EM up", src: "https://finviz.com/news/401772/jpmorgan-chase-misses-third-quarter-earnings-estimates-as-fixed-income-trading-revenue-declines", primary: false },
    { symbol: "GS", region: "US", name: "Goldman Sachs", ficc: 3.47, ficcYoY: -1, eq: 6.44, eqYoY: 72, driver: "Intermediation −7% (mortgages, credit, rates); financing +14%; currencies & commodities up", src: "https://www.goldmansachs.com/pressroom/press-releases/current/pdfs/2026-q3-results.pdf", primary: true },
    { symbol: "C", region: "US", name: "Citigroup", ficc: 4.39, ficcYoY: 4, eq: 1.73, eqYoY: 14, driver: "Rates & currencies flat (FX up, rates down); spread products +13%", src: "https://www.sec.gov/Archives/edgar/data/0000831001/000110465926115323/c-ex99d1.htm", primary: true },
    { symbol: "MS", region: "US", name: "Morgan Stanley", ficc: 2.01, ficcYoY: -7, eq: 5.8, eqYoY: 41, driver: "Lower securitized credit and commodities", src: "https://www.sec.gov/Archives/edgar/data/0000895421/000089542126000288/a3q26msearningsrelease.htm", primary: true },
    { symbol: "BAC", region: "US", name: "Bank of America", ficc: 2.6, ficcYoY: -17, eq: 2.5, eqYoY: 11, driver: "Weaker mortgages, municipals and credit", src: "https://d1io3yog0oux5.cloudfront.net/_57b47cfcfa36e60b766b86c879f09ca2/bankofamerica/files/pages/fixed-income/09.30.2026_Fixed_Income_Materials.pdf", primary: true },
    { symbol: "RY.TO", region: "CA", name: "Royal Bank of Canada", ficc: null, ficcYoY: null, eq: null, eqYoY: 43, markets: 2.152, marketsYoY: 11, driver: "Capital Markets revenue C$4.2B (+12%, record); Global Markets C$2.15B (+11%)", src: "https://www.investing.com/news/company-news/rbc-q3-2026-slides-record-earnings-18-roe-strong-capital-generation-93CH-4879636", primary: false },
  ],
  context: { fed: "FOMC raised the fed funds target range 25 bp to 3.75–4.00% on Sept 16, 2026", src: "https://federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm" },
};

// Which regions' figures are past their next scheduled update.
export function tradingStatus(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const stale = Object.entries(TRADING.nextUpdate).filter(([, d]) => today > d).map(([r]) => r);
  return { stale, ageDays: Math.round((now - Date.parse(TRADING.asOf)) / 86400000) };
}
