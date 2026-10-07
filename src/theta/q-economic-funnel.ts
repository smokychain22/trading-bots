// Q candidate funnel receipt (SHADOW, observation only).
//
// The 2026-10-07 XLE decision showed 124 Q put candidates collapsing to 4 evaluated finalists on structural closeness
// (delta-band distance, DTE, spread, quote age) before any economics. This receipt measures, per cycle, where candidates
// disappear and whether the structural shortlist excludes the economically strongest candidates. It never changes the
// shortlist, the selection, eligibility or quantity.
//
// Stage 1 = hard filters the runtime already applies (same frozen lattice values, read via parseLattice; no new
// threshold). Event, ownership and AEGIS are evaluated by the runtime only AFTER the shortlist, so they are reported as
// NOT_EVALUATED_BEFORE_SHORTLIST rather than guessed. Stage 2 = economic ranking (strategy-economics.ts) over every
// stage-1 survivor.

import type { NormalizedOptionContract } from './option-contract.js';
import { isFinalistCapitalMisfit, parseLattice, type FinalistCapitalContext } from './finalist-quote-refresh.js';
import { economicRankingForCspCandidates, economicRankingMethodVersion, nearestAtmPutIv, type CspContractEvidence } from './strategy-economics.js';

export const qEconomicFunnelContractVersion = 'theta-q-economic-funnel-v1' as const;

export interface QEconomicFunnelCandidate {
  readonly candidateId: string;
  readonly economicRank: number;
  readonly paretoRank: number | null;
  readonly decidedBy: string;
  readonly requiredUnknowns: readonly string[];
  readonly structuralFinalist: boolean;
  readonly strike: number;
  readonly dte: number;
  readonly delta: number | null;
  readonly grossCreditUsd: number | null;
  readonly capitalUsd: number | null;
  readonly returnOnCapital: number | null;
  readonly returnPerCapitalDay: number | null;
  readonly breakevenCushionPct: number | null;
  readonly breakevenCushionSigmas: number | null;
  readonly rewardToStressRisk: number | null;
  readonly bidAskSpreadPct: number | null;
}

export interface QEconomicFunnelReceipt {
  readonly contractVersion: typeof qEconomicFunnelContractVersion;
  readonly rankingMethod: typeof economicRankingMethodVersion;
  readonly underlying: string;
  readonly stages: {
    readonly RAW_CONTRACTS: number;
    readonly PUT_QUOTED: number;
    readonly DTE_VALID: number;
    readonly DELTA_BAND_VALID: number;
    readonly LIQUIDITY_VALID: number;
    readonly CAPITAL_VALID: number;
    readonly EVENT_VALID: 'NOT_EVALUATED_BEFORE_SHORTLIST';
    readonly OWNERSHIP_VALID: 'NOT_EVALUATED_BEFORE_SHORTLIST';
    readonly AEGIS_VALID: 'NOT_EVALUATED_BEFORE_SHORTLIST';
    readonly ECONOMICS_EVALUATED: number;
    readonly ECONOMICS_COMPLETE: number;
    readonly STRUCTURAL_FINALISTS: number;
  };
  readonly economicTopK: readonly QEconomicFunnelCandidate[];
  readonly structuralFinalistIds: readonly string[];
  readonly economicTopKExcludedByStructuralShortlist: readonly string[];
  readonly economicLeaderIsStructuralFinalist: boolean | null;
  readonly bestStructuralFinalistEconomicRank: number | null;
  readonly scenarioVolatility: number | null;
  readonly authority: 'SHADOW_OBSERVATION_ONLY';
}

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const k = (v: { readonly state: string; readonly value?: number }): number | null => v.state === 'KNOWN' ? v.value as number : null;

