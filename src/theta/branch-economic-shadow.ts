// Per-branch economic shadow for the canonical frontier (Q, H, D). Observation only.
//
// Each branch's structural `bestCandidateId` falls back to candidate-ID (OCC) order when Pareto rank and unknown count tie
// (canonical-strategy-frontier.ts candidateRankOrder). This records, beside it, the economic best under the class-specific
// risk-constrained order (strategy-economics.ts): H by cushion in implied moves first, D by credit per unit of DEFINED max
// loss with BOTH legs priced (short bid - long ask) -- never a single-leg proxy. It never changes any selection.

import type { CanonicalBranchFrontier, CanonicalFrontierCandidate } from './canonical-strategy-frontier.js';
import type { NormalizedOptionContract } from './option-contract.js';
import {
  buildStrategyEconomicsReceipt, economicRankingMethodVersion, nearestAtmPutIv, rankEconomically,
  type EconomicsStrategyClass, type StrategyEconomicsReceipt,
} from './strategy-economics.js';

export const branchEconomicShadowVersion = 'theta-branch-economic-shadow-v1' as const;

export interface BranchEconomicShadowRow {
  readonly candidateId: string;
  readonly rank: number;
  readonly decidedBy: string;
  readonly requiredUnknowns: readonly string[];
  readonly maxProfitUsd: number | null;
  readonly maxLossUsd: number | null;
  readonly capitalUsd: number | null;
  readonly returnPerCapitalDay: number | null;
  readonly rewardToMaxLoss: number | null;
  readonly breakevenCushionSigmas: number | null;
  readonly rewardToStressRisk: number | null;
  readonly bidAskSpreadPct: number | null;
}

export interface BranchEconomicShadowRecord {
  readonly branch: EconomicsStrategyClass;
  readonly rankingMethod: typeof economicRankingMethodVersion;
  readonly feasibleCandidateCount: number;
  readonly economicsEvaluatedCount: number;
  readonly notEvaluableCount: number;
  readonly structuralBestCandidateId: string | null;
  readonly economicBestCandidateId: string | null;
  readonly diverges: boolean;
  readonly top: readonly BranchEconomicShadowRow[];
  readonly authority: 'SHADOW_OBSERVATION_ONLY';
}

const branchClasses: readonly EconomicsStrategyClass[] = ['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK'];
const k = (v: { readonly state: string; readonly value?: number }): number | null => v.state === 'KNOWN' ? v.value as number : null;

function receiptFor(candidate: CanonicalFrontierCandidate, cls: EconomicsStrategyClass,
  bySymbol: ReadonlyMap<string, NormalizedOptionContract>, scenarioVolatility: number | null): StrategyEconomicsReceipt | null {
  const shortLeg = candidate.legs.find((leg) => leg.positionIntent === 'SELL_TO_OPEN' && leg.optionType === 'PUT');
  const longLegs = candidate.legs.filter((leg) => leg.positionIntent === 'BUY_TO_OPEN');
  if (shortLeg === undefined || candidate.dte === null) return null;
  const shortEvidence = bySymbol.get(shortLeg.optionSymbol);
  const quote = (leg: typeof shortLeg, evidence: NormalizedOptionContract | undefined) => ({
    optionSymbol: leg.optionSymbol, strike: leg.strike, bid: leg.bid, ask: leg.ask, delta: evidence?.delta ?? null,
    iv: evidence?.iv ?? null, volume: evidence?.volume ?? null, openInterest: evidence?.openInterest ?? null,
  });
  const spread = cls === 'THETA_DEFINED_RISK';
  if (spread ? !(candidate.legs.length === 2 && longLegs.length === 1 && longLegs[0]?.optionType === 'PUT') : candidate.legs.length !== 1) return null;
  const longLeg = spread ? longLegs[0] as typeof shortLeg : null;
  const credit = spread
    ? (shortLeg.bid !== null && longLeg?.ask !== null && longLeg !== null ? Number(((shortLeg.bid as number) - (longLeg.ask as number)).toFixed(4)) : null)
    : shortLeg.bid;
  try {
    return buildStrategyEconomicsReceipt({
      candidateId: candidate.candidateId, strategyClass: cls, structure: spread ? 'PUT_CREDIT_SPREAD' : 'CASH_SECURED_PUT',
      underlying: candidate.underlying, expiration: shortLeg.expiration, dte: candidate.dte, multiplier: shortLeg.multiplier,
      shortLeg: quote(shortLeg, shortEvidence), longLeg: longLeg === null ? null : quote(longLeg, bySymbol.get(longLeg.optionSymbol)),
      spot: shortEvidence?.underlyingReferencePrice ?? null, creditPerShare: credit, creditBasis: 'EXECUTABLE_BID',
      openingCostsUsd: null, realizedVolatility: null, ivRank: null, eventInWindow: null,
      stressGapPct: 0.05, opportunityCostAnnualRate: null, scenarioVolatility,
      scenarioVolatilityProvenance: 'NEAREST_ATM_PUT_IV_ON_UNDERLYING',
    });
  } catch {
    return null;
  }
}

