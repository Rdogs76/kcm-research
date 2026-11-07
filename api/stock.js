// GET /api/stock?symbol=AAPL  -> profile, ratios, analyst insights, earnings
import { yf, send, fail, symbolsFrom, num, time, NO_VALIDATE, sectorWeightsFrom } from "./_lib/util.js";

const FULL = [
  "price", "summaryDetail", "defaultKeyStatistics", "financialData", "assetProfile",
  "recommendationTrend", "upgradeDowngradeHistory", "calendarEvents", "earnings", "earningsTrend",
];
const FUND = ["price", "summaryDetail", "defaultKeyStatistics", "topHoldings", "fundProfile"];

async function summary(symbol) {
  try {
    return await yf().quoteSummary(symbol, { modules: FULL }, NO_VALIDATE);
  } catch {
    return await yf().quoteSummary(symbol, { modules: FUND }, NO_VALIDATE);
  }
}

export default async function handler(req, res) {
  const [symbol] = symbolsFrom(req.query.symbol, 1);
  if (!symbol) return send(res, 400, { error: "Add a symbol." }, 0);
  try {
    const s = await summary(symbol);
    const p = s.price || {};
    const d = s.summaryDetail || {};
    const k = s.defaultKeyStatistics || {};
    const f = s.financialData || {};
    const a = s.assetProfile || {};
    const cal = s.calendarEvents || {};

    let fund = null;
    if ((p.quoteType || "").toUpperCase() === "ETF" || (p.quoteType || "").toUpperCase() === "MUTUALFUND") {
      try {
        const extra = s.topHoldings ? s : await yf().quoteSummary(symbol, { modules: ["topHoldings", "fundProfile"] }, NO_VALIDATE);
        fund = {
          sectorWeights: sectorWeightsFrom(extra.topHoldings),
          holdings: (extra.topHoldings?.holdings || []).slice(0, 10).map((h) => ({
            symbol: h.symbol, name: h.holdingName, weight: num(h.holdingPercent),
          })),
          family: extra.fundProfile?.family || null,
          category: extra.fundProfile?.categoryName || null,
          expenseRatio: num(extra.fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio) ?? num(d.expenseRatio),
        };
      } catch { /* fund extras are optional */ }
    }

    const trend = (s.recommendationTrend?.trend || []).map((t) => ({
      period: t.period,
      strongBuy: num(t.strongBuy) || 0,
      buy: num(t.buy) || 0,
      hold: num(t.hold) || 0,
      sell: num(t.sell) || 0,
      strongSell: num(t.strongSell) || 0,
    }));

    const changes = (s.upgradeDowngradeHistory?.history || []).slice(0, 15).map((h) => ({
      date: time(h.epochGradeDate),
      firm: h.firm,
      from: h.fromGrade || null,
      to: h.toGrade || null,
      action: h.action || null,
    }));

    const history = (s.earnings?.earningsChart?.quarterly || []).map((q) => ({
      quarter: q.date,
      actual: num(q.actual),
      estimate: num(q.estimate),
    }));

    const nextQ = (s.earningsTrend?.trend || []).find((t) => t.period === "0q");

    send(res, 200, {
      symbol,
      name: p.longName || p.shortName || symbol,
      currency: p.currency || null,
      exchange: p.exchangeName || null,
      type: p.quoteType || null,
      price: num(p.regularMarketPrice),
      change: num(p.regularMarketChange),
      changePct: num(p.regularMarketChangePercent) != null ? num(p.regularMarketChangePercent) * 100 : null,
      sector: a.sector || null,
      industry: a.industry || null,
      website: a.website || null,
      employees: num(a.fullTimeEmployees),
      summary: a.longBusinessSummary || null,
      stats: {
        marketCap: num(p.marketCap ?? d.marketCap),
        trailingPE: num(d.trailingPE),
        forwardPE: num(d.forwardPE ?? k.forwardPE),
        peg: num(k.pegRatio),
        priceToBook: num(k.priceToBook),
        priceToSales: num(d.priceToSalesTrailing12Months),
        evToEbitda: num(k.enterpriseToEbitda),
        evToRevenue: num(k.enterpriseToRevenue),
        eps: num(k.trailingEps),
        forwardEps: num(k.forwardEps),
        dividendYield: num(d.dividendYield ?? d.yield),
        dividendRate: num(d.dividendRate),
        payoutRatio: num(d.payoutRatio),
        beta: num(d.beta ?? k.beta3Year),
        high52: num(d.fiftyTwoWeekHigh),
        low52: num(d.fiftyTwoWeekLow),
        avgVolume: num(d.averageVolume),
        profitMargin: num(f.profitMargins ?? k.profitMargins),
        operatingMargin: num(f.operatingMargins),
        grossMargin: num(f.grossMargins),
        roe: num(f.returnOnEquity),
        roa: num(f.returnOnAssets),
        debtToEquity: num(f.debtToEquity),
        currentRatio: num(f.currentRatio),
        quickRatio: num(f.quickRatio),
        revenueGrowth: num(f.revenueGrowth),
        earningsGrowth: num(f.earningsGrowth),
        totalRevenue: num(f.totalRevenue),
        freeCashflow: num(f.freeCashflow),
        totalCash: num(f.totalCash),
        totalDebt: num(f.totalDebt),
        shortRatio: num(k.shortRatio),
        ytdReturn: num(k.ytdReturn),
        threeYearReturn: num(k.threeYearAverageReturn),
        netAssets: num(d.totalAssets),
      },
      analyst: {
        recommendation: f.recommendationKey || null,
        recommendationMean: num(f.recommendationMean),
        analysts: num(f.numberOfAnalystOpinions),
        targetMean: num(f.targetMeanPrice),
        targetMedian: num(f.targetMedianPrice),
        targetHigh: num(f.targetHighPrice),
        targetLow: num(f.targetLowPrice),
        trend,
        changes,
      },
      earnings: {
        next: (cal.earnings?.earningsDate || []).map(time).filter(Boolean),
        epsEstimate: num(cal.earnings?.earningsAverage),
        epsLow: num(cal.earnings?.earningsLow),
        epsHigh: num(cal.earnings?.earningsHigh),
        revenueEstimate: num(cal.earnings?.revenueAverage),
        growthEstimate: num(nextQ?.growth),
        exDividendDate: time(cal.exDividendDate),
        dividendDate: time(cal.dividendDate),
        history,
      },
      fund,
      asOf: Date.now(),
    }, 600);
  } catch (err) {
    fail(res, err);
  }
}
