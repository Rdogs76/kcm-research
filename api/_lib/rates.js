// Free public rate sources shared by /api/curve, /api/banks and /api/screen.
//   FRED public CSV (no key): fredgraph.csv?id=SERIES
//   Bank of Canada Valet API
const UA = { "User-Agent": "Mozilla/5.0 (compatible; kcm-research-dashboard/1.0)" };
export const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

export async function text(url, ms = 8000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.text();
}

// [[date, value], ...] oldest first.
export async function fred(id, days = 400) {
  const csv = await text(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${iso(Date.now() - days * DAY)}`);
  const obs = csv.trim().split(/\r?\n/).slice(1).map((l) => l.split(",")).map(([d, v]) => [d, Number(v)]).filter(([d, v]) => d && Number.isFinite(v));
  if (!obs.length) throw new Error(`FRED ${id}: no data`);
  return obs;
}
export async function valet(series, days = 400) {
  const j = JSON.parse(await text(`https://www.bankofcanada.ca/valet/observations/${series}/json?start_date=${iso(Date.now() - days * DAY)}`));
  const obs = (j.observations || []).map((o) => [o.d, Number(o[series]?.v)]).filter(([d, v]) => d && Number.isFinite(v));
  if (!obs.length) throw new Error(`BoC ${series}: no data`);
  return obs;
}
// Value on or before a date, and the change since n days ago.
export const asOf = (obs, date) => { let v = null; for (const [d, x] of obs) { if (d <= date) v = x; else break; } return v; };
export const daysAgo = (n) => iso(Date.now() - n * DAY);
// Average of a daily series over the 91 days ending on `date` (a quarter's average policy rate).
export function quarterAvg(obs, date) {
  const from = iso(Date.parse(date) - 91 * DAY);
  const xs = obs.filter(([d]) => d > from && d <= date).map((o) => o[1]);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : asOf(obs, date);
}

// Policy rates, cached per function instance for an hour.
let policyCache = null;
export async function policyRates() {
  if (policyCache && Date.now() - policyCache.t < 3600e3) return policyCache.v;
  const [us, ca] = await Promise.allSettled([fred("DFF", 900), valet("V39079", 900)]);
  const v = { USD: us.status === "fulfilled" ? us.value : null, CAD: ca.status === "fulfilled" ? ca.value : null };
  policyCache = { t: Date.now(), v };
  return v;
}
