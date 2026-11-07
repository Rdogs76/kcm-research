// The research universe: TSX- and NYSE-listed stocks in the GICS Financials sector — banks, diversified
// financial services, consumer finance, capital markets (managers, brokers, exchanges & data),
// insurance (life, P&C, brokers) and mortgage REITs.
// Canadian names cross-listed in New York are kept once, under their TSX ticker.
// Peer groups drive the "cheap vs its own peers" comparisons, so keep like with like.
// Each entry is [ticker, group] or [ticker, group, metricOverride]. Anything Yahoo can't quote
// (delisted, acquired, renamed) is skipped automatically — check the "skipped" list the screen returns.
//
// metric: "pb"  -> valued on price/book, adjusted for return on equity (banks, insurers, holdcos)
//         "pe"  -> valued on forward P/E (fee businesses: managers, exchanges, payments, brokers)
// etf: the sector ETF used to split a stock's move into the part its sector explains and its own part.

export const GROUPS = {
  cabank: { name: "Canadian banks", metric: "pb", etf: "ZEB.TO" },
  uslarge: { name: "US large banks", metric: "pb", etf: "KBE" },
  usreg: { name: "US regional banks", metric: "pb", etf: "KRE" },
  calife: { name: "Canadian life insurers", metric: "pb", etf: "XFN.TO" },
  uslife: { name: "US life insurers", metric: "pe", etf: "KIE" },
  pc: { name: "P&C insurers", metric: "pb", etf: "KIE" },
  holdco: { name: "Holding companies", metric: "pb", etf: "XLF" },
  alts: { name: "Alternative managers", metric: "pe", etf: "XLF" },
  tradam: { name: "Traditional asset managers", metric: "pe", etf: "XLF" },
  exch: { name: "Exchanges & data", metric: "pe", etf: "XLF" },
  cards: { name: "Card & consumer lenders", metric: "pe", etf: "XLF" },
  specfin: { name: "Specialty & mortgage finance", metric: "pe", etf: "XFN.TO" },
  ib: { name: "Investment banks & brokers", metric: "pe", etf: "IAI" },
  pay: { name: "Payments & card networks", metric: "pe", etf: "IPAY" },
  insbrk: { name: "Insurance brokers", metric: "pe", etf: "KIE" },
  mreit: { name: "Mortgage REITs & lenders", metric: "pb", etf: "REM" },
};

