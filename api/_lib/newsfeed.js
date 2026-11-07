// Free news sources and the catalyst tagger.
//
// Bloomberg has no free API, so headlines come from:
//   1. Yahoo Finance search news (same as /api/news)
//   2. Yahoo Finance's per-ticker RSS headline feed
//   3. Google News RSS, which indexes Bloomberg, Reuters, BNN Bloomberg, the Globe and Mail,
//      the Financial Post, CNBC, WSJ and others. Every item links to the original article.
// Everything runs server-side, so browser CORS rules don't apply.
import { yf, time, NO_VALIDATE } from "./util.js";

const UA = "Mozilla/5.0 (compatible; kcm-research-dashboard/1.0)";

// ---------- RSS ----------
const decode = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/\s+/g, " ").trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i")); return m ? decode(m[1]) : null; };

export function parseRss(xml, via) {
  const items = [];
  for (const m of String(xml || "").matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const x = m[0];
    let title = tag(x, "title");
    const link = tag(x, "link");
    let publisher = tag(x, "source");
    // Google News appends " - Publisher" to every title.
    if (via === "google" && title) {
      const cut = title.lastIndexOf(" - ");
      if (cut > 20) { publisher = publisher || title.slice(cut + 3); title = title.slice(0, cut); }
    }
    const t = Date.parse(tag(x, "pubDate") || "");
    if (title && link) items.push({ title, link, publisher: publisher || null, time: Number.isFinite(t) ? t : null, via });
  }
  return items;
}

async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.text();
}

export async function googleNews(query, days = 90) {
  const q = encodeURIComponent(`${query} when:${days}d`);
  return parseRss(await getText(`https://news.google.com/rss/search?q=${q}&hl=en-CA&gl=CA&ceid=CA:en`), "google");
}

