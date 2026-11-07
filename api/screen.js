// GET /api/screen -> the undervalued-financials screen.
//
// Each stock in _lib/universe.js is measured on four things:
//   1. Value vs its own peers.
//      - Banks, insurers and holdcos: price/book adjusted for return on equity. A 16%-ROE bank
//        deserves a higher P/B than a 9% one, so we fit ln(P/B) against forward ROE within peer groups
//        and score the residual ("cheap for the returns it earns"). Raw P/B vs the peer median is the
//        secondary measure.
//      - Fee businesses (managers, exchanges, payments, brokers): forward P/E vs peers.
//      Peer medians leave the stock itself out and are pulled toward the sector median when a group is small.
//      TSX names that report in USD (FFH, BN, BAM, ONEX, ...) are converted to CAD first.
//   2. The Street: analyst upside to the average target, the consensus rating, and the 90-day revision
//      to next year's EPS estimate.
//   3. Why it fell. Each stock's 3-month move is split into the part its sector ETF explains
//      (beta × ETF move; that is the macro / news-cycle discount the club is hunting for) and its own part.
//      Daily-return correlations with the 10-yr yield, high-yield credit, oil and USD/CAD show what moves it.
//   4. Quality: return on equity ranked within the peer group, plus value-trap flags.
// The "why it's cheap" headlines for each name come from /api/catalysts.
import { yf, send, fail, num, time, NO_VALIDATE } from "./_lib/util.js";
import { pool, quotes, ranks, clip, r1, DAY } from "./_lib/screen.js";
import { UNIVERSE, GROUPS, FACTORS, exchangeOf, capTier } from "./_lib/universe.js";

const med = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (v) => (v == null ? null : v * 100);
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const SHRINK = 4; // pseudo-peers pulling a small group's median toward the sector median

export function analystLabel(mean) {
  if (mean == null) return null;
  return mean <= 1.5 ? "Strong buy" : mean <= 2.5 ? "Buy" : mean <= 3.5 ? "Hold" : mean <= 4.5 ? "Sell" : "Strong sell";
}

// ---------- Fetch ----------
async function details(symbol) {
  const s = await yf().quoteSummary(symbol, { modules: ["financialData", "defaultKeyStatistics", "summaryDetail", "earningsTrend", "recommendationTrend"] }, NO_VALIDATE);
  const f = s.financialData || {}, k = s.defaultKeyStatistics || {}, d = s.summaryDetail || {};
  const trend = s.earningsTrend?.trend || [];
  const pick = (p) => trend.find((t) => t.period === p);
  const ny = pick("+1y"), cy = pick("0y");
  const rev = (t) => {
    const e = t?.epsTrend; if (!e) return null;
    const now = num(e.current), ago = num(e["90daysAgo"]);
    // A near-zero base turns tiny changes into huge percentages, so skip it.
    return now != null && ago != null && Math.abs(ago) >= 0.1 ? ((now - ago) / Math.abs(ago)) * 100 : null;
  };
  const rt = (s.recommendationTrend?.trend || []).find((t) => t.period === "0m") || {};
  return {
    finCcy: f.financialCurrency || null,
    target: num(f.targetMeanPrice), targetHigh: num(f.targetHighPrice), targetLow: num(f.targetLowPrice),
    recMean: num(f.recommendationMean), analysts: num(f.numberOfAnalystOpinions),
    roe: pct(num(f.returnOnEquity)),
    pb: num(k.priceToBook), bookValue: num(k.bookValue), fwdEps: num(k.forwardEps),
    divRate: num(d.dividendRate), payout: pct(num(d.payoutRatio)),
    beta: num(d.beta ?? k.beta3Year),
    rev90: rev(ny) ?? rev(cy),
    growthNext: num(ny?.growth) != null ? num(ny.growth) * 100 : null,
    counts: { buy: (num(rt.strongBuy) || 0) + (num(rt.buy) || 0), hold: num(rt.hold) || 0, sell: (num(rt.sell) || 0) + (num(rt.strongSell) || 0) },
  };
}

