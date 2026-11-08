// GET /api/curve -> US Treasury and Government of Canada yield curves, key spreads, front-end volatility,
// policy rates, and a plain-English read of what the curve means for banks.
//
// Sources (all free, no keys):
//   US curve:   U.S. Treasury daily par yield curve CSV (home.treasury.gov)
//   Canada:     Bank of Canada Valet API (benchmark bond yields and T-bills)
//   Fed funds:  FRED (effective federal funds rate, DFF)
//   MOVE index: Yahoo Finance (^MOVE), the bond market's "VIX"
import { send, fail, chartPoints } from "./_lib/util.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; kcm-research-dashboard/1.0)" };
const DAY = 86400000;
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const r0 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v));

async function text(url, ms = 8000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.text();
}

// "1 Mo" -> 1/12, "1.5 Month" -> 0.125, "2 Yr" -> 2
function tenorOf(label) {
  const m = String(label).trim().replace(/"/g, "").match(/^([\d.]+)\s*(mo|month|months|yr|year|years)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return /^mo/i.test(m[2]) ? n / 12 : n;
}
const splitCsv = (line) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).slice(0, -1).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").trim());

// ---- US Treasury ----
export function parseTreasury(csv) {
  const lines = String(csv).trim().split(/\r?\n/);
  const head = splitCsv(lines[0]);
  const cols = head.map((h) => ({ h, t: tenorOf(h) }));
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsv(line);
    const [mm, dd, yy] = (cells[0] || "").split("/");
    if (!yy) continue;
    const date = `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    const pts = {};
    cols.forEach((c, i) => { if (c.t != null && cells[i] !== "" && Number.isFinite(Number(cells[i]))) pts[c.t] = Number(cells[i]); });
    if (Object.keys(pts).length >= 4) rows.push({ date, pts });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
async function usCurve() {
  const y = new Date().getUTCFullYear();
  const url = (yr) => `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${yr}&page&_format=csv`;
  const [a, b] = await Promise.allSettled([text(url(y - 1)), text(url(y))]);
  const rows = [...(a.status === "fulfilled" ? parseTreasury(a.value) : []), ...(b.status === "fulfilled" ? parseTreasury(b.value) : [])];
  if (!rows.length) throw new Error("Treasury yield curve unavailable");
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.date) ? false : seen.add(r.date)));
}

// ---- Canada (Bank of Canada Valet) ----
const CA_SERIES = [
  ["TB.CDN.90D.MID", 0.25], ["TB.CDN.180D.MID", 0.5], ["TB.CDN.1Y.MID", 1],
  ["BD.CDN.2YR.DQ.YLD", 2], ["BD.CDN.3YR.DQ.YLD", 3], ["BD.CDN.5YR.DQ.YLD", 5],
  ["BD.CDN.7YR.DQ.YLD", 7], ["BD.CDN.10YR.DQ.YLD", 10], ["BD.CDN.LONG.DQ.YLD", 30],
];
async function valet(series, start) {
  const j = JSON.parse(await text(`https://www.bankofcanada.ca/valet/observations/${series}/json?start_date=${start}`));
  return (j.observations || []).map((o) => [o.d, Number(o[series]?.v)]).filter(([d, v]) => d && Number.isFinite(v));
}
async function caCurve() {
  const start = new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10);
  const got = await Promise.allSettled(CA_SERIES.map(([s]) => valet(s, start)));
  const byDate = {};
  got.forEach((g, i) => { if (g.status !== "fulfilled") return; for (const [d, v] of g.value) (byDate[d] ||= {})[CA_SERIES[i][1]] = v; });
  const rows = Object.entries(byDate).map(([date, pts]) => ({ date, pts })).filter((r) => Object.keys(r.pts).length >= 4).sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) throw new Error("Bank of Canada yields unavailable");
  return rows;
}
async function bocRate() {
  const start = new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10);
  const obs = await valet("V39079", start); // target for the overnight rate
  return obs.length ? { now: obs.at(-1)[1], yearAgo: obs.find(([d]) => d >= new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10))?.[1] ?? null, date: obs.at(-1)[0] } : null;
}
async function fedFunds() {
  const start = new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10);
  const csv = await text(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFF&cosd=${start}`);
  const obs = csv.trim().split(/\r?\n/).slice(1).map((l) => l.split(",")).map(([d, v]) => [d, Number(v)]).filter(([, v]) => Number.isFinite(v));
  return obs.length ? { now: obs.at(-1)[1], yearAgo: obs.find(([d]) => d >= new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10))?.[1] ?? null, date: obs.at(-1)[0] } : null;
}

// ---- Analytics ----
// Value at tenor t, interpolating linearly between the nearest available tenors.
function at(pts, t) {
  if (pts[t] != null) return pts[t];
  const ks = Object.keys(pts).map(Number).sort((a, b) => a - b);
  const lo = ks.filter((k) => k < t).at(-1), hi = ks.find((k) => k > t);
  if (lo == null || hi == null) return null;
  return pts[lo] + ((pts[hi] - pts[lo]) * (t - lo)) / (hi - lo);
}
const closest = (rows, daysBack) => {
  const target = new Date(Date.now() - daysBack * DAY).toISOString().slice(0, 10);
  return rows.filter((r) => r.date <= target).at(-1) || rows[0];
};
function stdev(xs) { if (xs.length < 5) return null; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); }
function pctRank(xs, v) { const ok = xs.filter((x) => x != null); if (!ok.length || v == null) return null; return Math.round((ok.filter((x) => x < v).length / ok.length) * 100); }

export function analyze(rows) {
  const last = rows.at(-1), m1 = closest(rows, 30), m3 = closest(rows, 91), y1 = closest(rows, 365);
  const spread = (r, a, b) => { const x = at(r.pts, a), y = at(r.pts, b); return x == null || y == null ? null : (y - x) * 100; };
  const S = (r) => ({ y3m: at(r.pts, 0.25), y2: at(r.pts, 2), y5: at(r.pts, 5), y10: at(r.pts, 10), y30: at(r.pts, 30), s2s10s: spread(r, 2, 10), s3m10y: spread(r, 0.25, 10), s5s30s: spread(r, 5, 30) });
  const now = S(last), a1 = S(m1), a3 = S(m3), ay = S(y1);
  const chg = (k, base) => (now[k] != null && base[k] != null ? (now[k] - base[k]) * (k.startsWith("s") ? 1 : 100) : null); // bps

  // Regime: who moved more, the front end or the long end?
  const regime = (base, label) => {
    const d2 = chg("y2", base), d10 = chg("y10", base);
    if (d2 == null || d10 == null) return null;
    const slope = d10 - d2, level = (d2 + d10) / 2;
    const steep = slope > 5 ? "steepener" : slope < -5 ? "flattener" : null;
    const dir = level < -3 ? "bull" : level > 3 ? "bear" : null;
    const name = steep ? `${dir ? dir[0].toUpperCase() + dir.slice(1) + " " : ""}${steep}` : dir ? `Parallel ${dir === "bull" ? "rally" : "sell-off"}` : "Little changed";
    const why = !steep ? "" : steep === "steepener"
      ? dir === "bull" ? "short rates falling faster than long rates (markets pricing cuts)" : dir === "bear" ? "long rates rising faster than short rates (term premium / inflation or supply worries)" : "the curve tilting steeper"
      : dir === "bear" ? "short rates rising faster than long rates (markets pricing hikes)" : dir === "bull" ? "long rates falling faster than short rates (growth worries / flight to safety)" : "the curve tilting flatter";
    return { label, name, why, d2: r0(d2), d10: r0(d10), slope: r0(slope) };
  };

  // Shape of today's curve.
  const s2 = now.s2s10s, s3 = now.s3m10y;
  const belly = Math.max(at(last.pts, 2) ?? -99, at(last.pts, 5) ?? -99);
  const humped = belly > (at(last.pts, 0.25) ?? 99) + 0.1 && belly > (at(last.pts, 10) ?? 99) + 0.1;
  const shape = s2 == null ? null : s2 < -10 && (s3 ?? 0) < 0 ? "Inverted" : humped ? "Humped" : Math.abs(s2) <= 25 ? "Flat" : s2 > 100 ? "Steep" : "Upward-sloping";

  // Front-end volatility: 20-day realised vol of daily 2-year yield changes, annualised, in bps.
  const d2s = [];
  for (let i = 1; i < rows.length; i++) { const a = at(rows[i - 1].pts, 2), b = at(rows[i].pts, 2); if (a != null && b != null) d2s.push({ date: rows[i].date, d: (b - a) * 100 }); }
  const vol = [];
  for (let i = 20; i <= d2s.length; i++) { const s = stdev(d2s.slice(i - 20, i).map((x) => x.d)); if (s != null) vol.push([d2s[i - 1].date, s * Math.sqrt(252)]); }
  const volNow = vol.at(-1)?.[1] ?? null;
  const volYear = vol.slice(-252).map((v) => v[1]);
  const big = d2s.slice(-21).filter((x) => Math.abs(x.d) >= 10).length;

  const hist = rows.filter((r) => r.date >= y1.date).map((r) => { const s = S(r); return [r.date, r2(s.s2s10s), r2(s.s3m10y), r2(s.y2), r2(s.y10)]; });
  const curve = (r) => ({ date: r.date, pts: Object.entries(r.pts).map(([t, v]) => [Number(t), v]).sort((a, b) => a[0] - b[0]) });
  return {
    curves: { now: curve(last), m1: curve(m1), y1: curve(y1) },
    levels: Object.fromEntries(Object.entries(now).map(([k, v]) => [k, k.startsWith("s") ? r0(v) : r2(v)])),
    changes: { m1: Object.fromEntries(Object.keys(now).map((k) => [k, r0(chg(k, a1))])), m3: Object.fromEntries(Object.keys(now).map((k) => [k, r0(chg(k, a3))])), y1: Object.fromEntries(Object.keys(now).map((k) => [k, r0(chg(k, ay))])) },
    shape, regime: { m1: regime(a1, "1 month"), m3: regime(a3, "3 months") },
    frontVol: { now: r0(volNow), pct: pctRank(volYear, volNow), bigDays: big, series: vol.slice(-252).map(([d, v]) => [d, r0(v)]) },
    history: hist, asOfDate: last.date,
  };
}

function bankRead(us, ca, fed, move) {
  const out = [];
  if (us) {
    const s = us.levels.s2s10s, r = us.regime.m3;
    out.push({
      k: "NIM",
      t: s == null ? "" : s > 50
        ? `A ${s} bp 2s10s slope is a tailwind: banks fund at the short end (deposits, which reprice with the policy rate) and lend or invest further out. New loans and maturing securities reinvest at higher yields than the deposits funding them, so margins tend to widen, especially at banks with lots of fixed-rate assets repricing.`
        : s < 0 ? `An inverted curve (2s10s ${s} bp) squeezes margins: deposit costs track the high short end while long-dated assets earn less. Asset-sensitive banks (floating-rate loans, sticky low-cost deposits) hold up best.`
        : `A flat curve (2s10s ${s} bp) gives little help from term spread. NIM growth has to come from asset repricing (old low-yield loans and bonds rolling off) and from holding deposit costs down.`,
    });
    if (r) out.push({ k: "Regime", t: `Over 3 months the US curve has seen a ${r.name.toLowerCase()} (2-yr ${r.d2 >= 0 ? "+" : ""}${r.d2} bp, 10-yr ${r.d10 >= 0 ? "+" : ""}${r.d10} bp)${r.why ? `: ${r.why}` : ""}. ${/bear flattener/i.test(r.name) ? "Rising short rates lift floating-rate loan yields quickly, but deposit costs follow, so watch deposit betas." : /steepener/i.test(r.name) ? "Steepening is usually the friendliest move for bank margins." : ""}` });
  }
  if (us?.frontVol?.now != null) out.push({ k: "Trading", t: `Front-end volatility: the 2-yr yield is moving about ${us.frontVol.now} bp a year (20-day realised), higher than ${us.frontVol.pct}% of the past year, with ${us.frontVol.bigDays} day${us.frontVol.bigDays === 1 ? "" : "s"} of 10 bp+ moves in the last month.${move != null ? ` The MOVE index is ${move.toFixed(0)}.` : ""} Higher rates volatility usually means more client hedging and wider bid-ask spreads for FICC and rates-derivatives desks. But it only becomes revenue if clients trade and desks don't get caught on the wrong side, so check it against reported FICC results.` });
  if (fed && ca?.levels) out.push({ k: "Canada vs US", t: `${fed ? `Effective fed funds ${fed.now.toFixed(2)}%` : ""}${ca.boc ? ` vs Bank of Canada ${ca.boc.now.toFixed(2)}%` : ""}. Canada's 2s10s is ${ca.levels.s2s10s} bp vs ${us?.levels?.s2s10s ?? "—"} bp in the US. Canadian bank margins also depend on mortgage renewals: 5-year fixed mortgages written in 2021 are renewing at much higher rates, which lifts asset yields over time.` });
  return out;
}

