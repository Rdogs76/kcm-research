// Dealer trading results, entered by hand from earnings releases (no free API reports FICC by bank).
// Update after each earnings season: US banks report mid-Jan/Apr/Jul/Oct; Canadian banks late Feb/May/Aug and early Dec.
// Revenue in billions of reporting currency; yoy in %.
export const TRADING = {
  quarter: "Q3 2026 (US) · Q3 FY2026 (Canada)",
  note: "Q3 2026 was an equities quarter, not a FICC quarter. FICC was flat to down at most US dealers while equities trading jumped 11–72%. Rates products were specifically weaker at JPMorgan, Goldman and Citi despite the Fed's September hike. The FICC winners were currencies and financing (prime and structured lending).",
  rows: [
    { symbol: "JPM", name: "JPMorgan Chase", ficc: 5.4, ficcYoY: -4, eq: null, eqYoY: 49, driver: "Lower commodities, rates, credit and public finance; currencies & EM up", src: "https://finviz.com/news/401772/jpmorgan-chase-misses-third-quarter-earnings-estimates-as-fixed-income-trading-revenue-declines" },
    { symbol: "GS", name: "Goldman Sachs", ficc: 3.47, ficcYoY: -1, eq: 6.44, eqYoY: 72, driver: "Intermediation −7% (mortgages, credit, rates); financing +14%; currencies & commodities up", src: "https://www.goldmansachs.com/pressroom/press-releases/current/pdfs/2026-q3-results.pdf" },
    { symbol: "C", name: "Citigroup", ficc: 4.39, ficcYoY: 4, eq: 1.73, eqYoY: 14, driver: "Rates & currencies flat (FX up, rates down); spread products +13%", src: "https://www.sec.gov/Archives/edgar/data/0000831001/000110465926115323/c-ex99d1.htm" },
    { symbol: "MS", name: "Morgan Stanley", ficc: 2.01, ficcYoY: -7, eq: 5.8, eqYoY: 41, driver: "Lower securitized credit and commodities", src: "https://www.sec.gov/Archives/edgar/data/0000895421/000089542126000288/a3q26msearningsrelease.htm" },
    { symbol: "BAC", name: "Bank of America", ficc: 2.6, ficcYoY: -17, eq: 2.5, eqYoY: 11, driver: "Weaker mortgages, municipals and credit", src: "https://d1io3yog0oux5.cloudfront.net/_57b47cfcfa36e60b766b86c879f09ca2/bankofamerica/files/pages/fixed-income/09.30.2026_Fixed_Income_Materials.pdf" },
    { symbol: "RY.TO", name: "Royal Bank of Canada", ficc: null, ficcYoY: null, eq: null, eqYoY: 43, markets: 2.152, marketsYoY: 11, driver: "Capital Markets revenue C$4.2B (+12%, record); Global Markets C$2.15B (+11%)", src: "https://www.investing.com/news/company-news/rbc-q3-2026-slides-record-earnings-18-roe-strong-capital-generation-93CH-4879636" },
  ],
  context: { fed: "FOMC raised the fed funds target 25 bp to 3.75–4.00% on Sept 16, 2026", src: "https://www.heygotrade.com/en/market-outlook/bank-stocks-q3-2026-earnings/" },
};
