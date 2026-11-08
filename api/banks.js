// GET /api/banks            -> net-interest-margin trends for every bank in the universe, plus dealer trading results
// GET /api/banks?symbol=TD.TO -> the quarterly detail for one bank
//
// NIM here is a proxy computed from Yahoo Finance's quarterly statements:
//   NIM ≈ net interest income × 4 / average total assets
// Banks report NIM on average *earning* assets, which excludes things like goodwill and cash at other banks,
// so the level runs below the bank's own figure. The *change* is what matters for spotting expansion.
// We also split the margin into its two sides — what assets earn (interest income / assets) and what
// funding costs (interest expense / assets) — which is exactly "loan rates vs what they pay on deposits".
import { yf, send, fail, symbolsFrom, num } from "./_lib/util.js";
import { pool, ranks, r1 } from "./_lib/screen.js";
import { UNIVERSE, GROUPS } from "./_lib/universe.js";
import { TRADING } from "./_lib/trading.js";

export const BANK_GROUPS = ["cabank", "uslarge", "usreg"];
const TYPES = ["NetInterestIncome", "InterestIncome", "InterestExpense", "TotalAssets"];
const DAY = 86400000;

// Yahoo's public fundamentals time-series endpoint (the one yfinance uses).
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
  for (const res of j?.timeseries?.result || []) {
    const key = res?.meta?.type?.[0]; if (!key) continue;
    const name = key.replace(/^quarterly/, "");
    for (const pt of res[key] || []) {
      if (!pt?.asOfDate) continue;
      const v = num(pt.reportedValue);
      if (v != null) (out[pt.asOfDate] ||= {})[name] = v;
    }
  }
  return out;
}
// Fallback through yahoo-finance2, which handles Yahoo's cookies if the direct call is refused.
async function viaLib(symbol) {
  const rows = await yf().fundamentalsTimeSeries(symbol, { period1: new Date(Date.now() - 900 * DAY), type: "quarterly", module: "all" }, { validateResult: false });
  const out = {};
  const pick = (o, name) => { const k = Object.keys(o).find((x) => x.toLowerCase().replace(/^quarterly/, "") === name.toLowerCase()); return k ? num(o[k]) : null; };
  for (const o of rows || []) {
    const d = o.date instanceof Date ? o.date.toISOString().slice(0, 10) : String(o.date || "").slice(0, 10);
    if (!d) continue;
    for (const t of TYPES) { const v = pick(o, t); if (v != null) (out[d] ||= {})[t] = v; }
  }
  return out;
}

export function nimSeries(byDate) {
  const qs = Object.entries(byDate).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i], prev = qs[i - 1];
    const nii = q.NetInterestIncome ?? (q.InterestIncome != null && q.InterestExpense != null ? q.InterestIncome - q.InterestExpense : null);
    const ii = q.InterestIncome ?? null;
    const ie = q.InterestExpense ?? (ii != null && nii != null ? ii - nii : null);
    const assets = q.TotalAssets && prev?.TotalAssets ? (q.TotalAssets + prev.TotalAssets) / 2 : q.TotalAssets ?? null;
    if (nii == null || !assets) continue;
    out.push({
      date: q.date, nii, assets: q.TotalAssets ?? null,
      nim: (nii * 4 / assets) * 100,
      yieldA: ii != null ? (ii * 4 / assets) * 100 : null,
      cost: ie != null ? (ie * 4 / assets) * 100 : null,
    });
  }
  return out;
}

export function metrics(s) {
  if (!s.length) return null;
  const last = s.at(-1), q1 = s.at(-2), q4 = s.length >= 5 ? s.at(-5) : null;
  const bp = (a, b, k) => (a?.[k] != null && b?.[k] != null ? Math.round((a[k] - b[k]) * 100) : null);
  const base = q4 || s[0];
  return {
    quarter: last.date, quarters: s.length,
    nim: Math.round(last.nim * 100) / 100,
    nimChg1q: bp(last, q1, "nim"), nimChg4q: q4 ? bp(last, q4, "nim") : null,
    nimChgSpan: bp(last, base, "nim"), spanQ: s.length - 1 - s.indexOf(base),
    yieldChg: bp(last, base, "yieldA"), costChg: bp(last, base, "cost"),
    yieldA: last.yieldA != null ? Math.round(last.yieldA * 100) / 100 : null, cost: last.cost != null ? Math.round(last.cost * 100) / 100 : null,
    niiYoY: q4 ? r1((last.nii / q4.nii - 1) * 100) : null,
    niiQoQ: q1 ? r1((last.nii / q1.nii - 1) * 100) : null,
    // Two quarters of widening in a row = momentum, not a one-off.
    streak: s.length >= 3 ? (s.at(-1).nim > s.at(-2).nim && s.at(-2).nim > s.at(-3).nim ? 2 : s.at(-1).nim > s.at(-2).nim ? 1 : 0) : null,
    series: s.map((x) => ({ date: x.date, nim: Math.round(x.nim * 100) / 100, yieldA: x.yieldA != null ? Math.round(x.yieldA * 100) / 100 : null, cost: x.cost != null ? Math.round(x.cost * 100) / 100 : null, nii: x.nii })),
  };
}

export async function one(symbol) {
  let raw, src = "yahoo";
  try { raw = await direct(symbol); if (!Object.keys(raw).length) throw new Error("empty"); }
  catch { raw = await viaLib(symbol); src = "yahoo-finance2"; }
  const m = metrics(nimSeries(raw));
  if (!m) throw new Error("no net interest income data");
  return { ...m, src };
}

export default async function handler(req, res) {
  try {
    const [sym] = symbolsFrom(req.query.symbol, 1);
    if (sym) {
      const m = await one(sym).catch((e) => ({ error: String(e.message || e) }));
      return send(res, 200, { symbol: sym, ...m, asOf: Date.now() }, 12 * 3600);
    }
    const banks = UNIVERSE.filter((u) => BANK_GROUPS.includes(u[1]));
    const errors = {};
    const got = await pool(banks.map((b) => b[0]), 8, (s) => one(s).catch((e) => { errors[s] = String(e.message || e); return null; }));
    let list = banks.map(([symbol, group], i) => (got[i] ? { symbol, group, groupName: GROUPS[group].name, ...got[i], series: undefined } : null)).filter(Boolean);
    // NIM momentum score: margin change over a year (or the longest span available), the last quarter, and NII growth.
    const R = { a: ranks(list.map((b) => b.nimChg4q ?? b.nimChgSpan)), b: ranks(list.map((b) => b.nimChg1q)), c: ranks(list.map((b) => b.niiYoY)) };
    list.forEach((b, i) => {
      let t = 0, w = 0;
      for (const [k, wt] of [["a", 0.5], ["b", 0.25], ["c", 0.25]]) if (R[k][i] != null) { t += R[k][i] * wt; w += wt; }
      b.nimScore = w ? Math.round(t / w) : null;
    });
    list.sort((a, b) => (b.nimScore ?? -1) - (a.nimScore ?? -1));
    const med = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };
    const groups = BANK_GROUPS.map((g) => { const l = list.filter((b) => b.group === g); return { key: g, name: GROUPS[g].name, count: l.length, nimChg4q: med(l.map((b) => b.nimChg4q ?? b.nimChgSpan)), niiYoY: med(l.map((b) => b.niiYoY)), widening: l.filter((b) => (b.nimChg1q ?? 0) > 0).length }; });
    send(res, 200, { banks: list, groups, trading: TRADING, errors, asOf: Date.now() }, 12 * 3600);
  } catch (e) { fail(res, e); }
}
