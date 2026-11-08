// KCM Research dashboard — vanilla JS, no build step. Talks only to this project's /api routes.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Data ----------
const cache = new Map();
function api(path, ttl = 5 * 60e3) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.t < ttl) return hit.p;
  const p = fetch(path).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
    return body;
  });
  p.catch(() => cache.delete(path));
  cache.set(path, { t: Date.now(), p });
  return p;
}
const screen = () => api("/api/screen", 30 * 60e3);

// ---------- Local storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem("kcm-" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("kcm-" + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const watch = {
  all: () => store.get("watch", []),
  has: (s) => watch.all().some((w) => w.symbol === s),
  toggle(s, price) {
    const list = watch.all();
    const i = list.findIndex((w) => w.symbol === s);
    if (i >= 0) list.splice(i, 1); else list.push({ symbol: s, price: price ?? null, added: Date.now() });
    store.set("watch", list);
    return i < 0;
  },
};
const notes = { get: (s) => store.get("notes", {})[s] || "", set(s, v) { const n = store.get("notes", {}); if (v) n[s] = v; else delete n[s]; store.set("notes", n); } };

// ---------- Formatting ----------
const isNum = (v) => v != null && Number.isFinite(v);
const pct = (v, d = 1, sign = true) => (isNum(v) ? `${sign && v > 0 ? "+" : ""}${v.toFixed(d)}%` : "—");
const cls = (v) => (isNum(v) ? (v > 0 ? "up" : v < 0 ? "down" : "") : "");
const fix = (v, d = 2) => (isNum(v) ? v.toFixed(d) : "—");
const x = (v, d = 1) => (isNum(v) ? `${v.toFixed(d)}×` : "—");
const money = (v, cur) => (isNum(v) ? `${cur === "CAD" ? "C$" : "$"}${v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(2)}` : "—");
const cap = (v) => (!isNum(v) ? "—" : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`);
const ago = (t) => {
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${Math.max(m, 1)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  if (m < 60 * 24 * 14) return `${Math.round(m / 1440)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const labelCls = (l) => ({ Undervalued: "undervalued", Watch: "watch", "Possible value trap": "trap" }[l] || "fair");
const label = (l) => (l ? `<span class="label ${labelCls(l)}">${esc(l)}</span>` : "");
const ring = (v) => `<div class="ring" style="--p:${v ?? 0}" title="Value score ${v ?? "—"} / 100"><span>${v ?? "—"}</span></div>`;
const skel = (n = 3) => Array.from({ length: n }, (_, i) => `<div class="skeleton" style="width:${90 - i * 12}%"></div>`).join("");
const errBox = (e) => `<div class="err">Couldn't load this (${esc(e.message || e)}). <button class="link" data-retry>Try again</button></div>`;
const catChip = (d) => `<span class="chip ${d.macro ? "macro" : ""}" title="${d.macro ? "Macro / geopolitical driver" : "Company or industry driver"}">${esc(d.name)}${d.count != null ? ` · ${d.count}` : ""}<span class="sr">${d.macro ? " (macro)" : ""}</span></span>`;
const dot = (tone, text) => `<span class="dot ${tone}" aria-hidden="true"></span><span class="sr">${esc(text || tone)}: </span>`;
const link = (sym, inner) => `<a class="rowlink" href="#research/${encodeURIComponent(sym)}">${inner}</a>`;

// ---------- Charts ----------
function spark(points, w = 140, h = 26, neutral = false) {
  if (!points?.length) return "";
  const ys = points.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), r = hi - lo || 1;
  const d = points.map((p, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * w).toFixed(1)},${(h - 2 - ((p[1] - lo) / r) * (h - 4)).toFixed(1)}`).join("");
  const c = neutral ? "var(--muted)" : ys.at(-1) >= ys[0] ? "var(--up)" : "var(--down)";
  return `<svg aria-hidden="true" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${c}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}
function lineChart(el, points, opts = {}) {
  if (!points?.length) { el.innerHTML = `<div class="empty">No price history.</div>`; return; }
  const W = Math.max(280, el.clientWidth || 800), H = 240, P = { l: 6, r: 58, t: 12, b: 22 };
  const ys = points.map((p) => p[1]);
  const extra = [opts.target, opts.fair].filter(isNum);
  let lo = Math.min(...ys, ...extra), hi = Math.max(...ys, ...extra);
  const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
  const t0 = points[0][0], t1 = points.at(-1)[0];
  const X = (t) => P.l + ((t - t0) / (t1 - t0 || 1)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
  const chg = (ys.at(-1) / ys[0] - 1) * 100;
  const col = chg >= 0 ? "var(--up)" : "var(--down)";
  const dec = hi < 20 ? 2 : hi < 200 ? 1 : 0;
  const grid = [0.1, 0.5, 0.9].map((f) => { const v = lo + (hi - lo) * f; return `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${W - P.r + 6}" y="${Y(v) + 4}" font-size="11" fill="var(--faint)">${v.toFixed(dec)}</text>`; }).join("");
  const hline = (v, c, txt) => isNum(v) ? `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${c}" stroke-dasharray="4 4"/><text x="${P.l + 4}" y="${Y(v) - 5}" font-size="11" fill="${c}">${txt} ${v.toFixed(2)}</text>` : "";
  const fmtD = (t, y = true) => new Date(t).toLocaleDateString(undefined, { month: "short", day: y ? undefined : "numeric", year: y ? "2-digit" : undefined });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opts.label || "Price")}: ${pct(chg)} over the period">${grid}
    ${hline(opts.target, "var(--accent)", "Avg analyst target")}${hline(opts.fair, "var(--macro)", "Justified P/B value")}
    <path d="${d} L${X(t1)},${H - P.b} L${X(t0)},${H - P.b} Z" fill="${col}" opacity=".08"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="1.8"/>
    <circle cx="${X(t1)}" cy="${Y(ys.at(-1))}" r="3" fill="${col}"/>
    <text x="${W - P.r + 6}" y="${Y(ys.at(-1)) + 4}" font-size="11" font-weight="600" fill="var(--text)">${ys.at(-1).toFixed(2)}</text>
    <text x="${P.l}" y="${H - 5}" font-size="11" fill="var(--faint)">${fmtD(t0)}</text>
    <text x="${W - P.r}" y="${H - 5}" font-size="11" fill="var(--faint)" text-anchor="end">${fmtD(t1)}</text>
    <line id="xh" y1="${P.t}" y2="${H - P.b}" stroke="var(--faint)" visibility="hidden"/></svg><div class="tip" id="tip"></div>`;
  const svg = el.querySelector("svg"), tip = el.querySelector("#tip"), xh = el.querySelector("#xh");
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    const t = t0 + ((px - P.l) / (W - P.l - P.r)) * (t1 - t0);
    let lo2 = 0, hi2 = points.length - 1; while (lo2 < hi2) { const m = (lo2 + hi2) >> 1; if (points[m][0] < t) lo2 = m + 1; else hi2 = m; }
    const p = points[lo2]; const x = X(p[0]);
    xh.setAttribute("x1", x); xh.setAttribute("x2", x); xh.setAttribute("visibility", "visible");
    tip.style.display = "block"; tip.textContent = `${fmtD(p[0], false)} ${new Date(p[0]).getFullYear()} · ${p[1].toFixed(2)}`;
    tip.style.left = `${Math.min(x, W - 150)}px`; tip.style.top = "36px";
  });
  svg.addEventListener("pointerleave", () => { tip.style.display = "none"; xh.setAttribute("visibility", "hidden"); });
}
const hbar = (name, val, max, txt, kind = "") => `<div class="hbar"><span title="${esc(name)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span><div class="track"><div class="fill ${kind}" style="width:${Math.min(100, (Math.abs(val ?? 0) / (max || 1)) * 100)}%"></div></div><span class="num" style="text-align:right">${txt}</span></div>`;

// ---------- Router ----------
const TABS = ["overview", "screener", "research", "rates", "catalysts", "watchlist", "calendar"];
let current = null;
function route() {
  const [tab = "overview", arg] = location.hash.slice(1).split("/");
  const t = TABS.includes(tab) ? tab : "overview";
  $$("nav.tabs a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + t));
  current = t + (arg || "");
  const token = current;
  window.scrollTo(0, 0);
  ({ overview, screener, research, rates, catalysts, watchlist, calendar })[t](arg ? decodeURIComponent(arg).toUpperCase() : null, () => token === current);
}
window.addEventListener("hashchange", route);
const go = (sym) => { location.hash = `#research/${encodeURIComponent(sym)}`; };
app.addEventListener("click", (e) => {
  if (e.target.closest("[data-retry]")) { cache.clear(); route(); return; }
  const star = e.target.closest("[data-star]");
  if (star) { e.stopPropagation(); const on = watch.toggle(star.dataset.star, Number(star.dataset.price) || null); star.classList.toggle("on", on); star.textContent = on ? "★" : "☆"; star.setAttribute("aria-pressed", on); return; }
  const go2 = e.target.closest("[data-go]");
  if (go2 && !e.target.closest("a, button")) go(go2.dataset.go);
});
const starBtn = (s, price) => { const on = watch.has(s); return `<button class="star ${on ? "on" : ""}" data-star="${esc(s)}" data-price="${price ?? ""}" aria-pressed="${on}" title="${on ? "Remove from" : "Add to"} watchlist">${on ? "★" : "☆"}</button>`; };

// ======================================================================
// Overview
// ======================================================================
function overview(_, alive) {
  app.innerHTML = `
    <div class="page-head"><div><h1>Undervalued financials</h1><div class="muted">TSX and NYSE banks, insurers, lenders, managers, exchanges and mortgage REITs trading cheap for their returns — and whether the discount comes from the news cycle or the business.</div></div><div class="muted" id="asof"></div></div>
    <div id="insight"></div>
    <div class="card" style="margin-bottom:14px"><div class="card-head"><h2>Your rates thesis: NIM expansion + trading desks</h2><a href="#rates">Rates & banks →</a></div>
      <div id="tcurve" class="muted" style="font-size:13px;margin-bottom:10px">${skel(1)}</div>
      <div class="grid g2"><div><div class="faint" style="font-size:12px;margin-bottom:4px">Banks widening their margin that still screen cheap</div><div id="tnim">${skel(4)}</div></div>
      <div><div class="faint" style="font-size:12px;margin-bottom:4px">Dealer trading desks (FICC & derivatives)</div><div id="tdeal">${skel(4)}</div></div></div></div>
    <div class="grid g4" id="kpis">${Array.from({ length: 4 }, () => `<div class="card kpi">${skel(2)}</div>`).join("")}</div>
    <div class="card" style="margin-top:14px"><div class="card-head"><h2>Top ideas right now</h2><a href="#screener">Full screen →</a></div><div class="grid g3" id="picks">${skel(4)}</div></div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><div class="card-head"><h2>Where the discount sits</h2><span class="muted" style="font-size:12px">Median drop from 52-week high</span></div><div id="groups">${skel(5)}</div></div>
      <div class="card"><div class="card-head"><h2>What's driving financials</h2><a href="#catalysts">All catalysts →</a></div><div id="heat">${skel(5)}</div></div>
    </div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><div class="card-head"><h2>Rates & market pulse</h2><span class="muted" style="font-size:12px">1-month change</span></div><div class="tiles" id="pulse">${skel(3)}</div></div>
      <div class="card"><div class="card-head"><h2>Macro headlines</h2><a href="#catalysts">More →</a></div><ul class="news" id="heads">${skel(5)}</ul></div>
    </div>`;

  screen().then((d) => {
    if (!alive()) return;
    $("#asof").textContent = `Screened ${d.stocks.length} stocks · ${ago(d.asOf)}`;
    if (d.insight) $("#insight").innerHTML = `<div class="banner">${esc(d.insight)}</div>`;
    const uv = d.stocks.filter((s) => s.label === "Undervalued");
    const medUp = (() => { const v = uv.map((s) => s.upside).filter(isNum).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; })();
    const worst = d.groups[0];
    const traps = d.stocks.filter((s) => s.label === "Possible value trap").length;
    const sectorDriven = uv.filter((s) => isNum(s.sector3m) && s.sector3m < 0 && (s.own3m ?? 0) > -4).length;
    $("#kpis").innerHTML = `
      <div class="card kpi"><div class="label">Screen as undervalued</div><div class="value">${uv.length}</div><div class="sub">${sectorDriven} marked down with their sector, not on own news</div></div>
      <div class="card kpi"><div class="label">Median analyst upside on those</div><div class="value ${cls(medUp)}">${pct(medUp, 0)}</div><div class="sub">to the average price target</div></div>
      <div class="card kpi"><div class="label">Most marked-down group</div><div class="value" style="font-size:18px;margin-top:6px">${esc(worst?.name || "—")}</div><div class="sub">${worst ? `${pct(worst.offHigh, 0)} from highs · ${pct(worst.upside, 0)} to targets` : ""}</div></div>
      <div class="card kpi"><div class="label">Possible value traps</div><div class="value warn">${traps}</div><div class="sub">cheap, but estimates or returns are slipping</div></div>`;
    // Rates thesis lists
    const nimRows = d.stocks.filter((s) => s.thesisType === "NIM" && s.nim).sort((a, b) => ((b.thesisFit ? 1000 : 0) + (b.thesis ?? 0) + (b.score ?? 0) * 0.5) - ((a.thesisFit ? 1000 : 0) + (a.thesis ?? 0) + (a.score ?? 0) * 0.5)).slice(0, 6);
    const thRow = (s, right) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px"><span>${link(s.symbol, `<b>${esc(s.symbol)}</b>`)} ${s.thesisFit ? `<span class="label undervalued">Fits thesis</span>` : label(s.label)}</span><span class="num muted">${right}</span></div>`;
    $("#tnim").innerHTML = nimRows.length ? nimRows.map((s) => thRow(s, `NIM <b class="${cls(s.nim.chg1y)}">${s.nim.chg1y > 0 ? "+" : ""}${s.nim.chg1y ?? "—"} bp</b> · NII ${pct(s.nim.niiYoY, 0)} · value ${s.score ?? "—"}`)).join("") : `<div class="empty">No NIM data yet.</div>`;
    const dl = d.stocks.filter((s) => s.trading).sort((a, b) => (b.thesis ?? 0) - (a.thesis ?? 0));
    $("#tdeal").innerHTML = dl.length ? dl.map((s) => thRow(s, `${s.trading.ficcYoY != null ? "FICC" : "Mkts"} <b class="${cls(s.trading.ficcYoY ?? s.trading.marketsYoY)}">${pct(s.trading.ficcYoY ?? s.trading.marketsYoY, 0)}</b> · Eq ${pct(s.trading.eqYoY, 0)} · value ${s.score ?? "—"}`)).join("") + `<div class="faint" style="font-size:12px;margin-top:6px">${esc(d.tradingQuarter || "")}. FICC lagged equities last quarter, so the volatility case still needs to show up in results.</div>` : `<div class="empty">No dealer data.</div>`;
    const picks = (uv.length >= 3 ? uv : d.stocks).slice(0, 6);
    $("#picks").innerHTML = picks.map((s) => `
      <div class="card pick" data-go="${esc(s.symbol)}" style="background:var(--panel-2)">
        <div class="top"><div><div class="sym">${link(s.symbol, esc(s.symbol))} ${label(s.label)}</div><div class="muted" style="font-size:12px">${esc(s.name)} · ${esc(s.groupName)} · ${esc(s.tier || "")}</div></div>${ring(s.score)}</div>
        <div class="stats"><span>Upside <b class="${cls(s.upside)}">${pct(s.upside, 0)}</b></span><span>${s.metric === "pb" ? `P/B <b>${x(s.pb, 2)}</b> vs ${x(s.impliedPB ?? s.peerPB, 2)} ${s.impliedPB ? "ROE-implied" : "peers"}` : `Fwd P/E <b>${x(s.forwardPE)}</b> vs ${x(s.peerPE)}`}</span>${isNum(s.sector3m) ? `<span>3m: sector <b class="${cls(s.sector3m)}">${pct(s.sector3m, 0)}</b> · own <b class="${cls(s.own3m)}">${pct(s.own3m, 0)}</b></span>` : ""}</div>
        <ul>${s.why.slice(0, 3).map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
        <div class="chips" data-cat="${esc(s.symbol)}"><span class="faint" style="font-size:12px">Checking the news…</span></div>
      </div>`).join("");
    api(`/api/catalysts?symbols=${picks.map((s) => s.symbol).join(",")}`, 60 * 60e3).then((c) => {
      if (!alive()) return;
      for (const s of picks) {
        const el = $(`[data-cat="${CSS.escape(s.symbol)}"]`); if (!el) continue;
        const k = c.catalysts[s.symbol];
        el.innerHTML = k?.drivers?.length ? `<span class="faint" style="font-size:12px">In the news:</span> ${k.drivers.slice(0, 3).map(catChip).join("")}` : `<span class="faint" style="font-size:12px">No clear negative headline — discount looks valuation-driven</span>`;
      }
    }).catch(() => { if (alive()) $$("[data-cat]").forEach((el) => { el.innerHTML = `<span class="faint" style="font-size:12px">News unavailable right now</span>`; }); });
    const max = Math.max(...d.groups.map((g) => Math.abs(g.offHigh ?? 0)), 1);
    $("#groups").innerHTML = d.groups.map((g) => hbar(g.name, g.offHigh, max, pct(g.offHigh, 0), "down")).join("") +
      `<div class="faint" style="font-size:12px;margin-top:8px">A group-wide drop usually points to a macro cause (rates, tariffs, conflict). A single name falling far more than its group points to a company-specific one.</div>`;
  }).catch((e) => { if (!alive()) return; $("#kpis").innerHTML = `<div class="card span2">${errBox(e)}</div>`; $("#picks").innerHTML = ""; $("#groups").innerHTML = ""; });

  api("/api/catalysts?section=macro", 30 * 60e3).then((m) => {
    if (!alive()) return;
    const macro = m.heat.filter((h) => h.macro), comp = m.heat.filter((h) => !h.macro);
    const max = Math.max(...m.heat.map((h) => h.count), 1);
    $("#heat").innerHTML = m.heat.length ? `
      <div class="faint" style="font-size:12px;margin-bottom:2px">Macro & geopolitical</div>${macro.map((h) => hbar(h.name, h.count, max, `${h.count}`, "macro")).join("") || `<div class="faint">None this period</div>`}
      <div class="faint" style="font-size:12px;margin:8px 0 2px">Industry & company</div>${comp.slice(0, 5).map((h) => hbar(h.name, h.count, max, `${h.count}`)).join("")}
      <div class="faint" style="font-size:12px;margin-top:8px">Number of headlines in the last three weeks.</div>` : `<div class="empty">No tagged headlines yet.</div>`;
    $("#heads").innerHTML = newsItems(m.news.slice(0, 7));
  }).catch((e) => { if (alive()) { $("#heat").innerHTML = errBox(e); $("#heads").innerHTML = ""; } });

  api("/api/curve", 30 * 60e3).then((c) => {
    if (!alive()) return;
    const u = c.us; if (!u) { $("#tcurve").textContent = ""; return; }
    const r = u.regime?.m3, r1m = u.regime?.m1;
    $("#tcurve").innerHTML = `US curve <b style="color:var(--text)">${esc(u.shape)}</b>, 2s10s <b style="color:var(--text)">${bp(u.levels.s2s10s)}</b> (${bp(u.changes.y1.s2s10s)} in a year)${r ? ` · 3 months: <b style="color:var(--text)">${esc(r.name.toLowerCase())}</b>` : ""}${r1m ? `, last month: ${esc(r1m.name.toLowerCase())}` : ""} · front-end vol higher than <b style="color:var(--text)">${u.frontVol.pct ?? "—"}%</b> of the past year${c.move ? ` · MOVE ${c.move.now}` : ""}. ${u.levels.s2s10s > 0 ? "A positively sloped curve supports margins;" : "An inverted curve squeezes margins;"} front-end volatility is ${(u.frontVol.pct ?? 0) >= 70 ? "elevated, which is good for rates desks" : "not unusually high"}.`;
  }).catch(() => { if (alive()) $("#tcurve").textContent = ""; });

  api("/api/market", 5 * 60e3).then((m) => {
    if (!alive()) return;
    $("#pulse").innerHTML = m.series.map((s) => {
      const pts = s.points.slice(-22), last = pts.at(-1)?.[1], first = pts[0]?.[1];
      const isYield = /yield|T-bill/.test(s.name);
      const chg = isYield ? (last - first) : first ? (last / first - 1) * 100 : null;
      return `<div class="tile"><div class="n" title="${esc(s.name)}">${esc(s.name)}</div><div class="v"><span class="num">${isYield ? `${fix(last)}%` : fix(last, last > 1000 ? 0 : 2)}</span><span class="num ${s.group === "macro" ? "" : cls(chg)}" style="font-size:12px">${isYield ? `${chg > 0 ? "+" : ""}${fix(chg * 100, 0)}bp` : pct(chg)}</span></div>${spark(pts, 140, 26, s.group === "macro")}</div>`;
    }).join("");
  }).catch((e) => { if (alive()) $("#pulse").innerHTML = errBox(e); });
}

function newsItems(list) {
  if (!list?.length) return `<li class="empty">No headlines found.</li>`;
  const names = Object.fromEntries(CATS.map((c) => [c.key, c]));
  return list.map((n) => `<li>${dot(n.tone, `${n.tone} tone`)}<div style="min-width:0">
    <a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
    <div class="meta"><span>${esc(n.publisher || "")}</span><span>${ago(n.time)}</span>${(n.tags || []).slice(0, 3).map((k) => names[k] ? catChip({ name: names[k].name, macro: names[k].macro }) : "").join("")}</div></div></li>`).join("");
}
// Mirror of the server's categories (names only) so chips can be labelled without another request.
const CATS = [
  ["war", "War & conflict", 1], ["geo", "Geopolitics & sanctions", 1], ["trade", "Tariffs & trade", 1], ["rates", "Rates & central banks", 1],
  ["recession", "Recession & jobs", 1], ["credit", "Credit & loan losses", 0], ["privcredit", "Private credit & alts", 0], ["cat", "Catastrophe & claims", 0],
  ["housing", "Housing & mortgages", 0], ["legal", "Regulation & legal", 0], ["mgmt", "Deals & management", 0], ["earnings", "Earnings & guidance", 0], ["analyst", "Analyst calls", 0],
].map(([key, name, macro]) => ({ key, name, macro: !!macro }));

// ======================================================================
// Screener
// ======================================================================
const COLS = [
  ["symbol", "Stock", "l"], ["label", "Signal", "l"], ["score", "Score"], ["thesis", "Rates thesis"], ["nimChg", "NIM Δ 1y"], ["discount", "Value gap"], ["upside", "Upside"],
  ["sector3m", "3m: sector / own"], ["recMean", "Analysts"], ["rev90", "EPS rev. 90d"], ["roe", "ROE"], ["yield", "Yield"],
  ["valuation", "Multiple vs peers"], ["offHigh", "Off 52w high"], ["marketCapUsd", "Mkt cap"], ["price", "Price"], ["groupName", "Group", "l"],
];
const DEFAULT_FILTERS = { ex: "All", tiers: ["Small", "Mid", "Large"], group: "All", sig: "All", lens: "All", minUp: "", text: "", sort: "score", dir: -1 };
const LENSES = { All: () => true, "Fits rates thesis": (s) => s.thesisFit, "NIM widening": (s) => (s.nim?.chg1y ?? -1) > 0, "Dealers (FICC)": (s) => !!s.trading, "Banks": (s) => BANK_GROUPS.includes(s.group) };
const valueGap = (s) => (s.metric === "pb" ? s.pbResid ?? s.pbDiscount : s.peDiscount);
const partsTip = (p) => (p ? `Score parts (percentile): value ${p.value ?? "—"} · street ${p.street ?? "—"} · quality ${p.quality ?? "—"} · revisions ${p.revisions ?? "—"} · sector markdown ${p.macro ?? "—"}` : "");
function screener(_, alive) {
  const f = { ...DEFAULT_FILTERS, ...store.get("filters", {}) };
  app.innerHTML = `
    <div class="page-head"><div><h1>Screener</h1><div class="muted"><b>Rates thesis</b> (0–100): for banks, how fast net interest margin is widening (and whether asset yields, not just cheaper deposits, are driving it); for dealers, FICC and equities trading growth and how the stock trades with rates volatility. ✓ = strong thesis fit that isn't a value trap. Score is a 0–100 percentile: value for its returns vs peers (35%), estimate revisions (15%), analyst upside & rating (20%), quality within its group (15%) and how much of its recent drop came from its sector (15%). <b>Value gap</b> = how far below the P/B its ROE implies (banks, insurers, mREITs) or below peers' forward P/E (fee businesses).</div></div><div class="muted" id="count"></div></div>
    <div class="filters">
      <label class="field">Exchange<select id="f-ex">${["All", "TSX", "NYSE"].map((v) => `<option ${f.ex === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <div class="field" role="group" aria-label="Market cap">Size<div class="chips">${["Micro", "Small", "Mid", "Large"].map((t) => `<button class="chip ${f.tiers.includes(t) ? "on" : ""}" data-tier="${t}" aria-pressed="${f.tiers.includes(t)}">${t}</button>`).join("")}</div></div>
      <label class="field">Peer group<select id="f-group"><option>All</option></select></label>
      <label class="field">Lens<select id="f-lens">${Object.keys(LENSES).map((v) => `<option ${f.lens === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="field">Signal<select id="f-sig">${["All", "Undervalued", "Watch", "Possible value trap", "Fairly valued"].map((v) => `<option ${f.sig === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="field">Min upside %<input id="f-up" type="number" inputmode="numeric" value="${esc(f.minUp)}" style="width:90px"></label>
      <label class="field">Find<input id="f-text" type="text" value="${esc(f.text)}" placeholder="e.g. bank" style="width:140px"></label>
      <button class="btn ghost" id="f-clear">Clear filters</button>
      <button class="btn ghost" id="f-csv" title="Download the filtered list as CSV">Export CSV</button>
    </div>
    <div class="table-wrap" id="tbl">${skel(8)}</div>
    <div class="faint" id="skipped" style="font-size:12px;margin-top:8px"></div>`;

  screen().then((d) => {
    if (!alive()) return;
    const groups = [...new Set(d.stocks.map((s) => s.groupName))].sort();
    $("#f-group").innerHTML = `<option>All</option>` + groups.map((g) => `<option ${f.group === g ? "selected" : ""}>${esc(g)}</option>`).join("");
    if (d.skipped?.length) $("#skipped").textContent = `Not quoted by Yahoo (delisted, renamed or acquired — remove from api/_lib/universe.js): ${d.skipped.join(", ")}`;
    const val = (s, k) => k === "valuation" ? (s.metric === "pb" ? s.pb : s.forwardPE) : k === "discount" ? valueGap(s) : k === "recMean" ? (s.recMean == null ? null : -s.recMean) : k === "nimChg" ? s.nim?.chg1y ?? null : s[k];
    let rows = [];
    const draw = () => {
      store.set("filters", f);
      const t = f.text.trim().toLowerCase(), minUp = f.minUp === "" ? null : Number(f.minUp);
      rows = d.stocks.filter((s) => (f.ex === "All" || s.exchange === f.ex) && (!s.tier || f.tiers.includes(s.tier)) && (f.group === "All" || s.groupName === f.group)
        && (f.sig === "All" || s.label === f.sig) && (LENSES[f.lens] || LENSES.All)(s) && (minUp == null || (s.upside ?? -999) >= minUp) && (!t || `${s.symbol} ${s.name} ${s.groupName}`.toLowerCase().includes(t)));
      rows.sort((a, b) => { const A = val(a, f.sort), B = val(b, f.sort); if (A == null) return 1; if (B == null) return -1; return (typeof A === "string" ? A.localeCompare(B) : A - B) * f.dir; });
      $("#count").textContent = `${rows.length} of ${d.stocks.length} stocks · data ${ago(d.asOf)}`;
      $("#tbl").innerHTML = rows.length ? `<table class="sticky"><thead><tr>${COLS.map(([k, n, a]) => `<th scope="col" class="${a || ""} ${f.sort === k ? "sorted" : ""}" aria-sort="${f.sort === k ? (f.dir > 0 ? "ascending" : "descending") : "none"}"><button data-sort="${k}">${n}${f.sort === k ? (f.dir > 0 ? " ↑" : " ↓") : ""}</button></th>`).join("")}</tr></thead><tbody>${rows.map((s) => {
        const gap = valueGap(s);
        return `<tr>
        <td class="l">${starBtn(s.symbol, s.price)}${link(s.symbol, `<b>${esc(s.symbol)}</b> <span class="name">${esc(s.name)}</span>`)}</td>
        <td class="l">${label(s.label)}</td>
        <td class="num" title="${esc(partsTip(s.parts))}"><b>${s.score ?? "—"}</b></td>
        <td class="num" title="${esc((s.thesisWhy || []).join(" · "))}">${s.thesis != null ? `${s.thesis} <span class="faint">${esc(s.thesisType)}</span>${s.thesisFit ? " ✓" : ""}` : "—"}</td>
        <td class="num ${cls(s.nim?.chg1y)}">${s.nim ? bp(s.nim.chg1y) : "—"}</td>
        <td class="num ${cls(gap)}" title="${s.metric === "pb" && s.impliedPB ? `P/B ${s.pb}× vs ${s.impliedPB}× implied by ${fix(s.roeF ?? s.roe, 1)}% ROE` : ""}">${pct(gap, 0)}</td>
        <td class="num ${cls(s.upside)}">${pct(s.upside, 0)}</td>
        <td class="num"><span class="${cls(s.sector3m)}">${pct(s.sector3m, 0)}</span> / <span class="${cls(s.own3m)}">${pct(s.own3m, 0)}</span></td>
        <td class="num" title="${s.counts ? `${s.counts.buy} buy · ${s.counts.hold} hold · ${s.counts.sell} sell` : ""}">${esc(s.rating || "—")} <span class="faint">${s.analysts ?? ""}</span></td>
        <td class="num ${cls(s.rev90)}">${pct(s.rev90, 0)}</td>
        <td class="num">${pct(s.roeF ?? s.roe, 0, false)}</td>
        <td class="num">${pct(s.yield, 1, false)}</td>
        <td class="num">${s.metric === "pb" ? `${x(s.pb, 2)} <span class="faint">P/B vs ${x(s.peerPB, 2)}</span>` : `${x(s.forwardPE)} <span class="faint">P/E vs ${x(s.peerPE)}</span>`}</td>
        <td class="num">${pct(s.offHigh, 0)}</td>
        <td class="num" title="${esc(s.tier || "")} cap">${cap(s.marketCapUsd)}</td>
        <td class="num">${money(s.price, s.currency)} <span class="${cls(s.change)}" style="font-size:11px">${pct(s.change)}</span></td>
        <td class="l muted">${esc(s.groupName)}</td></tr>`; }).join("")}</tbody></table>` : `<div class="empty">No stocks match these filters. <button class="link" data-clear>Clear filters</button></div>`;
    };
    const reset = () => {
      Object.assign(f, DEFAULT_FILTERS, { tiers: [...DEFAULT_FILTERS.tiers] });
      $("#f-ex").value = "All"; $("#f-group").value = "All"; $("#f-sig").value = "All"; $("#f-lens").value = "All"; $("#f-up").value = ""; $("#f-text").value = "";
      $$("[data-tier]").forEach((b) => { const on = f.tiers.includes(b.dataset.tier); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
      draw();
    };
    draw();
    const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
    on("#f-ex", "change", (e) => { f.ex = e.target.value; draw(); });
    on("#f-group", "change", (e) => { f.group = e.target.value; draw(); });
    on("#f-sig", "change", (e) => { f.sig = e.target.value; draw(); });
    on("#f-lens", "change", (e) => { f.lens = e.target.value; draw(); });
    on("#f-up", "input", (e) => { f.minUp = e.target.value; draw(); });
    on("#f-text", "input", (e) => { f.text = e.target.value; draw(); });
    on("#f-clear", "click", reset);
    $$("[data-tier]").forEach((b) => b.addEventListener("click", () => {
      const t = b.dataset.tier; f.tiers = f.tiers.includes(t) ? f.tiers.filter((v) => v !== t) : [...f.tiers, t];
      b.classList.toggle("on", f.tiers.includes(t)); b.setAttribute("aria-pressed", f.tiers.includes(t)); draw();
    }));
    $("#tbl").addEventListener("click", (e) => {
      const th = e.target.closest("[data-sort]");
      if (th) { const k = th.dataset.sort; f.dir = f.sort === k ? -f.dir : (["symbol", "groupName", "label", "valuation"].includes(k) ? 1 : -1); f.sort = k; draw(); $(`[data-sort="${k}"]`)?.focus(); }
      if (e.target.closest("[data-clear]")) reset();
    });
    on("#f-csv", "click", () => {
      const head = ["Symbol", "Name", "Exchange", "Group", "Signal", "Score", "Value gap %", "Analyst upside %", "Sector 3m %", "Own 3m %", "Rating", "Analysts", "EPS rev 90d %", "ROE % (fwd)", "Yield %", "P/B", "ROE-implied P/B", "Peer P/B", "Fwd P/E", "Peer P/E", "Justified value", "Off 52w high %", "Market cap (USD)", "Price", "Currency", "Most sensitive to", "Value-trap flags", "Rates thesis score", "Thesis type", "NIM change 1y (bp)", "NII y/y %", "FICC y/y %", "Thesis notes"];
      const lines = rows.map((s) => [s.symbol, s.name, s.exchange, s.groupName, s.label, s.score, valueGap(s), s.upside, s.sector3m, s.own3m, s.rating, s.analysts, s.rev90, s.roeF ?? s.roe, s.yield, s.pb, s.impliedPB, s.peerPB, s.forwardPE, s.peerPE, s.fairValue, s.offHigh, s.marketCapUsd, s.price, s.currency, s.sens?.name, s.risks.join("; "), s.thesis, s.thesisType, s.nim?.chg1y, s.nim?.niiYoY, s.trading?.ficcYoY ?? s.trading?.marketsYoY, (s.thesisWhy || []).join("; ")]);
      const csv = [head, ...lines].map((r) => r.map((v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `kcm-financials-screen-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    });
  }).catch((e) => { if (alive()) $("#tbl").innerHTML = `<div style="padding:16px">${errBox(e)}</div>`; });
}

// ======================================================================
// Research
// ======================================================================
function scatter(el, peers, sym) {
  const pts = peers.filter((p) => isNum(p.pb) && isNum(p.roeF ?? p.roe)).map((p) => ({ ...p, rx: p.roeF ?? p.roe }));
  if (pts.length < 3) { el.innerHTML = `<div class="empty">Not enough peers with P/B and ROE to plot.</div>`; return; }
  const W = Math.max(260, el.clientWidth || 400), H = 240, P = { l: 40, r: 14, t: 12, b: 32 };
  const xs = pts.map((p) => p.rx), ys = pts.map((p) => p.pb);
  const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, y0 = Math.max(0, Math.min(...ys) - 0.15), y1 = Math.max(...ys) + 0.15;
  const X = (v) => P.l + ((v - x0) / (x1 - x0)) * (W - P.l - P.r), Y = (v) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
  // Simple fit line through the peers (the "fair" P/B for a given ROE).
  const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0; pts.forEach((p) => { sxy += (p.rx - mx) * (p.pb - my); sxx += (p.rx - mx) ** 2; });
  const b = sxx ? sxy / sxx : 0, a = my - b * mx;
  const ticks = (lo, hi, n) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Price to book against return on equity for ${esc(peers[0]?.groupName || "peers")}">
    ${ticks(y0, y1, 4).map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${P.l - 6}" y="${Y(v) + 4}" font-size="11" fill="var(--faint)" text-anchor="end">${v.toFixed(1)}×</text>`).join("")}
    ${ticks(x0, x1, 4).map((v) => `<text x="${X(v)}" y="${H - 14}" font-size="11" fill="var(--faint)" text-anchor="middle">${v.toFixed(0)}%</text>`).join("")}
    <text x="${W - P.r}" y="${H - 2}" font-size="11" fill="var(--muted)" text-anchor="end">Forward ROE →</text>
    <line x1="${X(x0)}" y1="${Y(a + b * x0)}" x2="${X(x1)}" y2="${Y(a + b * x1)}" stroke="var(--faint)" stroke-dasharray="4 4"/>
    ${pts.map((p) => `<g><title>${esc(p.symbol)}: P/B ${p.pb}×, ROE ${fix(p.rx, 1)}%</title><circle cx="${X(p.rx)}" cy="${Y(p.pb)}" r="${p.symbol === sym ? 7 : 5}" fill="${p.symbol === sym ? "var(--accent)" : "var(--muted)"}" fill-opacity="${p.symbol === sym ? 1 : 0.55}" stroke="var(--panel)" stroke-width="1.5"/>
      <text x="${X(p.rx) + 8}" y="${Y(p.pb) + 4}" font-size="11" fill="${p.symbol === sym ? "var(--text)" : "var(--faint)"}" font-weight="${p.symbol === sym ? 600 : 400}">${esc(p.symbol.replace(".TO", ""))}</text></g>`).join("")}
  </svg><div class="faint" style="font-size:12px">Below the dashed line = cheaper than peers earning a similar return. That is the "value gap" in the screener.</div>`;
}

async function research(sym, alive) {
  if (!sym) {
    const w = watch.all();
    app.innerHTML = `<div class="page-head"><div><h1>Research</h1><div class="muted">Pick a stock from the screener, your watchlist, or search with <kbd>/</kbd>.</div></div></div>
      <div class="card">${w.length ? `<div class="chips">${w.map((x2) => `<a class="chip" href="#research/${encodeURIComponent(x2.symbol)}">${esc(x2.symbol)}</a>`).join("")}</div>` : `<div class="empty">Your watchlist is empty. Star a stock in the screener to keep it here.</div>`}</div>`;
    return;
  }
  app.innerHTML = `
    <div class="quote-head" id="qh"><div>${skel(2)}</div></div>
    <div class="strip" id="strip"></div>
    <div class="grid g3">
      <div class="card span2 chart"><div class="card-head"><h2>Price</h2><div class="ranges" id="ranges" role="group" aria-label="Chart range">${["3mo", "6mo", "1y", "2y", "5y"].map((r) => `<button data-r="${r}" class="${r === "1y" ? "on" : ""}" aria-pressed="${r === "1y"}">${r.toUpperCase()}</button>`).join("")}</div></div><div id="chart">${skel(6)}</div></div>
      <div class="card"><div class="card-head"><h2>Street view</h2></div><div id="street">${skel(6)}</div></div>
    </div>
    <div class="grid g3" style="margin-top:14px">
      <div class="card span2"><div class="card-head"><h2>Why it's cheap</h2><span class="muted" style="font-size:12px">Price action + last 90 days of headlines</span></div><div id="why">${skel(6)}</div></div>
      <div class="card"><div class="card-head"><h2>Value-trap check</h2></div><div id="trap">${skel(4)}</div></div>
    </div>
    <div class="grid g3" style="margin-top:14px">
      <div class="card"><div class="card-head"><h2>Fair-value range</h2></div><div id="fv">${skel(4)}</div></div>
      <div class="card span2"><div class="card-head"><h2 id="peer-h">Peers</h2></div><div id="peers">${skel(6)}</div></div>
    </div>
    <div class="grid g3" style="margin-top:14px">
      <div class="card"><div class="card-head"><h2>Cheap for its returns?</h2></div><div class="scatter" id="scatter">${skel(6)}</div></div>
      <div class="card span2"><div class="card-head"><h2>Analyst track records</h2><span class="muted" style="font-size:12px">Each firm's past calls on this stock, scored 12 months later</span></div><div id="firms">${skel(6)}</div></div>
    </div>
    <div class="card" style="margin-top:14px" id="nimcard" hidden><div class="card-head"><h2>Net interest margin</h2><a href="#rates">All banks →</a></div><div id="nimbody">${skel(4)}</div></div>
    <div class="card" style="margin-top:14px"><div class="card-head"><h2>Pitch notes</h2><span class="muted" style="font-size:12px" id="saved"></span></div>
      <textarea class="notes" id="notes" placeholder="Thesis, the catalyst that closes the discount, risks, what would make you wrong…" aria-label="Pitch notes"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn" id="copy">Copy pitch summary</button><span class="muted" style="font-size:12px;align-self:center" id="copied" role="status"></span></div></div>`;

  const ta = $("#notes"); ta.value = notes.get(sym);
  let tmr; ta.addEventListener("input", () => { clearTimeout(tmr); tmr = setTimeout(() => { notes.set(sym, ta.value.trim()); $("#saved").textContent = "Saved in this browser"; }, 400); });

  const scr = screen().catch(() => null);
  const st = api(`/api/stock?symbol=${encodeURIComponent(sym)}`).catch((e) => ({ error: e }));
  const cat = api(`/api/catalysts?symbol=${encodeURIComponent(sym)}`, 30 * 60e3).catch((e) => ({ error: e }));

  let want = "1y";
  const drawChart = (range) => {
    want = range;
    api(`/api/charts?symbols=${encodeURIComponent(sym)}&range=${range}`).then(async (c) => {
      const s = await st, d = await scr;
      if (!alive() || range !== want) return;
      const row = d?.stocks.find((r) => r.symbol === sym);
      lineChart($("#chart"), c.charts[sym]?.points, { target: s?.analyst?.targetMean, fair: row?.fairValue, label: `${sym} price, ${range}` });
    }).catch((e) => { if (alive() && range === want) $("#chart").innerHTML = errBox(e); });
  };
  drawChart("1y");
  $("#ranges").addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (!b) return; $$("#ranges button").forEach((x2) => { x2.classList.toggle("on", x2 === b); x2.setAttribute("aria-pressed", x2 === b); }); drawChart(b.dataset.r); });

  const [d, s] = await Promise.all([scr, st]);
  if (!alive()) return;
  const row = d?.stocks.find((r) => r.symbol === sym) || null;
  const peers = row ? d.stocks.filter((p) => p.group === row.group) : [];
  const a = s.analyst || {};
  const st2 = s.stats || {};
  if (s.error) { $("#qh").innerHTML = `<div><h1>${esc(sym)}</h1>${errBox(s.error)}</div>`; }
  else {
    $("#qh").innerHTML = `<div><h1>${esc(s.name)} <span class="muted" style="font-weight:450">${esc(sym)}</span></h1>
      <div class="muted">${esc([s.exchange, row?.groupName || s.industry, row?.tier ? `${row.tier} cap` : null].filter(Boolean).join(" · "))}</div></div>
      <div style="text-align:right"><div class="px num">${money(s.price, s.currency)} <span class="${cls(s.changePct)}" style="font-size:15px">${pct(s.changePct)}</span></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:4px">${row ? `${label(row.label)} <span title="${esc(partsTip(row.parts))}">${ring(row.score)}</span>` : `<span class="chip">Outside the financials universe</span>`}${starBtn(sym, s.price)}</div></div>`;
  }

  // ---- Summary strip ----
  const verdict = (c) => {
    if (!row || !isNum(row.sector3m)) return null;
    const priceSays = row.sector3m < -3 && (row.own3m ?? 0) > -4 ? "sector" : (row.own3m ?? 0) <= -8 ? "own" : "mixed";
    const newsSays = c && !c.error && c.macroShare != null ? (c.macroShare >= 50 ? "macro" : "company") : null;
    return { priceSays, newsSays };
  };
  const drawStrip = (c) => {
    if (!row) { $("#strip").innerHTML = ""; return; }
    const v = verdict(c);
    const gap = valueGap(row);
    const ver = !v ? "—" : v.priceSays === "sector" && v.newsSays !== "company" ? "Sector / macro" : v.priceSays === "own" && v.newsSays !== "macro" ? "Company-specific" : v.newsSays && ((v.priceSays === "sector") !== (v.newsSays === "macro")) ? "Mixed — dig in" : v.priceSays === "sector" ? "Sector / macro" : "Mixed";
    $("#strip").innerHTML = [
      ["Value gap", pct(gap, 0), row.metric === "pb" ? "vs ROE-implied P/B" : "vs peers' forward P/E", cls(gap)],
      ["Analyst upside", pct(row.upside, 0), `${esc(row.rating || "—")}${row.analysts ? ` · ${row.analysts} analysts` : ""}`, cls(row.upside)],
      ["Why it fell (3m)", ver, isNum(row.sector3m) ? `sector ${pct(row.sector3m, 0)} · own ${pct(row.own3m, 0)}${c && !c.error && c.macroShare != null ? ` · news ${c.macroShare}% macro` : ""}` : "no price history", ""],
      ["EPS revisions 90d", pct(row.rev90, 0), "next year's estimate", cls(row.rev90)],
      ["Value-trap flags", String(row.risks.length), row.risks.length ? "see the check below" : "none from the numbers", row.risks.length >= 2 ? "down" : row.risks.length ? "warn" : "up"],
      ...(row.thesis != null ? [["Rates thesis", `${row.thesis}${row.thesisFit ? " ✓" : ""}`, row.thesisType === "NIM" && row.nim ? `NIM ${bp(row.nim.chg1y)} · NII ${pct(row.nim.niiYoY, 0)} y/y` : row.trading ? `FICC ${pct(row.trading.ficcYoY ?? row.trading.marketsYoY, 0)} · equities ${pct(row.trading.eqYoY, 0)}` : "", row.thesisFit ? "up" : ""]] : []),
      ["Most sensitive to", row.sens ? esc(row.sens.name) : "—", row.sens ? `correlation ${row.sens.corr > 0 ? "+" : ""}${row.sens.corr}` : "no strong single factor", ""],
    ].map(([k, v2, sub, c2]) => `<div class="cell"><div class="k">${k}</div><div class="v ${c2}">${v2}</div><div class="s">${sub}</div></div>`).join("");
  };
  drawStrip(null);

  // ---- Street view ----
  const t0 = a.trend?.find((t) => t.period === "0m") || a.trend?.[0];
  const tot = t0 ? t0.strongBuy + t0.buy + t0.hold + t0.sell + t0.strongSell : 0;
  $("#street").innerHTML = a.analysts || tot ? `<dl class="kv">
      <dt>Consensus</dt><dd>${esc(row?.rating || (a.recommendation || "—").replace("_", " "))}</dd>
      <dt>Analysts</dt><dd>${a.analysts ?? tot ?? "—"}</dd>
      <dt>Average target</dt><dd>${money(a.targetMean, s.currency)}${row ? ` <span class="${cls(row.upside)}">${pct(row.upside, 0)}</span>` : ""}</dd>
      <dt>Target range</dt><dd>${fix(a.targetLow)} – ${fix(a.targetHigh)}</dd></dl>
      ${tot ? `<div class="split" style="margin-top:12px" role="img" aria-label="${t0.strongBuy + t0.buy} buy, ${t0.hold} hold, ${t0.sell + t0.strongSell} sell">${[[t0.strongBuy + t0.buy, "var(--up)"], [t0.hold, "var(--faint)"], [t0.sell + t0.strongSell, "var(--down)"]].map(([n, c]) => n ? `<span style="width:${(n / tot) * 100}%;background:${c}"></span>` : "").join("")}</div>
      <div style="font-size:12px;margin-top:6px;display:flex;gap:12px"><span><span class="dot positive"></span> ${t0.strongBuy + t0.buy} buy</span><span><span class="dot neutral"></span> ${t0.hold} hold</span><span><span class="dot negative"></span> ${t0.sell + t0.strongSell} sell</span></div>` : ""}
      ${a.changes?.length ? `<div style="margin-top:12px;font-size:13px">${a.changes.slice(0, 4).map((c) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0"><span>${esc(c.firm)}</span><span class="muted">${esc(c.to || "")} · ${ago(c.date)}</span></div>`).join("")}</div>` : ""}`
    : `<div class="empty">No analyst coverage on Yahoo Finance.</div>`;

  // ---- Value-trap check ----
  const roeUse = row ? row.roeF ?? row.roe : null;
  const checks = row ? [
    [row.rev90 == null ? null : row.rev90 > -5, `EPS estimates ${row.rev90 == null ? "— no revision data" : row.rev90 >= 0 ? `rising (${pct(row.rev90, 0)})` : `falling (${pct(row.rev90, 0)})`} over 90 days`],
    [roeUse == null ? null : roeUse >= row.coe - 3, `ROE ${pct(roeUse, 1, false)} vs ~${fix(row.coe, 1)}% cost of equity`],
    [row.payout == null ? null : row.payout <= 100 || ["alts", "holdco"].includes(row.group), `Payout ${pct(row.payout, 0, false)} of expected earnings`],
    [row.upside == null ? null : row.upside > 0, `Price ${row.upside != null && row.upside > 0 ? "below" : "above"} the average target`],
    [row.own3m == null ? null : row.own3m > -15, `Own 3-month move ${pct(row.own3m, 0)} beyond what its sector explains`],
  ] : [];
  $("#trap").innerHTML = row ? `<ul class="news">${checks.map(([ok, t]) => `<li>${dot(ok == null ? "neutral" : ok ? "positive" : "negative", ok == null ? "No data" : ok ? "Pass" : "Flag")}<span>${esc(t)}</span></li>`).join("")}</ul>
      ${row.risks.length ? `<div class="faint" style="font-size:12px;margin-top:8px">Flags: ${row.risks.map(esc).join(" · ")}</div>` : `<div class="faint" style="font-size:12px;margin-top:8px">No value-trap flags from the numbers.</div>`}
      <div id="newsflags"></div>`
    : `<div class="empty">Only scored for stocks in the financials universe.</div>`;

  // ---- Fair-value range ----
  const fvPts = [
    ["Low target", a.targetLow], ["Avg target", a.targetMean], ["High target", a.targetHigh],
    ["Peer P/B × book", row?.peerPB && row?.bvps ? row.peerPB * row.bvps : null],
    ["ROE-implied P/B × book", row?.impliedPB && row?.bvps ? row.impliedPB * row.bvps : null],
    ["Justified P/B", row?.fairValue],
  ].filter(([, v]) => isNum(v));
  if (fvPts.length && isNum(s.price)) {
    const vals = [...fvPts.map((p) => p[1]), s.price];
    const lo = Math.min(...vals) * 0.97, hi = Math.max(...vals) * 1.03, P = (v) => ((v - lo) / (hi - lo)) * 100;
    const tl = isNum(a.targetLow) ? a.targetLow : null, th = isNum(a.targetHigh) ? a.targetHigh : null;
    $("#fv").innerHTML = `<div class="fv">${tl != null && th != null ? `<div class="band" style="left:${P(tl)}%;width:${P(th) - P(tl)}%" title="Analyst target range"></div>` : ""}
        <div class="pt now" style="left:${P(s.price)}%"></div><span class="lbl" style="left:${P(s.price)}%;top:0;color:var(--text)">Now ${fix(s.price)}</span>
        ${isNum(a.targetMean) ? `<div class="pt" style="left:${P(a.targetMean)}%;background:var(--accent)"></div><span class="lbl" style="left:${P(a.targetMean)}%;top:40px;color:var(--accent)">Avg ${fix(a.targetMean)}</span>` : ""}</div>
      <dl class="kv" style="margin-top:6px">${fvPts.map(([k, v]) => `<dt>${k}</dt><dd>${fix(v)} <span class="${cls((v / s.price - 1) * 100)}">${pct((v / s.price - 1) * 100, 0)}</span></dd>`).join("")}</dl>
      <div class="faint" style="font-size:12px;margin-top:8px">Bear / base / bull from the Street's low, average and high targets. The book-value methods suit banks and insurers. Justified P/B = (ROE − g) / (cost of equity − g), with cost of equity ≈ 10-yr yield + β × 5.5%; it swings a lot with those inputs.</div>`;
  } else $("#fv").innerHTML = `<div class="empty">No targets or book value to build a range from.</div>`;

  // ---- Peers ----
  if (row) {
    $("#peer-h").textContent = `${row.groupName} — peer comparison`;
    $("#peers").innerHTML = `<div class="table-wrap" style="border:0"><table><thead><tr><th scope="col" class="l">Stock</th><th scope="col">Score</th><th scope="col">P/B</th><th scope="col">Fwd P/E</th><th scope="col">ROE</th><th scope="col">Yield</th><th scope="col">Value gap</th><th scope="col">Upside</th><th scope="col">3m</th></tr></thead><tbody>
      ${peers.map((p) => `<tr class="${p.symbol === sym ? "peer-hl" : ""}"><td class="l">${p.symbol === sym ? `<b>${esc(p.symbol)}</b>` : link(p.symbol, esc(p.symbol))}</td><td class="num">${p.score ?? "—"}</td><td class="num">${x(p.pb, 2)}</td><td class="num">${x(p.forwardPE)}</td><td class="num">${pct(p.roeF ?? p.roe, 0, false)}</td><td class="num">${pct(p.yield, 1, false)}</td><td class="num ${cls(valueGap(p))}">${pct(valueGap(p), 0)}</td><td class="num ${cls(p.upside)}">${pct(p.upside, 0)}</td><td class="num ${cls(p.ret3m)}">${pct(p.ret3m, 0)}</td></tr>`).join("")}
      <tr><td class="l muted">Peer median</td><td></td><td class="num muted">${x(medOf(peers, "pb"), 2)}</td><td class="num muted">${x(medOf(peers, "forwardPE"))}</td><td class="num muted">${pct(medOf(peers, "roeF"), 0, false)}</td><td class="num muted">${pct(medOf(peers, "yield"), 1, false)}</td><td></td><td class="num muted">${pct(medOf(peers, "upside"), 0)}</td><td class="num muted">${pct(medOf(peers, "ret3m"), 0)}</td></tr></tbody></table></div>`;
    scatter($("#scatter"), peers, sym);
  } else { $("#peers").innerHTML = `<div class="empty">Peer comparison is available for stocks in the financials universe.</div>`; $("#scatter").innerHTML = ""; }

  if (row && BANK_GROUPS.includes(row.group)) {
    $("#nimcard").hidden = false;
    api(`/api/banks?symbol=${encodeURIComponent(sym)}`, 60 * 60e3).then((n) => {
      if (!alive()) return;
      if (n.error || !n.series?.length) { $("#nimbody").innerHTML = `<div class="empty">No quarterly statements from Yahoo for ${esc(sym)}.</div>`; return; }
      $("#nimbody").innerHTML = `<div class="stats" style="margin-bottom:6px"><span>NIM proxy <b>${fix(n.nim)}%</b></span><span>Last quarter <b class="${cls(n.nimChg1q)}">${bp(n.nimChg1q)}</b></span><span>${n.nimChg4q != null ? "1 year" : `${n.spanQ} quarters`} <b class="${cls(n.nimChg4q ?? n.nimChgSpan)}">${bp(n.nimChg4q ?? n.nimChgSpan)}</b></span><span>Asset yield <b class="${cls(n.yieldChg)}">${bp(n.yieldChg)}</b></span><span>Funding cost <b class="${cls(n.costChg == null ? null : -n.costChg)}">${bp(n.costChg)}</b></span><span>NII y/y <b class="${cls(n.niiYoY)}">${pct(n.niiYoY, 0)}</b></span></div><div id="nimchart"></div>
        <div class="faint" style="font-size:12px">Quarterly, annualised, as a share of average total assets (Yahoo Finance statements). The gap between the two dashed lines is the margin. The bank's reported NIM uses earning assets and runs higher.</div>`;
      const t = (d) => Date.parse(d);
      multiLine($("#nimchart"), [
        { name: "NIM proxy", color: "var(--accent)", width: 2.5, points: n.series.map((q) => [t(q.date), q.nim]) },
        { name: "Asset yield", color: "var(--up)", dash: "4 3", points: n.series.map((q) => [t(q.date), q.yieldA]) },
        { name: "Funding cost", color: "var(--down)", dash: "4 3", points: n.series.map((q) => [t(q.date), q.cost]) },
      ], { xticks: n.series.filter((_, i) => i % 2 === 0 || i === n.series.length - 1).map((q) => [t(q.date), new Date(q.date).toLocaleDateString(undefined, { month: "short", year: "2-digit" })]), yfmt: (v) => `${v.toFixed(2)}%`, dots: true, h: 200, label: "Net interest margin by quarter" });
    }).catch((e) => { if (alive()) $("#nimbody").innerHTML = errBox(e); });
  }

  api(`/api/analysts?symbol=${encodeURIComponent(sym)}`, 60 * 60e3).then((f) => {
    if (!alive()) return;
    const list = f.firms.filter((x2) => x2.active).slice(0, 8);
    $("#firms").innerHTML = list.length ? `<div class="table-wrap" style="border:0"><table><thead><tr><th scope="col" class="l">Firm</th><th scope="col">Latest call</th><th scope="col">Target</th><th scope="col">Hit rate</th><th scope="col">Avg 12m result</th><th scope="col">Stars</th></tr></thead><tbody>${list.map((x2) => `<tr style="cursor:default">
      <td class="l">${esc(x2.firm)}</td><td>${esc(x2.latest.rating || "—")} <span class="faint">${ago(x2.latest.date)}</span></td>
      <td class="num">${x2.target ? `${fix(x2.target.value)} <span class="${cls(x2.target.upside)}">${pct(x2.target.upside, 0)}</span>` : "—"}</td>
      <td class="num">${x2.scored ? `${pct(x2.successRate, 0, false)} <span class="faint">of ${x2.scored}</span>` : "—"}</td>
      <td class="num ${cls(x2.avgReturn)}">${pct(x2.avgReturn, 0)}</td>
      <td class="num" aria-label="${x2.stars ?? "no"} stars">${x2.stars != null ? "★".repeat(Math.round(x2.stars)) : "<span class='faint'>new</span>"}</td></tr>`).join("")}</tbody></table></div>
      ${f.summary?.consensus ? `<div class="faint" style="font-size:12px;margin-top:8px">Firms with the best record on this stock: <b style="color:var(--text)">${esc(f.summary.consensus)}</b>${isNum(f.summary.topUpside) ? `, average target ${pct(f.summary.topUpside, 0)} from here` : ""}.</div>` : ""}`
      : `<div class="empty">No rating history to score.</div>`;
  }).catch((e) => { if (alive()) $("#firms").innerHTML = errBox(e); });

  // ---- Why it's cheap: price split + news ----
  const c = await cat;
  if (!alive()) return;
  drawStrip(c);
  const v = verdict(c);
  const split = row && isNum(row.ret3m) && isNum(row.sector3m) ? (() => {
    const sec = row.sector3m, own = row.own3m;
    const tot2 = Math.abs(sec) + Math.abs(own) || 1;
    return `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;gap:8px;font-size:13px;margin-bottom:6px;flex-wrap:wrap"><span>3-month move <b class="${cls(row.ret3m)}">${pct(row.ret3m, 0)}</b> = sector <b>${pct(sec, 0)}</b> (β ${fix(row.etfBeta)} × ${esc(row.etf)}) + its own <b>${pct(own, 0)}</b></span></div>
      <div class="split" role="img" aria-label="Sector part ${pct(sec, 0)}, own part ${pct(own, 0)}"><span style="width:${(Math.abs(sec) / tot2) * 100}%;background:var(--muted)"></span><span style="width:${(Math.abs(own) / tot2) * 100}%;background:${own < 0 ? "var(--down)" : "var(--up)"}"></span></div>
      <div class="faint" style="font-size:12px;margin-top:4px">Grey = sector-wide part · coloured = company's own part${row.sens ? ` · moves most with <b style="color:var(--text)">${esc(row.sens.name)}</b> (${row.sens.corr > 0 ? "+" : ""}${row.sens.corr})` : ""}</div></div>`;
  })() : "";
  if (c.error) { $("#why").innerHTML = split + errBox(c.error); return; }
  const agree = v && v.newsSays ? (v.priceSays === "sector" && v.newsSays === "macro" ? `<div class="banner" style="border-left-color:var(--up)">Price and news agree: this is a <b>sector / macro discount</b>. The kind that closes when the news cycle turns, if earnings hold up.</div>`
    : v.priceSays === "own" && v.newsSays === "company" ? `<div class="banner" style="border-left-color:var(--down)">Price and news agree: the drop is <b>company-specific</b>. Find out whether the problem is one-off or lasting before calling it cheap.</div>`
    : v.priceSays === "own" && v.newsSays === "macro" ? `<div class="banner" style="border-left-color:var(--warn)">News talks macro, but the stock fell more than its sector explains. Something company-specific is likely going on — dig in.</div>`
    : v.priceSays === "sector" && v.newsSays === "company" ? `<div class="banner" style="border-left-color:var(--warn)">The price moved with its sector, but the headlines are about the company. Check whether those stories are material.</div>` : "") : "";
  $("#why").innerHTML = `${split}${agree}
      ${c.reason ? `<p style="margin:0 0 10px">${esc(c.reason)}</p>` : ""}
      ${c.drivers?.length ? `<div class="chips" style="margin-bottom:10px">${c.drivers.map(catChip).join("")}</div>` : ""}
      ${row?.why?.length ? `<ul class="bullets" style="margin-bottom:10px">${row.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      ${row?.thesisWhy?.length ? `<div class="faint" style="font-size:12px;margin-bottom:2px">Rates thesis${row.thesisFit ? " (fits)" : ""}</div><ul class="bullets" style="margin-bottom:10px">${row.thesisWhy.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      <div class="chips" style="margin-bottom:6px" id="tone" role="group" aria-label="Filter headlines"><button class="chip on" data-tone="all" aria-pressed="true">All ${c.news.length}</button><button class="chip" data-tone="negative" aria-pressed="false">Negative ${c.negative}</button><button class="chip" data-tone="premium" aria-pressed="false">Bloomberg, Reuters & major press</button></div>
      <ul class="news" id="symnews"></ul>
      <button class="link" id="more" style="margin-top:6px"></button>
      ${c.errors?.length ? `<div class="faint" style="font-size:12px">Some feeds didn't respond: ${esc(c.errors.join("; "))}</div>` : ""}`;
  let tone = "all", all2 = false;
  const drawNews = () => {
    const list = c.news.filter((n) => tone === "all" || (tone === "premium" ? n.premium : n.tone === tone));
    $("#symnews").innerHTML = newsItems(list.slice(0, all2 ? 40 : 5));
    $("#more").textContent = list.length > 5 ? (all2 ? "Show fewer" : `Show all ${Math.min(list.length, 40)}`) : "";
    $("#more").hidden = list.length <= 5;
  };
  drawNews();
  $("#more").addEventListener("click", () => { all2 = !all2; drawNews(); });
  $("#tone").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tone]"); if (!b) return;
    $$("#tone .chip").forEach((x2) => { x2.classList.toggle("on", x2 === b); x2.setAttribute("aria-pressed", x2 === b); });
    tone = b.dataset.tone; drawNews();
  });
  // Headline-based red flags for the trap check.
  const credLegal = (c.drivers || []).filter((dd) => ["credit", "legal"].includes(dd.key)).reduce((s2, dd) => s2 + (dd.weight ?? dd.count), 0);
  if ($("#newsflags") && credLegal >= 3) $("#newsflags").innerHTML = `<div class="err" style="margin-top:8px">${Math.round(credLegal)} negative credit or legal headlines in 90 days — a red flag worth reading.</div>`;

  $("#copy").addEventListener("click", async () => {
    const vv = verdict(c);
    const lines = [
      `${s.name || sym} (${sym}) — ${row?.label || "Research note"}${row ? ` · score ${row.score}/100` : ""}`,
      `Price ${money(s.price, s.currency)} · avg target ${money(a.targetMean, s.currency)} (${pct(row?.upside, 0)}), range ${fix(a.targetLow)}–${fix(a.targetHigh)} · ${row?.rating || a.recommendation || ""}${a.analysts ? ` from ${a.analysts} analysts` : ""}`,
      row ? `Valuation: P/B ${x(row.pb, 2)} (peers ${x(row.peerPB, 2)}${row.impliedPB ? `, ROE-implied ${x(row.impliedPB, 2)}` : ""}) · fwd P/E ${x(row.forwardPE)} (peers ${x(row.peerPE)}) · fwd ROE ${pct(row.roeF ?? row.roe, 1, false)} vs ~${fix(row.coe, 1)}% cost of equity · yield ${pct(row.yield, 1, false)}${row.fairValue ? ` · justified-P/B value ${fix(row.fairValue)}` : ""}` : "",
      row && isNum(row.sector3m) ? `Why it fell: 3-month move ${pct(row.ret3m, 0)} = sector ${pct(row.sector3m, 0)} + own ${pct(row.own3m, 0)}${row.sens ? `; most sensitive to ${row.sens.name}` : ""}${vv?.newsSays ? `; ${c.macroShare}% of negative themed headlines are macro` : ""}.` : "",
      row?.why?.length ? `Why it screens cheap:\n${row.why.map((w) => `- ${w}`).join("\n")}` : "",
      row?.thesisWhy?.length ? `Rates thesis (${row.thesis}/100, ${row.thesisType}):\n${row.thesisWhy.map((w) => `- ${w}`).join("\n")}` : "",
      !c.error && c.reason ? `News: ${c.reason}` : "",
      row?.risks?.length ? `Value-trap flags:\n${row.risks.map((w) => `- ${w}`).join("\n")}` : "",
      ta.value.trim() ? `My notes:\n${ta.value.trim()}` : "",
      `Sources: Yahoo Finance, Google News (Bloomberg, Reuters, BNN Bloomberg, Globe and Mail) · ${new Date().toLocaleDateString()}`,
    ].filter(Boolean).join("\n\n");
    try { await navigator.clipboard.writeText(lines); $("#copied").textContent = "Copied — paste it into your pitch doc."; }
    catch { $("#copied").textContent = "Couldn't reach the clipboard; select the notes and copy manually."; }
  });
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const medOf = (list, k) => { const v = list.map((p) => p[k]).filter(isNum).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
// ======================================================================
// Rates & banks: yield curve, NIM expansion, trading desks
// ======================================================================
// Multi-line SVG chart. series: [{ name, color, dash, points: [[x, y], ...] }]
function multiLine(el, series, o = {}) {
  const all = series.flatMap((s) => s.points).filter((p) => isNum(p[1]));
  if (!all.length) { el.innerHTML = `<div class="empty">No data.</div>`; return; }
  const W = Math.max(280, el.clientWidth || 600), H = o.h || 230, P = { l: 44, r: 12, t: 12, b: 28 };
  const xmap = o.xmap || ((v) => v);
  const xs = all.map((p) => xmap(p[0])), ys = all.map((p) => p[1]).concat(o.zero ? [0] : []);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys); const pad = (y1 - y0) * 0.1 || 0.1; y0 -= pad; y1 += pad;
  const X = (v) => P.l + ((xmap(v) - x0) / (x1 - x0 || 1)) * (W - P.l - P.r), Y = (v) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
  const yt = [0, 1, 2, 3].map((i) => y0 + ((y1 - y0) * (i + 0.5)) / 4);
  const lines = series.map((s) => { const pts = s.points.filter((p) => isNum(p[1])); return pts.length ? `<path d="${pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("")}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}/>${o.dots ? pts.map((p) => `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="2.5" fill="${s.color}"/>`).join("") : ""}` : ""; }).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.label || "chart")}">
    ${yt.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${P.l - 6}" y="${Y(v) + 4}" font-size="11" fill="var(--faint)" text-anchor="end">${(o.yfmt || ((v2) => v2.toFixed(2)))(v)}</text>`).join("")}
    ${o.zero && y0 < 0 && y1 > 0 ? `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--muted)" stroke-dasharray="3 3"/>` : ""}
    ${(o.xticks || []).map(([v, t]) => `<text x="${X(v)}" y="${H - 8}" font-size="11" fill="var(--faint)" text-anchor="middle">${t}</text>`).join("")}
    ${lines}</svg>
    <div class="chips" style="margin-top:4px">${series.map((s) => `<span class="chip" style="border-color:transparent"><svg width="18" height="6" aria-hidden="true"><line x1="0" x2="18" y1="3" y2="3" stroke="${s.color}" stroke-width="2" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}/></svg>${esc(s.name)}</span>`).join("")}</div>`;
}
const TENOR_TICKS = [[0.25, "3M"], [1, "1Y"], [2, "2Y"], [5, "5Y"], [10, "10Y"], [30, "30Y"]];
const tenorMap = (t) => Math.sqrt(t); // spreads the short end out so the front of the curve is readable
const bp = (v) => (isNum(v) ? `${v > 0 ? "+" : ""}${v} bp` : "—");
const BANK_GROUPS = ["cabank", "uslarge", "usreg"];

function curveCard(id, d, title) {
  if (!d) return `<div class="card"><div class="card-head"><h2>${title}</h2></div><div class="empty">Curve data unavailable right now.</div></div>`;
  const r = d.regime?.m1, r3 = d.regime?.m3;
  return `<div class="card"><div class="card-head"><h2>${title}</h2><span class="muted" style="font-size:12px">${esc(d.asOfDate)}</span></div>
    <div class="stats" style="margin-bottom:6px"><span>Shape <b>${esc(d.shape || "—")}</b></span><span>2s10s <b class="${cls(d.levels.s2s10s)}">${bp(d.levels.s2s10s)}</b></span><span>3m10y <b class="${cls(d.levels.s3m10y)}">${bp(d.levels.s3m10y)}</b></span><span>2-yr <b>${fix(d.levels.y2)}%</b></span><span>10-yr <b>${fix(d.levels.y10)}%</b></span></div>
    <div id="${id}"></div>
    <div class="faint" style="font-size:12px;margin-top:6px">${r ? `1 month: <b style="color:var(--text)">${esc(r.name)}</b> (2-yr ${bp(r.d2)}, 10-yr ${bp(r.d10)})` : ""}${r3 ? ` · 3 months: <b style="color:var(--text)">${esc(r3.name)}</b>${r3.why ? ` (${esc(r3.why)})` : ""}` : ""}</div></div>`;
}

function rates(_, alive) {
  app.innerHTML = `
    <div class="page-head"><div><h1>Rates & banks</h1><div class="muted">The yield curve, which banks are widening their net interest margin, and how the big dealers' trading desks are doing.</div></div><div class="muted" id="rasof"></div></div>
    <div id="rread">${skel(3)}</div>
    <div class="strip" id="rkpi"></div>
    <div class="grid g2"><div id="cus">${skel(6)}</div><div id="cca">${skel(6)}</div></div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><div class="card-head"><h2>Curve slope over the past year</h2><span class="muted" style="font-size:12px">US, basis points</span></div><div id="slope">${skel(6)}</div></div>
      <div class="card"><div class="card-head"><h2>Front-end volatility</h2><span class="muted" style="font-size:12px">2-yr yield, 20-day realised, bp/yr</span></div><div id="fvol">${skel(6)}</div></div>
    </div>
    <div class="card" style="margin-top:14px"><div class="card-head"><h2>Net interest margin: who's widening?</h2><div class="chips" id="nimf" role="group" aria-label="Bank group"></div></div>
      <div class="muted" style="font-size:13px;margin-bottom:8px">NIM = what a bank earns on loans and securities minus what it pays on deposits and borrowings, as a share of assets. The table splits it into those two sides, so you can see whether a margin is widening because asset yields are rising or because funding costs are falling.</div>
      <div id="nimgroups" class="strip"></div><div class="table-wrap" id="nimt">${skel(8)}</div>
      <div class="faint" style="font-size:12px;margin-top:8px">Built from Yahoo Finance quarterly statements: NIM ≈ net interest income × 4 ÷ average total assets. Banks report NIM on <i>earning</i> assets, so their own figure is higher; use the change, not the level. Bps = basis points (0.01%).</div></div>
    <div class="card" style="margin-top:14px"><div class="card-head"><h2>Trading desks: FICC & derivatives</h2><span class="muted" style="font-size:12px" id="tq"></span></div><div id="trade">${skel(6)}</div></div>
    <details class="card" style="margin-top:14px"><summary><h2 style="display:inline">Yield curve 101 for bank analysts</h2></summary>${PRIMER}</details>`;

  api("/api/curve", 30 * 60e3).then((c) => {
    if (!alive()) return;
    $("#rasof").textContent = `Curves as of ${c.us?.asOfDate || c.ca?.asOfDate || "—"}`;
    $("#rread").innerHTML = c.read.length ? `<div class="banner">${c.read.map((r) => `<p style="margin:4px 0"><b>${esc(r.k)}.</b> ${esc(r.t)}</p>`).join("")}</div>` : "";
    const u = c.us;
    $("#rkpi").innerHTML = [
      ["US 2s10s", bp(u?.levels.s2s10s), u ? `${bp(u.changes.m1.s2s10s)} in 1m · ${bp(u.changes.y1.s2s10s)} in 1y` : "", cls(u?.levels.s2s10s)],
      ["US 3m10y", bp(u?.levels.s3m10y), u ? `${bp(u.changes.m1.s3m10y)} in 1m` : "", cls(u?.levels.s3m10y)],
      ["US 2-yr yield", u ? `${fix(u.levels.y2)}%` : "—", u ? `${bp(u.changes.m1.y2)} in 1m · ${bp(u.changes.y1.y2)} in 1y` : "", ""],
      ["Fed funds (effective)", c.fed ? `${fix(c.fed.now)}%` : "—", c.fed?.yearAgo != null ? `${fix(c.fed.yearAgo)}% a year ago` : "", ""],
      ["Bank of Canada rate", c.ca?.boc ? `${fix(c.ca.boc.now)}%` : "—", c.ca?.boc?.yearAgo != null ? `${fix(c.ca.boc.yearAgo)}% a year ago` : "", ""],
      ["Front-end vol", u?.frontVol.now != null ? `${u.frontVol.now} bp` : "—", u?.frontVol.pct != null ? `higher than ${u.frontVol.pct}% of the past year` : "", u?.frontVol.pct >= 70 ? "warn" : ""],
      ["MOVE index", c.move ? String(c.move.now) : "—", c.move?.pct != null ? `bond-market 'VIX' · ${c.move.pct}th pct (1y)` : "bond-market 'VIX'", ""],
    ].map(([k, v, s2, c2]) => `<div class="cell"><div class="k">${k}</div><div class="v ${c2}">${v}</div><div class="s">${s2}</div></div>`).join("");
    $("#cus").innerHTML = curveCard("cus-c", u, "US Treasury curve");
    $("#cca").innerHTML = curveCard("cca-c", c.ca, "Government of Canada curve");
    const draw = (id, d) => d && multiLine($(id), [
      { name: `Today`, color: "var(--accent)", width: 2.5, points: d.curves.now.pts },
      { name: `1 month ago`, color: "var(--muted)", dash: "4 3", points: d.curves.m1.pts },
      { name: `1 year ago`, color: "var(--macro)", dash: "2 3", points: d.curves.y1.pts },
    ], { xmap: tenorMap, xticks: TENOR_TICKS.filter(([t]) => d.curves.now.pts.some((p) => Math.abs(p[0] - t) < 0.01 || p[0] > t)), yfmt: (v) => `${v.toFixed(2)}%`, dots: true, label: "Yield curve" });
    draw("#cus-c", u); draw("#cca-c", c.ca);
    if (u) {
      const t = (d) => Date.parse(d);
      const hx = u.history;
      const ticks = [0, 0.33, 0.66, 1].map((f) => hx[Math.min(hx.length - 1, Math.round(f * (hx.length - 1)))]).map((h) => [t(h[0]), new Date(h[0]).toLocaleDateString(undefined, { month: "short", year: "2-digit" })]);
      multiLine($("#slope"), [
        { name: "2s10s (10-yr minus 2-yr)", color: "var(--accent)", points: hx.map((h) => [t(h[0]), h[1]]) },
        { name: "3m10y (10-yr minus 3-month)", color: "var(--macro)", points: hx.map((h) => [t(h[0]), h[2]]) },
      ], { zero: true, xticks: ticks, yfmt: (v) => `${v.toFixed(0)}`, label: "Curve slope history" });
      $("#slope").insertAdjacentHTML("beforeend", `<div class="faint" style="font-size:12px">Above zero = upward-sloping (good for bank margins); below zero = inverted.</div>`);
      const fv = u.frontVol.series;
      const vt = [0, 0.5, 1].map((f) => fv[Math.min(fv.length - 1, Math.round(f * (fv.length - 1)))]).filter(Boolean).map((h) => [t(h[0]), new Date(h[0]).toLocaleDateString(undefined, { month: "short", year: "2-digit" })]);
      multiLine($("#fvol"), [{ name: "2-yr realised vol", color: "var(--warn)", points: fv.map(([d, v]) => [t(d), v]) }, ...(c.move ? [{ name: "MOVE index (rescaled)", color: "var(--muted)", dash: "4 3", points: c.move.series.map(([d, v]) => [t(d), v * (fv.at(-1)?.[1] || 1) / (c.move.now || 1)]) }] : [])], { xticks: vt, yfmt: (v) => v.toFixed(0), label: "Front-end volatility" });
      $("#fvol").insertAdjacentHTML("beforeend", `<div class="faint" style="font-size:12px">Bigger, choppier moves in short rates mean more hedging flow for rates and derivatives desks. ${u.frontVol.bigDays} day${u.frontVol.bigDays === 1 ? "" : "s"} with a 10 bp+ move in the 2-yr over the last month.</div>`);
    } else { $("#slope").innerHTML = ""; $("#fvol").innerHTML = ""; }
    if (c.errors?.length) $("#rread").insertAdjacentHTML("beforeend", `<div class="faint" style="font-size:12px;margin:-6px 0 12px">Some sources didn't respond: ${esc(c.errors.join("; "))}</div>`);
  }).catch((e) => { if (alive()) { $("#rread").innerHTML = errBox(e); ["#cus", "#cca", "#slope", "#fvol"].forEach((s) => { $(s).innerHTML = ""; }); } });

  Promise.all([api("/api/banks", 60 * 60e3), screen().catch(() => null)]).then(([b, d]) => {
    if (!alive()) return;
    const by = Object.fromEntries((d?.stocks || []).map((s) => [s.symbol, s]));
    $("#nimgroups").innerHTML = b.groups.map((g) => `<div class="cell"><div class="k">${esc(g.name)}</div><div class="v ${cls(g.nimChg4q)}">${bp(g.nimChg4q)}</div><div class="s">median NIM change (1y) · ${g.widening}/${g.count} widened last quarter · NII ${pct(g.niiYoY, 0)} y/y</div></div>`).join("");
    let grp = "all";
    const drawT = () => {
      const rows = b.banks.filter((x2) => grp === "all" || x2.group === grp);
      $("#nimf").innerHTML = [["all", "All banks"], ...BANK_GROUPS.map((g) => [g, b.groups.find((x2) => x2.key === g)?.name || g])].map(([k, n]) => `<button class="chip ${grp === k ? "on" : ""}" data-g="${k}" aria-pressed="${grp === k}">${esc(n)}</button>`).join("");
      $("#nimt").innerHTML = rows.length ? `<table class="sticky"><thead><tr><th scope="col" class="l">Bank</th><th scope="col">NIM momentum</th><th scope="col">NIM (proxy)</th><th scope="col">Δ last qtr</th><th scope="col">Δ 1 year</th><th scope="col">Asset yield Δ</th><th scope="col">Funding cost Δ</th><th scope="col">NII y/y</th><th scope="col">Value score</th><th scope="col">Upside</th><th scope="col" class="l">Signal</th></tr></thead><tbody>
        ${rows.map((x2) => { const s = by[x2.symbol]; const both = (x2.nimScore ?? 0) >= 65 && s && ["Undervalued", "Watch"].includes(s.label);
          return `<tr><td class="l">${starBtn(x2.symbol, s?.price)}${link(x2.symbol, `<b>${esc(x2.symbol)}</b> <span class="name">${esc(s?.name || x2.groupName)}</span>`)}${both ? ` <span class="label undervalued" title="Widening margin and screens cheap">NIM + value</span>` : ""}</td>
          <td class="num"><b>${x2.nimScore ?? "—"}</b>${x2.streak === 2 ? ` <span class="faint" title="Widened two quarters in a row">↑↑</span>` : ""}</td>
          <td class="num">${fix(x2.nim)}%</td><td class="num ${cls(x2.nimChg1q)}">${bp(x2.nimChg1q)}</td>
          <td class="num ${cls(x2.nimChg4q ?? x2.nimChgSpan)}" title="${x2.nimChg4q == null ? `Over ${x2.spanQ} quarters (a full year isn't available)` : ""}">${bp(x2.nimChg4q ?? x2.nimChgSpan)}${x2.nimChg4q == null ? "*" : ""}</td>
          <td class="num ${cls(x2.yieldChg)}">${bp(x2.yieldChg)}</td><td class="num ${cls(x2.costChg == null ? null : -x2.costChg)}">${bp(x2.costChg)}</td>
          <td class="num ${cls(x2.niiYoY)}">${pct(x2.niiYoY, 0)}</td>
          <td class="num">${s?.score ?? "—"}</td><td class="num ${cls(s?.upside)}">${pct(s?.upside, 0)}</td><td class="l">${label(s?.label)}</td></tr>`; }).join("")}</tbody></table>`
        : `<div class="empty">No quarterly data came back for these banks.</div>`;
    };
    drawT();
    $("#nimf").addEventListener("click", (e) => { const c2 = e.target.closest("[data-g]"); if (c2) { grp = c2.dataset.g; drawT(); } });
    const errs = Object.keys(b.errors || {});
    if (errs.length) $("#nimt").insertAdjacentHTML("afterend", `<div class="faint" style="font-size:12px;margin-top:6px">No quarterly statements from Yahoo for: ${esc(errs.join(", "))}</div>`);

    // Trading desks
    const T = b.trading;
    $("#tq").textContent = T.quarter;
    $("#trade").innerHTML = `<div class="banner" style="border-left-color:var(--warn)">${esc(T.note)}</div>
      <div class="table-wrap" style="border:0"><table><thead><tr><th scope="col" class="l">Dealer</th><th scope="col">FICC revenue</th><th scope="col">FICC y/y</th><th scope="col">Equities revenue</th><th scope="col">Equities y/y</th><th scope="col">Value score</th><th scope="col" class="l">What drove fixed income</th></tr></thead><tbody>
      ${T.rows.map((r) => { const s = by[r.symbol]; return `<tr><td class="l">${link(r.symbol, `<b>${esc(r.symbol)}</b> <span class="name">${esc(r.name)}</span>`)}</td>
        <td class="num">${r.ficc != null ? `$${r.ficc.toFixed(2)}B` : r.markets != null ? `<span title="Global Markets (FICC + equities)">C$${r.markets.toFixed(2)}B*</span>` : "—"}</td>
        <td class="num ${cls(r.ficcYoY ?? r.marketsYoY)}">${pct(r.ficcYoY ?? r.marketsYoY, 0)}</td>
        <td class="num">${r.eq != null ? `$${r.eq.toFixed(2)}B` : "—"}</td><td class="num ${cls(r.eqYoY)}">${pct(r.eqYoY, 0)}</td>
        <td class="num">${s?.score ?? "—"}</td>
        <td class="l" style="white-space:normal;min-width:240px;font-size:12px"><a href="${esc(r.src)}" target="_blank" rel="noopener noreferrer">${esc(r.driver)}</a></td></tr>`; }).join("")}</tbody></table></div>
      <div class="faint" style="font-size:12px;margin-top:8px">* RBC reports Global Markets (FICC + equities together). ${esc(T.context.fed)} (<a href="${esc(T.context.src)}" target="_blank" rel="noopener noreferrer">source</a>). These figures are entered by hand from earnings releases; update <code>api/_lib/trading.js</code> each quarter. The Canadian banks' next results come in early December.</div>`;
  }).catch((e) => { if (alive()) { $("#nimt").innerHTML = `<div style="padding:16px">${errBox(e)}</div>`; $("#trade").innerHTML = ""; } });
}