export const UNIVERSE = [
  // ---- TSX ----
  ["RY.TO", "cabank"], ["TD.TO", "cabank"], ["BNS.TO", "cabank"], ["BMO.TO", "cabank"], ["CM.TO", "cabank"],
  ["NA.TO", "cabank"], ["EQB.TO", "cabank"], ["VBNK.TO", "cabank"],
  ["MFC.TO", "calife"], ["SLF.TO", "calife"], ["GWO.TO", "calife"], ["IAG.TO", "calife"],
  ["IFC.TO", "pc"], ["FFH.TO", "pc"], ["DFY.TO", "pc"], ["TSU.TO", "pc"],
  ["BN.TO", "holdco"], ["ONEX.TO", "holdco"], ["POW.TO", "holdco"], ["ELF.TO", "holdco"],
  ["BAM.TO", "alts"], ["SII.TO", "tradam"],
  ["IGM.TO", "tradam"], ["AGF-B.TO", "tradam"], ["FSZ.TO", "tradam"],
  ["X.TO", "exch"],
  ["GSY.TO", "specfin"], ["EFN.TO", "specfin"], ["FN.TO", "specfin"], ["PRL.TO", "specfin"],
  ["TF.TO", "mreit"], ["AI.TO", "mreit"], ["FC.TO", "mreit"],
  ["ECN.TO", "specfin"], ["MKP.TO", "specfin"],
  ["CF.TO", "ib"],
  // ---- NYSE ----
  ["JPM", "uslarge"], ["BAC", "uslarge"], ["C", "uslarge"], ["WFC", "uslarge"], ["USB", "uslarge"], ["PNC", "uslarge"],
  ["TFC", "uslarge"], ["BK", "uslarge", "pe"], ["STT", "uslarge", "pe"],
  ["KEY", "usreg"], ["RF", "usreg"], ["CFG", "usreg"], ["MTB", "usreg"], ["WAL", "usreg"], ["FNB", "usreg"],
  ["CFR", "usreg"], ["BOH", "usreg"], ["SNV", "usreg"], ["WBS", "usreg"], ["BKU", "usreg"], ["FLG", "usreg"],
  ["CUBI", "usreg"], ["AX", "usreg"], ["FBK", "usreg"], ["FHN", "usreg"], ["PB", "usreg"], ["ASB", "usreg"],
  ["MET", "uslife"], ["PRU", "uslife"], ["AFL", "uslife"], ["UNM", "uslife"], ["LNC", "uslife"], ["CNO", "uslife"],
  ["GL", "uslife"], ["CRBG", "uslife"], ["EQH", "uslife"], ["RGA", "uslife"], ["JXN", "uslife"], ["PRI", "uslife"],
  ["AIG", "pc"], ["ALL", "pc"], ["TRV", "pc"], ["CB", "pc"], ["HIG", "pc"], ["PGR", "pc"], ["KMPR", "pc"],
  ["WRB", "pc"], ["AFG", "pc"], ["MKL", "pc"], ["RNR", "pc"], ["EG", "pc"], ["AXS", "pc"],
  ["L", "holdco"], ["BRK-B", "holdco"],
  ["MMC", "insbrk"], ["AON", "insbrk"], ["AJG", "insbrk"], ["BRO", "insbrk"], ["RYAN", "insbrk"],
  ["NLY", "mreit"], ["STWD", "mreit"], ["BXMT", "mreit"], ["ARI", "mreit"], ["RITM", "mreit"], ["TWO", "mreit"],
  ["LADR", "mreit"], ["KREF", "mreit"], ["DX", "mreit"],
  ["KKR", "alts"], ["APO", "alts"], ["BX", "alts"], ["ARES", "alts"], ["OWL", "alts"],
  ["BLK", "tradam"], ["IVZ", "tradam"], ["BEN", "tradam"], ["AMP", "tradam"], ["AB", "tradam"], ["APAM", "tradam"],
  ["CNS", "tradam"], ["FHI", "tradam"],
  ["ICE", "exch"], ["SPGI", "exch"], ["MCO", "exch"], ["MSCI", "exch"], ["FDS", "exch"],
  ["COF", "cards", "pb"], ["AXP", "cards"], ["SYF", "cards"], ["ALLY", "cards", "pb"], ["OMF", "cards", "pb"],
  ["RKT", "specfin"], ["UWMC", "specfin"],
  ["GS", "ib"], ["MS", "ib"], ["SCHW", "ib"], ["RJF", "ib"], ["EVR", "ib"], ["LAZ", "ib"], ["PJT", "ib"], ["SF", "ib"], ["HLI", "ib"],
  ["V", "pay"], ["MA", "pay"], ["GPN", "pay"], ["FIS", "pay"], ["XYZ", "pay"], ["WEX", "pay"], ["FOUR", "pay"],
];

export const exchangeOf = (symbol) => (symbol.endsWith(".TO") ? "TSX" : "NYSE");

// Market-cap tiers in US dollars (Canadian caps are converted with USD/CAD first).
export function capTier(usd) {
  if (usd == null) return null;
  if (usd < 300e6) return "Micro";
  if (usd < 2e9) return "Small";
  if (usd < 10e9) return "Mid";
  return "Large";
}

// Macro factors used for the "what moves this stock" sensitivities.
export const FACTORS = [
  { symbol: "^TNX", name: "US 10-yr yield", label: "rate-sensitive", diff: true },
  { symbol: "HYG", name: "High-yield credit", label: "credit-sensitive" },
  { symbol: "CL=F", name: "Crude oil", label: "oil-sensitive" },
  { symbol: "USDCAD=X", name: "USD/CAD", label: "CAD-sensitive" },
];
