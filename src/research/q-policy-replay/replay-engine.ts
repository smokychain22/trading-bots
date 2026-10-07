// Q policy replay engine (pure). Point-in-time: every decision uses only data dated on or before the decision date; forward
// path data is touched only by the exit simulator, after selection.
//
// DATA-REALITY LABELS (reported with every run):
//  - OPTION_PRICE_IS_DAILY_TRADE_CLOSE_NOT_QUOTE: mid proxy = the option's daily trade close (Alpaca has no historical
//    option quotes); executable prices = close -/+ a MODELED half-spread.
//  - GREEKS_BS_INVERTED: IV and Greeks come from Black-Scholes inversion of that close against the underlying's daily close
//    (fixed rate, q = 0); the two closes are not simultaneous (TIMING_MISMATCH).
//  - OPEN_INTEREST_NOT_EVALUABLE: historical OI is unavailable; the OI gate is reported NOT_EVALUABLE and not applied.
//  - ASSIGNMENT_MARKED_AT_EXPIRY_CLOSE: an ITM expiry is settled at intrinsic on the underlying's expiry-day close (the
//    stock leg is marked, not managed; whole-chain A/C is out of scope).
//  - SURVIVORSHIP_FIXED_UNIVERSE: the universe is today's THETA universe.

import { blackScholesPut, impliedPutVolatility } from './black-scholes.js';
import { buildStrategyEconomicsReceipt, nearestAtmPutIv, rankEconomically, type StrategyEconomicsReceipt } from '../../theta/strategy-economics.js';

export const qPolicyReplayVersion = 'theta-q-policy-replay-v2' as const;

export interface ReplayAssumptions {
  readonly riskFreeRate: number;
  /** Modeled half-spread per share as a function of the mid proxy. */
  readonly halfSpread: (mid: number) => number;
  readonly halfSpreadModelId: string;
  readonly feePerContractSide: number;
  readonly multiplier: number;
  /** Null = capital-unconstrained research mode (per-contract economics only). */
  readonly accountEquityUsd: number | null;
  /** AEGIS hard single-ticker limit (maxTickerConcentrationPct x hardCapMultiplier). */
  readonly hardTickerCapPct: number;
  readonly lattice: {
    readonly minDte: number; readonly maxDte: number;
    readonly deltaBands: readonly (readonly [number, number])[];
    readonly minVolume: number; readonly maxSpreadPct: number;
  };
  readonly stressGapPct: number;
  readonly pricingMode: PricingMode;
}

export interface OptionBarPoint { readonly close: number; readonly volume: number; readonly high?: number; readonly low?: number }

/**
 * Trade-print pricing mode. CLOSE: mid proxy = daily close. ADVERSE_EXTREME (stress bracket for stale/favourable prints):
 * a sale opens at the day's LOW and a buyback closes at the day's HIGH, then the modeled half-spread is applied on top.
 */
export type PricingMode = 'CLOSE' | 'ADVERSE_EXTREME';

/** Split-adjusted closes for trend/volatility features only (strikes and settlement always use raw prices). */
export function splitAdjustedCloses(closes: readonly number[]): number[] {
  const out = [...closes];
  for (let i = 1; i < out.length; i++) {
    const ratio = (closes[i] as number) / (closes[i - 1] as number);
    if (ratio < 0.6 || ratio > 1.6) {
      const factor = ratio < 1 ? Math.round(1 / ratio) : 1 / Math.round(ratio);
      for (let j = 0; j < i; j++) out[j] = (out[j] as number) / factor;
    }
  }
  return out;
}
export interface ContractHistory {
  readonly symbol: string;
  readonly strike: number;
  readonly expiration: string;
  /** date (YYYY-MM-DD) -> daily bar */
  readonly bars: ReadonlyMap<string, OptionBarPoint>;
}
export interface UnderlyingHistory {
  readonly symbol: string;
  /** Research taxonomy only. UNKNOWN is preserved when no qualified mapping exists. */
  readonly sector?: string;
  /** Ascending trading dates with raw (unadjusted) closes. */
  readonly dates: readonly string[];
  readonly closes: readonly number[];
}