const PRIMER = `<div style="font-size:14px;line-height:1.6;max-width:820px">
  <p><b>What it is.</b> The yield curve plots government bond yields against maturity, from 1 month to 30 years. Normally it slopes up, because lenders want more for tying money up longer. The short end is anchored by the central bank's policy rate and what markets expect it to do over the next 1–2 years. The long end reflects expected growth and inflation plus a "term premium".</p>
  <p><b>The spreads people quote.</b> <b>2s10s</b> = 10-yr minus 2-yr yield, the classic steepness gauge. <b>3m10y</b> = 10-yr minus 3-month, the version the Fed's research leans on for recession signals. A negative spread means the curve is <b>inverted</b>: markets expect rates to fall, usually because they expect a slowdown.</p>
  <p><b>How it moves.</b> <i>Bull steepener</i>: short rates fall faster (markets pricing cuts). <i>Bear steepener</i>: long rates rise faster (inflation, deficits, term premium). <i>Bear flattener</i>: short rates rise faster (hikes being priced). <i>Bull flattener</i>: long rates fall faster (growth fears, flight to safety).</p>
  <p><b>Why banks care: NIM.</b> Banks borrow short (deposits, which reprice with the policy rate) and lend or invest longer (mortgages, loans, bonds). A steeper curve widens the gap between the two. The speed matters too:</p>
  <ul>
    <li><b>Deposit beta</b> is the share of a rate move passed on to depositors. Low betas (sticky chequing deposits) mean rising rates widen margins. High betas (rate-sensitive savings, CDs, GICs) eat the benefit.</li>
    <li><b>Asset sensitivity.</b> Banks with lots of floating-rate loans gain fast when short rates rise. Banks with lots of fixed-rate mortgages or bonds bought at low yields gain slowly, but keep gaining as those assets <b>reprice</b> or mature into higher yields. That "back-book repricing" is a big NIM driver right now.</li>
    <li><b>Canada</b> is different: 5-year fixed mortgages dominate, so the 5-yr Government of Canada yield matters more than the 10-yr, and the 2021–22 mortgages renewing now reprice much higher.</li>
  </ul>
  <p><b>Why banks care: trading.</b> FICC (fixed income, currencies and commodities) desks make markets for clients. When the front end is volatile (the Fed or BoC surprising, data moving rate expectations), clients hedge more and bid-ask spreads widen, which tends to lift rates and derivatives revenue. Volatility that is <i>too</i> violent, or one-directional, can hurt desks holding inventory. And as Q3 2026 showed, volatility does not guarantee a strong FICC quarter.</p>
  <p><b>The risks.</b> A steeper curve because growth is collapsing usually comes with rising loan losses, which can outweigh the margin benefit. Inversion plus credit stress is the worst mix for banks. Rising long yields also cut the value of bonds banks already hold (unrealised losses, the SVB problem in 2023).</p>
  <p><b>How to use this page.</b> Start with the curve shape and regime. Then look for banks where NIM is widening <i>and</i> the screener says they're still cheap (the "NIM + value" tag). Check whether the widening comes from asset yields rising (durable if driven by repricing) or funding costs falling (can reverse). For trading names, check reported FICC growth, not just the volatility backdrop.</p>
</div>`;

