// GET /api/catalysts?section=macro        -> geopolitics, war, tariffs, rates and credit headlines that move financials
// GET /api/catalysts?symbol=RY.TO         -> one company's headlines, tagged, with the "why it's cheap" drivers
// GET /api/catalysts?symbols=RY.TO,BAC    -> a short catalyst summary for up to 12 names (used by the screener)
//
// Sources: Yahoo Finance news + Yahoo's ticker RSS + Google News RSS (Bloomberg, Reuters, BNN Bloomberg,
// Globe and Mail, Financial Post, CNBC...). Bloomberg itself has no free API; its headlines arrive through
// Google News and BNN Bloomberg and link to the original article.
import { send, fail, symbolsFrom, num } from "./_lib/util.js";
import { quotes } from "./_lib/screen.js";
import { googleNews, yahooRss, yahooSearch, merge, gather, tagged, drivers, macroShare as shareOf, macroCounts, CATEGORIES } from "./_lib/newsfeed.js";
import { UNIVERSE } from "./_lib/universe.js";

const KNOWN = new Set(UNIVERSE.map((u) => u[0]));
const MIN_VERDICT = 6; // negative, theme-tagged headlines needed before saying "macro" or "company"

const DAY = 86400000;
const SITES = "(site:bloomberg.com OR site:reuters.com OR site:bnnbloomberg.ca OR site:theglobeandmail.com OR site:financialpost.com)";

const MACRO = [
  `bank stocks geopolitics ${SITES}`,
  `war markets banks insurers ${SITES}`,
  `tariffs Canadian banks`,
  `tariffs bank stocks ${SITES}`,
  `Bank of Canada interest rate decision`,
  `Federal Reserve rate decision bank stocks`,
  `bank credit loss provisions`,
  `private credit concerns ${SITES}`,
  `insurers catastrophe losses`,
  `regional banks ${SITES}`,
  `sanctions financial sector`,
  `TSX financials`,
];

// "Royal Bank of Canada" stays; "Bank of America Corporation" -> "Bank of America".
export function cleanName(name, symbol) {
  const n = String(name || symbol).replace(/,?\s+(Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|plc|Co\.?|Company|Holdings?|Group|Financial Corp\.?|N\.A\.|L\.P\.|\(The\))$/i, "").replace(/^The\s+/i, "").trim();
  return n.length >= 3 ? n : symbol;
}

function summarize(items, symbol) {
  const recent = items.filter((n) => n.time && n.time > Date.now() - 90 * DAY);
  const drv = drivers(recent);
  const neg = recent.filter((n) => n.tone === "negative").length, pos = recent.filter((n) => n.tone === "positive").length;
  const mc = macroCounts(recent);
  const macroShare = mc.total >= MIN_VERDICT ? shareOf(recent) : null;
  let reason = null;
  const top = drv.slice(0, 3).map((d) => `${d.name.toLowerCase()} (${d.count})`).join(", ");
  if (mc.total >= MIN_VERDICT) {
    reason = macroShare >= 50
      ? `${mc.macro} of ${mc.total} negative, theme-tagged headlines on ${symbol} in the last 90 days are about the macro backdrop: ${top}. Headline tagging is automated and approximate; read the articles before drawing a conclusion.`
      : `${mc.company} of ${mc.total} negative, theme-tagged headlines on ${symbol} in the last 90 days are about the company or its industry: ${top}. Check whether these are one-offs or a lasting change.`;
  } else if (recent.length) {
    reason = `Only ${mc.total} negative, theme-tagged headline${mc.total === 1 ? "" : "s"} on ${symbol} in the last 90 days, too few to say whether the news is mainly macro or company-specific${top ? ` (${top})` : ""}.`;
  }
  return { drivers: drv, negative: neg, positive: pos, count: recent.length, macroShare, macroCounts: mc, reason };
}

async function forSymbol(symbol, name, deep) {
  const short = cleanName(name, symbol);
  const tasks = [
    () => yahooSearch(symbol, deep ? 20 : 10),
    () => googleNews(`"${short}" (stock OR shares OR bank OR earnings OR analyst)`, 90),
  ];
  if (deep) {
    tasks.push(() => yahooRss(symbol));
    tasks.push(() => googleNews(`"${short}" ${SITES}`, 180));
    tasks.push(() => googleNews(`"${short}" downgrade OR tariffs OR probe OR provisions OR war`, 180));
  }
  const { lists, errors } = await gather(tasks);
  const items = tagged(merge(lists, deep ? 80 : 30));
  return { items, errors, short };
}

export default async function handler(req, res) {
  try {
    if (req.query.section === "macro") {
      const { lists, errors } = await gather([
        ...MACRO.map((q) => () => googleNews(q, 21)),
        () => yahooSearch("bank stocks", 10),
        () => yahooSearch("geopolitical risk markets", 10),
        () => yahooSearch("tariffs stocks", 10),
      ]);
      const news = tagged(merge(lists, 120)).filter((n) => n.tags.length);
      // Heat: how much of this fortnight's financial news each macro theme accounts for.
      const heat = CATEGORIES.map((c) => {
        const hits = news.filter((n) => n.tags.includes(c.key));
        return { key: c.key, name: c.name, macro: c.macro, count: hits.length, negative: hits.filter((n) => n.tone === "negative").length };
      }).filter((h) => h.count).sort((a, b) => b.count - a.count);
      return send(res, 200, { news, heat, errors, asOf: Date.now() }, 1800);
    }

    const extra = Object.keys(req.query || {}).filter((k) => !["section", "symbol", "symbols"].includes(k));
    if (extra.length) return send(res, 400, { error: `Unknown parameter: ${extra.join(", ")}` }, 3600);
    const [one] = symbolsFrom(req.query.symbol, 1);
    if (req.query.symbol != null && (!one || !KNOWN.has(one))) return send(res, 400, { error: "News analysis is available for stocks in the research universe." }, 3600);
    if (one) {
      const q = await quotes([one]);
      const name = q[one]?.longName || q[one]?.shortName || one;
      const { items, errors, short } = await forSymbol(one, name, true);
      return send(res, 200, { symbol: one, name: short, price: num(q[one]?.regularMarketPrice), news: items, ...summarize(items, one), errors, asOf: Date.now() }, 1800);
    }

    const list = symbolsFrom(req.query.symbols, 12).filter((s) => KNOWN.has(s)).sort();
    if (!list.length) return send(res, 400, { error: "Add symbol=, symbols= (research-universe tickers) or section=macro." }, 3600);
    const q = await quotes(list);
    const settled = await Promise.allSettled(list.map((s) => forSymbol(s, q[s]?.longName || q[s]?.shortName || s, false)));
    const out = {};
    settled.forEach((r, i) => {
      if (r.status !== "fulfilled") return;
      const s = summarize(r.value.items, list[i]);
      out[list[i]] = { ...s, headlines: r.value.items.filter((n) => n.tone === "negative").slice(0, 3) };
    });
    send(res, 200, { catalysts: out, asOf: Date.now() }, 3 * 3600);
  } catch (e) { fail(res, e); }
}
