// GET /api/quotes?symbols=AAPL,VFV.TO,USDCAD=X
import { yf, send, fail, symbolsFrom, num, time, NO_VALIDATE } from "./_lib/util.js";

export default async function handler(req, res) {
  const symbols = symbolsFrom(req.query.symbols, 60);
  if (!symbols.length) return send(res, 400, { error: "Add at least one symbol." }, 0);
  try {
    const result = await yf().quote(symbols, {}, NO_VALIDATE);
    const list = Array.isArray(result) ? result : [result];
    const quotes = {};
    for (const q of list) {
      if (!q?.symbol) continue;
      quotes[q.symbol] = {
        symbol: q.symbol,
        name: q.shortName || q.longName || q.symbol,
        price: num(q.regularMarketPrice),
        change: num(q.regularMarketChange),
        changePct: num(q.regularMarketChangePercent),
        prevClose: num(q.regularMarketPreviousClose),
        currency: q.currency || null,
        exchange: q.fullExchangeName || q.exchange || null,
        type: q.quoteType || null,
        marketState: q.marketState || null,
        time: time(q.regularMarketTime),
        high52: num(q.fiftyTwoWeekHigh),
        low52: num(q.fiftyTwoWeekLow),
        pe: num(q.trailingPE),
        forwardPE: num(q.forwardPE),
        marketCap: num(q.marketCap),
        dividendRate: num(q.dividendRate ?? q.trailingAnnualDividendRate),
        dividendYield: num(q.dividendYield) ?? (num(q.trailingAnnualDividendYield) != null ? num(q.trailingAnnualDividendYield) * 100 : null),
      };
    }
    send(res, 200, { quotes, asOf: Date.now() }, 60);
  } catch (err) {
    fail(res, err);
  }
}
