import type { JsonValue } from '../market/fusion-snapshot.js';
import type { CanonicalFrontierCandidate, CanonicalStrategyFrontier } from '../theta/canonical-strategy-frontier.js';
import type { NormalizedOptionContract } from '../theta/option-contract.js';
import type { HistoricalBar } from '../theta/underlying-history.js';
import { optionomicsFamiliesFor, type OptionomicsFeatureFamily } from '../theta/optionomics-feature-destinations.js';
import { buildVolatilityAccelerationEvidence, type VolatilityAccelerationEvidence } from './volatility-acceleration.js';

export const strategyQualityShadowDiagnosticVersion = 'theta-strategy-quality-shadow-v1' as const;

export type ShadowFeatureState = 'KNOWN' | 'UNKNOWN' | 'INVALID' | 'UNAVAILABLE';

export interface UniverseBreadthShadowPlan {
  readonly championSymbols: readonly string[];
  readonly challengerSymbols: readonly { readonly width: 5 | 10; readonly symbol: string }[];
  readonly maximumAdditionalFullScans: 1;
  readonly brokerAuthority: false;
}

/**
 * Schedules at most one rotating challenger from each bounded width. The
 * plan itself performs no provider call and confers no broker authority.
 */
export function buildUniverseBreadthShadowPlan(
  rankedSymbols: readonly string[], scanOrdinal: number,
): UniverseBreadthShadowPlan {
  if (!Number.isInteger(scanOrdinal) || scanOrdinal < 0) throw new Error('UNIVERSE_CHALLENGER_ORDINAL_INVALID');
  const unique = [...new Set(rankedSymbols)];
  const championSymbols = unique.slice(0, 2);
  const selection = (start:number,end:number,width:5|10,rotation:number) => {
    const band = unique.slice(start, end);
    if (band.length === 0) return [];
    return [{ width, symbol: band[rotation % band.length] as string }] as const;
  };
  const preferred = scanOrdinal % 2 === 0
    ? selection(2, 5, 5, Math.floor(scanOrdinal / 2))
    : selection(5, 10, 10, Math.floor(scanOrdinal / 2));
  const fallback = scanOrdinal % 2 === 0
    ? selection(5, 10, 10, Math.floor(scanOrdinal / 2))
    : selection(2, 5, 5, Math.floor(scanOrdinal / 2));
  return {
    championSymbols,
    challengerSymbols: preferred.length > 0 ? preferred : fallback,
    maximumAdditionalFullScans: 1,
    brokerAuthority: false,
  };
}

export interface StrategyQualityShadowDiagnostic {
  readonly contractVersion: typeof strategyQualityShadowDiagnosticVersion;
  readonly brokerAuthority: false;
  readonly activeConventionalDteWindow: { readonly min: number; readonly max: number };
  readonly dteEdge: {
    readonly bandDays: number;
    readonly observedCandidateCount: number;
    readonly lowerBandCount: number;
    readonly upperBandCount: number;
    readonly bestCapitalDayCandidateId: string | null;
    readonly economicallyDominatesSelectedOnKnownObjectives: boolean;
    readonly interpretation: 'ECONOMIC_ONLY_NOT_FEASIBILITY_OR_EXECUTION_AUTHORITY';
  };
  readonly capitalDayChallenger: {
    readonly currentSelectedCandidateId: string | null;
    readonly challengerCandidateId: string | null;
    readonly selectionWouldChange: boolean;
  };
  readonly paretoTie: {
    readonly alphabeticalTieBreakCount: number;
    readonly economicallyDifferentTieCount: number;
  };
  readonly optionomicsFamilies: Readonly<Record<
    'IV' | 'IV_RANK' | 'IV_PERCENTILE' | 'REALIZED_VOLATILITY' | 'VRP' | 'SKEW' | 'TERM' | 'SURFACE'
      | 'EXPECTED_MOVE' | 'GEX' | 'VANNA' | 'CHARM' | 'FLOW' | 'EVENTS',
    ShadowFeatureState
  >>;
  readonly volatilityAcceleration: VolatilityAccelerationEvidence;
  readonly liveSelectionChanged: false;
}

