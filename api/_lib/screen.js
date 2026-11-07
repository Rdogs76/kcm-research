// Helpers shared by the Ideas tab routes (stock ideas, money flow, dividend stocks, ETFs).
import { yf, num, time, NO_VALIDATE } from "./util.js";

export const DAY = 86400000, YEAR = 365.25 * DAY;

// Run fn over items with at most `limit` running at once; failures become null.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i], i); } catch { out[i] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Batch quotes (one request per 50 symbols).
export async function quotes(symbols) {
  const map = {};
  for (let i = 0; i < symbols.length; i += 50) {
    const chunk = symbols.slice(i, i + 50);
    try {
      const r = await yf().quote(chunk, { return: "array" }, NO_VALIDATE);
      for (const q of r || []) if (q?.symbol) map[q.symbol] = q;
    } catch {
      // Fall back to one at a time so a single bad symbol doesn't sink the batch.
      const each = await pool(chunk, 8, (s) => yf().quote(s, {}, NO_VALIDATE));
      for (const q of each) if (q?.symbol) map[q.symbol] = q;
    }
  }
  return map;
}

// Daily bars with volume, oldest first.
export async function daily(symbol, days) {
  const r = await yf().chart(symbol, { period1: new Date(Date.now() - days * DAY), interval: "1d" }, NO_VALIDATE);
  return (r?.quotes || [])
    .map((q) => ({ t: time(q.date), c: num(q.adjclose ?? q.close) ?? num(q.close), v: num(q.volume) || 0 }))
    .filter((b) => b.t && b.c != null);
}

// Monthly bars (adjusted close = total return incl. dividends, close = price only) plus dividend events.
export async function monthly(symbol, years) {
  const r = await yf().chart(symbol, { period1: new Date(Date.now() - years * YEAR), interval: "1mo", events: "div" }, NO_VALIDATE);
  const bars = (r?.quotes || [])
    .map((q) => ({ t: time(q.date), adj: num(q.adjclose) ?? num(q.close), close: num(q.close) }))
    .filter((b) => b.t && b.adj != null && b.close != null);
  let divs = r?.events?.dividends || [];
  if (!Array.isArray(divs)) divs = Object.values(divs);
  divs = divs.map((d) => ({ t: time(d.date), amount: num(d.amount) })).filter((d) => d.t && d.amount);
  return { bars, divs, currency: r?.meta?.currency || null };
}

// Total and price returns from monthly bars.
export function returnsFrom(m) {
  const b = m.bars; if (b.length < 3) return {};
  const last = b.at(-1);
  const back = (months) => (b.length > months ? b[b.length - 1 - months] : null);
  const r = (a, z, k) => (a && z && a[k] ? (z[k] / a[k] - 1) * 100 : null);
  const ann = (months) => { const a = back(months); return a ? (Math.pow(last.adj / a.adj, 12 / months) - 1) * 100 : null; };
  // Calendar-year total returns from the December bar of each year.
  const dec = {};
  for (const bar of b) { const d = new Date(bar.t); if (d.getUTCMonth() === 11) dec[d.getUTCFullYear()] = bar.adj; }
  const thisYear = new Date().getUTCFullYear();
  const years = [];
  for (let y = thisYear - 6; y < thisYear; y++) if (dec[y] && dec[y - 1]) years.push({ year: y, ret: (dec[y] / dec[y - 1] - 1) * 100 });
  const ytd = dec[thisYear - 1] ? (last.adj / dec[thisYear - 1] - 1) * 100 : null;
  // Dividends: trailing 12 months vs the same window five years earlier.
  const now = last.t;
  const sumDiv = (from, to) => m.divs.filter((d) => d.t > from && d.t <= to).reduce((a, d) => a + d.amount, 0);
  const ttm = sumDiv(now - YEAR, now), old = sumDiv(now - 6 * YEAR, now - 5 * YEAR);
  return {
    total1y: r(back(12), last, "adj"), price1y: r(back(12), last, "close"),
    total3y: ann(36), total5y: ann(60),
    years, ytd,
    divTTM: ttm || null,
    divGrowth5y: ttm && old ? (Math.pow(ttm / old, 1 / 5) - 1) * 100 : null,
  };
}

// Percentile rank (0-100) of each value within the list; nulls stay null.
export function ranks(values) {
  const xs = values.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  return values.map((v) => {
    if (v == null || !Number.isFinite(v) || !xs.length) return null;
    let lo = 0; while (lo < xs.length && xs[lo] < v) lo++;
    let hi = lo; while (hi < xs.length && xs[hi] === v) hi++;
    return xs.length === 1 ? 50 : (((lo + hi - 1) / 2) / (xs.length - 1)) * 100;
  });
}

export const clip = (v, lo, hi) => (v == null ? null : Math.max(lo, Math.min(hi, v)));
export const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
