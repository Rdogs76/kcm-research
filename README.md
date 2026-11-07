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
| Catalysts | Headlines on war, geopolitics, tariffs, rates, recession, credit, private credit, catastrophe losses and more, with a theme-heat chart |
| Watchlist | Starred names, price change since you starred them, current score and signal, first line of your notes |
| Calendar | This week's US and Canadian events, with rate decisions and inflation prints flagged |

## How the score works

The details are in `api/screen.js`.

**Cheap vs its own peers.** Banks and insurers are compared on price/book. Everyone else is compared on
forward P/E. In both cases the comparison is against the median of the stock's peer group, so a Canadian
bank is only compared with Canadian banks.

**The Street.** This is the average analyst price target, the consensus rating, and the 90-day revision
to next year's EPS estimate.

**Marked down.** This is the drop from the 52-week high, split into two parts: the part the whole peer
group shares (macro or sector-wide) and the part that belongs to the company alone.

**Quality.** Return on equity. The **value-trap flags** are falling estimates, low ROE, a payout above
100%, a price above target, a cautious Street, or a drop far bigger than the peer group's.

## Where the news comes from

Bloomberg has no free API. The dashboard gathers headlines server-side from three places:

- Yahoo Finance news search, the same source the portfolio dashboard uses.
- Yahoo Finance's per-ticker RSS feed.
- Google News RSS. This indexes Bloomberg, Reuters, BNN Bloomberg, the Globe and Mail, the Financial Post,
  CNBC and others, and is filtered to those sites for the deeper searches.

Every headline links to the original article. Headlines are tagged by theme and tone in
`api/_lib/newsfeed.js`. Edit the regular expressions there to tune what counts as "war", "tariffs" and so on.

## Deploy (Vercel)

1. Make a new GitHub repo, for example `kcm-research`, and push this folder to it.
2. In Vercel, go to **Add New → Project**, import the repo, and leave the framework preset as **Other**.
3. Deploy. No environment variables or API keys are needed.

The project uses 11 serverless functions, under the free plan's limit of 12. `vercel.json` gives the
screen route up to 60 seconds, because it pulls about 110 stocks on a cold cache. After that the result
is cached at the edge for 6 hours.

`package.json` asks for the latest `yahoo-finance2`. If your portfolio dashboard pins a version, copy
that version here so both behave the same.

### Run locally

```
npm install
npx vercel dev
```

## Change the universe

Edit `api/_lib/universe.js`. Each entry is `[ticker, peerGroup]`. Use the `.TO` suffix for TSX names.
Tickers Yahoo can't quote (delisted or acquired) are skipped automatically.

---
Scores are a screening aid for club research, not investment advice.