// Daily closes keyed by date, about 13 months back.
async function closes(symbol) {
  const r = await yf().chart(symbol, { period1: new Date(Date.now() - 400 * DAY), interval: "1d" }, NO_VALIDATE);
  const m = new Map();
  for (const q of r?.quotes || []) {
    const t = time(q.date), c = num(q.adjclose ?? q.close) ?? num(q.close);
    if (t && c != null) m.set(new Date(t).toISOString().slice(0, 10), c);
  }
  return m;
}

// ---------- Return math ----------
// Paired daily returns on dates both series traded; `diff` uses changes instead of % returns (yields).
function paired(a, b, diffB = false) {
  const keys = [...a.keys()].filter((k) => b.has(k)).sort();
  const ra = [], rb = [];
  for (let i = 1; i < keys.length; i++) {
    const a0 = a.get(keys[i - 1]), a1 = a.get(keys[i]), b0 = b.get(keys[i - 1]), b1 = b.get(keys[i]);
    if (!a0 || !b0) continue;
    ra.push(a1 / a0 - 1);
    rb.push(diffB ? b1 - b0 : b1 / b0 - 1);
  }
  return { ra: ra.slice(-250), rb: rb.slice(-250), keys };
}
function betaCorr(ra, rb) {
  if (ra.length < 60) return { beta: null, corr: null };
  const ma = mean(ra), mb = mean(rb);
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < ra.length; i++) { const x = ra[i] - ma, y = rb[i] - mb; cov += x * y; va += x * x; vb += y * y; }
  return { beta: vb ? cov / vb : null, corr: va && vb ? cov / Math.sqrt(va * vb) : null };
}
// Return over the last n trading days, on dates shared with the ETF.
function retOver(m, keys, n) {
  const ks = keys.filter((k) => m.has(k));
  if (ks.length <= n) return null;
  return (m.get(ks.at(-1)) / m.get(ks[ks.length - 1 - n]) - 1) * 100;
}

// Percentile ranks computed separately inside each bucket (e.g. P/B family vs P/E family).
function ranksBy(list, value, bucket, minSize = 4) {
  const out = new Array(list.length).fill(null);
  const groups = {};
  list.forEach((s, i) => (groups[bucket(s)] ||= []).push(i));
  const all = ranks(list.map(value));
  for (const idx of Object.values(groups)) {
    const vals = idx.map((i) => value(list[i]));
    if (vals.filter((v) => v != null).length < minSize) { idx.forEach((i) => (out[i] = all[i])); continue; }
    const r = ranks(vals);
    idx.forEach((i, j) => (out[i] = r[j]));
  }
  return out;
}