export function buildQEconomicFunnelReceipt(input: {
  readonly underlying: string;
  readonly contracts: readonly NormalizedOptionContract[];
  readonly latticeConfig: Readonly<Record<string, unknown>>;
  readonly capital?: FinalistCapitalContext;
  readonly structuralFinalistSymbols: ReadonlySet<string>;
  readonly topK: number;
  readonly stressGapPct: number;
}): QEconomicFunnelReceipt {
  const lattice = parseLattice(input.latticeConfig);
  const putQuoted = input.contracts.filter((c) => c.optionType === 'PUT' && c.occSymbol !== null && finite(c.multiplier)
    && c.multiplier > 0 && finite(c.bid) && c.bid > 0);
  const dteValid = putQuoted.filter((c) => (lattice.minDte === null || c.dte >= lattice.minDte) && (lattice.maxDte === null || c.dte <= lattice.maxDte));
  const deltaValid = dteValid.filter((c) => lattice.deltaBands.length === 0 || (c.delta !== null
    && lattice.deltaBands.some(([low, high]) => Math.abs(c.delta as number) >= low && Math.abs(c.delta as number) < high)));
  const liquidityValid = deltaValid.filter((c) => (lattice.maxSpreadPct === null || (c.spreadPct !== null && c.spreadPct <= lattice.maxSpreadPct))
    && (lattice.minOpenInterest === null || (c.openInterest !== null && c.openInterest >= lattice.minOpenInterest))
    && (lattice.minVolume === null || (c.volume !== null && c.volume >= lattice.minVolume)));
  const capitalValid = liquidityValid.filter((c) => !isFinalistCapitalMisfit(c, input.capital));
  const evidence = (c: NormalizedOptionContract): CspContractEvidence => ({
    underlying: c.underlying, optionSymbol: c.optionSymbol, strike: c.strike, expiration: c.expiration, dte: c.dte,
    multiplier: c.multiplier, bid: c.bid, ask: c.ask, delta: c.delta, iv: c.iv, volume: c.volume, openInterest: c.openInterest,
    underlyingReferencePrice: c.underlyingReferencePrice,
  });
  // The shared scenario volatility comes from the WHOLE put chain (nearest-ATM put), not from the filtered survivors.
  const scenarioVolatility = nearestAtmPutIv(putQuoted.map(evidence));
  const { ranked } = economicRankingForCspCandidates(capitalValid.map((c) => ({ candidateId: c.optionSymbol, contract: evidence(c) })),
    { mode: 'SHADOW', strategyClass: 'THETA_CONVENTIONAL', policy: null, openingCostPerContractUsd: null,
      stressGapPct: input.stressGapPct, opportunityCostAnnualRate: null, scenarioVolatility });
  const bySymbol = new Map(capitalValid.map((c) => [c.optionSymbol, c]));
  const row = (r: typeof ranked[number]): QEconomicFunnelCandidate => {
    const c = bySymbol.get(r.receipt.candidateId) as NormalizedOptionContract;
    return {
      candidateId: r.receipt.candidateId, economicRank: r.rank, paretoRank: r.paretoRank, decidedBy: r.decidedBy,
      requiredUnknowns: r.requiredUnknowns, structuralFinalist: input.structuralFinalistSymbols.has(r.receipt.candidateId),
      strike: c.strike, dte: c.dte, delta: c.delta, grossCreditUsd: k(r.receipt.grossCreditUsd), capitalUsd: k(r.receipt.capitalRequiredUsd),
      returnOnCapital: k(r.receipt.returnOnCapital), returnPerCapitalDay: k(r.receipt.returnPerCapitalDay),
      breakevenCushionPct: k(r.receipt.distanceToBreakevenPct), breakevenCushionSigmas: k(r.receipt.breakevenCushionSigmas),
      rewardToStressRisk: k(r.receipt.rewardToStressRisk), bidAskSpreadPct: k(r.receipt.bidAskSpreadPct),
    };
  };
  const top = ranked.slice(0, Math.max(0, input.topK)).map(row);
  const finalistRanks = ranked.filter((r) => input.structuralFinalistSymbols.has(r.receipt.candidateId)).map((r) => r.rank);
  return {
    contractVersion: qEconomicFunnelContractVersion, rankingMethod: economicRankingMethodVersion, underlying: input.underlying,
    stages: {
      RAW_CONTRACTS: input.contracts.length, PUT_QUOTED: putQuoted.length, DTE_VALID: dteValid.length,
      DELTA_BAND_VALID: deltaValid.length, LIQUIDITY_VALID: liquidityValid.length, CAPITAL_VALID: capitalValid.length,
      EVENT_VALID: 'NOT_EVALUATED_BEFORE_SHORTLIST', OWNERSHIP_VALID: 'NOT_EVALUATED_BEFORE_SHORTLIST', AEGIS_VALID: 'NOT_EVALUATED_BEFORE_SHORTLIST',
      ECONOMICS_EVALUATED: ranked.length, ECONOMICS_COMPLETE: ranked.filter((r) => r.requiredUnknowns.length === 0).length,
      STRUCTURAL_FINALISTS: input.structuralFinalistSymbols.size,
    },
    economicTopK: top,
    structuralFinalistIds: [...input.structuralFinalistSymbols].sort(),
    economicTopKExcludedByStructuralShortlist: top.filter((c) => !c.structuralFinalist).map((c) => c.candidateId),
    economicLeaderIsStructuralFinalist: top[0] === undefined ? null : top[0].structuralFinalist,
    bestStructuralFinalistEconomicRank: finalistRanks.length === 0 ? null : Math.min(...finalistRanks),
    scenarioVolatility,
    authority: 'SHADOW_OBSERVATION_ONLY',
  };
}
