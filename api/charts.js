// GET /api/charts?symbols=AAPL,^GSPC&range=1y
import { send, symbolsFrom, chartPoints, RANGES } from "./_lib/util.js";

export default async function handler(req, res) {
  const symbols = symbolsFrom(req.query.symbols, 30);
  const range = RANGES[req.query.range] ? req.query.range : "1y";
  if (!symbols.length) return send(res, 400, { error: "Add at least one symbol." }, 0);
  const settled = await Promise.allSettled(symbols.map((s) => chartPoints(s, range)));
  const charts = {};
  const errors = {};
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") charts[symbols[i]] = r.value;
    else errors[symbols[i]] = String(r.reason?.message || r.reason);
  });
  const maxAge = range === "1d" || range === "5d" ? 120 : 900;
  send(res, 200, { range, charts, errors, asOf: Date.now() }, maxAge);
}