// ======================================================================
// Catalysts
// ======================================================================
function catalysts(_, alive) {
  app.innerHTML = `<div class="page-head"><div><h1>Catalysts</h1><div class="muted">Geopolitics, war, tariffs, rates and credit headlines that move financial stocks — from Bloomberg, Reuters, BNN Bloomberg, the Globe and Mail and Yahoo Finance via free feeds.</div></div><div class="muted" id="casof"></div></div>
    <div class="grid g3"><div class="card"><div class="card-head"><h2>Theme heat</h2><span class="muted" style="font-size:12px">Last 3 weeks</span></div><div id="cheat">${skel(8)}</div></div>
    <div class="card span2"><div class="card-head"><h2>Headlines</h2></div><div class="chips" id="cf" style="margin-bottom:8px"></div><ul class="news" id="clist">${skel(10)}</ul></div></div>`;
  api("/api/catalysts?section=macro", 30 * 60e3).then((m) => {
    if (!alive()) return;
    $("#casof").textContent = `Updated ${ago(m.asOf)}`;
    const max = Math.max(...m.heat.map((h) => h.count), 1);
    $("#cheat").innerHTML = m.heat.map((h) => hbar(h.name, h.count, max, `${h.count}`, h.macro ? "macro" : "")).join("") + `<div class="faint" style="font-size:12px;margin-top:8px">${m.heat.filter((h) => h.macro).reduce((a, h) => a + h.negative, 0)} negative macro headlines. When a theme heats up, check which peer group in the screener fell with it.</div>`;
    let sel = "all";
    const draw = () => {
      $("#cf").innerHTML = [`<button class="chip ${sel === "all" ? "on" : ""}" data-k="all">All</button>`, ...m.heat.map((h) => `<button class="chip ${h.macro ? "macro" : ""} ${sel === h.key ? "on" : ""}" data-k="${h.key}">${esc(h.name)}</button>`)].join("");
      $("#clist").innerHTML = newsItems(m.news.filter((n) => sel === "all" || n.tags.includes(sel)).slice(0, 50));
    };
    draw();
    $("#cf").addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (b) { sel = b.dataset.k; draw(); } });
  }).catch((e) => { if (alive()) { $("#cheat").innerHTML = errBox(e); $("#clist").innerHTML = ""; } });
}