export async function yahooRss(symbol) {
  return parseRss(await getText(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`), "yahoo-rss");
}

export async function yahooSearch(query, count = 10) {
  const r = await yf().search(query, { newsCount: count, quotesCount: 0 }, NO_VALIDATE);
  return (r?.news || []).map((n) => ({
    title: n.title, link: n.link, publisher: n.publisher || null, time: time(n.providerPublishTime), via: "yahoo", tickers: n.relatedTickers || [],
  }));
}

// Merge sources, drop near-duplicate headlines, newest first.
export function merge(lists, max = 60) {
  const seen = new Set(), out = [];
  const key = (t) => {
    const norm = t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const words = norm.split(" ").filter((w) => w.length > 1);
    return words.length >= 4 ? words.slice(0, 10).join(" ") : norm;
  };
  for (const n of lists.flat()) {
    if (!n?.title || !n.link) continue;
    const k = key(n.title);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out.sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, max);
}

// Settle every source; a dead feed never sinks the response.
export async function gather(tasks) {
  const settled = await Promise.allSettled(tasks.map((f) => f()));
  const errors = settled.filter((r) => r.status === "rejected").map((r) => String(r.reason?.message || r.reason));
  return { lists: settled.filter((r) => r.status === "fulfilled").map((r) => r.value), errors };
}

// ---------- Catalyst tagger ----------
// Ordered: the first few categories are the "macro" reasons a good company gets marked down.
// `company: true` themes are about the business itself; earnings/analyst chatter is neither and is left
// out of the macro-vs-company share because almost every company headline mentions results.
export const CATEGORIES = [
  { key: "war", name: "War & conflict", macro: true, re: /\b(?<!price |bidding |talent |turf |format )wars?\b(?! chest)|\bmissiles?\b|\binvasion\b|\binvade|\bmilitary\b|\bairstrikes?\b|\bceasefire\b|\bhostilities\b|\barmed conflict\b|\btroops\b|\bdrone strikes?\b/ },
  { key: "geo", name: "Geopolitics & sanctions", macro: true, re: /geopolit|\bsanctions?\b|\bchina\b|\bchinese\b|\brussia|\bukrain|\bmiddle east\b|\bisrael|\biran\b|\btaiwan\b|\bnato\b|\belection\b|government shutdown/ },
  { key: "trade", name: "Tariffs & trade", macro: true, re: /\btariffs?\b|\btrade war\b|\btrade (deal|talks|tensions|dispute)\b|\bcusma\b|\busmca\b|export controls?|\bduties\b|protectionis/ },
  { key: "rates", name: "Rates & central banks", macro: true, re: /\brate (cuts?|hikes?|decision|path)\b|\binterest rates?\b|federal reserve|\bthe fed\b|\bfed (chair|officials?|rate|minutes|policy|governor)\b|bank of canada|\bboc\b|yield curve|\binflation\b|bond yields?|\btreasur(y|ies) yields?\b/ },
  { key: "recession", name: "Recession & jobs", macro: true, re: /\brecession|\bslowdown\b|\bunemployment\b|jobless|\bgdp\b|\bdownturn\b|stagflation/ },
  { key: "credit", name: "Credit & loan losses", company: true, re: /\bprovisions? for\b|loan[- ]loss|credit[- ]loss|\bdefaults?\b|delinquen|impairment|\bbad loans?\b|charge-?offs?|write-?downs?|commercial real estate|\bcre\b|non-?performing/ },
  { key: "privcredit", name: "Private credit & alts", company: true, re: /private credit|\bfund redemptions?\b|redemption requests|\bgated\b|\bgates? (withdrawals|redemptions)\b|fundraising slow|\bbdcs?\b/ },
  { key: "cat", name: "Catastrophe & claims", company: true, re: /\bhurricane|\bwildfires?\b|\bcatastrophe|\bcat losses\b|insurance claims|claims (costs?|losses|inflation)|\bflooding\b|storm (losses|damage)|reinsurance/ },
  { key: "housing", name: "Housing & mortgages", company: false, re: /\bmortgages?\b|\bhousing\b|home prices|mortgage renewals?|\bcondos?\b/ },
  { key: "legal", name: "Regulation & legal", company: true, re: /\bregulators?\b|\bfined\b|\bfines? (of|from|for)\b|\bpenalt|\blawsuits?\b|class action|\bprobes?\b|\binvestigat|money laundering|\baml\b|\bosfi\b|\bsec (probe|charges|fines?|investigation)\b|\bdoj\b|consent order|asset cap|capital rules?|\bbasel\b|\bsettle(s|d|ment)? (with|over|a lawsuit|probe|charges)\b/ },
  { key: "mgmt", name: "Deals & management", company: true, re: /\bacqui(re|res|red|sition)|\bmerger\b|\btakeover\b|\bceo\b|steps down|\bresign|succession|\bbuybacks?\b|job cuts|restructur|\bactivist\b/ },
  { key: "earnings", name: "Earnings & guidance", re: /\bearnings\b|\bquarterly\b|\bguidance\b|\boutlook\b|\bresults\b|\beps\b|\bprofit\b/ },
  { key: "analyst", name: "Analyst calls", re: /\bupgrades?d?\b|\bdowngrades?d?\b|price targets?|initiat(es|ed) coverage|\breiterat|\boverweight\b|\bunderweight\b|\boutperform\b|\bunderperform\b/ },
];
const MACRO = new Set(CATEGORIES.filter((c) => c.macro).map((c) => c.key));
const COMPANY = new Set(CATEGORIES.filter((c) => c.company).map((c) => c.key));
const NEG = /\b(falls?|fell|drops?|dropped|slumps?|plunges?|tumbles?|sinks?|slides?|cuts?|downgraded?|downgrades|miss(es|ed)?|loss(es)?|warns?|warning|concerns?|fears?|worr(y|ies|ied)|risks?|probe|fined|lawsuits?|weak(er|ens?)?|declines?|slash(es|ed)?|hits?|pressure[sd]?|sell-?off|lowers?|lowered|disappoint\w*|struggl\w*|turmoil|crisis|shock|plummets?|halts?|suspend\w*|exposure|tumbled|slumped)\b/;
const POS = /\b(rises?|rose|jumps?|jumped|surges?|surged|beats?|upgraded?|upgrades|record|gains?|rall(y|ies|ied)|raises?|raised|strong(er)?|boosts?|soars?|soared|tops|outperforms?|rebounds?|recover(s|ed|y)?)\b/;
// Phrases whose words would otherwise trip the tone check ("rate cut" is often good news for stocks).
const NEUTRALIZE = /rate cuts?|price targets?|risk-?weighted|risk management|chief risk officer|beaten-?down/g;

export function classify(title) {
  const t = String(title || "").toLowerCase();
  const tags = CATEGORIES.filter((c) => c.re.test(t)).map((c) => c.key);
  const toneText = t.replace(NEUTRALIZE, " ");
  const neg = NEG.test(toneText), pos = POS.test(toneText);
  const tone = neg && !pos ? "negative" : pos && !neg ? "positive" : "neutral";
  return { tags, tone };
}

const PREMIUM_NAMES = /bloomberg|reuters|bnn|globe and mail|globe & mail|financial post|wall street journal|\bwsj\b|financial times|\bft\.com|\bcnbc\b|barron/i;
export const tagged = (items) => items.map((n) => ({ ...n, ...classify(n.title), premium: PREMIUM_NAMES.test(String(n.publisher || "")) }));

// Count the negative catalysts — the reasons the market is marking this stock down.
// Each negative headline carries a total weight of 1, split across its tags, so a headline that
// mentions war + sanctions + tariffs isn't counted three times.
export function drivers(items) {
  const counts = {};
  for (const n of items) {
    if (n.tone !== "negative" || !n.tags.length) continue;
    for (const k of n.tags) counts[k] = (counts[k] || 0) + 1 / n.tags.length;
  }
  return CATEGORIES.filter((c) => counts[c.key]).map((c) => ({ key: c.key, name: c.name, macro: !!c.macro, count: Math.round(counts[c.key] * 10) / 10 }))
    .sort((a, b) => b.count - a.count);
}

// Share of negative, theme-tagged headlines that are purely macro (no company-specific theme).
export function macroShare(items) {
  let macro = 0, company = 0;
  for (const n of items) {
    if (n.tone !== "negative") continue;
    const m = n.tags.some((k) => MACRO.has(k)), c = n.tags.some((k) => COMPANY.has(k));
    if (m && !c) macro++; else if (c) company++;
  }
  return macro + company ? Math.round((macro / (macro + company)) * 100) : null;
}
