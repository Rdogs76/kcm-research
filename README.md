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

The details are in `api/screen.js`. The score is a 0–100 percentile across the universe.

| Factor | Weight | What it measures |
|---|---|---|
| Value for its returns | 35% | Banks, insurers, holdcos and mortgage REITs: P/B against the P/B its forward ROE implies within its peer group (a 16%-ROE bank deserves more than a 9% one), plus raw P/B against peers. Fee businesses (managers, exchanges, payments, brokers): forward P/E against peers. Peer medians leave the stock out and lean toward the sector median when a group is small. TSX names that report in USD (FFH, BN, BAM, ONEX) are converted first. |
| Estimate revisions | 15% | 90-day change in next year's EPS estimate |
| The Street | 20% | Upside to the average analyst target, and the consensus rating |
| Quality | 15% | Forward ROE, ranked within the peer group |
| Sector markdown | 15% | How much of the last three months' drop came from the stock's sector ETF (beta × ETF move): the news-cycle discount, not a company problem |

**Value-trap flags:**

- EPS estimates being cut
- ROE below the cost of equity
- Payout above 100% of expected earnings (alternative managers and holdcos are exempt)
- Price above the average analyst target, or a cautious Street
- A fall of 15 pts or more beyond what the sector explains

**Signals:**

- **Undervalued:** top quartile, at least 10% upside, cheap for its returns, and fewer than two flags.
- **Possible value trap:** two or more flags.

**"Why it's cheap" on the Research page** puts two independent views side by side: the price split (sector move vs. the stock's own move) and the share of negative, theme-tagged headlines that are macro (war, geopolitics, tariffs, rates, recession). It says when the two agree or disagree. Each stock also shows which macro factor it moves with most (the 10-yr yield, high-yield credit, oil or USD/CAD).

**Justified P/B** = (ROE − g) / (cost of equity − g), with cost of equity = max(9%, 10-yr yield + beta × 5.5%). It is shown for reference only, because it is sensitive to its inputs.

## Rates thesis

The club's current thesis is that banks with widening net interest margins, and dealers with strong FICC and derivatives desks, benefit from today's yield curve and front-end volatility. Every bank and dealer gets a **Rates thesis** score (0–100), separate from the value score:

- **Banks:** NIM change over a year (45%), last quarter (20%), net interest income growth (20%), and asset-yield change (15%). Asset-yield growth is weighted because expansion from repricing lasts longer than expansion from cheaper deposits.
- **Dealers:** FICC (or Global Markets) growth (50%), equities trading growth (25%), and how the stock trades with the MOVE index (25%).

**"Fits thesis"** means a thesis score of 65 or more, a value score of 45 or more, and no value-trap label.

Where it appears:

- The **Overview** has a rates-thesis card, with a one-line read of the curve.
- The **Screener** has a *Lens* filter: Fits rates thesis, NIM widening, Dealers, Banks.
- **Research pages** show the thesis bullets, and the copied pitch summary includes them.

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

`package.json` asks for the latest `yahoo-finance2`. If your portfolio dashboard pins a version, copy
that version here so both behave the same.

### Run locally

```
npm install
npx vercel dev
```

## Rates data

- **US curve:** U.S. Treasury daily par yield curve CSV. **Canada:** Bank of Canada Valet API (benchmark bonds and T-bills, plus the overnight rate). **Fed funds:** FRED (DFF). **MOVE:** Yahoo Finance.
- **NIM** comes from Yahoo Finance's quarterly statements: net interest income × 4 ÷ average total assets. This is a proxy. Banks report NIM on earning assets, so watch the change, not the level.
- **FICC / trading** figures are entered by hand in `api/_lib/trading.js` from earnings releases. Update them each quarter.

## Change the universe

Edit `api/_lib/universe.js`. Each entry is `[ticker, peerGroup]`. Use the `.TO` suffix for TSX names.
Tickers Yahoo can't quote (delisted or acquired) are skipped automatically.

---
Scores are a screening aid for club research, not investment advice.