export type GateState = 'PASS' | 'FAIL' | 'NOT_EVALUABLE';
export interface ReplayCandidate {
  readonly symbol: string;
  readonly strike: number;
  readonly expiration: string;
  readonly dte: number;
  readonly mid: number;
  readonly volume: number;
  readonly iv: number | null;
  readonly realizedVolatility: number | null;
  readonly ivToRvRatio: number | null;
  readonly delta: number | null;
  readonly gamma: number | null;
  readonly thetaPerDay: number | null;
  readonly vega: number | null;
  readonly modeledSpreadPct: number;
  readonly creditPerShare: number;
  readonly gates: { readonly dte: GateState; readonly deltaBand: GateState; readonly spread: GateState; readonly volume: GateState;
    readonly openInterest: 'NOT_EVALUABLE'; readonly capital: GateState };
  readonly latticeEligible: boolean;
  readonly receipt: StrategyEconomicsReceipt;
}

export const calendarDays = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const yearFraction = (from: string, to: string): number => Math.max(0, calendarDays(from, to)) / 365;
const kv = (v: { readonly state: string; readonly value?: number }): number | null => v.state === 'KNOWN' ? v.value as number : null;

/** Builds the decision-date candidate chain from data dated on or before `date` only. */
export function buildDecisionCandidates(input: {
  readonly underlying: string; readonly date: string; readonly spot: number;
  readonly contracts: readonly ContractHistory[]; readonly assumptions: ReplayAssumptions;
  readonly realizedVolatility?: number | null;
}): readonly ReplayCandidate[] {
  const a = input.assumptions;
  const raw = input.contracts.flatMap((contract) => {
    const bar = contract.bars.get(input.date);
    const dte = calendarDays(input.date, contract.expiration);
    if (bar === undefined || !(bar.close > 0) || dte <= 0) return [];
    const t = yearFraction(input.date, contract.expiration);
    const iv = impliedPutVolatility(bar.close, input.spot, contract.strike, t, a.riskFreeRate);
    const greeks = iv === null ? null : blackScholesPut(input.spot, contract.strike, t, iv, a.riskFreeRate);
    return [{ contract, bar, dte, iv, greeks }];
  });
  const scenarioVolatility = nearestAtmPutIv(raw.map(({ contract, bar, dte, iv, greeks }) => ({
    underlying: input.underlying, optionSymbol: contract.symbol, strike: contract.strike, expiration: contract.expiration, dte,
    multiplier: a.multiplier, bid: bar.close, ask: bar.close, delta: greeks?.delta ?? null, iv, volume: bar.volume, openInterest: null,
    underlyingReferencePrice: input.spot })));
  return raw.map(({ contract, bar, dte, iv, greeks }) => {
    const half = a.halfSpread(bar.close);
    const saleBasis = a.pricingMode === 'ADVERSE_EXTREME' ? Math.min(bar.close, bar.low ?? bar.close) : bar.close;
    const credit = Math.max(0, saleBasis - half);
    const spreadPct = (2 * half) / bar.close;
    const absDelta = greeks === null ? null : Math.abs(greeks.delta);
    const collateral = contract.strike * a.multiplier;
    const gates = {
      dte: dte >= a.lattice.minDte && dte <= a.lattice.maxDte ? 'PASS' as const : 'FAIL' as const,
      deltaBand: absDelta === null ? 'FAIL' as const : a.lattice.deltaBands.some(([low, high]) => absDelta >= low && absDelta < high) ? 'PASS' as const : 'FAIL' as const,
      spread: spreadPct <= a.lattice.maxSpreadPct ? 'PASS' as const : 'FAIL' as const,
      volume: bar.volume >= a.lattice.minVolume ? 'PASS' as const : 'FAIL' as const,
      openInterest: 'NOT_EVALUABLE' as const,
      capital: a.accountEquityUsd === null ? 'NOT_EVALUABLE' as const
        : collateral / a.accountEquityUsd < a.hardTickerCapPct ? 'PASS' as const : 'FAIL' as const,
    };
    const receipt = buildStrategyEconomicsReceipt({
      candidateId: contract.symbol, strategyClass: 'THETA_CONVENTIONAL', structure: 'CASH_SECURED_PUT', underlying: input.underlying,
      expiration: contract.expiration, dte, multiplier: a.multiplier,
      shortLeg: { optionSymbol: contract.symbol, strike: contract.strike, bid: credit, ask: bar.close + half, delta: greeks?.delta ?? null,
        iv, volume: bar.volume, openInterest: null },
      spot: input.spot, creditPerShare: credit > 0 ? credit : null, creditBasis: 'EXECUTABLE_BID',
      openingCostsUsd: a.feePerContractSide, openingCostProvenance: 'REPLAY_MODELED_REGULATORY_FEE',
      realizedVolatility: input.realizedVolatility ?? null, ivRank: null, eventInWindow: null, stressGapPct: a.stressGapPct, opportunityCostAnnualRate: null,
      scenarioVolatility, scenarioVolatilityProvenance: 'NEAREST_ATM_PUT_BS_INVERTED_IV',
    });
    return {
      symbol: contract.symbol, strike: contract.strike, expiration: contract.expiration, dte, mid: bar.close, volume: bar.volume,
      iv, realizedVolatility: input.realizedVolatility ?? null,
      ivToRvRatio: iv !== null && input.realizedVolatility !== undefined && input.realizedVolatility !== null && input.realizedVolatility > 0
        ? iv / input.realizedVolatility : null,
      delta: greeks?.delta ?? null, gamma: greeks?.gamma ?? null, thetaPerDay: greeks?.thetaPerDay ?? null, vega: greeks?.vega ?? null,
      modeledSpreadPct: spreadPct, creditPerShare: credit, gates,
      latticeEligible: gates.dte === 'PASS' && gates.deltaBand === 'PASS' && gates.spread === 'PASS' && gates.volume === 'PASS'
        && gates.capital !== 'FAIL' && credit > 0,
      receipt,
    };
  });
}

