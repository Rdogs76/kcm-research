// GET /api/market -> one month of daily closes for indices, rates, commodities and sector ETFs.
// Financials-focused: rates and the yield curve drive bank and insurer earnings, so they sit beside the sector ETFs.
import { send, chartPoints } from "./_lib/util.js";

export const MARKET = [
  { symbol: "^GSPC", name: "S&P 500", group: "index" },
  { symbol: "^GSPTSE", name: "S&P/TSX", group: "index" },
  { symbol: "^RUT", name: "Russell 2000", group: "index" },
  { symbol: "^VIX", name: "VIX (fear gauge)", group: "macro" },
  { symbol: "^TNX", name: "US 10-yr yield", group: "macro" },
  { symbol: "^IRX", name: "US 3-mo T-bill", group: "macro" },
  { symbol: "^FVX", name: "US 5-yr yield", group: "macro" },
  { symbol: "CL=F", name: "Crude oil", group: "macro" },
  { symbol: "GC=F", name: "Gold", group: "macro" },
  { symbol: "USDCAD=X", name: "USD/CAD", group: "macro" },
  { symbol: "DX-Y.NYB", name: "US dollar index", group: "macro" },
  { symbol: "XLF", name: "US financials", group: "sector" },
  { symbol: "KBE", name: "US banks", group: "sector" },
  { symbol: "KRE", name: "US regional banks", group: "sector" },
  { symbol: "KIE", name: "Insurers", group: "sector" },
  { symbol: "IAI", name: "Brokers & exchanges", group: "sector" },
  { symbol: "XFN.TO", name: "Canadian financials", group: "sector" },
  { symbol: "ZEB.TO", name: "Canadian banks", group: "sector" },
  { symbol: "ITA", name: "Aerospace & defence", group: "sector" },
];

export default async function handler(req, res) {
  const settled = await Promise.allSettled(MARKET.map((m) => chartPoints(m.symbol, "3mo")));
  const series = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.points.length) series.push({ ...MARKET[i], points: r.value.points });
  });
  send(res, 200, { series, asOf: Date.now() }, 300);
}
