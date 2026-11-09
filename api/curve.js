// GET /api/curve -> US Treasury and Government of Canada yield curves, key spreads, the market-implied policy
// path, front-end volatility, credit spreads, real yields, and a plain-English read of what it means for banks.
//
// Sources (all free, no keys):
//   US curve:  U.S. Treasury daily par yield curve CSV (home.treasury.gov)
//   Canada:    Bank of Canada Valet API (benchmark bonds, T-bills, overnight rate)
//   FRED:      effective fed funds (DFF), SOFR, IORB, ICE BofA credit spreads (BAMLC0A0CM, BAMLH0A0HYM2),
//              10-yr real yield (DFII10) and breakeven inflation (T10YIE)
//   MOVE:      Yahoo Finance (^MOVE), implied volatility on a blend of 2/5/10/30-yr Treasuries
import { send, fail, chartPoints } from "./_lib/util.js";
import { text, fred, valet, asOf, daysAgo, DAY } from "./_lib/rates.js";

const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const r0 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v));

function tenorOf(label) {
  const m = String(label).trim().replace(/"/g, "").match(/^([\d.]+)\s*(mo|month|months|yr|year|years)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return /^mo/i.test(m[2]) ? n / 12 : n;
}
const splitCsv = (line) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).slice(0, -1).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").trim());

export function parseTreasury(csv) {
  const lines = String(csv).trim().split(/\r?\n/);
  const cols = splitCsv(lines[0]).map((h) => ({ h, t: tenorOf(h) }));
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

const CA_SERIES = [
  ["TB.CDN.90D.MID", 0.25], ["TB.CDN.180D.MID", 0.5], ["TB.CDN.1Y.MID", 1],
  ["BD.CDN.2YR.DQ.YLD", 2], ["BD.CDN.3YR.DQ.YLD", 3], ["BD.CDN.5YR.DQ.YLD", 5],
  ["BD.CDN.7YR.DQ.YLD", 7], ["BD.CDN.10YR.DQ.YLD", 10], ["BD.CDN.LONG.DQ.YLD", 30],
];
async function caCurve(errors) {
  const got = await Promise.allSettled(CA_SERIES.map(([s]) => valet(s, 400)));
  const byDate = {};
  got.forEach((g, i) => {
    if (g.status !== "fulfilled") { errors.push(`Bank of Canada series ${CA_SERIES[i][0]} unavailable`); return; }
    for (const [d, v] of g.value) (byDate[d] ||= {})[CA_SERIES[i][1]] = v;
  });
  const rows = Object.entries(byDate).map(([date, pts]) => ({ date, pts })).filter((r) => Object.keys(r.pts).length >= 4).sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) throw new Error("Bank of Canada yields unavailable");
  return rows;
}
const policyPoint = (obs) => (obs?.length ? { now: obs.at(-1)[1], m3: asOf(obs, daysAgo(91)), yearAgo: asOf(obs, daysAgo(365)), date: obs.at(-1)[0] } : null);

function at(pts, t) {
  if (pts[t] != null) return pts[t];
  const ks = Object.keys(pts).map(Number).sort((a, b) => a - b);
  const lo = ks.filter((k) => k < t).at(-1), hi = ks.find((k) => k > t);
  if (lo == null || hi == null) return null;
  return pts[lo] + ((pts[hi] - pts[lo]) * (t - lo)) / (hi - lo);
}
const closest = (rows, back) => { const target = daysAgo(back); return rows.filter((r) => r.date <= target).at(-1) || rows[0]; };
const rms = (xs) => (xs.length >= 5 ? Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length) : null); // zero-mean, the rates convention
function pctRank(xs, v) { const ok = xs.filter((x) => x != null); if (!ok.length || v == null) return null; return Math.round((ok.filter((x) => x < v).length / ok.length) * 100); }

// One shape rule used everywhere on the site.
export function shapeOf(s2s10s, s3m10y) {
  if (s2s10s == null) return null;
  if (s2s10s < -10 && (s3m10y ?? 0) < 0) return "Inverted";
  if (Math.abs(s2s10s) <= 25) return "Flat";
  if (s2s10s > 100) return "Steep";
  return "Upward-sloping";
}