// ---------------------------------------------------------------------------
// Selection policies
// ---------------------------------------------------------------------------

export interface EconomicProfile {
  readonly id: string;
  readonly minCushionSigmas: number | null;
  readonly maxAbsDelta: number | null;
  readonly minRewardToStress: number | null;
}

/**
 * CURRENT_Q_EMULATION. Approximates Production Q: the frozen lattice gates, the structural finalist shortlist of
 * selectFinalistContractsForRefresh (delta-band-centre distance, DTE-midpoint distance, spread; then OCC symbol), top 5,
 * the CSP Pareto objectives of the canonical frontier (premium up, collateral down, spread down, cushion up), and the
 * candidate-ID (OCC lexical) final tie-break used when calibrated EV is unavailable. NOT emulated: the Python opportunity
 * frontier and its own dominance, AEGIS per-candidate states, ownership/event gates, quote age.
 */
export function selectCurrentQ(candidates: readonly ReplayCandidate[], assumptions: ReplayAssumptions, maxFinalists = 5): ReplayCandidate | null {
  const eligible = candidates.filter((c) => c.latticeEligible);
  const centers = assumptions.lattice.deltaBands.map(([low, high]) => (low + high) / 2);
  const midpointDte = (assumptions.lattice.minDte + assumptions.lattice.maxDte) / 2;
  const score = (c: ReplayCandidate): readonly number[] => [
    c.delta === null ? Number.POSITIVE_INFINITY : Math.min(...centers.map((center) => Math.abs(Math.abs(c.delta as number) - center))),
    Math.abs(c.dte - midpointDte), c.modeledSpreadPct,
  ];
  const finalists = eligible.toSorted((a, b) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) { const d = (sa[i] as number) - (sb[i] as number); if (d !== 0) return d; }
    return a.symbol.localeCompare(b.symbol);
  }).slice(0, maxFinalists);
  const objective = (c: ReplayCandidate): readonly (number | null)[] => [
    kv(c.receipt.grossCreditUsd), kv(c.receipt.capitalRequiredUsd) === null ? null : -(kv(c.receipt.capitalRequiredUsd) as number),
    -c.modeledSpreadPct, kv(c.receipt.distanceToBreakevenPct)];
  const dominated = (a: ReplayCandidate, b: ReplayCandidate): boolean => {
    const x = objective(a), y = objective(b);
    if (x.some((v) => v === null) || y.some((v) => v === null)) return false;
    let better = false;
    for (let i = 0; i < x.length; i++) { if ((y[i] as number) < (x[i] as number)) return false; if ((y[i] as number) > (x[i] as number)) better = true; }
    return better;
  };
  const front = finalists.filter((c) => !finalists.some((other) => other !== c && dominated(c, other)));
  return front.toSorted((a, b) => a.symbol.localeCompare(b.symbol))[0] ?? null;
}

