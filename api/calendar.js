// GET /api/calendar  -> this week's economic calendar from ForexFactory's public weekly export.
// The export is cached for 30 minutes so we stay well inside its request limits.
import { send, fail } from "./_lib/util.js";

const FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

export default async function handler(req, res) {
  try {
    const r = await fetch(FEED, { headers: { "User-Agent": "portfolio-dashboard/1.0 (personal use)" } });
    if (!r.ok) throw new Error(`Calendar feed returned ${r.status}`);
    const raw = await r.json();
    const events = (Array.isArray(raw) ? raw : []).map((e, i) => ({
      id: `${e.date}-${e.country}-${i}`,
      title: e.title,
      country: e.country,
      time: Date.parse(e.date) || null,
      impact: e.impact || "Low",
      forecast: e.forecast || null,
      previous: e.previous || null,
      actual: e.actual || null, // not in the free export today; kept in case it is added
    }));
    send(res, 200, { events, source: "ForexFactory weekly export", asOf: Date.now() }, 1800);
  } catch (err) {
    fail(res, err);
  }
}