// ---------- Build ----------
export function build(q, det, hist, ctx = {}) {
  const usdcad = ctx.usdcad || null, tnx = ctx.tnx ?? 4.2;
  const fxUsed = usdcad || 1.38;
  const skipped = [];
  let stocks = UNIVERSE.map(([sym, group, override], i) => {
    const qq = q[sym]; const d = det[i] || {};
    const price = num(qq?.regularMarketPrice);
    if (!qq || price == null) { skipped.push(sym); return null; }
    const G = GROUPS[group];
    const cur = qq.currency || null;
    // Convert per-share fundamentals into the trading currency (CAD-listed, USD-reporting and vice versa).
    const fx = d.finCcy === "USD" && cur === "CAD" ? fxUsed : d.finCcy === "CAD" && cur === "USD" ? 1 / fxUsed : 1;
    const bvps = d.bookValue > 0 ? d.bookValue * fx : null;
    const feps = d.fwdEps != null ? d.fwdEps * fx : null;
    let pb = bvps ? price / bvps : (d.pb ?? num(qq.priceToBook)) != null ? (d.pb ?? num(qq.priceToBook)) / fx : null;
    if (!(pb > 0 && pb < 50)) pb = null;
    let fpe = feps > 0 ? price / feps : num(qq.forwardPE) != null ? num(qq.forwardPE) / fx : null;
    if (!(fpe > 0 && fpe < 200)) fpe = null;
    const roeF = d.fwdEps != null && d.bookValue > 0 ? clip((d.fwdEps / d.bookValue) * 100, -5, 35) : null;
    const payoutF = d.divRate != null && feps > 0 ? (d.divRate / feps) * 100 : null;
    const cap = num(qq.marketCap);
    const capUsd = cap == null ? null : cur === "CAD" ? cap / fxUsed : cap;
    const high = num(qq.fiftyTwoWeekHigh), low = num(qq.fiftyTwoWeekLow);
    const yld = num(qq.dividendYield) ?? (num(qq.trailingAnnualDividendYield) != null ? num(qq.trailingAnnualDividendYield) * 100 : null);
    let chg1y = num(qq.fiftyTwoWeekChangePercent);
    if (chg1y != null && Math.abs(chg1y) < 1.5 && high && low && high / low > 1.2) chg1y *= 100; // guard against a fraction

    // Sector vs own move over 3 months, and macro sensitivities.
    const h = hist[sym], e = hist[G.etf];
    let beta = null, sector3m = null, own3m = null, ret3m = null, sens = null;
    if (h?.size && e?.size) {
      const p = paired(h, e);
      beta = betaCorr(p.ra, p.rb).beta;
      ret3m = retOver(h, p.keys, 63);
      const etf3m = retOver(e, p.keys, 63);
      if (beta != null && ret3m != null && etf3m != null) {
        const b = clip(beta, 0, 2.5);
        sector3m = b * etf3m; own3m = ret3m - sector3m;
      }
      const cands = FACTORS.map((f) => {
        const fh = hist[f.symbol]; if (!fh?.size) return null;
        const pp = paired(h, fh, f.diff);
        const { corr } = betaCorr(pp.ra, pp.rb);
        return corr == null ? null : { ...f, corr: r2(corr) };
      }).filter(Boolean).sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));
      if (cands[0] && Math.abs(cands[0].corr) >= 0.3) sens = { label: cands[0].label, name: cands[0].name, corr: cands[0].corr };
    }

    // Justified P/B (display only — it swings with small changes in the cost of equity).
    const roeUse = roeF ?? d.roe;
    const bClip = clip(d.beta ?? 1, 0.5, 1.8);
    const coe = tnx / 100 + bClip * 0.055;
    let jPB = null;
    if (roeUse != null && roeUse > 0) {
      const g = clip((roeUse / 100) * (1 - clip(payoutF ?? d.payout ?? 40, 0, 100) / 100), 0, 0.04);
      if (coe - g > 0.01) jPB = (roeUse / 100 - g) / (coe - g);
    }

    return {
      symbol: sym, name: qq.shortName || qq.longName || sym, exchange: exchangeOf(sym), currency: cur, finCcy: d.finCcy,
      group, groupName: G.name, metric: override || G.metric, etf: G.etf,
      price, change: r1(num(qq.regularMarketChangePercent)),
      marketCap: cap, marketCapUsd: capUsd, tier: capTier(capUsd),
      pb: r2(pb), forwardPE: r1(fpe), pe: r1(num(qq.trailingPE)), bvps: r2(bvps),
      yield: r1(yld), payout: r1(payoutF ?? d.payout), roe: r1(d.roe), roeF: r1(roeF), beta: r2(d.beta),
      coe: r1(coe * 100), jPB: r2(jPB), fairValue: jPB && bvps ? r2(jPB * bvps) : null,
      high52: high, low52: low,
      offHigh: high ? r1((price / high - 1) * 100) : null,
      chg1y: r1(chg1y), ret3m: r1(ret3m), sector3m: r1(sector3m), own3m: r1(own3m), etfBeta: r2(beta), sens,
      target: d.target, targetHigh: d.targetHigh, targetLow: d.targetLow,
      upside: d.target ? r1((d.target / price - 1) * 100) : null,
      recMean: d.recMean, rating: analystLabel(d.recMean), analysts: d.analysts, counts: d.counts || null,
      rev90: r1(clip(d.rev90, -80, 150)), growthNext: r1(clip(d.growthNext, -90, 300)),
    };
  }).filter(Boolean);

  // ---- Peer medians: leave-one-out, shrunk toward the sector median for small groups ----
  const byGroup = {};
  for (const s of stocks) (byGroup[s.group] ||= []).push(s);
  const sectorMed = { pb: med(stocks.filter((s) => s.metric === "pb").map((s) => s.pb)), pe: med(stocks.map((s) => s.forwardPE)), yield: med(stocks.map((s) => s.yield)) };
  const peerOf = (s, key, sector) => {
    const vals = byGroup[s.group].filter((o) => o !== s).map((o) => o[key]).filter((v) => v != null);
    if (!vals.length) return sector;
    const g = med(vals), n = vals.length;
    return sector == null ? g : (n * g + SHRINK * sector) / (n + SHRINK);
  };
  for (const s of stocks) {
    s.peerPB = r2(peerOf(s, "pb", sectorMed.pb));
    s.peerPE = r1(peerOf(s, "forwardPE", sectorMed.pe));
    // Positive = cheaper than peers (log scale, so +20 and −20 are symmetric).
    s.pbDiscount = s.pb && s.peerPB ? r1(-Math.log(s.pb / s.peerPB) * 100) : null;
    s.peDiscount = s.forwardPE && s.peerPE ? r1(-Math.log(s.forwardPE / s.peerPE) * 100) : null;
  }

  // ---- "Cheap for its returns": ln(P/B) vs forward ROE, demeaned within each group, pooled slope ----
  const pbSet = stocks.filter((s) => s.metric === "pb" && s.pb && (s.roeF ?? s.roe) != null);
  const pooled = { y: mean(pbSet.map((s) => Math.log(s.pb))), x: mean(pbSet.map((s) => s.roeF ?? s.roe)) };
  const gMeans = {};
  for (const [g, list] of Object.entries(byGroup)) {
    const ok = list.filter((s) => pbSet.includes(s));
    gMeans[g] = ok.length >= 3 ? { y: mean(ok.map((s) => Math.log(s.pb))), x: mean(ok.map((s) => s.roeF ?? s.roe)) } : pooled;
  }
  let sxy = 0, sxx = 0;
  for (const s of pbSet) { const m = gMeans[s.group]; const dx = (s.roeF ?? s.roe) - m.x, dy = Math.log(s.pb) - m.y; sxy += dx * dy; sxx += dx * dx; }
  const slope = pbSet.length >= 8 && sxx ? clip(sxy / sxx, 0, 0.15) : 0.06;
  for (const s of pbSet) {
    const m = gMeans[s.group];
    const resid = Math.log(s.pb) - m.y - slope * ((s.roeF ?? s.roe) - m.x);
    s.pbResid = r1(-resid * 100);
    s.impliedPB = r2(Math.exp(m.y + slope * ((s.roeF ?? s.roe) - m.x)));
  }

  // ---- Score ----
  const primary = (s) => (s.metric === "pb" ? s.pbResid ?? s.pbDiscount : s.peDiscount);
  const secondary = (s) => (s.metric === "pb" ? s.pbDiscount : null);
  const R = {
    v1: ranksBy(stocks, primary, (s) => s.metric),
    v2: ranksBy(stocks, secondary, (s) => s.metric),
    up: ranks(stocks.map((s) => s.upside)),
    rating: ranks(stocks.map((s) => (s.recMean == null ? null : -s.recMean))),
    quality: ranksBy(stocks, (s) => s.roeF ?? s.roe, (s) => s.group, 3),
    rev: ranks(stocks.map((s) => s.rev90)),
    // Reward a sector-driven markdown (the news-cycle discount), not a company-specific collapse.
    macro: ranks(stocks.map((s) => (s.sector3m == null ? null : -Math.min(s.sector3m, 0)))),
  };
  const W = { v1: 0.25, v2: 0.1, rev: 0.15, up: 0.15, rating: 0.05, quality: 0.15, macro: 0.15 };
  const raw = stocks.map((s, i) => {
    if (R.v1[i] == null) return null; // no valuation, no score
    let tot = 0;
    for (const k of Object.keys(W)) tot += (R[k][i] ?? 50) * W[k]; // missing factors count as neutral
    return tot;
  });
  const pctl = ranks(raw);
  stocks.forEach((s, i) => {
    s.scoreRaw = raw[i] == null ? null : Math.round(raw[i]);
    s.score = pctl[i] == null ? null : Math.round(pctl[i]);
    const p = (k) => (R[k][i] == null ? null : Math.round(R[k][i]));
    s.parts = { value: p("v1"), street: R.up[i] != null ? Math.round(((R.up[i] ?? 50) * 3 + (R.rating[i] ?? 50)) / 4) : null, quality: p("quality"), revisions: p("rev"), macro: p("macro") };

    const why = [];
    if (s.metric === "pb" && s.pbResid != null && s.pbResid >= 10) why.push(`P/B of ${s.pb}× is ${s.pbResid.toFixed(0)}% below the ${s.impliedPB}× its ${(s.roeF ?? s.roe).toFixed(0)}% ROE implies vs ${s.groupName}`);
    else if (s.metric === "pb" && s.pbDiscount != null && s.pbDiscount >= 10) why.push(`Trades at ${s.pb}× book vs ${s.peerPB}× for peers`);
    if (s.metric === "pe" && s.peDiscount != null && s.peDiscount >= 10) why.push(`Trades at ${s.forwardPE}× forward earnings vs ${s.peerPE}× for ${s.groupName}`);
    if (s.sector3m != null && s.sector3m <= -4 && (s.own3m ?? 0) > -4) why.push(`Its sector cost it ${Math.abs(s.sector3m).toFixed(0)} pts over 3 months while its own move was ${s.own3m >= 0 ? "+" : ""}${s.own3m.toFixed(0)} pts — a sector-wide markdown, not a company problem`);
    if (s.upside != null && s.upside >= 10) why.push(`Average analyst target is ${s.upside.toFixed(0)}% above the price${s.analysts ? ` (${s.analysts} analysts)` : ""}`);
    if (s.rev90 != null && s.rev90 >= 3) why.push(`Next year's EPS estimate raised ${s.rev90.toFixed(0)}% in 90 days`);
    if (s.fairValue && s.price && s.fairValue / s.price - 1 >= 0.15) why.push(`Justified P/B points to about ${s.fairValue.toFixed(2)} (ROE ${(s.roeF ?? s.roe).toFixed(0)}% vs ${s.coe}% cost of equity)`);
    if (s.yield != null && s.yield >= 4 && (s.payout ?? 0) <= 80) why.push(`${s.yield.toFixed(1)}% dividend yield, ${s.payout != null ? `${s.payout.toFixed(0)}% payout` : "covered"}`);
    s.why = why.slice(0, 4);

    const traps = [];
    if (s.rev90 != null && s.rev90 <= -5) traps.push(`Analysts cut next year's EPS estimate ${Math.abs(s.rev90).toFixed(0)}% in 90 days${s.own3m != null && s.own3m <= -5 ? " while the stock lagged its sector" : ""}`);
    const roeUse = s.roeF ?? s.roe;
    if (roeUse != null && s.group !== "holdco" && roeUse < s.coe - 3) traps.push(`ROE of ${roeUse.toFixed(1)}% sits below its ~${s.coe}% cost of equity`);
    if (s.payout != null && s.payout > 100 && !["alts", "holdco"].includes(s.group)) traps.push(`Paying out ${s.payout.toFixed(0)}% of expected earnings`);
    if ((s.upside != null && s.upside < 0) || (s.recMean != null && s.recMean >= 3.3)) traps.push(s.upside != null && s.upside < 0 ? "Trading above analysts' average target" : `Street is cautious (${s.rating})`);
    if (s.own3m != null && s.own3m <= -15) traps.push(`Fell ${Math.abs(s.own3m).toFixed(0)} pts more than its sector explains in 3 months — find out what changed`);
    s.risks = traps.slice(0, 3);

    s.label = s.score == null ? "Not enough data"
      : traps.length >= 2 ? "Possible value trap"
      : s.score >= 75 && (s.upside ?? 0) >= 10 && (primary(s) ?? 0) > 0 ? "Undervalued"
      : s.score >= 55 ? "Watch"
      : "Fairly valued";
  });
  stocks.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  // ---- Where the discount sits, by peer group ----
  const groupList = Object.entries(byGroup).map(([g, list]) => ({
    key: g, name: GROUPS[g].name, metric: GROUPS[g].metric, etf: GROUPS[g].etf, count: list.length,
    offHigh: r1(med(list.map((s) => s.offHigh))), ret3m: r1(med(list.map((s) => s.ret3m))), sector3m: r1(med(list.map((s) => s.sector3m))),
    upside: r1(med(list.map((s) => s.upside))),
    pb: r2(med(list.map((s) => s.pb))), pe: r1(med(list.map((s) => s.forwardPE))),
    score: list.some((s) => s.score != null) ? Math.round(med(list.map((s) => s.score))) : null,
    top: list.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 3).map((s) => s.symbol),
  })).sort((a, b) => (a.offHigh ?? 0) - (b.offHigh ?? 0));

  const hurt = groupList.filter((g) => g.offHigh != null).slice(0, 2);
  const undervalued = stocks.filter((s) => s.label === "Undervalued");
  const sectorDriven = undervalued.filter((s) => s.sector3m != null && s.sector3m < 0 && (s.own3m ?? 0) > -4).length;
  const insight = hurt.length
    ? `${hurt.map((g) => `${g.name} (median ${Math.abs(g.offHigh).toFixed(0)}% off highs)`).join(" and ")} have been marked down the most. ${undervalued.length} name${undervalued.length === 1 ? "" : "s"} screen as undervalued — cheap for their returns, backed by analysts, without value-trap signals${undervalued.length ? `; ${sectorDriven} of them fell with their sector rather than on company news, the kind of discount that can close when the macro story turns` : ""}.`
    : null;

  return { stocks, groups: groupList, insight, usdcad, tnx, slope: r2(slope), skipped, fxFallback: !usdcad };
}

export default async function handler(req, res) {
  try {
    const syms = UNIVERSE.map((u) => u[0]);
    const extra = [...new Set([...Object.values(GROUPS).map((g) => g.etf), ...FACTORS.map((f) => f.symbol)])];
    const [q, det, histList] = await Promise.all([
      quotes([...syms, "USDCAD=X", "^TNX"]),
      pool(syms, 12, details),
      pool([...syms, ...extra], 12, closes),
    ]);
    const hist = {};
    [...syms, ...extra].forEach((s, i) => { if (histList[i]) hist[s] = histList[i]; });
    const ctx = { usdcad: num(q["USDCAD=X"]?.regularMarketPrice), tnx: num(q["^TNX"]?.regularMarketPrice) };
    send(res, 200, { ...build(q, det, hist, ctx), asOf: Date.now() }, 6 * 3600);
  } catch (e) { fail(res, e); }
}
