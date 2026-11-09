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
//   3. Why it fell. Each stock's 3-month move is split into the part its sector explains (beta × the median
//      move of its *other* peers, so a stock never explains itself; the sector ETF is the fallback for small
//      groups) and its own part. A sector-wide move is consistent with a macro or news-cycle cause.
//      Daily-return correlations with the 10-yr yield, high-yield credit, oil and USD/CAD show what moves it.
//   4. Quality: return on equity ranked within the peer group, plus value-trap flags.
// Banks are valued on price / tangible book and ROTCE from their quarterly statements (via /api/banks).
// A residual-income model gives a reference value for book-value businesses, with its assumptions returned.
// Scores are percentile ranks within this universe (relative, not absolute), and the response reports how
// much of each data source came back so the UI can say when the screen is running on partial data.
// The "why it's cheap" headlines for each name come from /api/catalysts.
import { yf, send, fail, num, time, NO_VALIDATE, withTimeout } from "./_lib/util.js";
import { pool, quotes, ranks, clip, r1, DAY } from "./_lib/screen.js";
import { UNIVERSE, GROUPS, FACTORS, exchangeOf, capTier } from "./_lib/universe.js";
import { one as bankNim, BANK_GROUPS, nimScores } from "./banks.js";
import { TRADING, tradingStatus } from "./_lib/trading.js";
import { HANDBOOK, handbookFor } from "./_lib/handbook.js";
import { policyRates, valet } from "./_lib/rates.js";

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
  const s = await withTimeout(yf().quoteSummary(symbol, { modules: ["financialData", "defaultKeyStatistics", "summaryDetail", "earningsTrend", "recommendationTrend"] }, NO_VALIDATE));
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
  const r = await withTimeout(yf().chart(symbol, { period1: new Date(Date.now() - 400 * DAY), interval: "1d" }, NO_VALIDATE));
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

// Residual-income value per share: book value today plus the present value of returns above the cost of
// equity, with ROE fading in a straight line to the cost of equity over 10 years (no terminal value).
// payout = share of earnings returned (dividends + buybacks); the rest grows book value.
export function riValue(bv0, roe, coe, payout = 0.5, years = 10) {
  if (!(bv0 > 0) || roe == null || !(coe > 0)) return null;
  let bv = bv0, pv = 0;
  for (let t = 1; t <= years; t++) {
    const r = roe + ((coe - roe) * (t - 1)) / (years - 1);
    pv += ((r - coe) * bv) / Math.pow(1 + coe, t);
    bv *= 1 + r * (1 - payout);
  }
  return bv0 + pv;
}

// Daily returns keyed by date.
function returns(m) {
  const ks = [...m.keys()].sort(), out = new Map();
  for (let i = 1; i < ks.length; i++) { const a = m.get(ks[i - 1]), b = m.get(ks[i]); if (a) out.set(ks[i], b / a - 1); }
  return out;
}
// Price index built from the median daily return of a stock's peers (excluding the stock itself).
function peerIndex(rets, self) {
  const others = [...rets.entries()].filter(([k]) => k !== self).map(([, v]) => v);
  if (others.length < 4) return null;
  const dates = [...new Set(others.flatMap((m) => [...m.keys()]))].sort();
  const idx = new Map(); let lvl = 100;
  for (const d of dates) {
    const xs = others.map((m) => m.get(d)).filter((v) => v != null).sort((a, b) => a - b);
    if (xs.length < 3) continue;
    const md = xs.length % 2 ? xs[xs.length >> 1] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
    lvl *= 1 + md; idx.set(d, lvl);
  }
  return idx.size > 100 ? idx : null;
}

