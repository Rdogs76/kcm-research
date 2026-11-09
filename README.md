# KCM Research — undervalued financials dashboard

A research dashboard for King's Capital Management: it screens TSX- and NYSE-listed financial stocks
(banks, insurers, asset managers, lenders, exchanges, brokers, payments) for names trading below their
peers, shows what analysts think, and explains *why* each one is cheap from the news.

It is built on the same base as the portfolio dashboard: the same `api/_lib/util.js` and
`api/_lib/screen.js` helpers, `yahoo-finance2`, Vercel serverless routes and a no-build front end.

## Tabs

| Tab | What it does |
|---|---|
| Overview | Top ideas, how many names screen as undervalued, which peer group has been marked down most, the macro themes driving financials, rates and market pulse, macro headlines |
| Screener | Every stock in the universe with peer-relative valuation, drop from 52-week high, analyst upside and rating, EPS revisions, ROE, yield, score and signal. Filter, sort, export CSV, star to watchlist |
| Research | One stock: price chart with the analyst target, valuation vs peers, *why it's cheap* (macro vs company-specific split + tagged headlines), value-trap check, Street view, analyst track records, pitch notes with a copy-to-clipboard pitch summary |
| Rates & banks | US Treasury and Government of Canada yield curves (today vs 1 month and 1 year ago), 2s10s / 3m10y history, the curve's shape and regime (bull/bear steepener or flattener), front-end volatility (2-yr realised vol and the MOVE index), fed funds and BoC rates, and a plain-English read of what the curve means for bank margins and trading. A **net interest margin** screen ranks every bank by how fast its margin is widening, split into asset yield vs funding cost, and tags banks that are both widening and cheap ("NIM + value"). A **trading desks** panel shows dealer FICC and equities results with sources. Includes a yield curve primer |
| Catalysts | Headlines on war, geopolitics, tariffs, rates, recession, credit, private credit, catastrophe losses and more, with a theme-heat chart |
| Watchlist | Starred names, price change since you starred them, current score and signal, first line of your notes |
| Calendar | This week's US and Canadian events, with rate decisions and inflation prints flagged |

## How the score works

The details are in `api/screen.js`. The **percentile** (0–100) ranks each stock against the rest of this ~140-stock universe. It is relative, not absolute.

| Factor | Weight | What it measures |
|---|---|---|
| Value for its returns | 35% | **Banks:** price / *tangible* book against the multiple peers trade at for the same ROTCE, using a peer regression built from Yahoo's quarterly statements. **Insurers, holdcos and mREITs:** P/B against ROE in the same way. **Fee businesses** (managers, exchanges, payments, brokers, life insurers): forward P/E against peers. Peer medians leave the stock out and are pulled toward the sector median when a group is small. TSX names that report in USD are converted to CAD first. |
| Estimate revisions | 15% | 90-day change in next year's EPS estimate |
| The Street | 20% | Analyst upside and consensus rating (third-party opinions) |
| Quality | 15% | ROE / ROTCE ranked within the peer group |
| Sector markdown | 15% | How much of the 3-month move is shared with the sector: beta × the median of the stock's *other* peers, with the sector ETF as a fallback for small groups |

If a factor is missing, it counts as neutral (50). The UI lists which factors are missing for each stock.

**Labels**

- **Screens cheap:** in the top quarter, with analyst upside of 10% or more, cheap against peers, and no more than one red flag.
- **Watch:** 55th–75th percentile.
- **In line with peers:** below the 55th percentile.
- **Value-trap risk:** two or more red flags. A red flag is any of: estimate cuts, ROE/ROTCE below the cost of equity, a payout above 100% of earnings, price above target or a cautious Street, a fall of 15 points or more beyond what the sector explains, or credit-loss provisions up more than 25% while estimates are being cut.

**Data sanity checks** flag implausible figures and keep them out of the score:

- a target more than 100% away from the price
- a reported ROE above 60%
- a yield above 25%
- a residual-income value outside 0.33–3× the price
- quotes more than 8 days old

**Residual-income value** (book-value businesses only):

- Formula: book value plus the present value of returns above the cost of equity, with ROE/ROTCE fading to the cost of equity over 10 years.
- Payout: dividends plus buybacks.
- Cost of equity: max(9%, home-market 10-yr yield + β × 5.5%).
- There is no terminal value.
- It is shown with a ±1 point cost of equity × ±2 point ROE grid, as a reference point, not a forecast.

## Rates thesis

The rates thesis covers two kinds of stock: banks with a widening net interest margin, and dealers with strong FICC/derivatives desks.