// ======================================================================
// Watchlist
// ======================================================================
function watchlist(_, alive) {
  const w = watch.all();
  app.innerHTML = `<div class="page-head"><div><h1>Watchlist</h1><div class="muted">Names you're researching for the club. Stored in this browser; the price when you starred it is kept so you can track the call.</div></div></div><div class="table-wrap" id="wl">${w.length ? skel(4) : `<div class="empty">Nothing here yet. Star stocks in the <a href="#screener" style="color:var(--accent)">screener</a>.</div>`}</div>`;
  if (!w.length) return;
  Promise.all([api(`/api/quotes?symbols=${w.map((x2) => x2.symbol).join(",")}`, 60e3), screen().catch(() => null)]).then(([q, d]) => {
    if (!alive()) return;
    const by = Object.fromEntries((d?.stocks || []).map((s) => [s.symbol, s]));
    $("#wl").innerHTML = `<table class="sticky"><thead><tr><th scope="col" class="l">Stock</th><th scope="col">Price</th><th scope="col">Today</th><th scope="col">Since starred</th><th scope="col">Upside</th><th scope="col">Score</th><th scope="col" class="l">Signal</th><th scope="col" class="l">Notes</th></tr></thead><tbody>${w.map((it) => {
      const qq = q.quotes[it.symbol] || {}, s = by[it.symbol];
      const since = isNum(it.price) && isNum(qq.price) ? (qq.price / it.price - 1) * 100 : null;
      const n = notes.get(it.symbol).split("\n")[0];
      return `<tr><td class="l">${starBtn(it.symbol, qq.price)}${link(it.symbol, `<b>${esc(it.symbol)}</b> <span class="name">${esc(qq.name || "")}</span>`)}</td>
        <td class="num">${money(qq.price, qq.currency)}</td><td class="num ${cls(qq.changePct)}">${pct(qq.changePct)}</td>
        <td class="num ${cls(since)}" title="Starred ${new Date(it.added).toLocaleDateString()} at ${fix(it.price)}">${pct(since)}</td>
        <td class="num ${cls(s?.upside)}">${pct(s?.upside, 0)}</td><td class="num">${s?.score ?? "—"}</td><td class="l">${label(s?.label)}</td>
        <td class="l muted" style="max-width:260px;overflow:hidden;text-overflow:ellipsis">${esc(n) || "<span class='faint'>—</span>"}</td></tr>`; }).join("")}</tbody></table>`;
  }).catch((e) => { if (alive()) $("#wl").innerHTML = `<div style="padding:16px">${errBox(e)}</div>`; });
}

