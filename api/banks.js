// GET /api/banks             -> margin, deposit-beta, capital and credit trends for every bank in the universe,
//                               plus hand-entered dealer trading results
// GET /api/banks?symbol=TD.TO -> the quarterly detail for one bank in the universe
//
// Built from Yahoo Finance's quarterly statements (the fundamentals time-series endpoint yfinance uses).
// NIM is a proxy: net interest income, annualised by the actual days in the quarter, ÷ average total assets.
// Banks report NIM on average *earning* assets, so their own figure is higher. Use the change, not the level.
// The margin is split into what assets earn (interest income / assets) and the total funding cost
// (all interest expense / assets: deposits plus repo, wholesale and debt). Deposit cost uses interest
// expense on deposits alone, and the implied deposit beta compares its change with the policy-rate change.
// For universal dealers (JPM, C, BAC, GS-style), trading-book interest sits in both lines, so read with care.
import { yf, send, fail, symbolsFrom, num, withTimeout } from "./_lib/util.js";
import { pool, ranks, r1 } from "./_lib/screen.js";
import { UNIVERSE, GROUPS } from "./_lib/universe.js";
import { TRADING, tradingStatus } from "./_lib/trading.js";
import { policyRates, quarterAvg } from "./_lib/rates.js";

export const BANK_GROUPS = ["cabank", "uslarge", "usreg"];
export const DEALERS = ["JPM", "C", "BAC", "WFC", "GS", "MS"];
const TYPES = [
  "NetInterestIncome", "InterestIncome", "InterestExpense", "InterestExpenseForDeposit", "TotalAssets",
  "TangibleBookValue", "CommonStockEquity", "NetIncomeCommonStockholders", "OrdinarySharesNumber",
  "CreditLossesProvision", "TotalRevenue", "NonInterestExpense",
  "RepurchaseOfCapitalStock", "CashDividendsPaid", "GainsLossesNotAffectingRetainedEarnings",
];
const DAY = 86400000;
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / DAY;

