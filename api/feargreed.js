// Fear & Greed Index.
// First choice: CNN Business's published index. If CNN can't be reached (it sometimes blocks
// data-centre traffic), the route builds an estimate from the same kinds of signals CNN uses,
// with free Yahoo Finance data: each signal is ranked against its own past year (0 = most
// fearful reading of the year, 100 = most greedy) and the ranks are averaged.
import { yf, send, fail, num, time, NO_VALIDATE } from "./_lib/util.js";

const BANDS = [[25, "Extreme fear"], [45, "Fear"], [55, "Neutral"], [75, "Greed"], [Infinity, "Extreme greed"]];
const rating = (v) => (v == null ? null : BANDS.find(([max]) => v < max)[1]);
const round = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const DAY = 86400000;

const CNN_PARTS = [
  ["market_momentum_sp500", "Market momentum", "S&P 500 compared with its 125-day average"],
  ["stock_price_strength", "Stock price strength", "Stocks at 52-week highs vs 52-week lows"],
  ["stock_price_breadth", "Stock price breadth", "Volume in rising vs falling stocks"],
  ["put_call_options", "Put and call options", "Put/call ratio — more puts means more fear"],
  ["market_volatility_vix", "Market volatility", "VIX compared with its 50-day average"],
  ["safe_haven_demand", "Safe haven demand", "Stocks vs Treasury bonds over 20 days"],
  ["junk_bond_demand", "Junk bond demand", "Yield spread of junk bonds over investment grade"],
];