// ======================================================================
// Calendar
// ======================================================================
const MOVERS = /rate|cpi|inflation|employment|payroll|jobs|gdp|retail sales|fomc|press conference|bank of canada|boc|fed chair|powell|macklem|pce|housing|mortgage|ppi/i;
function calendar(_, alive) {
  app.innerHTML = `<div class="page-head"><div><h1>This week's economic calendar</h1><div class="muted">US and Canadian events that move bank and insurer stocks are highlighted. Rate decisions and inflation prints matter most: they set net interest margins and bond yields.</div></div>
    <label class="field">Show<select id="cal-f"><option value="key">US & Canada, medium + high impact</option><option value="all">Everything</option></select></label></div><div id="cal">${skel(8)}</div>`;
  api("/api/calendar", 30 * 60e3).then((c) => {
    if (!alive()) return;
    const draw = () => {
      const all = $("#cal-f").value === "all";
      const ev = c.events.filter((e) => all || (["USD", "CAD"].includes(e.country) && e.impact !== "Low" && e.impact !== "Holiday"));
      const days = {};
      for (const e of ev) (days[new Date(e.time).toDateString()] ||= []).push(e);
      $("#cal").innerHTML = Object.keys(days).length ? Object.entries(days).map(([day, list]) => `<div class="card" style="margin-bottom:10px"><div class="card-head"><h2>${new Date(day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</h2></div>
        <ul class="news">${list.map((e) => `<li>${dot(e.impact === "High" ? "negative" : e.impact === "Medium" ? "positive" : "neutral", `${e.impact} impact`)}<div style="flex:1;min-width:0;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <span><span class="chip">${esc(e.country)}</span> ${esc(e.title)} ${MOVERS.test(e.title) ? `<span class="chip macro">Moves financials</span>` : ""}</span>
          <span class="muted num" style="font-size:12px">${new Date(e.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${e.forecast ? ` · fcst ${esc(e.forecast)}` : ""}${e.previous ? ` · prev ${esc(e.previous)}` : ""}</span></div></li>`).join("")}</ul></div>`).join("")
        : `<div class="empty">No matching events this week.</div>`;
    };
    draw();
    $("#cal-f").addEventListener("change", draw);
  }).catch((e) => { if (alive()) $("#cal").innerHTML = errBox(e); });
}

// ---------- Search ----------
const q = $("#q"), qres = $("#qres");
let qt, qsel = -1;
q.addEventListener("input", () => {
  clearTimeout(qt);
  const v = q.value.trim();
  if (!v) { qres.classList.remove("show"); return; }
  qt = setTimeout(() => api(`/api/search?q=${encodeURIComponent(v)}`, 60 * 60e3).then((r) => {
    qsel = -1;
    qres.innerHTML = r.results.length ? r.results.map((x2) => `<button role="option" data-sym="${esc(x2.symbol)}"><b>${esc(x2.symbol)}</b><span class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x2.name)} · ${esc(x2.exchange || "")}</span></button>`).join("") : `<div class="empty">No matches.</div>`;
    qres.classList.add("show"); q.setAttribute("aria-expanded", "true");
  }).catch(() => {}), 200);
});
q.addEventListener("keydown", (e) => {
  const opts = $$("button", qres);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); qsel = (qsel + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length; opts.forEach((o, i) => { o.classList.toggle("sel", i === qsel); o.id = `opt-${i}`; }); q.setAttribute("aria-activedescendant", `opt-${qsel}`); }
  if (e.key === "Enter") { const o = opts[qsel] || opts[0]; const sym = o?.dataset.sym || q.value.trim().toUpperCase(); if (sym) { go(sym); q.value = ""; qres.classList.remove("show"); q.blur(); } }
  if (e.key === "Escape") { qres.classList.remove("show"); q.blur(); }
});
qres.addEventListener("click", (e) => { const b = e.target.closest("[data-sym]"); if (b) { go(b.dataset.sym); q.value = ""; qres.classList.remove("show"); } });
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) qres.classList.remove("show"); });

// ---------- Theme & shortcuts ----------
function toggleTheme() {
  const next = (document.documentElement.dataset.theme || "dark") === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("kcm-theme", next); } catch { /* ignore */ }
}
$("#theme").addEventListener("click", toggleTheme);
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "/") { e.preventDefault(); q.focus(); }
  else if (e.key === "t" || e.key === "T") toggleTheme();
  else if (e.key === "r" || e.key === "R") { cache.clear(); route(); }
  else if (/^[1-7]$/.test(e.key)) location.hash = "#" + TABS[Number(e.key) - 1];
});

route();