/** ECONOMIC_Q: risk-constrained economic order (strategy-economics.ts) over lattice-eligible candidates, after profile floors. */
export function selectEconomicQ(candidates: readonly ReplayCandidate[], profile: EconomicProfile | null): ReplayCandidate | null {
  const eligible = candidates.filter((c) => c.latticeEligible && (profile === null || (
    (profile.minCushionSigmas === null || ((kv(c.receipt.breakevenCushionSigmas) ?? Number.NEGATIVE_INFINITY) >= profile.minCushionSigmas))
    && (profile.maxAbsDelta === null || (c.delta !== null && Math.abs(c.delta) <= profile.maxAbsDelta))
    && (profile.minRewardToStress === null || ((kv(c.receipt.rewardToStressRisk) ?? Number.NEGATIVE_INFINITY) >= profile.minRewardToStress)))));
  const ranked = rankEconomically(eligible.map((c) => ({ receipt: c.receipt, verdict: 'NOT_CONFIGURED' as const })));
  const best = ranked[0]?.receipt.candidateId;
  return best === undefined ? null : eligible.find((c) => c.symbol === best) ?? null;
}

// ---------------------------------------------------------------------------
// Exit policies
// ---------------------------------------------------------------------------

export interface ExitPolicy {
  readonly id: string;
  /** Close when profit >= this fraction of the entry credit (executable prices). */
  readonly profitCapture?: number;
  readonly dteExit?: number;
  /** Close once this fraction of the entry DTE has elapsed. */
  readonly timeFraction?: number;
  /** Close when the executable buyback >= this multiple of the entry credit. */
  readonly premiumMultiple?: number;
  readonly deltaAbove?: number;
  readonly belowBreakeven?: boolean;
  /** Remaining-reward rule: capture >= minCapture AND remaining reward / remaining -2 sigma tail loss < tailRatio, or capture >= hardCapture. */
  readonly dynamic?: { readonly minCapture: number; readonly tailRatio: number; readonly hardCapture: number };
  /** Emulates current Production bootstrap management: close only when remaining value <= 10% of credit AND DTE <= 5. */
  readonly currentManagement?: boolean;
}

export type ExitReason = 'EXPIRED_OTM' | 'ASSIGNED_AT_EXPIRY' | 'PROFIT_CAPTURE' | 'DTE_EXIT' | 'TIME_EXIT' | 'PREMIUM_MULTIPLE'
  | 'DELTA_ABOVE' | 'BELOW_BREAKEVEN' | 'DYNAMIC_REMAINING_REWARD' | 'CURRENT_MANAGEMENT';