export function buildBranchEconomicShadow(branches: readonly CanonicalBranchFrontier[],
  contracts: readonly NormalizedOptionContract[], topN = 5): readonly BranchEconomicShadowRecord[] {
  const bySymbol = new Map(contracts.map((contract) => [contract.optionSymbol, contract]));
  const records: BranchEconomicShadowRecord[] = [];
  for (const cls of branchClasses) {
    const branch = branches.find((item) => item.branch === cls);
    if (branch === undefined || !branch.evaluated) continue;
    const feasible = branch.candidates.filter((candidate) => candidate.riskFeasible && candidate.sizing.quantity > 0);
    const underlyings = new Set(feasible.map((candidate) => candidate.underlying));
    const scenarioByUnderlying = new Map([...underlyings].map((underlying) => [underlying, nearestAtmPutIv(contracts
      .filter((c) => c.underlying === underlying && c.optionType === 'PUT')
      .map((c) => ({ underlying: c.underlying, optionSymbol: c.optionSymbol, strike: c.strike, expiration: c.expiration, dte: c.dte,
        multiplier: c.multiplier, bid: c.bid, ask: c.ask, delta: c.delta, iv: c.iv, volume: c.volume, openInterest: c.openInterest,
        underlyingReferencePrice: c.underlyingReferencePrice })))]));
    const receipts = feasible.map((candidate) => receiptFor(candidate, cls, bySymbol, scenarioByUnderlying.get(candidate.underlying) ?? null))
      .filter((receipt): receipt is StrategyEconomicsReceipt => receipt !== null);
    const ranked = rankEconomically(receipts.map((receipt) => ({ receipt, verdict: 'NOT_CONFIGURED' as const })));
    const economicBest = ranked[0]?.receipt.candidateId ?? null;
    records.push({
      branch: cls, rankingMethod: economicRankingMethodVersion, feasibleCandidateCount: feasible.length,
      economicsEvaluatedCount: receipts.length, notEvaluableCount: feasible.length - receipts.length,
      structuralBestCandidateId: branch.bestCandidateId, economicBestCandidateId: economicBest,
      diverges: economicBest !== null && economicBest !== branch.bestCandidateId,
      top: ranked.slice(0, topN).map((row) => ({
        candidateId: row.receipt.candidateId, rank: row.rank, decidedBy: row.decidedBy, requiredUnknowns: row.requiredUnknowns,
        maxProfitUsd: k(row.receipt.maxProfitUsd), maxLossUsd: k(row.receipt.maxLossUsd), capitalUsd: k(row.receipt.capitalRequiredUsd),
        returnPerCapitalDay: k(row.receipt.returnPerCapitalDay), rewardToMaxLoss: k(row.receipt.rewardToMaxLoss),
        breakevenCushionSigmas: k(row.receipt.breakevenCushionSigmas), rewardToStressRisk: k(row.receipt.rewardToStressRisk),
        bidAskSpreadPct: k(row.receipt.bidAskSpreadPct),
      })),
      authority: 'SHADOW_OBSERVATION_ONLY',
    });
  }
  return records;
}