export default async function handler(req, res) {
  try {
    const [us, ca, fed, boc, move] = await Promise.allSettled([usCurve(), caCurve(), fedFunds(), bocRate(), chartPoints("^MOVE", "1y")]);
    const errors = [us, ca, fed, boc, move].filter((x) => x.status === "rejected").map((x) => String(x.reason?.message || x.reason));
    const US = us.status === "fulfilled" ? analyze(us.value) : null;
    const CA = ca.status === "fulfilled" ? { ...analyze(ca.value), boc: boc.status === "fulfilled" ? boc.value : null } : null;
    const FED = fed.status === "fulfilled" ? fed.value : null;
    const mv = move.status === "fulfilled" ? move.value.points : [];
    const moveNow = mv.at(-1)?.[1] ?? null;
    if (!US && !CA) throw new Error(errors.join("; ") || "No curve data");
    send(res, 200, {
      us: US, ca: CA, fed: FED,
      move: mv.length ? { now: r0(moveNow), pct: pctRank(mv.map((p) => p[1]), moveNow), series: mv.map(([t, v]) => [new Date(t).toISOString().slice(0, 10), r0(v)]) } : null,
      read: bankRead(US, CA, FED, moveNow), errors, asOf: Date.now(),
    }, 3 * 3600);
  } catch (e) { fail(res, e); }
}
