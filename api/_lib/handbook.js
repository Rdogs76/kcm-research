// Figures that free APIs don't carry, entered by hand from company releases.
// UPDATE EACH EARNINGS SEASON (same schedule as trading.js). Every entry carries its quarter and source.
// Leave a field null rather than guessing; the dashboard shows "not entered".
//
// cet1:       Common Equity Tier 1 ratio, % (Standardized for US banks)
// cet1Req:    the bank's own CET1 requirement, % (only where the release states it or OSFI's D-SIB rule applies)
// niiUp/Dn:   12-month NII change for a +/-100 bp parallel shift, in millions of reporting currency, as disclosed
// niiAnnual:  annualised NII used to turn that into a % (quarterly NII × 4), millions
// cr / crPrior / crUnderlying: P&C combined ratio for the quarter, the year-ago quarter, and ex-cat/underlying, %
export const HANDBOOK = {
  asOf: "2026-11-08",
  nextUpdate: { US: "2027-01-20", CA: "2026-12-05" },
  notes: {
    osfi: "OSFI requires D-SIBs (the Big 6) to hold 11.5% CET1: the 4.5% minimum, 2.5% conservation buffer, 1% D-SIB surcharge and 3.5% Domestic Stability Buffer.",
    us: "US requirements differ by bank (4.5% minimum + stress capital buffer + G-SIB surcharge). Only Citi states its gap to the requirement in its release.",
    nii: "Sensitivities are each bank's own disclosure: Canadian banks report structural (non-trading) NII over 12 months; Bank of America reports vs its forward curve. They are not perfectly comparable.",
  },
  banks: {
    "RY.TO": { quarter: "Q3 FY26 (Jul 31)", cet1: 13.5, cet1Req: 11.5, niiUp: 373, niiDn: -558, niiAnnual: 8744 * 4, src: "https://www.rbc.com/investor-relations/_assets-custom/pdf/2026q3_report.pdf" },
    "TD.TO": { quarter: "Q3 FY26 (Jul 31)", cet1: 14.3, cet1Req: 11.5, niiUp: null, niiDn: null, niiAnnual: 9296 * 4, src: "https://www.sec.gov/Archives/edgar/data/0000947263/000156276226000098/ex994.htm" },
    "BMO.TO": { quarter: "Q3 FY26 (Jul 31)", cet1: 13.0, cet1Req: 11.5, niiUp: 291, niiDn: -318, niiAnnual: 5567 * 4, src: "https://www.sec.gov/Archives/edgar/data/0000927971/000092797126000108/q32026mda.htm" },
    "BNS.TO": { quarter: "Q3 FY26 (Jul 31)", cet1: 13.1, cet1Req: 11.5, niiUp: null, niiDn: null, niiAnnual: 5866 * 4, src: "https://www.sec.gov/Archives/edgar/data/0000009631/000119312526364091/d143422dex991.htm" },
    "CM.TO": { quarter: "Q3 FY26 (Jul 31)", cet1: 13.4, cet1Req: 11.5, niiUp: 177, niiDn: -230, niiAnnual: 4507 * 4, src: "https://www.cibc.com/content/dam/cibc-public-assets/about-cibc/investor-relations/pdfs/quarterly-results/2026/q326report-en.pdf" },
    "NA.TO": { quarter: "Q3 FY26 (Jul 31)", cet1: 13.5, cet1Req: 11.5, niiUp: null, niiDn: null, niiAnnual: 1254 * 4, src: "https://www.nbc.ca/content/dam/bnc/a-propos-de-nous/relations-investisseurs/resultats-trimestriels/2026/comm-q3-2026.pdf" },
    JPM: { quarter: "Q3 2026 (Sep 30)", cet1: 13.9, cet1Req: null, niiUp: null, niiDn: null, niiAnnual: 27100 * 4, src: "https://www.jpmorganchase.com/content/dam/jpmc/jpmorgan-chase-and-co/investor-relations/documents/quarterly-earnings/2026/3rd-quarter/2b5b9a7e-a968-4985-94ad-5fa949a08d1c.pdf" },
    BAC: { quarter: "Q3 2026 (Sep 30)", cet1: 10.9, cet1Req: null, niiUp: 1400, niiDn: -1900, niiAnnual: 16400 * 4, niiBasis: "vs forward curve", src: "https://d1io3yog0oux5.cloudfront.net/_57b47cfcfa36e60b766b86c879f09ca2/bankofamerica/files/pages/fixed-income/09.30.2026_Fixed_Income_Materials.pdf" },
    C: { quarter: "Q3 2026 (Sep 30)", cet1: 12.8, cet1Req: 11.6, niiUp: null, niiDn: null, niiAnnual: 16982 * 4, cet1Note: "~120 bp above requirement per Citi", src: "https://www.citigroup.com/rcs/citigpa/storage/public/Earnings/Q32026/2026psqtr3rslt.pdf" },
    WFC: { quarter: "Q3 2026 (Sep 30)", cet1: 10.0, cet1Req: null, niiUp: null, niiDn: null, niiAnnual: 12517 * 4, src: "https://www.sec.gov/Archives/edgar/data/0000072971/000007297126000318/wfc3qer10-13x26ex991xrelea.htm" },
    USB: { quarter: "Q3 2026 (Sep 30)", cet1: 10.8, cet1Req: null, src: "https://www.usbank.com/about-us-bank/news-and-stories/article-library/us-bancorp-reports-third-quarter-2026-results.html" },
    BNY: { quarter: "Q3 2026 (Sep 30)", cet1: 10.9, cet1Req: null, niiAnnual: 1423 * 4, src: "https://www.bny.com/assets/corporate/documents/pdf/investor-relations/earnings/earnings-press-release-3q-2026.pdf" },
    GS: { quarter: "Q3 2026 (Sep 30)", cet1: 12.4, cet1Req: null, src: "https://www.goldmansachs.com/pressroom/press-releases/current/pdfs/2026-q3-results.pdf" },
    MS: { quarter: "Q3 2026 (Sep 30)", cet1: 14.9, cet1Req: null, src: "https://www.sec.gov/Archives/edgar/data/0000895421/000089542126000288/a3q26msearningsrelease.htm" },
  },
  insurers: {
    TRV: { quarter: "Q3 2026", cr: 86.8, crPrior: 87.3, crUnderlying: 84.1, src: "https://investor.travelers.com/newsroom/press-releases/news-details/2026/Travelers-Reports-Excellent-Third-Quarter-and-Year-to-Date-Results/default.aspx" },
    CB: { quarter: "Q3 2026", cr: 84.1, crPrior: 81.8, crUnderlying: 82.6, priorDerived: true, src: "https://finance.yahoo.com/markets/stocks/articles/chubb-q3-earnings-beat-estimates-124000904.html" },
    ALL: { quarter: "Q3 2026", cr: 86.6, crPrior: 80.1, crUnderlying: 80.5, src: "https://www.sec.gov/Archives/edgar/data/0000899051/000089905126000156/allcorp93026earningsreleas.htm" },
    PGR: { quarter: "Q3 2026", cr: 88.7, crPrior: 89.5, crUnderlying: null, priorDerived: true, src: "https://www.tradingview.com/news/zacks:3338e456c094b:0-progressive-s-q3-earnings-top-estimates-on-higher-premiums/" },
    HIG: { quarter: "Q3 2026", cr: 91.3, crPrior: 88.8, crUnderlying: 90.1, segment: "Business Insurance", src: "https://www.sec.gov/Archives/edgar/data/0000874766/000087476626000079/ex991earningsnewsrelease93.htm" },
    WRB: { quarter: "Q3 2026", cr: 90.8, crPrior: 90.9, crUnderlying: 88.1, src: "https://www.sec.gov/Archives/edgar/data/0000011544/000001154426000046/wrb93020268-kex991.htm" },
    "IFC.TO": { quarter: "Q3 2026", cr: 94.0, crPrior: 89.8, crUnderlying: null, src: "https://www.tradingview.com/news/prnewswire:2dd588816200f:0-intact-financial-corporation-reports-q3-2026-results/" },
    "FFH.TO": { quarter: "Q3 2026", cr: 92.5, crPrior: 92.0, crUnderlying: null, segment: "undiscounted", src: "https://www.globenewswire.com/news-release/2026/11/03/3394870/0/en/fairfax-financial-holdings-limited-financial-results-for-the-third-quarter.html" },
  },
};

