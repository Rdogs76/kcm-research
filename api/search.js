// GET /api/search?q=royal bank  -> matching tickers for autocomplete
import { yf, send, fail, NO_VALIDATE } from "./_lib/util.js";

const TYPES = new Set(["EQUITY", "ETF", "MUTUALFUND", "INDEX", "CRYPTOCURRENCY", "CURRENCY", "FUTURE"]);

export default async function handler(req, res) {
  const q = String(req.query.q || "").trim().slice(0, 60);
  if (q.length < 1) return send(res, 400, { error: "Type a ticker or company name." }, 0);
  try {
    const r = await yf().search(q, { quotesCount: 8, newsCount: 0 }, NO_VALIDATE);
    const results = (r?.quotes || [])
      .filter((x) => x.symbol && (!x.quoteType || TYPES.has(String(x.quoteType).toUpperCase())))
      .map((x) => ({ symbol: x.symbol, name: x.shortname || x.longname || x.symbol, exchange: x.exchDisp || x.exchange || null, type: x.quoteType || null }));
    send(res, 200, { results }, 3600);
  } catch (err) {
    fail(res, err);
  }
}