export function analyze(rows) {
  const last = rows.at(-1), m1 = closest(rows, 30), m3 = closest(rows, 91), y1 = closest(rows, 365);
  const spread = (r, a, b) => { const x = at(r.pts, a), y = at(r.pts, b); return x == null || y == null ? null : (y - x) * 100; };
  const S = (r) => ({ y3m: at(r.pts, 0.25), y1: at(r.pts, 1), y2: at(r.pts, 2), y5: at(r.pts, 5), y10: at(r.pts, 10), y30: at(r.pts, 30), s2s10s: spread(r, 2, 10), s3m10y: spread(r, 0.25, 10), s5s30s: spread(r, 5, 30) });
  const now = S(last), a1 = S(m1), a3 = S(m3), ay = S(y1);
  const chg = (k, base) => (now[k] != null && base[k] != null ? (now[k] - base[k]) * (k.startsWith("s") ? 1 : 100) : null);

  // Front-end volatility: 20-day realised vol of daily 2-yr changes (zero-mean), annualised, bp/yr.
  const d2s = [];
  for (let i = 1; i < rows.length; i++) { const a = at(rows[i - 1].pts, 2), b = at(rows[i].pts, 2); if (a != null && b != null) d2s.push({ date: rows[i].date, d: (b - a) * 100 }); }
  const vol = [];
  for (let i = 20; i <= d2s.length; i++) { const s = rms(d2s.slice(i - 20, i).map((x) => x.d)); if (s != null) vol.push([d2s[i - 1].date, s * Math.sqrt(252)]); }
  const volNow = vol.at(-1)?.[1] ?? null;
  const volYear = vol.slice(-252).map((v) => v[1]);
  const big = d2s.slice(-21).filter((x) => Math.abs(x.d) >= 10).length;

  // Regime: thresholds scale with volatility so ordinary noise isn't labelled a regime.
  const regime = (base, label, h) => {
    const d2 = chg("y2", base), d10 = chg("y10", base);
    if (d2 == null || d10 == null) return null;
    const noise = Math.max(10, 0.25 * (volNow ?? 80) * Math.sqrt(h / 252));
    const slope = d10 - d2, level = (d2 + d10) / 2;
    const twist = Math.sign(d2) !== Math.sign(d10) && Math.abs(d2) >= noise / 2 && Math.abs(d10) >= noise / 2;
    const steep = slope > noise ? "steepener" : slope < -noise ? "flattener" : null;
    const dir = level < -noise ? "bull" : level > noise ? "bear" : null;
    let name, why = "";
    if (twist) { name = slope > 0 ? "Steepening twist" : "Flattening twist"; why = slope > 0 ? "short rates fell while long rates rose" : "short rates rose while long rates fell"; }
    else if (steep) {
      name = `${dir ? dir[0].toUpperCase() + dir.slice(1) + " " : ""}${steep}`;
      why = steep === "steepener"
        ? dir === "bull" ? "short rates falling faster than long rates (markets pricing cuts)" : dir === "bear" ? "long rates rising faster than short rates (term premium, inflation or supply worries)" : "the curve tilting steeper"
        : dir === "bear" ? "short rates rising faster than long rates (markets pricing hikes)" : dir === "bull" ? "long rates falling faster than short rates (growth worries or flight to safety)" : "the curve tilting flatter";
    } else name = dir ? `Parallel ${dir === "bull" ? "rally" : "sell-off"}` : "Within normal noise";
    return { label, name, why, d2: r0(d2), d10: r0(d10), slope: r0(slope), noise: r0(noise) };
  };

  const hist = rows.filter((r) => r.date >= y1.date).map((r) => { const s = S(r); return [r.date, r2(s.s2s10s), r2(s.s3m10y), r2(s.y2), r2(s.y10)]; });
  const curve = (r) => ({ date: r.date, pts: Object.entries(r.pts).map(([t, v]) => [Number(t), v]).sort((a, b) => a[0] - b[0]) });
  return {
    curves: { now: curve(last), m1: curve(m1), y1: curve(y1) },
    levels: Object.fromEntries(Object.entries(now).map(([k, v]) => [k, k.startsWith("s") ? r0(v) : r2(v)])),
    changes: { m1: Object.fromEntries(Object.keys(now).map((k) => [k, r0(chg(k, a1))])), m3: Object.fromEntries(Object.keys(now).map((k) => [k, r0(chg(k, a3))])), y1: Object.fromEntries(Object.keys(now).map((k) => [k, r0(chg(k, ay))])) },
    shape: shapeOf(now.s2s10s, now.s3m10y), regime: { m1: regime(a1, "1 month", 21), m3: regime(a3, "3 months", 63) },
    frontVol: { now: r0(volNow), pct: pctRank(volYear, volNow), bigDays: big, series: vol.slice(-252).map(([d, v]) => [d, r0(v)]) },
    history: hist, asOfDate: last.date,
  };
}

