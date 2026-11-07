// Shared helpers for the API routes. Files in folders starting with "_" are not routes on Vercel.
import YahooFinance from "yahoo-finance2";

let instance;
export function yf() {
  if (!instance) {
    // v3+/v4 export a class; older versions exported a ready instance.
    instance = typeof YahooFinance === "function" ? new YahooFinance() : YahooFinance;
    try { instance.suppressNotices?.(["yahooSurvey", "ripHistorical"]); } catch { /* optional */ }
  }
  return instance;
}

export const NO_VALIDATE = { validateResult: false };

export function send(res, status, body, maxAgeSeconds = 60) {
  if (maxAgeSeconds > 0) {
    res.setHeader("Cache-Control", `s-maxage=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds * 5}`);
  } else {
    res.setHeader("Cache-Control", "no-store");
  }
  res.status(status).json(body);
}

export function fail(res, err) {
  send(res, 502, { error: String(err?.message || err || "Upstream error") }, 0);
}

// Accepts "AAPL, vfv.to,^GSPC" and returns a clean, de-duplicated list.
export function symbolsFrom(value, max = 40) {
  const list = String(value || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9.\-=^]{1,20}$/.test(s));
  return [...new Set(list)].slice(0, max);
}

// Unwrap {raw, fmt} objects and Dates into plain numbers.
export function num(v) {
  if (v == null) return null;
  if (typeof v === "object") {
    if (v instanceof Date) return v.getTime();
    if ("raw" in v) return num(v.raw);
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function time(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && "raw" in v) return time(v.raw);
  const n = Number(v);
  if (Number.isFinite(n)) return n < 1e11 ? n * 1000 : n; // seconds -> ms
  const d = Date.parse(v);
  return Number.isFinite(d) ? d : null;
}

export const RANGES = {
  "1d": { days: 5, interval: "5m", lastSessionOnly: true },
  "5d": { days: 7, interval: "30m" },
  "1mo": { days: 31, interval: "1d" },
  "3mo": { days: 92, interval: "1d" },
  "6mo": { days: 183, interval: "1d" },
  "ytd": { days: null, interval: "1d" },
  "1y": { days: 366, interval: "1d" },
  "2y": { days: 731, interval: "1d" },
  "5y": { days: 1830, interval: "1wk" },
};

export async function chartPoints(symbol, range = "1y") {
  const r = RANGES[range] || RANGES["1y"];
  const now = new Date();
  const period1 = r.days == null
    ? new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
    : new Date(now.getTime() - r.days * 86400000);
  const data = await yf().chart(symbol, { period1, interval: r.interval }, NO_VALIDATE);
  let points = (data?.quotes || [])
    .map((q) => [time(q.date), num(q.adjclose ?? q.close) ?? num(q.close)])
    .filter(([t, c]) => t && c != null);
  if (r.lastSessionOnly && points.length) {
    const day = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const last = day(points[points.length - 1][0]);
    points = points.filter(([t]) => day(t) === last);
  }
  return {
    symbol,
    currency: data?.meta?.currency || null,
    previousClose: num(data?.meta?.chartPreviousClose ?? data?.meta?.previousClose),
    points,
  };
}

export const SECTOR_KEYS = {
  realestate: "Real Estate",
  consumer_cyclical: "Consumer Cyclical",
  basic_materials: "Basic Materials",
  consumer_defensive: "Consumer Defensive",
  technology: "Technology",
  communication_services: "Communication Services",
  financial_services: "Financial Services",
  utilities: "Utilities",
  industrials: "Industrials",
  energy: "Energy",
  healthcare: "Healthcare",
};

export function sectorWeightsFrom(topHoldings) {
  const out = {};
  for (const entry of topHoldings?.sectorWeightings || []) {
    for (const [k, v] of Object.entries(entry)) {
      const name = SECTOR_KEYS[k];
      const w = num(v);
      if (name && w) out[name] = (out[name] || 0) + w;
    }
  }
  return Object.keys(out).length ? out : null;
}