const record = (value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, JsonValue>> : null;

const stateOf = (value: JsonValue | undefined): ShadowFeatureState => {
  const object = value === undefined ? null : record(value);
  const state = object?.state;
  return state === 'KNOWN' || state === 'UNKNOWN' || state === 'INVALID' ? state : 'UNAVAILABLE';
};

const populatedContext = (context: Readonly<Record<string, JsonValue>> | null, key: string): ShadowFeatureState => {
  const value = context?.[key];
  if (value === null || value === undefined) return 'UNKNOWN';
  if (Array.isArray(value)) return value.length > 0 ? 'KNOWN' : 'UNKNOWN';
  if (typeof value === 'object') return Object.keys(value).length > 0 ? 'KNOWN' : 'UNKNOWN';
  return 'INVALID';
};

const featureFamilies = (optionomicsContext: JsonValue): StrategyQualityShadowDiagnostic['optionomicsFamilies'] => {
  const allowed = new Set<OptionomicsFeatureFamily>(optionomicsFamiliesFor('THETA_CONVENTIONAL'));
  const routed = (family:OptionomicsFeatureFamily,value:ShadowFeatureState):ShadowFeatureState =>
    allowed.has(family) ? value : 'UNAVAILABLE';
  const context = record(optionomicsContext);
  const contracts = Array.isArray(context?.contracts) ? context.contracts.map(record).filter((value) => value !== null) : [];
  const contractState = (path: readonly string[]): ShadowFeatureState => {
    const states = contracts.map((contract) => {
      let current: JsonValue | undefined = contract;
      for (const key of path) current = record(current as JsonValue)?.[key];
      return stateOf(current);
    });
    if (states.includes('KNOWN')) return 'KNOWN';
    if (states.includes('INVALID')) return 'INVALID';
    return states.includes('UNKNOWN') ? 'UNKNOWN' : 'UNAVAILABLE';
  };
  const providerContext = record(context?.providerContext);
  const metrics = record(providerContext?.metrics);
  return {
    IV: routed('VOLATILITY',contractState(['volatility', 'impliedVolatility'])),
    IV_RANK: routed('VOLATILITY',stateOf(metrics?.ivRank)),
    IV_PERCENTILE: routed('VOLATILITY',stateOf(metrics?.ivPercentile)),
    REALIZED_VOLATILITY: routed('VOLATILITY','UNAVAILABLE'),
    VRP: routed('VOLATILITY','UNAVAILABLE'),
    SKEW: routed('SKEW',stateOf(context?.skew)),
    TERM: routed('TERM',stateOf(context?.termStructure)),
    SURFACE: routed('SURFACE',stateOf(context?.volatilitySurface)),
    EXPECTED_MOVE: routed('EXPECTED_MOVE',contractState(['structuralEconomics', 'expectedMoveApprox'])),
    GEX: routed('EXPOSURE',contractState(['marketStructure', 'gammaExposure']) === 'KNOWN'
      ? 'KNOWN' : populatedContext(providerContext, 'exposureHeatmap')),
    VANNA: routed('EXPOSURE',populatedContext(providerContext, 'vannaExposureHeatmap')),
    CHARM: routed('EXPOSURE',populatedContext(providerContext, 'charmExposureHeatmap')),
    FLOW: routed('FLOW',Array.isArray(record(context?.flow)?.windows)
      && (record(context?.flow)?.windows as JsonValue[]).length > 0 ? 'KNOWN' : 'UNKNOWN'),
    EVENTS: routed('EVENTS',[providerContext?.events, providerContext?.earningsFilings, providerContext?.symbolNews]
      .some((value) => populatedContext({ value: value ?? null }, 'value') === 'KNOWN') ? 'KNOWN' : 'UNKNOWN'),
  };
};

type ComparableEconomics = {
  readonly candidateId: string;
  readonly grossPremium: number | null;
  readonly collateral: number | null;
  readonly spreadPct: number | null;
  readonly downsideCushion: number | null;
  readonly capitalDayYield: number | null;
};

const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);
const comparable = (candidate: CanonicalFrontierCandidate): ComparableEconomics => ({
  candidateId: candidate.candidateId,
  grossPremium: candidate.economics.grossPremium,
  collateral: candidate.economics.collateral,
  spreadPct: candidate.spreadPct,
  downsideCushion: candidate.economics.downsideCushion,
  capitalDayYield: candidate.economics.capitalDayYield,
});

const edgeEconomics = (contract: NormalizedOptionContract): ComparableEconomics => {
  const premium = finite(contract.bid) ? contract.bid * contract.multiplier : null;
  const collateral = contract.strike * contract.multiplier;
  const downsideCushion = finite(contract.underlyingReferencePrice) && finite(contract.breakEven)
    && contract.underlyingReferencePrice > 0
    ? (contract.underlyingReferencePrice - contract.breakEven) / contract.underlyingReferencePrice : null;
  return {
    candidateId: `DTE_EDGE:${contract.optionSymbol}`,
    grossPremium: premium,
    collateral,
    spreadPct: contract.spreadPct,
    downsideCushion,
    capitalDayYield: premium === null || collateral <= 0 || contract.dte <= 0 ? null : premium / (collateral * contract.dte),
  };
};