export interface Episode {
  readonly underlying: string;
  readonly symbol: string;
  readonly entryDate: string;
  readonly exitDate: string;
  readonly exitReason: ExitReason;
  readonly pnl: number;
  /** Before modeled half-spread and known per-side fees. */
  readonly grossPnl: number;
  /** Modeled spread plus known fees. Always grossPnl - pnl. */
  readonly modeledCosts: number;
  readonly capital: number;
  readonly holdDays: number;
  readonly capitalDays: number;
  readonly roc: number;
  readonly assigned: boolean;
  readonly modelPricedExit: boolean;
  readonly modeledSlippage: number;
  /** Maximum adverse excursion: worst executable mark-to-market P&L while held (<= 0), including the exit. Path risk. */
  readonly maeUsd: number;
  readonly features: { readonly absDelta: number | null; readonly iv: number | null; readonly realizedVolatility: number | null;
    readonly ivToRvRatio: number | null; readonly dte: number; readonly cushionSigmas: number | null;
    readonly underlyingSector: string; readonly regime: string };
}

export type SimulationResult = { readonly state: 'CLOSED'; readonly episode: Episode }
  | { readonly state: 'CENSORED' | 'CORPORATE_ACTION_EXCLUDED'; readonly reason: string };

/** Simulates one short put from the decision-date close. Uses forward data only here, after selection. */
export function simulateExit(input: {
  readonly underlying: UnderlyingHistory; readonly contract: ContractHistory; readonly candidate: ReplayCandidate;
  readonly entryDate: string; readonly policy: ExitPolicy; readonly assumptions: ReplayAssumptions; readonly regime: string;
}): SimulationResult {
  const a = input.assumptions, c = input.candidate, K = c.strike, m = a.multiplier;
  const entryIndex = input.underlying.dates.indexOf(input.entryDate);
  if (entryIndex < 0) throw new Error('REPLAY_ENTRY_DATE_NOT_A_TRADING_DATE');
  const creditPs = c.creditPerShare;
  const entryHalf = a.halfSpread(c.mid);
  let lastIv = c.iv;
  let worstMark = 0;
  const breakeven = K - creditPs;
  for (let i = entryIndex + 1; i < input.underlying.dates.length; i++) {
    const date = input.underlying.dates[i] as string, spot = input.underlying.closes[i] as number;
    const previous = input.underlying.closes[i - 1] as number;
    if (spot / previous < 0.6 || spot / previous > 1.6) return { state: 'CORPORATE_ACTION_EXCLUDED', reason: `UNDERLYING_DISCONTINUITY:${date}` };
    const finish = (exitReason: ExitReason, debitPs: number, exitHalf: number, modelPriced: boolean, assigned: boolean): SimulationResult => {
      // Fees only on actual trades: the opening sale, and a closing buyback (never on expiry or assignment settlement).
      const closingTrade = exitReason !== 'EXPIRED_OTM' && exitReason !== 'ASSIGNED_AT_EXPIRY';
      const grossPnl = ((creditPs + entryHalf) - (debitPs - exitHalf)) * m;
      const pnl = (creditPs - debitPs) * m - a.feePerContractSide - (closingTrade ? a.feePerContractSide : 0);
      const holdDays = Math.max(1, calendarDays(input.entryDate, date));
      const capital = K * m;
      return { state: 'CLOSED', episode: {
        underlying: input.underlying.symbol, symbol: c.symbol, entryDate: input.entryDate, exitDate: date, exitReason,
        pnl, grossPnl, modeledCosts: grossPnl - pnl, capital, holdDays, capitalDays: capital * holdDays, roc: pnl / capital,
        assigned, modelPricedExit: modelPriced,
        maeUsd: Math.min(worstMark, pnl, 0),
        modeledSlippage: (entryHalf + exitHalf) * m,
        features: { absDelta: c.delta === null ? null : Math.abs(c.delta), iv: c.iv,
          realizedVolatility: c.realizedVolatility, ivToRvRatio: c.ivToRvRatio, dte: c.dte,
          cushionSigmas: kv(c.receipt.breakevenCushionSigmas), underlyingSector: input.underlying.sector ?? 'UNKNOWN',
          regime: input.regime } } };
    };
    if (date >= c.expiration) {
      // Settle at intrinsic on the expiry-day close (or the first trading date at/after expiry when it was a holiday).
      const intrinsic = Math.max(0, K - spot);
      return intrinsic > 0 ? finish('ASSIGNED_AT_EXPIRY', intrinsic, 0, false, true) : finish('EXPIRED_OTM', 0, 0, false, false);
    }
    const bar = input.contract.bars.get(date);
    const t = yearFraction(date, c.expiration);
    let mid: number, modelPriced = false;
    if (bar !== undefined && bar.close > 0) {
      const buyBasis = a.pricingMode === 'ADVERSE_EXTREME' ? Math.max(bar.close, bar.high ?? bar.close) : bar.close;
      mid = Math.max(buyBasis, Math.max(0, K - spot));
      lastIv = impliedPutVolatility(bar.close, spot, K, t, a.riskFreeRate) ?? lastIv;
    } else if (lastIv !== null) {
      mid = blackScholesPut(spot, K, t, lastIv, a.riskFreeRate).price; modelPriced = true;
    } else continue;
    const half = a.halfSpread(mid);
    const debitPs = mid + half;
    worstMark = Math.min(worstMark, (creditPs - debitPs) * m - 2 * a.feePerContractSide);
    const capture = (creditPs - debitPs) / creditPs;
    const dte = calendarDays(date, c.expiration);
    const delta = lastIv === null ? null : blackScholesPut(spot, K, t, lastIv, a.riskFreeRate).delta;
    const p = input.policy;
    if (p.premiumMultiple !== undefined && debitPs >= p.premiumMultiple * creditPs) return finish('PREMIUM_MULTIPLE', debitPs, half, modelPriced, false);
    if (p.deltaAbove !== undefined && delta !== null && Math.abs(delta) > p.deltaAbove) return finish('DELTA_ABOVE', debitPs, half, modelPriced, false);
    if (p.belowBreakeven === true && spot < breakeven) return finish('BELOW_BREAKEVEN', debitPs, half, modelPriced, false);
    // Profit-taking needs a real traded print: a constant-IV model price decays by theta alone and would fake captures.
    // Model prices are used only for risk and time exits (labelled modelPricedExit).
    if (p.profitCapture !== undefined && !modelPriced && capture >= p.profitCapture) return finish('PROFIT_CAPTURE', debitPs, half, modelPriced, false);
    if (p.dynamic !== undefined && lastIv !== null && !modelPriced) {
      const tail = Math.max(0, K - spot * Math.exp(-2 * lastIv * Math.sqrt(t))) - debitPs;
      const ratio = tail > 0 ? debitPs / tail : Number.POSITIVE_INFINITY;
      if (capture >= p.dynamic.hardCapture || (capture >= p.dynamic.minCapture && ratio < p.dynamic.tailRatio))
        return finish('DYNAMIC_REMAINING_REWARD', debitPs, half, modelPriced, false);
    }
    if (p.currentManagement === true && !modelPriced && dte <= 5 && debitPs <= 0.10 * creditPs) return finish('CURRENT_MANAGEMENT', debitPs, half, modelPriced, false);
    if (p.dteExit !== undefined && dte <= p.dteExit) return finish('DTE_EXIT', debitPs, half, modelPriced, false);
    if (p.timeFraction !== undefined && calendarDays(input.entryDate, date) >= p.timeFraction * c.dte) return finish('TIME_EXIT', debitPs, half, modelPriced, false);
  }
  return { state: 'CENSORED', reason: 'DATA_ENDS_BEFORE_EXIT_OR_EXPIRY' };
}