export function handbookFor(symbol) {
  const b = HANDBOOK.banks[symbol], i = HANDBOOK.insurers[symbol];
  if (!b && !i) return null;
  const out = { quarter: (b || i).quarter, src: (b || i).src };
  if (b) {
    Object.assign(out, { cet1: b.cet1 ?? null, cet1Req: b.cet1Req ?? null, cet1Note: b.cet1Note || null, cet1Excess: b.cet1 != null && b.cet1Req != null ? Math.round((b.cet1 - b.cet1Req) * 100) : null });
    if (b.niiUp != null && b.niiAnnual) Object.assign(out, { niiUp: b.niiUp, niiDn: b.niiDn, niiPctUp: Math.round((b.niiUp / b.niiAnnual) * 1000) / 10, niiPctDn: Math.round((b.niiDn / b.niiAnnual) * 1000) / 10, niiBasis: b.niiBasis || "parallel shift, 12 months" });
  }
  if (i) Object.assign(out, { cr: i.cr, crPrior: i.crPrior ?? null, crUnderlying: i.crUnderlying ?? null, crChg: i.cr != null && i.crPrior != null ? Math.round((i.cr - i.crPrior) * 10) / 10 : null, crSegment: i.segment || null, priorDerived: !!i.priorDerived });
  return out;
}
