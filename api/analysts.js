// GET /api/analysts?symbol=AAPL
// "Top analysts" in the spirit of TipRanks, built from Yahoo Finance's public rating history:
// every past rating a firm issued on this stock is scored against what the stock actually did
// over the next 12 months. Firms are then ranked by that track record, and the latest rating and
// price target of each firm are shown alongside it.
import { yf, send, fail, symbolsFrom, num, time, NO_VALIDATE } from "./_lib/util.js";

const DAY = 86400000, YEAR = 365 * DAY;

// Bearish is checked first so "Underperform" isn't read as "perform".
function stance(grade) {
  const g = String(grade || "").toLowerCase();
  if (!g) return null;
  if (/sell|underperform|underweight|negative|reduce|below average/.test(g)) return "sell";
  if (/buy|outperform|overweight|positive|accumulate|\badd\b|top pick|above average|long-term buy|speculative/.test(g)) return "buy";
  if (/hold|neutral|equal|market perform|sector perform|peer perform|in-line|inline|perform|mixed|fair value|sector weight|market weight/.test(g)) return "hold";
  return null;
}

// First close on or after time t.
function priceAt(points, t) {
  let lo = 0, hi = points.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (points[m][0] >= t) { ans = m; hi = m - 1; } else lo = m + 1; }
  return ans < 0 ? null : points[ans][1];
}

function scoreFirms(history, points, price, now = Date.now()) {
  const firms = new Map();
  for (const h of history) {
    if (!h.firm || !h.date) continue;
    const f = firms.get(h.firm) || { firm: h.firm, ratings: [], scored: 0, wins: 0, sumRet: 0 };
    f.ratings.push(h);
    firms.set(h.firm, f);
    const st = stance(h.to);
    if ((st === "buy" || st === "sell") && h.date <= now - YEAR) {
      const p0 = priceAt(points, h.date), p1 = priceAt(points, h.date + YEAR);
      if (p0 && p1) {
        const r = (p1 / p0 - 1) * 100, signed = st === "buy" ? r : -r;
        f.scored++; f.sumRet += signed; if (signed > 0) f.wins++;
      }
    }
  }
  const out = [];
  for (const f of firms.values()) {
    f.ratings.sort((a, b) => b.date - a.date);
    const last = f.ratings[0];
    const withTarget = f.ratings.find((r) => r.target != null && r.date > now - YEAR);
    const successRate = f.scored ? (f.wins / f.scored) * 100 : null;
    const avgReturn = f.scored ? f.sumRet / f.scored : null;
    // Small samples are pulled toward 50% so one lucky call can't top the list.
    const adjusted = ((f.wins + 2) / (f.scored + 4)) * 100;
    const retScore = avgReturn == null ? 0.5 : Math.min(1, Math.max(0, avgReturn / 40 + 0.5));
    const score = adjusted * 0.7 + retScore * 100 * 0.3;
    const stars = f.scored >= 2 ? Math.max(0.5, Math.min(5, Math.round(((score - 30) / 50) * 10) / 2)) : null;
    out.push({
      firm: f.firm,
      calls: f.ratings.length,
      scored: f.scored,
      wins: f.wins,
      successRate, avgReturn, score: Math.round(score * 10) / 10, stars,
      active: last.date > now - YEAR,
      latest: { date: last.date, rating: last.to, from: last.from, action: last.action, stance: stance(last.to) },
      target: withTarget ? { value: withTarget.target, prior: withTarget.priorTarget, date: withTarget.date, upside: price ? (withTarget.target / price - 1) * 100 : null } : null,
    });
  }
  out.sort((a, b) => (b.active - a.active) || ((b.scored >= 3) - (a.scored >= 3)) || b.score - a.score || b.calls - a.calls);
  return out;
}

function summarize(firms, price) {
  const ranked = firms.filter((f) => f.active && f.scored >= 3);
  const top = (ranked.length >= 3 ? ranked : firms.filter((f) => f.active)).slice(0, 6);
  const count = { buy: 0, hold: 0, sell: 0 };
  for (const f of top) if (f.latest.stance) count[f.latest.stance]++;
  const tgts = top.map((f) => f.target?.value).filter((v) => v != null);
  const all = firms.filter((f) => f.active && f.target).map((f) => f.target.value);
  const avg = tgts.length ? tgts.reduce((a, b) => a + b, 0) / tgts.length : null;
  const consensus = !top.length ? null : count.buy >= count.hold + count.sell ? (count.buy >= top.length * 0.75 ? "Strong buy" : "Moderate buy") : count.sell > count.buy && count.sell >= count.hold ? (count.sell >= top.length * 0.75 ? "Strong sell" : "Moderate sell") : "Hold";
  return {
    topFirms: top.map((f) => f.firm),
    consensus, count,
    topTarget: avg, topUpside: avg && price ? (avg / price - 1) * 100 : null,
    high: all.length ? Math.max(...all) : null,
    low: all.length ? Math.min(...all) : null,
    activeFirms: firms.filter((f) => f.active).length,
  };
}

export default async function handler(req, res) {
  const [symbol] = symbolsFrom(req.query.symbol, 1);
  if (!symbol) return send(res, 400, { error: "Add a symbol." }, 0);
  try {
    const [s, chart] = await Promise.all([
      yf().quoteSummary(symbol, { modules: ["price", "upgradeDowngradeHistory", "financialData"] }, NO_VALIDATE),
      yf().chart(symbol, { period1: new Date(Date.now() - 8 * YEAR), interval: "1d" }, NO_VALIDATE).catch(() => null),
    ]);
    const price = num(s.price?.regularMarketPrice);
    const points = (chart?.quotes || []).map((q) => [time(q.date), num(q.close) ?? num(q.adjclose)]).filter(([t, c]) => t && c != null);
    const history = (s.upgradeDowngradeHistory?.history || []).map((h) => ({
      date: time(h.epochGradeDate),
      firm: h.firm,
      from: h.fromGrade || null,
      to: h.toGrade || null,
      action: h.action || null,
      target: num(h.currentPriceTarget) || null,
      priorTarget: num(h.priorPriceTarget) || null,
    })).filter((h) => h.date && h.date > Date.now() - 7 * YEAR);
    const firms = scoreFirms(history, points, price);
    const fd = s.financialData || {};
    send(res, 200, {
      symbol, price, currency: s.price?.currency || null,
      firms: firms.slice(0, 25),
      summary: summarize(firms, price),
      street: { mean: num(fd.targetMeanPrice), high: num(fd.targetHighPrice), low: num(fd.targetLowPrice), analysts: num(fd.numberOfAnalystOpinions) },
      ratingsSince: history.length ? Math.min(...history.map((h) => h.date)) : null,
      asOf: Date.now(),
    }, 6 * 3600);
  } catch (e) { fail(res, e); }
}