// Spreads anchored on the policy rate (what deposits actually reprice from) and the priced policy path.
function policyView(c, policy) {
  if (!c || !policy) return null;
  const L = c.levels;
  const bp = (y) => (y == null ? null : r0((y - policy.now) * 100));
  return {
    rate: policy.now, s5: bp(L.y5), s10: bp(L.y10),
    priced1y: bp(L.y1), priced2y: bp(L.y2), // + = markets expect the policy rate to rise
    movesPriced1y: L.y1 != null ? Math.round(((L.y1 - policy.now) * 100) / 25 * 10) / 10 : null,
  };
}

function bankRead(us, ca, fed, extra, move) {
  const out = [];
  if (us) {
    const p = us.policy, s = us.levels.s2s10s, shape = us.shape;
    out.push({ k: "Margins", t: `The US curve is ${shape.toLowerCase()} (2s10s ${s >= 0 ? "+" : ""}${s} bp). For bank margins the policy-rate spread matters more: deposits reprice off fed funds, partly and with a lag (the deposit beta), so ${p ? `the 5-yr is ${p.s5 >= 0 ? "+" : ""}${p.s5} bp and the 10-yr ${p.s10 >= 0 ? "+" : ""}${p.s10} bp over fed funds. ` : ""}${p && p.s5 > 50 ? "That is room for assets to reprice above funding costs, if deposit betas stay low and credit holds." : p && p.s5 < 0 ? "Funding costs sit above medium-term yields, which squeezes margins unless deposit costs lag." : "That gives limited room from term spread; repricing of older low-yield assets does more of the work."}` });
    if (p?.movesPriced1y != null) out.push({ k: "Priced path", t: `The 1-yr Treasury is ${p.priced1y >= 0 ? "+" : ""}${p.priced1y} bp vs fed funds, roughly ${Math.abs(p.movesPriced1y)} quarter-point ${p.movesPriced1y >= 0 ? "hikes" : "cuts"} priced over the next year (rough: term premium is included). ${p.movesPriced1y > 0.5 ? "Hikes lift floating-rate loan yields quickly but deposit costs follow, so watch each bank's deposit beta." : p.movesPriced1y < -0.5 ? "Cuts would help funding costs fall, but hurt asset-sensitive banks with floating-rate loans." : ""}` });
    const r = us.regime.m3;
    if (r) out.push({ k: "Regime", t: `Over 3 months: ${r.name.toLowerCase()} (2-yr ${r.d2 >= 0 ? "+" : ""}${r.d2} bp, 10-yr ${r.d10 >= 0 ? "+" : ""}${r.d10} bp; moves under ${r.noise} bp are treated as noise)${r.why ? `, ${r.why}` : ""}.${extra?.realChg != null ? ` The 10-yr move split: real yield ${extra.realChg >= 0 ? "+" : ""}${extra.realChg} bp, breakeven inflation ${extra.beChg >= 0 ? "+" : ""}${extra.beChg} bp.` : ""} ${/bear steepener/i.test(r.name) ? "Rising long yields add unrealised losses on banks' bond holdings (AOCI)." : /bull steepener/i.test(r.name) ? "Falling short rates help funding costs but hurt asset-sensitive banks." : ""}` });
  }
  if (extra?.hy != null) out.push({ k: "Credit", t: `High-yield spreads are ${extra.hy} bp (${extra.hyChg >= 0 ? "+" : ""}${extra.hyChg} bp in 3 months), investment grade ${extra.ig} bp. ${extra.hyChg > 75 ? "Credit is pricing more losses: a margin tailwind may not reach earnings if provisions rise." : "No sign of credit stress in spreads yet, which keeps loan-loss risk in check for now."}` });
  if (us?.frontVol?.now != null) out.push({ k: "Trading", t: `2-yr realised volatility is ${us.frontVol.now} bp/yr, higher than ${us.frontVol.pct}% of the past year, with ${us.frontVol.bigDays} day${us.frontVol.bigDays === 1 ? "" : "s"} of 10 bp+ moves in the last month.${move?.now != null ? ` MOVE (implied, blended maturities) is ${move.now}, ${move.now - us.frontVol.now >= 0 ? "+" : ""}${move.now - us.frontVol.now} vs realised.` : ""} More volatility can mean more client hedging for rates and derivatives desks, but only if clients trade and desks manage inventory risk. Check the trading-desk results below: volatility does not guarantee a strong FICC quarter.${extra?.sofrIorb != null ? ` SOFR − IORB: ${extra.sofrIorb >= 0 ? "+" : ""}${extra.sofrIorb} bp (repo funding pressure when positive).` : ""}` });
  if (ca) out.push({ k: "Canada", t: `Bank of Canada ${ca.boc ? `${ca.boc.now.toFixed(2)}%` : "—"}${fed ? ` vs fed funds ${fed.now.toFixed(2)}%` : ""}; 2-yr yields ${extra?.usCa2y != null ? `${extra.usCa2y} bp apart (US higher), a gap that tends to weigh on the Canadian dollar and lifts the CAD value of TD's and BMO's US earnings` : "—"}. The 5-yr GoC, the mortgage benchmark, is ${ca.levels.y5 != null ? `${ca.levels.y5.toFixed(2)}%` : "—"}${extra?.renewalGap != null ? `, ${extra.renewalGap >= 0 ? "+" : ""}${extra.renewalGap} bp vs five years ago, so fixed mortgages renewing now ${extra.renewalGap > 0 ? "reprice higher, lifting asset yields over time (and stretching some borrowers)" : "reprice lower"}` : ""}.` });
  return out;
}