async function direct(symbol) {
  const p1 = Math.floor((Date.now() - 900 * DAY) / 1000), p2 = Math.floor(Date.now() / 1000) + 86400;
  const type = TYPES.map((t) => "quarterly" + t).join(",");
  const r = await fetch(`https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=${type}&period1=${p1}&period2=${p2}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", Accept: "application/json" },
    signal: AbortSignal.timeout(7000),
  });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  const j = await r.json();
  const out = {};
  let ccy = null;
  for (const res of j?.timeseries?.result || []) {
    const key = res?.meta?.type?.[0]; if (!key) continue;
    const name = key.replace(/^quarterly/, "");
    for (const pt of res[key] || []) {
      if (!pt?.asOfDate) continue;
      const v = num(pt.reportedValue);
      if (v != null) (out[pt.asOfDate] ||= {})[name] = v;
      if (pt.currencyCode) ccy = pt.currencyCode;
    }
  }
  return { byDate: out, ccy };
}
async function viaLib(symbol) {
  const rows = await withTimeout(yf().fundamentalsTimeSeries(symbol, { period1: new Date(Date.now() - 900 * DAY), type: "quarterly", module: "all" }, { validateResult: false }), 8000);
  const out = {};
  const pick = (o, name) => { const k = Object.keys(o).find((x) => x.toLowerCase().replace(/^quarterly/, "") === name.toLowerCase()); return k ? num(o[k]) : null; };
  for (const o of rows || []) {
    const d = o.date instanceof Date ? o.date.toISOString().slice(0, 10) : String(o.date || "").slice(0, 10);
    if (!d) continue;
    for (const t of TYPES) { const v = pick(o, t); if (v != null) (out[d] ||= {})[t] = v; }
  }
  return { byDate: out, ccy: null };
}

export function nimSeries(byDate) {
  const qs = Object.entries(byDate).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i], prev = qs[i - 1];
    const gap = prev ? days(q.date, prev.date) : null;
    const contiguous = gap != null && gap >= 80 && gap <= 100;
    const nii = q.NetInterestIncome ?? (q.InterestIncome != null && q.InterestExpense != null ? q.InterestIncome - q.InterestExpense : null);
    const ii = q.InterestIncome ?? null;
    const ie = q.InterestExpense ?? (ii != null && nii != null ? ii - nii : null);
    const assets = q.TotalAssets && contiguous && prev.TotalAssets ? (q.TotalAssets + prev.TotalAssets) / 2 : q.TotalAssets ?? null;
    if (nii == null || !assets) continue;
    const ann = 365 / (contiguous ? gap : 91.25); // annualise by the real length of the quarter
    out.push({
      date: q.date, nii, assets: q.TotalAssets ?? null, gap,
      nim: (nii * ann / assets) * 100,
      yieldA: ii != null ? (ii * ann / assets) * 100 : null,
      cost: ie != null ? (ie * ann / assets) * 100 : null,
      depCost: q.InterestExpenseForDeposit != null ? (q.InterestExpenseForDeposit * ann / assets) * 100 : null,
      tbv: q.TangibleBookValue ?? null, ce: q.CommonStockEquity ?? null, ni: q.NetIncomeCommonStockholders ?? null, shares: q.OrdinarySharesNumber ?? null,
      prov: q.CreditLossesProvision != null ? Math.abs(q.CreditLossesProvision) : null,
      rev: q.TotalRevenue ?? null, nie: q.NonInterestExpense ?? null,
      buyback: q.RepurchaseOfCapitalStock != null ? Math.abs(q.RepurchaseOfCapitalStock) : null,
      div: q.CashDividendsPaid != null ? Math.abs(q.CashDividendsPaid) : null,
      aoci: q.GainsLossesNotAffectingRetainedEarnings ?? null,
    });
  }
  return out;
}

const sum = (xs) => (xs.length && xs.every((x) => x != null) ? xs.reduce((a, b) => a + b, 0) : null);

export function metrics(s, policy, region = "US") {
  if (!s.length) return null;
  const last = s.at(-1), q1 = s.at(-2);
  // A "1-year" comparison only counts if the dates really are about a year apart.
  const q4 = [...s].reverse().find((x) => { const d = days(last.date, x.date); return d >= 330 && d <= 400; }) || null;
  const base = q4 || s[0];
  const bp = (a, b, k) => (a?.[k] != null && b?.[k] != null ? Math.round((a[k] - b[k]) * 100) : null);
  const last4 = s.slice(-4);
  const contiguous4 = last4.length === 4 && last4.every((x, i) => i === 0 || (x.gap >= 80 && x.gap <= 100));
  // ROTCE: net income to common over the last four quarters ÷ average tangible common equity.
  const ni4 = contiguous4 ? sum(last4.map((x) => x.ni)) : null;
  const tbvAvg = last.tbv && base.tbv ? (last.tbv + base.tbv) / 2 : last.tbv;
  const rotce = ni4 != null && tbvAvg > 0 ? (ni4 / tbvAvg) * 100 : null;
  // Pre-provision net revenue and provisions.
  const ppnr4 = contiguous4 ? sum(last4.map((x) => (x.rev != null && x.nie != null ? x.rev - x.nie : null))) : null;
  const prov4 = contiguous4 ? sum(last4.map((x) => x.prov)) : null;
  const provYoY = last.prov != null && q4?.prov ? r1((last.prov / q4.prov - 1) * 100) : null;
  const payout4 = contiguous4 ? sum(last4.map((x) => (x.div ?? 0) + (x.buyback ?? 0))) : null;
  // Implied deposit beta: change in deposit cost ÷ change in the average policy rate over the same quarters.
  let depBeta = null, policyChg = null;
  if (policy?.length && last.depCost != null && base.depCost != null && base !== last) {
    policyChg = Math.round((quarterAvg(policy, last.date) - quarterAvg(policy, base.date)) * 100);
    if (Math.abs(policyChg) >= 25) depBeta = r2(((last.depCost - base.depCost) * 100) / policyChg);
  }
  const ageDays = Math.round((Date.now() - Date.parse(last.date)) / DAY);
  // US banks report ~2-3 weeks after quarter end, Canadian banks ~4-5 weeks; Yahoo adds a lag on top.
  const lagging = ageDays > (region === "CA" ? 125 : 100);
  return {
    quarter: last.date, quarters: s.length, ageDays, lagging, stale: ageDays > 200,
    nim: r2(last.nim),
    nimChg1q: q1 && last.gap >= 80 && last.gap <= 100 ? bp(last, q1, "nim") : null,
    nimChg4q: q4 ? bp(last, q4, "nim") : null,
    nimChgSpan: bp(last, base, "nim"), spanDays: Math.round(days(last.date, base.date)),
    yieldChg: bp(last, base, "yieldA"), costChg: bp(last, base, "cost"), depCostChg: bp(last, base, "depCost"),
    yieldA: r2(last.yieldA), cost: r2(last.cost), depCost: r2(last.depCost),
    depBeta, policyChg,
    niiYoY: q4 ? r1((last.nii / q4.nii - 1) * 100) : null,
    niiQoQ: q1 ? r1((last.nii / q1.nii - 1) * 100) : null,
    streak: s.length >= 3 ? (s.at(-1).nim > s.at(-2).nim && s.at(-2).nim > s.at(-3).nim ? 2 : s.at(-1).nim > s.at(-2).nim ? 1 : 0) : null,
    // Capital, returns, credit (per share values are in the reporting currency)
    tbvps: last.tbv && last.shares ? last.tbv / last.shares : null,
    rotce: r1(rotce),
    tceRatio: last.tbv && last.assets ? r2((last.tbv / last.assets) * 100) : null, // tangible common equity ÷ total assets (a rough capital proxy, not CET1)
    capitalReturn4: payout4, ni4,
    totalPayout: payout4 != null && ni4 > 0 ? r1((payout4 / ni4) * 100) : null,
    provYoY, provToPpnr: prov4 != null && ppnr4 > 0 ? r1((prov4 / ppnr4) * 100) : null,
    aociToTbv: last.aoci != null && last.tbv > 0 ? r1((last.aoci / last.tbv) * 100) : null,
    series: s.map((x) => ({ date: x.date, nim: r2(x.nim), yieldA: r2(x.yieldA), cost: r2(x.cost), depCost: r2(x.depCost), nii: x.nii })),
  };
}

export async function one(symbol, policy) {
  let raw, src = "yahoo";
  try { raw = await direct(symbol); if (!Object.keys(raw.byDate).length) throw new Error("empty"); }
  catch { raw = await viaLib(symbol); src = "yahoo-finance2"; }
  const ccy = raw.ccy || (symbol.endsWith(".TO") ? "CAD" : "USD");
  const p = policy ?? (await policyRates().catch(() => ({})));
  const m = metrics(nimSeries(raw.byDate), p[symbol.endsWith(".TO") ? "CAD" : "USD"], symbol.endsWith(".TO") ? "CA" : "US");
  if (!m) throw new Error("no net interest income data");
  return { ...m, finCcy: ccy, src };
}

export function nimScores(list) {
  // NIM momentum: margin change over a year (or the span available), last quarter, NII growth, and a low deposit beta.
  const R = { a: ranks(list.map((b) => b.nimChg4q ?? b.nimChgSpan)), b: ranks(list.map((b) => b.nimChg1q)), c: ranks(list.map((b) => b.niiYoY)), d: ranks(list.map((b) => (b.depBeta == null ? null : -b.depBeta))) };
  list.forEach((b, i) => {
    let t = 0, w = 0;
    for (const [k, wt] of [["a", 0.45], ["b", 0.2], ["c", 0.2], ["d", 0.15]]) if (R[k][i] != null) { t += R[k][i] * wt; w += wt; }
    b.nimScore = w ? Math.round(t / w) : null;
    b.nimRank = null;
  });
  const order = list.filter((b) => b.nimScore != null).sort((a, b) => b.nimScore - a.nimScore);
  order.forEach((b, i) => { b.nimRank = i + 1; });
  return order.length;
}

const BANK_SET = new Set(UNIVERSE.filter((u) => BANK_GROUPS.includes(u[1])).map((u) => u[0]));

export default async function handler(req, res) {
  try {
    const extra = Object.keys(req.query || {}).filter((k) => k !== "symbol");
    if (extra.length) return send(res, 400, { error: `Unknown parameter: ${extra.join(", ")}` }, 0);
    const policy = await policyRates().catch(() => ({}));
    const [sym] = symbolsFrom(req.query.symbol, 1);
    if (req.query.symbol != null) {
      if (!sym || !BANK_SET.has(sym)) return send(res, 400, { error: "Bank detail is available for banks in the research universe." }, 3600);
      const m = await one(sym, policy).catch((e) => ({ error: String(e.message || e) }));
      return send(res, 200, { symbol: sym, ...m, asOf: Date.now() }, 12 * 3600);
    }
    const banks = UNIVERSE.filter((u) => BANK_GROUPS.includes(u[1]));
    const errors = {};
    const got = await pool(banks.map((b) => b[0]), 8, (s) => one(s, policy).catch((e) => { errors[s] = String(e.message || e); return null; }));
    const list = banks.map(([symbol, group], i) => (got[i] ? { symbol, group, groupName: GROUPS[group].name, dealer: DEALERS.includes(symbol), ...got[i], series: undefined } : null)).filter(Boolean);
    const n = nimScores(list);
    list.forEach((b) => { b.nimOf = n; });
    list.sort((a, b) => (b.nimScore ?? -1) - (a.nimScore ?? -1));
    const med = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };
    const groups = BANK_GROUPS.map((g) => { const l = list.filter((b) => b.group === g); return { key: g, name: GROUPS[g].name, count: l.length, nimChg4q: med(l.map((b) => b.nimChg4q ?? b.nimChgSpan)), niiYoY: med(l.map((b) => b.niiYoY)), depBeta: med(l.map((b) => b.depBeta)), widening: l.filter((b) => (b.nimChg1q ?? 0) > 0).length }; });
    const coverage = { banks: banks.length, ok: list.length };
    if (list.length < banks.length * 0.6) return send(res, 503, { error: `Only ${list.length} of ${banks.length} banks returned statements; try again shortly.`, coverage }, 0);
    send(res, 200, { banks: list, groups, trading: { ...TRADING, status: tradingStatus() }, errors, coverage, asOf: Date.now() }, 12 * 3600);
  } catch (e) { fail(res, e); }
}