export const exitPolicies: readonly ExitPolicy[] = [
  { id: 'HOLD_TO_EXPIRY' },
  { id: 'CURRENT_MGMT_EMULATION', currentManagement: true },
  { id: 'FIXED_25', profitCapture: 0.25 }, { id: 'FIXED_50', profitCapture: 0.50 }, { id: 'FIXED_65', profitCapture: 0.65 },
  { id: 'FIXED_75', profitCapture: 0.75 }, { id: 'FIXED_80', profitCapture: 0.80 },
  { id: 'DTE_EXIT_21', dteExit: 21 }, { id: 'DTE_EXIT_7', dteExit: 7 }, { id: 'TIME_EXIT_50PCT', timeFraction: 0.5 },
  { id: 'RISK_2X', premiumMultiple: 2 }, { id: 'RISK_3X', premiumMultiple: 3 }, { id: 'RISK_DELTA_50', deltaAbove: 0.5 },
  { id: 'RISK_BELOW_BREAKEVEN', belowBreakeven: true },
  { id: 'DYNAMIC_REMAINING_REWARD', dynamic: { minCapture: 0.5, tailRatio: 0.10, hardCapture: 0.8 } },
  { id: 'FIXED_50+RISK_2X', profitCapture: 0.5, premiumMultiple: 2 },
  { id: 'FIXED_50+DTE_21', profitCapture: 0.5, dteExit: 21 },
  { id: 'FIXED_65+RISK_2X+DTE_7', profitCapture: 0.65, premiumMultiple: 2, dteExit: 7 },
  { id: 'FIXED_50+RISK_BELOW_BREAKEVEN', profitCapture: 0.5, belowBreakeven: true },
  { id: 'DYNAMIC+RISK_2X', dynamic: { minCapture: 0.5, tailRatio: 0.10, hardCapture: 0.8 }, premiumMultiple: 2 },
];