const economicallyDominates = (left: ComparableEconomics, right: ComparableEconomics): boolean => {
  const pairs = [
    [left.grossPremium, right.grossPremium, 'MAX'],
    [left.collateral, right.collateral, 'MIN'],
    [left.spreadPct, right.spreadPct, 'MIN'],
    [left.downsideCushion, right.downsideCushion, 'MAX'],
  ] as const;
  const known = pairs.filter(([a, b]) => finite(a) && finite(b));
  if (known.length < 3) return false;
  const noWorse = known.every(([a, b, direction]) => direction === 'MAX' ? (a as number) >= (b as number) : (a as number) <= (b as number));
  const better = known.some(([a, b, direction]) => direction === 'MAX' ? (a as number) > (b as number) : (a as number) < (b as number));
  return noWorse && better;
};

const objectiveSignature = (candidate: CanonicalFrontierCandidate): string => JSON.stringify([
  candidate.economics.grossPremium, candidate.economics.collateral, candidate.spreadPct,
  candidate.economics.downsideCushion, candidate.economics.retainedUpside,
]);

/**
 * Produces a point-in-time research side channel from data already fetched
 * for the canonical decision. It cannot select a candidate, authorize an
 * order, or mutate the canonical frontier.
 */
export function buildStrategyQualityShadowDiagnostic(input: {
  readonly contracts: readonly NormalizedOptionContract[];
  readonly frontier: CanonicalStrategyFrontier;
  readonly optionomicsContext: JsonValue;
  readonly historicalBars: readonly HistoricalBar[];
  readonly asOf: string;
  readonly conventionalDteMin: number;
  readonly conventionalDteMax: number;
  readonly dteEdgeBandDays?: number;
}): StrategyQualityShadowDiagnostic {
  const band = input.dteEdgeBandDays ?? 5;
  const edgeContracts = input.contracts.filter((contract) => contract.optionType === 'PUT'
    && ((contract.dte >= Math.max(0, input.conventionalDteMin - band) && contract.dte < input.conventionalDteMin)
      || (contract.dte > input.conventionalDteMax && contract.dte <= input.conventionalDteMax + band)));
  const edge = edgeContracts.map(edgeEconomics);
  const edgeBest = edge.filter((candidate) => finite(candidate.capitalDayYield))
    .toSorted((a, b) => (b.capitalDayYield as number) - (a.capitalDayYield as number))[0] ?? null;
  const candidates = input.frontier.branches.flatMap((branch) => branch.candidates);
  const current = candidates.find((candidate) => candidate.candidateId === input.frontier.selectedCandidateId) ?? null;
  const feasible = candidates.filter((candidate) => candidate.riskFeasible && finite(candidate.economics.capitalDayYield));
  const capitalDayBest = feasible.toSorted((a, b) =>
    (b.economics.capitalDayYield as number) - (a.economics.capitalDayYield as number)
      || a.candidateId.localeCompare(b.candidateId))[0] ?? null;
  const groups = new Map<string, CanonicalFrontierCandidate[]>();
  for (const candidate of candidates.filter((value) => value.riskFeasible)) {
    const key = `${candidate.paretoRank ?? 'null'}:${candidate.unknownEvidence.length}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  const ties = [...groups.values()].filter((group) => group.length > 1);
  return {
    contractVersion: strategyQualityShadowDiagnosticVersion,
    brokerAuthority: false,
    activeConventionalDteWindow: { min: input.conventionalDteMin, max: input.conventionalDteMax },
    dteEdge: {
      bandDays: band,
      observedCandidateCount: edge.length,
      lowerBandCount: edgeContracts.filter((contract) => contract.dte < input.conventionalDteMin).length,
      upperBandCount: edgeContracts.filter((contract) => contract.dte > input.conventionalDteMax).length,
      bestCapitalDayCandidateId: edgeBest?.candidateId ?? null,
      economicallyDominatesSelectedOnKnownObjectives: edgeBest !== null && current !== null
        ? economicallyDominates(edgeBest, comparable(current)) : false,
      interpretation: 'ECONOMIC_ONLY_NOT_FEASIBILITY_OR_EXECUTION_AUTHORITY',
    },
    capitalDayChallenger: {
      currentSelectedCandidateId: input.frontier.selectedCandidateId,
      challengerCandidateId: capitalDayBest?.candidateId ?? null,
      selectionWouldChange: capitalDayBest !== null && capitalDayBest.candidateId !== input.frontier.selectedCandidateId,
    },
    paretoTie: {
      alphabeticalTieBreakCount: ties.reduce((sum, group) => sum + group.length - 1, 0),
      economicallyDifferentTieCount: ties.filter((group) => new Set(group.map(objectiveSignature)).size > 1).length,
    },
    optionomicsFamilies: featureFamilies(input.optionomicsContext),
    volatilityAcceleration: buildVolatilityAccelerationEvidence(input.historicalBars, input.asOf),
    liveSelectionChanged: false,
  };
}