async function fromCnn() {
  const start = new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10);
  const r = await fetch(`https://production.dataviz.cnn.io/index/fearandgreed/graphdata/${start}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      Referer: "https://www.cnn.com/markets/fear-and-greed",
      Origin: "https://www.cnn.com",
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`CNN ${r.status}`);
  const d = await r.json();
  const fg = d?.fear_and_greed;
  const score = num(fg?.score);
  if (score == null) throw new Error("CNN: no score");
  const hist = (d.fear_and_greed_historical?.data || []).map((p) => [time(p.x), round(num(p.y))]).filter(([t, v]) => t && v != null);
  return {
    source: "cnn",
    score: round(score),
    rating: rating(score),
    previousClose: round(num(fg.previous_close)),
    week: round(num(fg.previous_1_week)),
    month: round(num(fg.previous_1_month)),
    year: round(num(fg.previous_1_year)),
    updated: time(fg.timestamp) || Date.now(),
    components: CNN_PARTS.map(([key, name, about]) => {
      const s = round(num(d[key]?.score));
      return s == null ? null : { key, name, about, score: s, rating: rating(s) };
    }).filter(Boolean),
    history: thin(hist),
  };
}

// ---- Estimate from market data ----
async function closes(symbol) {
  const data = await yf().chart(symbol, { period1: new Date(Date.now() - 1180 * DAY), interval: "1d" }, NO_VALIDATE);
  const m = new Map();
  for (const q of data?.quotes || []) {
    const t = time(q.date), c = num(q.adjclose ?? q.close) ?? num(q.close);
    if (t && c != null) m.set(new Date(t).toISOString().slice(0, 10), c);
  }
  return m;
}

function pctRank(values, i, window = 252) {
  const v = values[i]; if (v == null) return null;
  let below = 0, n = 0;
  for (let j = Math.max(0, i - window + 1); j <= i; j++) {
    if (values[j] == null) continue;
    n++; if (values[j] < v) below++; else if (values[j] === v) below += 0.5;
  }
  return n >= 60 ? (below / n) * 100 : null;
}

async function fromModel() {
  const syms = ["^GSPC", "^VIX", "TLT", "HYG", "IEF", "RSP"];
  const maps = await Promise.all(syms.map((s) => closes(s).catch(() => new Map())));
  const [spx, vix, tlt, hyg, ief, rsp] = maps;
  const keys = [...spx.keys()].sort();
  if (keys.length < 300) throw new Error("Not enough market history");
  // Carry forward the last known close so every series lines up with S&P 500 trading days.
  const align = (m) => { let last = null; return keys.map((k) => (m.has(k) ? (last = m.get(k)) : last)); };
  const S = align(spx), V = align(vix), T = align(tlt), H = align(hyg), I = align(ief), R = align(rsp);
  const ret = (a, i, n) => (i >= n && a[i] != null && a[i - n] ? a[i] / a[i - n] - 1 : null);
  const sma = (a, i, n) => { if (i < n - 1) return null; let s = 0; for (let j = i - n + 1; j <= i; j++) { if (a[j] == null) return null; s += a[j]; } return s / n; };
  const maxN = (a, i, n) => { let m = -Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) if (a[j] != null && a[j] > m) m = a[j]; return m; };
  const minN = (a, i, n) => { let m = Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) if (a[j] != null && a[j] < m) m = a[j]; return m; };

  const signals = [
    { key: "momentum", name: "Market momentum", about: "S&P 500 compared with its 125-day average",
      f: (i) => { const m = sma(S, i, 125); return m ? S[i] / m - 1 : null; },
      say: (v) => `S&P 500 is ${Math.abs(v * 100).toFixed(1)}% ${v >= 0 ? "above" : "below"} its 125-day average` },
    { key: "strength", name: "Stock price strength", about: "Where the S&P 500 sits in its 52-week range",
      f: (i) => { if (i < 250) return null; const hi = maxN(S, i, 252), lo = minN(S, i, 252); return hi > lo ? (S[i] - lo) / (hi - lo) : null; },
      say: (v) => `S&P 500 is ${Math.round(v * 100)}% of the way from its 52-week low to its high` },
    { key: "breadth", name: "Stock price breadth", about: "Equal-weight vs regular S&P 500 over 20 days",
      f: (i) => { const a = ret(R, i, 20), b = ret(S, i, 20); return a == null || b == null ? null : a - b; },
      say: (v) => `The average stock has ${v >= 0 ? "beaten" : "lagged"} the index by ${Math.abs(v * 100).toFixed(1)} pts over 20 days` },
    { key: "volatility", name: "Market volatility", about: "VIX compared with its 50-day average",
      f: (i) => { const m = sma(V, i, 50); return m ? -(V[i] / m - 1) : null; },
      say: (v) => `VIX is ${Math.abs(v * 100).toFixed(0)}% ${v <= 0 ? "above" : "below"} its 50-day average` },
    { key: "safehaven", name: "Safe haven demand", about: "Stocks vs Treasury bonds over 20 days",
      f: (i) => { const a = ret(S, i, 20), b = ret(T, i, 20); return a == null || b == null ? null : a - b; },
      say: (v) => `Stocks have ${v >= 0 ? "beaten" : "lagged"} long-term Treasuries by ${Math.abs(v * 100).toFixed(1)} pts over 20 days` },
    { key: "junk", name: "Junk bond demand", about: "High-yield vs investment-grade bonds over 20 days",
      f: (i) => { const a = ret(H, i, 20), b = ret(I, i, 20); return a == null || b == null ? null : a - b; },
      say: (v) => `Junk bonds have ${v >= 0 ? "beaten" : "lagged"} safer bonds by ${Math.abs(v * 100).toFixed(1)} pts over 20 days` },
  ];
  const raw = signals.map((s) => keys.map((_, i) => s.f(i)));
  const ranks = raw.map((vals) => keys.map((_, i) => pctRank(vals, i)));
  const composite = keys.map((_, i) => {
    const xs = ranks.map((r) => r[i]).filter((v) => v != null);
    return xs.length >= 4 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  });
  const last = composite.length - 1;
  const at = (back) => round(composite[last - back]);
  const hist = keys.map((k, i) => [Date.parse(k + "T21:00:00Z"), round(composite[i])]).filter(([t, v]) => v != null && t > Date.now() - 370 * DAY);
  return {
    source: "model",
    score: at(0),
    rating: rating(composite[last]),
    previousClose: at(1),
    week: at(5),
    month: at(21),
    year: at(252),
    updated: Date.parse(keys[last] + "T21:00:00Z"),
    components: signals.map((s, j) => {
      const sc = round(ranks[j][last]); const v = raw[j][last];
      return sc == null ? null : { key: s.key, name: s.name, about: s.about, score: sc, rating: rating(sc), detail: v == null ? null : s.say(v) };
    }).filter(Boolean),
    history: thin(hist),
  };
}

// Keep at most ~1 point per trading day for the past year.
function thin(points) { return points.slice(-260); }

export default async function handler(req, res) {
  try {
    let out;
    try { out = await fromCnn(); }
    catch (e) { out = await fromModel(); out.note = "CNN's index was unavailable, so this is an estimate built from market data."; }
    send(res, 200, { ...out, asOf: Date.now() }, 1800);
  } catch (e) { fail(res, e); }
}
