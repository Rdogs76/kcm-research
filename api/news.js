// GET /api/news?symbols=AAPL,RY.TO   (symbols optional; general market news is always included)
import { yf, send, symbolsFrom, time, NO_VALIDATE } from "./_lib/util.js";

const GENERAL = ["bank stocks", "financial stocks", "Canadian banks", "Federal Reserve", "Bank of Canada"];

async function search(query) {
  const r = await yf().search(query, { newsCount: 10, quotesCount: 0 }, NO_VALIDATE);
  return (r?.news || []).map((n) => ({
    id: n.uuid || n.link,
    title: n.title,
    publisher: n.publisher || null,
    link: n.link,
    time: time(n.providerPublishTime),
    tickers: n.relatedTickers || [],
    thumbnail: n.thumbnail?.resolutions?.find((x) => x.width && x.width <= 400)?.url
      || n.thumbnail?.resolutions?.[0]?.url || null,
    query,
  }));
}

export default async function handler(req, res) {
  const symbols = symbolsFrom(req.query.symbols, 10);
  const general = req.query.general === "0" ? [] : GENERAL;
  const queries = [...general, ...symbols];
  const settled = await Promise.allSettled(queries.map(search));
  const seen = new Set();
  const items = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const n of r.value) {
      if (!n.title || !n.link || seen.has(n.id)) continue;
      seen.add(n.id);
      items.push(n);
    }
  }
  items.sort((a, b) => (b.time || 0) - (a.time || 0));
  send(res, 200, { news: items.slice(0, 80), asOf: Date.now() }, 600);
}