export default async function handler(req, res) {
  try {
    if (Object.keys(req.query || {}).length) return send(res, 400, { error: "This endpoint takes no parameters." }, 3600);
    const errors = [];
    const [us, ca, fedObs, bocObs, move, sofr, iorb, hy, ig, real, be, ca5] = await Promise.allSettled([
      usCurve(), caCurve(errors), fred("DFF", 400), valet("V39079", 400), chartPoints("^MOVE", "1y"),
      fred("SOFR", 30), fred("IORB", 30), fred("BAMLH0A0HYM2", 120), fred("BAMLC0A0CM", 120), fred("DFII10", 120), fred("T10YIE", 120),
      valet("BD.CDN.5YR.DQ.YLD", 5 * 365 + 30),
    ]);
    const names = ["US Treasury curve", "Canada curve", "Fed funds (FRED)", "BoC rate", "MOVE", "SOFR", "IORB", "HY spread", "IG spread", "Real yield", "Breakeven"];
    [us, ca, fedObs, bocObs, move, sofr, iorb, hy, ig, real, be].forEach((x, i) => { if (x.status === "rejected") errors.push(`${names[i]}: ${String(x.reason?.message || x.reason)}`); });
    const val = (x) => (x.status === "fulfilled" ? x.value : null);
    const fed = policyPoint(val(fedObs)), boc = policyPoint(val(bocObs));
    const US = val(us) ? analyze(us.value) : null;
    const CA = val(ca) ? { ...analyze(ca.value), boc } : null;
    if (US) US.policy = policyView(US, fed);
    if (CA) CA.policy = policyView(CA, boc);
    const last = (o) => o?.at(-1)?.[1] ?? null;
    const chg3m = (o) => (o?.length ? r0((last(o) - (asOf(o, daysAgo(91)) ?? o[0][1])) * 100) : null);
    const hyO = val(hy), igO = val(ig), reO = val(real), beO = val(be), c5 = val(ca5);
    const extra = {
      hy: hyO ? r0(last(hyO) * 100) : null, hyChg: hyO ? r0((last(hyO) - (asOf(hyO, daysAgo(91)) ?? hyO[0][1])) * 100) : null,
      ig: igO ? r0(last(igO) * 100) : null,
      real10: r2(last(reO)), be10: r2(last(beO)), realChg: reO ? chg3m(reO) : null, beChg: beO ? chg3m(beO) : null,
      sofr: r2(last(val(sofr))), iorb: r2(last(val(iorb))), sofrIorb: val(sofr) && val(iorb) ? r0((last(val(sofr)) - last(val(iorb))) * 100) : null,
      usCa2y: US && CA && US.levels.y2 != null && CA.levels.y2 != null ? r0((US.levels.y2 - CA.levels.y2) * 100) : null,
      renewalGap: c5?.length > 200 ? r0((last(c5) - c5[0][1]) * 100) : null, renewalFrom: c5?.[0]?.[0] ?? null,
    };
    const mv = val(move)?.points || [];
    const moveObj = mv.length ? { now: r0(mv.at(-1)[1]), pct: pctRank(mv.map((p) => p[1]), mv.at(-1)[1]), series: mv.map(([t, v]) => [new Date(t).toISOString().slice(0, 10), r0(v)]) } : null;
    if (!US && !CA) return send(res, 503, { error: errors.join("; ") || "No curve data", errors }, 0);
    send(res, 200, { us: US, ca: CA, fed, extra, move: moveObj, read: bankRead(US, CA, fed, extra, moveObj), errors, asOf: Date.now() }, 3 * 3600);
  } catch (e) { fail(res, e); }
}