**Banks** are ranked against each other on four measures:

| Measure | Weight |
|---|---|
| NIM change over a year (only counted if the quarters really are ~a year apart) | 45% |
| NIM change over the last quarter | 20% |
| Net interest income growth | 20% |
| Low implied deposit beta (change in deposit cost ÷ change in the average policy rate) | 15% |

**Dealers** are ranked on FICC growth (70%) and on how the stock trades with the MOVE index (30%). Equities trading is shown for context only.

**"Thesis match"** needs both of the following:

- **The numbers agree in absolute terms.** For a bank, the margin is actually widening and its statements aren't stale. For a dealer, FICC is actually growing and the figures aren't past their update date.
- **The stock passes the screen.** It ranks well, its percentile is 45 or higher, and it isn't flagged as a value-trap risk.

## Where the news comes from

Bloomberg has no free API. The dashboard gathers headlines server-side from three places:

- Yahoo Finance news search, the same source the portfolio dashboard uses.
- Yahoo Finance's per-ticker RSS feed.
- Google News RSS. This indexes Bloomberg, Reuters, BNN Bloomberg, the Globe and Mail, the Financial Post,
  CNBC and others, and is filtered to those sites for the deeper searches.

Every headline links to the original article. Headlines are tagged by theme and tone in
`api/_lib/newsfeed.js`. Edit the regular expressions there to tune what counts as "war", "tariffs" and so on.

## Deploy (Vercel)

Live at **https://kcm-research.vercel.app**, deployed from `github.com/Rdogs76/kcm-research`. Every push to `main` redeploys automatically. No environment variables or API keys are needed.

The project uses 11 serverless functions (`/api/banks` and `/api/curve` are the rates routes), under the free plan's limit of 12. `vercel.json` gives the
screen route up to 60 seconds, because it pulls about 140 stocks plus their price history on a cold cache. After that the result
is cached at the edge for 6 hours.

`yahoo-finance2` is pinned to an exact version (3.15.3). Before you upgrade it, test that version locally against a few tickers.

**Abuse protection.**

- `/api/screen` and `/api/curve` reject query parameters, so every request hits one edge-cached result.
- `/api/catalysts` and `/api/banks` only accept tickers that are in the research universe.
- A screen built on a failed Yahoo pull returns 503 and is not cached, so the edge keeps serving the last good copy. A failed pull means fewer than 90% of quotes or fewer than 80% of fundamentals came back.

### Run locally

```
npm install
npx vercel dev
```

## Rates data

- **US curve:** U.S. Treasury daily par yield curve CSV. **Canada:** Bank of Canada Valet API (benchmark bonds and T-bills, plus the overnight rate). **Fed funds:** FRED (DFF). **MOVE:** Yahoo Finance.
- **Policy-rate spreads and priced path:** 5-yr and 10-yr minus fed funds (or the BoC rate), and the 1-yr minus the policy rate, read as approximate 25 bp moves priced.
- **Credit and real yields:** credit spreads (FRED BAMLH0A0HYM2 and BAMLC0A0CM), plus the real yield (DFII10) and breakeven inflation (T10YIE). SOFR − IORB is a gauge of repo pressure.
- **Regimes:** regime labels scale with volatility, so ordinary noise isn't called a steepener. "Twist" covers the two ends of the curve moving in opposite directions.
- **Bank fundamentals:** from Yahoo's quarterly statements.
  - NIM proxy, annualised by days in the quarter.
  - Asset yield, total funding cost and deposit cost.
  - Implied deposit beta.
  - ROTCE and tangible book per share.
  - TCE/assets (a rough capital proxy, not CET1).
  - Capital returned (dividends + buybacks).
  - Credit-loss provisions and provisions ÷ pre-provision net revenue.
  - AOCI as a share of tangible book.
  - The table shows which quarter each bank's data covers, and flags banks where Yahoo hasn't loaded the latest quarter yet.
- **FICC / trading:** figures are entered by hand in `api/_lib/trading.js` from earnings releases, with `asOf` and `nextUpdate` dates. After `nextUpdate` the dashboard shows a stale warning and leaves them out of the thesis score. **Update every earnings season.**

## Change the universe

Edit `api/_lib/universe.js`. Each entry is `[ticker, peerGroup]`. Use the `.TO` suffix for TSX names.
Tickers Yahoo can't quote (delisted or acquired) are skipped automatically.

---
Built by a King's Capital Management student analyst for club discussion. The club is not a registered adviser; nothing here is investment advice or a recommendation. Labels and percentiles are relative and automated; verify everything against company filings.