// ---------- Build ----------
export function build(q, det, hist, ctx = {}) {
  const usdcad = ctx.usdcad || null, tnx = ctx.tnx ?? 4.2, goc10 = ctx.goc10 ?? null;
  const fxUsed = usdcad || 1.38;
  const skipped = [], staleQuotes = [];
  const nimData = ctx.nim || {};
  const groupRets = {};
  for (const [sym, group] of UNIVERSE) if (hist[sym]?.size) (groupRets[group] ||= new Map()).set(sym, returns(hist[sym]));
  let stocks = UNIVERSE.map(([sym, group, override], i) => {
    const qq = q[sym]; const d = det[i] || {};
    const price = num(qq?.regularMarketPrice);
    if (!qq || price == null) { skipped.push(sym); return null; }
    const qt = time(qq.regularMarketTime);
    if (qt && Date.now() - qt > 8 * DAY) { staleQuotes.push(sym); return null; }
    const G = GROUPS[group];
    const cur = qq.currency || null;
    // Convert per-share fundamentals into the trading currency (CAD-listed, USD-reporting and vice versa).
    const fx = d.finCcy === "USD" && cur === "CAD" ? fxUsed : d.finCcy === "CAD" && cur === "USD" ? 1 / fxUsed : 1;
    const bvps = d.bookValue > 0 ? d.bookValue * fx : null;
    const feps = d.fwdEps != null ? d.fwdEps * fx : null;
    let pb = bvps ? price / bvps : (d.pb ?? num(qq.priceToBook)) != null ? (d.pb ?? num(qq.priceToBook)) / fx : null;
    // Banks: price / tangible book from the quarterly statements (strips goodwill and intangibles).
    const nb = BANK_GROUPS.includes(group) ? nimData[sym] : null;
    const bfx = nb?.finCcy === "USD" && cur === "CAD" ? fxUsed : nb?.finCcy === "CAD" && cur === "USD" ? 1 / fxUsed : 1;
    const tbvps = nb?.tbvps > 0 ? nb.tbvps * bfx : null;
    const bookBasis = tbvps ? "tangible" : "book";
    if (tbvps) pb = price / tbvps;
    if (!(pb > 0 && pb < 50)) pb = null;
    let fpe = feps > 0 ? price / feps : num(qq.forwardPE) != null ? num(qq.forwardPE) / fx : null;
    if (!(fpe > 0 && fpe < 200)) fpe = null;
    let roeF = d.fwdEps != null && d.bookValue > 0 ? clip((d.fwdEps / d.bookValue) * 100, -5, 35) : null;
    if (nb?.rotce != null) roeF = clip(nb.rotce, -5, 35); // banks: trailing ROTCE
    const dataFlags = [];
    const payoutF = d.divRate != null && feps > 0 ? (d.divRate / feps) * 100 : null;
    const cap = num(qq.marketCap);
    const capUsd = cap == null ? null : cur === "CAD" ? cap / fxUsed : cap;
    const high = num(qq.fiftyTwoWeekHigh), low = num(qq.fiftyTwoWeekLow);
    const yld = num(qq.dividendYield) ?? (num(qq.trailingAnnualDividendYield) != null ? num(qq.trailingAnnualDividendYield) * 100 : null);
    let chg1y = num(qq.fiftyTwoWeekChangePercent);
    if (chg1y != null && Math.abs(chg1y) < 1.5 && high && low && high / low > 1.2) chg1y *= 100; // guard against a fraction

    // Sector vs own move over 3 months, and macro sensitivities.
    const h = hist[sym];
    const peers = groupRets[group] && groupRets[group].size >= 5 ? peerIndex(groupRets[group], sym) : null;
    const e = peers || hist[G.etf];
    const sectorBasis = peers ? "peers" : G.etf;
    let beta = null, sector3m = null, own3m = null, ret3m = null, sens = null, corr = {};
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
      corr = Object.fromEntries(cands.map((c) => [c.symbol, c.corr]));
      const top = cands.find((c) => c.symbol !== "^MOVE");
      if (top && Math.abs(top.corr) >= 0.3) sens = { label: top.label, name: top.name, corr: top.corr };
    }

    // Cost of equity: the home-market 10-yr yield + beta × 5.5% equity risk premium, floored at 9%.
    const rf = cur === "CAD" && goc10 != null ? goc10 : tnx;
    const bClip = clip(d.beta ?? 1, 0.5, 1.8);
    const coe = Math.max(0.09, rf / 100 + bClip * 0.055);
    const roeUse = roeF ?? d.roe;
    const payTot = clip((nb?.totalPayout ?? payoutF ?? d.payout ?? 50) / 100, 0, 1);
    const bv0 = tbvps || bvps;
    let ri = null;
    if ((override || G.metric) === "pb" && bv0 && roeUse != null && roeUse > -5) {
      const base = riValue(bv0, roeUse / 100, coe, payTot);
      const grid = [-0.01, 0, 0.01].map((dc) => [-0.02, 0, 0.02].map((dr) => r2(riValue(bv0, roeUse / 100 + dr, coe + dc, payTot))));
      const ratio = base / price;
      ri = { value: r2(base), grid, coe: r1(coe * 100), roe: r1(roeUse), payout: Math.round(payTot * 100), basis: bookBasis, sane: ratio >= 0.33 && ratio <= 3 };
      if (!ri.sane) dataFlags.push(`Residual-income model gives ${ratio.toFixed(1)}× the price, outside a sensible range; inputs (book value or ROE) may be distorted`);
    }
    // Data sanity checks: implausible figures are flagged and kept out of the score.
    let upside = d.target ? (d.target / price - 1) * 100 : null;
    if (upside != null && (upside > 100 || upside < -60)) { dataFlags.push(`Analyst target (${d.target.toFixed(2)}) is ${upside.toFixed(0)}% from the price; likely a data mismatch (split, special dividend or stale target)`); upside = null; }
    let roeQ = d.roe;
    if (roeQ != null && Math.abs(roeQ) > 60) { dataFlags.push(`Reported ROE of ${roeQ.toFixed(0)}% looks distorted (small or negative book value)`); roeQ = null; }
    if (yld != null && yld > 25) dataFlags.push(`Dividend yield of ${yld.toFixed(0)}% looks implausible; check for a special payout or price error`);

    return {
      symbol: sym, name: qq.shortName || qq.longName || sym, exchange: exchangeOf(sym), currency: cur, finCcy: d.finCcy,
      group, groupName: G.name, metric: override || G.metric, etf: G.etf, sectorBasis, bookBasis,
      price, change: r1(num(qq.regularMarketChangePercent)), quoteTime: qt,
      marketCap: cap, marketCapUsd: capUsd, tier: capTier(capUsd),
      pb: r2(pb), forwardPE: r1(fpe), pe: r1(num(qq.trailingPE)), bvps: r2(bv0),
      yield: r1(yld), payout: r1(payoutF ?? d.payout), roe: r1(roeQ), roeF: r1(roeF), beta: r2(d.beta),
      coe: r1(coe * 100), ri, fairValue: ri?.sane ? ri.value : null,
      shYield: nb?.capitalReturn4 != null && cap ? r1(((nb.capitalReturn4 * bfx) / cap) * 100) : null,
      high52: high, low52: low,
      offHigh: high ? r1((price / high - 1) * 100) : null,
      chg1y: r1(chg1y), ret3m: r1(ret3m), sector3m: r1(sector3m), own3m: r1(own3m), etfBeta: r2(beta), sens, corr,
      target: d.target, targetHigh: d.targetHigh, targetLow: d.targetLow,
      upside: r1(upside),
      recMean: d.recMean, rating: analystLabel(d.recMean), analysts: d.analysts, counts: d.counts || null,
      rev90: r1(clip(d.rev90, -80, 150)), growthNext: r1(clip(d.growthNext, -90, 300)),
      dataFlags, missing: [], hand: handbookFor(sym),
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
    quality: ranksBy(stocks, (s) => (s.roeF ?? s.roe), (s) => s.group, 3),
    rev: ranks(stocks.map((s) => s.rev90)),
    // Reward a sector-driven markdown (the news-cycle discount), not a company-specific collapse.
    macro: ranks(stocks.map((s) => (s.sector3m == null ? null : -Math.min(s.sector3m, 0)))),
  };
  const W = { v1: 0.25, v2: 0.1, rev: 0.15, up: 0.15, rating: 0.05, quality: 0.15, macro: 0.15 };
  const raw = stocks.map((s, i) => {
    if (R.v1[i] == null) return null; // no valuation, no score
    let tot = 0;
    const names = { v2: "secondary valuation", rev: "estimate revisions", up: "analyst target", rating: "analyst rating", quality: "ROE", macro: "price history" };
    for (const k of Object.keys(W)) { if (R[k][i] == null && names[k] && !(k === "v2" && stocks[i].metric === "pe")) stocks[i].missing.push(names[k]); tot += (R[k][i] ?? 50) * W[k]; } // missing factors count as neutral (50th pct); fee businesses have no secondary book measure
    return tot;
  });
  const pctl = ranks(raw);
  stocks.forEach((s, i) => {
    s.scoreRaw = raw[i] == null ? null : Math.round(raw[i]);
    s.score = pctl[i] == null ? null : Math.round(pctl[i]);
    const p = (k) => (R[k][i] == null ? null : Math.round(R[k][i]));
    s.parts = { value: p("v1"), street: R.up[i] != null ? Math.round(((R.up[i] ?? 50) * 3 + (R.rating[i] ?? 50)) / 4) : null, quality: p("quality"), revisions: p("rev"), macro: p("macro") };

    const why = [];
    const bk = s.bookBasis === "tangible" ? "tangible book" : "book", rl = s.bookBasis === "tangible" ? "ROTCE" : "ROE";
    if (s.metric === "pb" && s.pbResid != null && s.pbResid >= 10) why.push(`Trades at ${s.pb}× ${bk}, below the ${s.impliedPB}× implied for a ${(s.roeF ?? s.roe).toFixed(0)}% ${rl} by its ${s.groupName} peers (peer regression)`);
    else if (s.metric === "pb" && s.pbDiscount != null && s.pbDiscount >= 10) why.push(`Trades at ${s.pb}× ${bk} vs ${s.peerPB}× for peers`);
    if (s.metric === "pe" && s.peDiscount != null && s.peDiscount >= 10) why.push(`Trades at ${s.forwardPE}× forward earnings vs ${s.peerPE}× for ${s.groupName}`);
    if (s.sector3m != null && s.sector3m <= -4 && (s.own3m ?? 0) > -4) why.push(`Over 3 months its sector accounts for ${s.sector3m.toFixed(0)} pts of the move and its own part is ${s.own3m >= 0 ? "+" : ""}${s.own3m.toFixed(0)} pts, consistent with a sector-wide markdown`);
    if (s.upside != null && s.upside >= 10) why.push(`Average analyst target is ${s.upside.toFixed(0)}% above the price${s.analysts ? ` (${s.analysts} analysts${s.counts ? `: ${s.counts.buy} buy / ${s.counts.hold} hold / ${s.counts.sell} sell` : ""})` : ""}`);
    if (s.rev90 != null && s.rev90 >= 3) why.push(`Next year's EPS estimate raised ${s.rev90.toFixed(0)}% in 90 days`);
    if (s.hand?.cr != null && s.hand.cr < 92 && (s.hand.crChg ?? 0) < 4) why.push(`Combined ratio ${s.hand.cr}% in ${s.hand.quarter}${s.hand.crPrior != null ? ` (${s.hand.crPrior}% a year earlier)` : ""}: profitable underwriting`);
    if (s.hand?.cet1Excess != null && s.hand.cet1Excess >= 150) why.push(`CET1 ${s.hand.cet1}%, ${s.hand.cet1Excess} bp above its ${s.hand.cet1Req}% requirement: room for buybacks`);
    if (s.yield != null && s.yield >= 4 && (s.payout ?? 0) <= 80) why.push(`${s.yield.toFixed(1)}% dividend yield, ${s.payout != null ? `${s.payout.toFixed(0)}% payout` : "covered"}`);
    s.why = why.slice(0, 4);

    const traps = [];
    if (s.rev90 != null && s.rev90 <= -5) traps.push(`Analysts cut next year's EPS estimate ${Math.abs(s.rev90).toFixed(0)}% in 90 days${s.own3m != null && s.own3m <= -5 ? " while the stock lagged its sector" : ""}`);
    const roeUse = s.roeF ?? s.roe;
    if (roeUse != null && s.group !== "holdco" && roeUse < s.coe - 3) traps.push(`${s.bookBasis === "tangible" ? "ROTCE" : "ROE"} of ${roeUse.toFixed(1)}% sits below its ~${s.coe}% cost of equity`);
    const hb = s.hand;
    if (hb?.cr != null && hb.cr > 100) traps.push(`Combined ratio ${hb.cr}% in ${hb.quarter}: losing money on underwriting`);
    else if (hb?.crChg != null && hb.crChg >= 4) traps.push(`Combined ratio worsened ${hb.crChg} pts y/y to ${hb.cr}% (${hb.quarter})`);
    if (hb?.cet1Excess != null && hb.cet1Excess < 75) traps.push(`CET1 of ${hb.cet1}% is only ${hb.cet1Excess} bp above its ${hb.cet1Req}% requirement, which limits buybacks`);
    const nbk = nimData[s.symbol];
    if (nbk?.provYoY != null && nbk.provYoY > 25 && (s.rev90 ?? 0) < 0) traps.push(`Credit-loss provisions up ${nbk.provYoY.toFixed(0)}% y/y while EPS estimates are being cut`);
    if (s.payout != null && s.payout > 100 && !["alts", "holdco"].includes(s.group)) traps.push(`Paying out ${s.payout.toFixed(0)}% of expected earnings`);
    if ((s.upside != null && s.upside < 0) || (s.recMean != null && s.recMean >= 3.3)) traps.push(s.upside != null && s.upside < 0 ? "Trading above analysts' average target" : `Street is cautious (${s.rating})`);
    if (s.own3m != null && s.own3m <= -15) traps.push(`Fell ${Math.abs(s.own3m).toFixed(0)} pts more than its sector explains in 3 months; check what changed`);
    s.risks = traps.slice(0, 3);

    s.label = s.score == null ? "Not enough data"
      : traps.length >= 2 ? "Value-trap risk"
      : s.score >= 75 && (s.upside ?? 0) >= 10 && (primary(s) ?? 0) > 0 ? "Screens cheap"
      : s.score >= 55 ? "Watch"
      : "In line with peers";
  });
  stocks.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  // ---- Rates thesis: banks with widening NIM, dealers with strong FICC / derivatives desks ----
  // Scores rank names against each other; "Thesis match" also needs the absolute numbers to agree.
  const trade = Object.fromEntries((ctx.trading?.rows || []).map((r) => [r.symbol, r]));
  const tStale = new Set(ctx.tradingStatus?.stale || []);
  const banks = stocks.filter((s) => BANK_GROUPS.includes(s.group) && nimData[s.symbol]);
  const nimList = banks.map((s) => ({ ...nimData[s.symbol], symbol: s.symbol }));
  const nimN = nimScores(nimList);
  banks.forEach((s, i) => {
    const n = nimData[s.symbol], sc = nimList[i];
    s.nim = { level: n.nim, chg1q: n.nimChg1q, chg1y: n.nimChg4q ?? n.nimChgSpan, full: n.nimChg4q != null, spanDays: n.spanDays, yieldChg: n.yieldChg, costChg: n.costChg, depCostChg: n.depCostChg, depBeta: n.depBeta, policyChg: n.policyChg, niiYoY: n.niiYoY, streak: n.streak, quarter: n.quarter, stale: n.stale, lagging: n.lagging, rotce: n.rotce, tceRatio: n.tceRatio, provYoY: n.provYoY, provToPpnr: n.provToPpnr, aociToTbv: n.aociToTbv, totalPayout: n.totalPayout };
    s.thesisNim = sc.nimScore; s.nimRank = sc.nimRank; s.nimOf = nimN;
    const tw = [];
    const span = n.nimChg4q != null ? "the past year" : `${Math.round((n.spanDays || 0) / 30)} months`;
    const c1 = s.nim.chg1y;
    if (c1 != null) tw.push(c1 > 0 ? `NIM up ${c1} bp over ${span}${n.streak === 2 ? ", widening two quarters running" : ""} (quarter ended ${n.quarter})` : `NIM ${c1 === 0 ? "flat" : `down ${Math.abs(c1)} bp`} over ${span} (quarter ended ${n.quarter})`);
    const y = n.yieldChg, c = n.costChg;
    if (y != null && c != null) {
      if (y > c) tw.push(y > 0 && c < 0 ? `Both sides helping: asset yields +${y} bp, total funding cost ${c} bp` : c < 0 ? `Widening comes from cheaper funding (${c} bp) while asset yields moved ${y >= 0 ? "+" : ""}${y} bp; funding-led gains can reverse if deposit competition returns` : `Asset yields (+${y} bp) rose faster than funding costs (+${c} bp), the more durable kind of widening`);
      else tw.push(`Funding costs (${c >= 0 ? "+" : ""}${c} bp) moved ahead of asset yields (${y >= 0 ? "+" : ""}${y} bp), squeezing the margin`);
    }
    if (n.depBeta != null) tw.push(`Implied deposit beta ${n.depBeta.toFixed(2)}: deposit costs moved ${n.depCostChg >= 0 ? "+" : ""}${n.depCostChg} bp against a ${n.policyChg >= 0 ? "+" : ""}${n.policyChg} bp change in the average policy rate`);
    if (n.niiYoY != null) tw.push(`Net interest income ${n.niiYoY >= 0 ? "up" : "down"} ${Math.abs(n.niiYoY).toFixed(0)}% y/y`);
    if (s.hand?.niiPctUp != null) tw.push(`Discloses NII ${s.hand.niiPctUp >= 0 ? "+" : ""}${s.hand.niiPctUp}% for +100 bp and ${s.hand.niiPctDn}% for −100 bp over 12 months (${s.hand.niiBasis}, ${s.hand.quarter}): ${Math.abs(s.hand.niiPctUp) >= Math.abs(s.hand.niiPctDn) ? "asset-sensitive" : "hurt more by cuts than helped by hikes"}`);
    if (n.stale) tw.push(`Latest statements on Yahoo are for the quarter ended ${n.quarter}, more than two quarters old, so this is left out of the thesis match`);
    else if (n.lagging) tw.push(`Yahoo's latest statements are for the quarter ended ${n.quarter}; the bank has likely reported a newer quarter, so check its latest release`);
    s.thesisWhy = tw;
    s.nimOk = c1 != null && c1 > 0 && !n.stale;
  });
  const dealers = stocks.filter((s) => trade[s.symbol]);
  const DR = { f: ranks(dealers.map((s) => trade[s.symbol].ficcYoY ?? trade[s.symbol].marketsYoY)), m: ranks(dealers.map((s) => s.corr?.["^MOVE"] ?? null)) };
  dealers.forEach((s, i) => {
    const t2 = trade[s.symbol];
    let t = 0, w = 0;
    for (const [k, wt] of [["f", 0.7], ["m", 0.3]]) if (DR[k][i] != null) { t += DR[k][i] * wt; w += wt; }
    s.thesisTrade = w ? Math.round(t / w) : null;
    s.tradeOf = dealers.length;
    s.trading = { ficc: t2.ficc, ficcYoY: t2.ficcYoY, markets: t2.markets, marketsYoY: t2.marketsYoY, eqYoY: t2.eqYoY, driver: t2.driver, src: t2.src, primary: t2.primary, stale: tStale.has(t2.region), moveCorr: s.corr?.["^MOVE"] ?? null, quarter: ctx.trading.quarter };
    const fy = t2.ficcYoY ?? t2.marketsYoY;
    const tw = [];
    if (fy != null) tw.push(`${t2.ficcYoY != null ? "FICC" : "Global Markets"} revenue ${fy >= 0 ? "+" : ""}${fy}% y/y in ${t2.region === "CA" ? "Q3 FY2026" : "Q3 2026"} (${t2.driver})`);
    if (s.trading.moveCorr != null) tw.push(`Over the past year the stock has ${s.trading.moveCorr > 0.1 ? "tended to rise" : s.trading.moveCorr < -0.1 ? "tended to fall" : "barely moved"} on days rates volatility (MOVE) rose (daily correlation ${s.trading.moveCorr > 0 ? "+" : ""}${s.trading.moveCorr})`);
    if (t2.eqYoY != null) tw.push(`For context, not part of the rates score: equities trading ${t2.eqYoY >= 0 ? "+" : ""}${t2.eqYoY}% y/y`);
    if (s.trading.stale) tw.push("These trading figures are past their next scheduled update; newer results are out");
    s.thesisWhy = [...(s.thesisWhy || []), ...tw];
    s.tradeOk = fy != null && fy > 0 && !s.trading.stale;
  });
  for (const s of stocks) {
    s.thesis = s.thesisNim ?? s.thesisTrade ?? null;
    s.thesisType = s.thesisNim != null ? "NIM" : s.thesisTrade != null ? "Trading" : null;
    const match = (s.nimOk && (s.thesisNim ?? 0) >= 65) || (s.tradeOk && (s.thesisTrade ?? 0) >= 65);
    s.thesisFit = !!match && s.label !== "Value-trap risk" && (s.score ?? 0) >= 45;
  }

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
  const cheap = stocks.filter((s) => s.label === "Screens cheap");
  const sectorDriven = cheap.filter((s) => s.sector3m != null && s.sector3m < 0 && (s.own3m ?? 0) > -4).length;
  const insight = hurt.length
    ? `${hurt.map((g) => `${g.name} (median ${Math.abs(g.offHigh).toFixed(0)}% below 52-week highs)`).join(" and ")} have fallen furthest from their 52-week highs. ${cheap.length} of ${stocks.length} names rank in the top quarter of this screen with analyst upside of 10%+ and no more than one value-trap flag${cheap.length ? `; for ${sectorDriven} of them, most of the 3-month move is shared with their sector rather than their own` : ""}. Screen output only: verify against filings before pitching.`
    : null;

  const thesisCount = stocks.filter((s) => s.thesisFit).length;
  return { stocks, groups: groupList, insight, usdcad, tnx, goc10, slope: r2(slope), skipped, staleQuotes, fxFallback: !usdcad, thesisCount, tradingQuarter: ctx.trading?.quarter || null, tradingStatus: ctx.tradingStatus || null, handbook: { asOf: HANDBOOK.asOf, nextUpdate: HANDBOOK.nextUpdate, notes: HANDBOOK.notes, stale: Object.entries(HANDBOOK.nextUpdate).filter(([, d]) => new Date().toISOString().slice(0, 10) > d).map(([r]) => r) } };
}

export default async function handler(req, res) {
  try {
    // One cache key only: extra query parameters would bypass the edge cache and re-run ~350 calls.
    if (Object.keys(req.query || {}).length) return send(res, 400, { error: "This endpoint takes no parameters." }, 3600);
    const syms = UNIVERSE.map((u) => u[0]);
    const extra = [...new Set([...Object.values(GROUPS).map((g) => g.etf), ...FACTORS.map((f) => f.symbol)])];
    const bankSyms = UNIVERSE.filter((u) => BANK_GROUPS.includes(u[1])).map((u) => u[0]);
    const policy = await policyRates().catch(() => ({}));
    const [q, det, histList, nimList, goc] = await Promise.all([
      quotes([...syms, "USDCAD=X", "^TNX"]),
      pool(syms, 12, details),
      pool([...syms, ...extra], 12, closes),
      pool(bankSyms, 8, (s) => bankNim(s, policy).catch(() => null)),
      valet("BD.CDN.10YR.DQ.YLD", 20).catch(() => null),
    ]);
    const nim = {}; bankSyms.forEach((s, i) => { if (nimList[i]) nim[s] = nimList[i]; });
    const hist = {};
    [...syms, ...extra].forEach((s, i) => { if (histList[i]) hist[s] = histList[i]; });
    const coverage = {
      quotes: syms.filter((s) => num(q[s]?.regularMarketPrice) != null).length,
      details: det.filter(Boolean).length,
      history: syms.filter((s) => hist[s]?.size).length,
      nim: Object.keys(nim).length, banks: bankSyms.length, total: syms.length,
    };
    // Don't cache a screen built on a failed data pull; the edge keeps serving the last good copy.
    if (coverage.quotes < syms.length * 0.9 || coverage.details < syms.length * 0.8)
      return send(res, 503, { error: `Yahoo Finance returned partial data (quotes ${coverage.quotes}/${syms.length}, fundamentals ${coverage.details}/${syms.length}). Try again in a few minutes.`, coverage }, 0);
    const ctx = { usdcad: num(q["USDCAD=X"]?.regularMarketPrice), tnx: num(q["^TNX"]?.regularMarketPrice), goc10: goc?.at(-1)?.[1] ?? null, nim, trading: TRADING, tradingStatus: tradingStatus() };
    send(res, 200, { ...build(q, det, hist, ctx), coverage, asOf: Date.now() }, 6 * 3600);
  } catch (e) { fail(res, e); }
}