export function economicProfileGrid(): readonly EconomicProfile[] {
  const out: EconomicProfile[] = [];
  for (const sigma of [0.4, 0.6, 0.8, 1.0, 1.2, 1.5])
    for (const delta of [0.10, 0.15, 0.20, 0.25, 0.30, 0.35])
      for (const r2s of [null, 0.05, 0.10])
        out.push({ id: `S${sigma}_D${delta}_R${r2s ?? 'none'}`, minCushionSigmas: sigma, maxAbsDelta: delta, minRewardToStress: r2s });
  return out;
}

// ---------------------------------------------------------------------------
// Sequential, non-overlapping simulation per (underlying, selection policy, exit policy)
// ---------------------------------------------------------------------------

export interface DecisionPoint {
  readonly date: string;
  readonly spot: number;
  readonly regime: string;
  readonly candidates: readonly ReplayCandidate[];
}

export interface PolicyRunResult {
  readonly episodes: readonly Episode[];
  readonly censored: number;
  readonly corporateActionExcluded: number;
  readonly waits: number;
  readonly decisionsConsidered: number;
}

export function runSequentialPolicy(input: {
  readonly underlying: UnderlyingHistory; readonly decisions: readonly DecisionPoint[];
  readonly contractsBySymbol: ReadonlyMap<string, ContractHistory>;
  readonly select: (candidates: readonly ReplayCandidate[], decision: DecisionPoint) => ReplayCandidate | null;
  readonly exit: ExitPolicy; readonly assumptions: ReplayAssumptions;
}): PolicyRunResult {
  const episodes: Episode[] = [];
  let censored = 0, excluded = 0, waits = 0, considered = 0, busyUntil = '';
  for (const decision of input.decisions) {
    if (decision.date <= busyUntil) continue;
    considered++;
    const chosen = input.select(decision.candidates, decision);
    if (chosen === null) { waits++; continue; }
    const contract = input.contractsBySymbol.get(chosen.symbol);
    if (contract === undefined) throw new Error('REPLAY_CONTRACT_MISSING');
    const result = simulateExit({ underlying: input.underlying, contract, candidate: chosen, entryDate: decision.date,
      policy: input.exit, assumptions: input.assumptions, regime: decision.regime });
    if (result.state === 'CLOSED') { episodes.push(result.episode); busyUntil = result.episode.exitDate; }
    else if (result.state === 'CENSORED') { censored++; break; }
    else { excluded++; busyUntil = chosen.expiration; }
  }
  return { episodes, censored, corporateActionExcluded: excluded, waits, decisionsConsidered: considered };
}
