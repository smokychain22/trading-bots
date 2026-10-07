import { expiryProfile, positionGreeks, type PayoffLeg }
  from '../../theta/strategy-intelligence/option-payoff.js';

export const futureStructureResearchVersion = 'theta-future-structure-research-v1' as const;

export type FutureResearchStructure = 'LONG_BUTTERFLY' | 'SHORT_BUTTERFLY' | 'CALENDAR' | 'DIAGONAL'
  | 'CALL_BACKSPREAD' | 'PUT_BACKSPREAD' | 'LONG_CALL' | 'LONG_PUT' | 'BULL_CALL_SPREAD';

export interface LotteryDiagnosticPolicy {
  readonly version: string;
  readonly maximumLowDelta: number;
  readonly maximumShortDte: number;
  readonly requiredMoveToExpectedMoveRatio: number;
}

export interface FutureStructureResearchReceipt {
  readonly contractVersion: typeof futureStructureResearchVersion;
  readonly structure: FutureResearchStructure;
  readonly authority: 'RESEARCH_ONLY';
  readonly executionAuthorized: false;
  readonly state: 'COMPLETE' | 'INVALID' | 'PIT_UNSAFE' | 'BLOCKED_MISSING_POLICY';
  readonly reasons: readonly string[];
  readonly geometryState: 'VALID' | 'INVALID';
  readonly entryCashflowUsd: number | null;
  readonly maxProfitUsd: number | 'UNBOUNDED' | null;
  readonly maxLossUsd: number | 'UNBOUNDED' | null;
  readonly afterCostMaxProfitUsd: number | 'UNBOUNDED' | null;
  readonly afterCostMaxLossUsd: number | 'UNBOUNDED' | null;
  readonly breakevens: readonly number[];
  readonly greeks: ReturnType<typeof positionGreeks> | null;
  readonly requiredMovePct: number | null;
  readonly expectedMovePct: number | null;
  readonly lotteryTicketOptionSuspected: boolean | null;
  readonly lotteryDiagnosticReasons: readonly string[];
  readonly profitabilityStatus: 'EMPIRICALLY_UNPROVEN';
}

const finite = (value: number): boolean => Number.isFinite(value);
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const optionLegs = (legs: readonly PayoffLeg[]) => legs.filter((leg) => leg.kind !== 'STOCK');
const sameExpiry = (legs: readonly PayoffLeg[]): boolean => new Set(optionLegs(legs).map((leg) => leg.expiryYears)).size === 1;
const sameMultiplier = (legs: readonly PayoffLeg[]): boolean => new Set(optionLegs(legs).map((leg) => leg.multiplier)).size === 1;

function geometryReasons(structure: FutureResearchStructure, legs: readonly PayoffLeg[]): string[] {
  const options = optionLegs(legs);
  const reasons: string[] = [];
  const calls = options.filter((leg) => leg.kind === 'CALL');
  const puts = options.filter((leg) => leg.kind === 'PUT');
  if (legs.length !== options.length) reasons.push('STOCK_LEG_NOT_ALLOWED');
  if (!sameMultiplier(legs)) reasons.push('MULTIPLIER_MISMATCH');
  const sorted = [...options].sort((left, right) => (left.strike as number) - (right.strike as number));
  if (structure === 'LONG_BUTTERFLY' || structure === 'SHORT_BUTTERFLY') {
    if (options.length !== 3 || calls.length !== 3 || !sameExpiry(legs)) reasons.push('BUTTERFLY_REQUIRES_THREE_SAME_EXPIRY_CALL_LEGS');
    else {
      const [low, center, high] = sorted as [PayoffLeg, PayoffLeg, PayoffLeg];
      const long = structure === 'LONG_BUTTERFLY';
      if (low.quantity !== 1 || center.quantity !== 2 || high.quantity !== 1
        || low.side !== (long ? 'LONG' : 'SHORT') || center.side !== (long ? 'SHORT' : 'LONG')
        || high.side !== (long ? 'LONG' : 'SHORT')) reasons.push('BUTTERFLY_RATIO_OR_SIDE_INVALID');
      if (Math.abs(((center.strike as number) - (low.strike as number))
        - ((high.strike as number) - (center.strike as number))) > 1e-9) reasons.push('BUTTERFLY_WINGS_NOT_EQUAL');
    }
  } else if (structure === 'CALENDAR' || structure === 'DIAGONAL') {
    if (options.length !== 2 || calls.length !== 2) reasons.push('CALENDAR_DIAGONAL_REQUIRES_TWO_CALL_LEGS');
    else {
      const short = options.find((leg) => leg.side === 'SHORT'); const long = options.find((leg) => leg.side === 'LONG');
      if (short === undefined || long === undefined || short.quantity !== long.quantity
        || (short.expiryYears as number) >= (long.expiryYears as number)) reasons.push('FRONT_SHORT_BACK_LONG_GEOMETRY_INVALID');
      if (structure === 'CALENDAR' && short?.strike !== long?.strike) reasons.push('CALENDAR_STRIKES_MUST_MATCH');
      if (structure === 'DIAGONAL' && short?.strike === long?.strike) reasons.push('DIAGONAL_STRIKES_MUST_DIFFER');
    }
  } else if (structure === 'CALL_BACKSPREAD' || structure === 'PUT_BACKSPREAD') {
    const kind = structure === 'CALL_BACKSPREAD' ? calls : puts;
    if (options.length !== 2 || kind.length !== 2 || !sameExpiry(legs)) reasons.push('BACKSPREAD_REQUIRES_TWO_SAME_EXPIRY_LEGS');
    else {
      const short = kind.find((leg) => leg.side === 'SHORT'); const long = kind.find((leg) => leg.side === 'LONG');
      if (short === undefined || long === undefined || short.quantity >= long.quantity) reasons.push('BACKSPREAD_RATIO_INVALID');
      if (structure === 'CALL_BACKSPREAD' && (short?.strike as number) >= (long?.strike as number)) reasons.push('CALL_BACKSPREAD_STRIKES_INVALID');
      if (structure === 'PUT_BACKSPREAD' && (short?.strike as number) <= (long?.strike as number)) reasons.push('PUT_BACKSPREAD_STRIKES_INVALID');
    }
  } else if (structure === 'LONG_CALL' || structure === 'LONG_PUT') {
    const expectedKind = structure === 'LONG_CALL' ? 'CALL' : 'PUT';
    if (options.length !== 1 || options[0]?.kind !== expectedKind || options[0]?.side !== 'LONG'
      || options[0]?.quantity !== 1) reasons.push('DIRECTIONAL_LONG_GEOMETRY_INVALID');
  } else {
    if (options.length !== 2 || calls.length !== 2 || !sameExpiry(legs)) reasons.push('BULL_CALL_SPREAD_REQUIRES_TWO_SAME_EXPIRY_CALLS');
    else {
      const long = calls.find((leg) => leg.side === 'LONG'); const short = calls.find((leg) => leg.side === 'SHORT');
      if (long === undefined || short === undefined || long.quantity !== short.quantity
        || (long.strike as number) >= (short.strike as number)) reasons.push('BULL_CALL_SPREAD_GEOMETRY_INVALID');
    }
  }
  return reasons;
}

function requiredMovePct(structure: FutureResearchStructure, breakevens: readonly number[], spot: number): number | null {
  if (breakevens.length === 0) return null;
  if (structure === 'LONG_CALL' || structure === 'BULL_CALL_SPREAD') return Math.max(0, breakevens[0] as number - spot) / spot;
  if (structure === 'LONG_PUT') return Math.max(0, spot - (breakevens.at(-1) as number)) / spot;
  return null;
}

export function evaluateFutureResearchStructure(input: {
  readonly structure: FutureResearchStructure;
  readonly legs: readonly PayoffLeg[];
  readonly spot: number;
  readonly observedAt: string;
  readonly providerKnownAt: string;
  readonly totalEntryExitCostsUsd: number | null;
  readonly expectedMovePct: number | null;
  readonly absoluteDelta: number | null;
  readonly dte: number | null;
  readonly lotteryPolicy: LotteryDiagnosticPolicy | null;
}): FutureStructureResearchReceipt {
  const base = { contractVersion: futureStructureResearchVersion, structure: input.structure,
    authority: 'RESEARCH_ONLY' as const, executionAuthorized: false as const,
    profitabilityStatus: 'EMPIRICALLY_UNPROVEN' as const };
  const observed = Date.parse(input.observedAt); const known = Date.parse(input.providerKnownAt);
  if (finite(observed) && finite(known) && known > observed) return { ...base, state: 'PIT_UNSAFE',
    reasons: ['PROVIDER_EVIDENCE_KNOWN_AFTER_OBSERVATION'], geometryState: 'INVALID', entryCashflowUsd: null,
    maxProfitUsd: null, maxLossUsd: null, afterCostMaxProfitUsd: null, afterCostMaxLossUsd: null,
    breakevens: [], greeks: null, requiredMovePct: null, expectedMovePct: input.expectedMovePct,
    lotteryTicketOptionSuspected: null, lotteryDiagnosticReasons: [] };
  const reasons = geometryReasons(input.structure, input.legs);
  if (!finite(observed) || !finite(known) || !finite(input.spot) || input.spot <= 0
    || (input.totalEntryExitCostsUsd !== null && (!finite(input.totalEntryExitCostsUsd) || input.totalEntryExitCostsUsd < 0))
    || (input.expectedMovePct !== null && (!finite(input.expectedMovePct) || input.expectedMovePct < 0))) reasons.push('INVALID_RESEARCH_INPUT');
  if (reasons.length > 0) return { ...base, state: 'INVALID', reasons: [...new Set(reasons)].sort(), geometryState: 'INVALID',
    entryCashflowUsd: null, maxProfitUsd: null, maxLossUsd: null, afterCostMaxProfitUsd: null, afterCostMaxLossUsd: null,
    breakevens: [], greeks: null, requiredMovePct: null, expectedMovePct: input.expectedMovePct,
    lotteryTicketOptionSuspected: null, lotteryDiagnosticReasons: [] };
  const directional = input.structure === 'LONG_CALL' || input.structure === 'LONG_PUT';
  if (directional && input.lotteryPolicy === null) return { ...base, state: 'BLOCKED_MISSING_POLICY',
    reasons: ['MISSING_POLICY:LOTTERY_DIAGNOSTIC_THRESHOLDS'], geometryState: 'VALID', entryCashflowUsd: null,
    maxProfitUsd: null, maxLossUsd: null, afterCostMaxProfitUsd: null, afterCostMaxLossUsd: null,
    breakevens: [], greeks: null, requiredMovePct: null, expectedMovePct: input.expectedMovePct,
    lotteryTicketOptionSuspected: null, lotteryDiagnosticReasons: [] };
  const profile = expiryProfile(input.legs, { spot: input.spot });
  const requiredMove = requiredMovePct(input.structure, profile.breakevens, input.spot);
  const lotteryReasons: string[] = [];
  if (directional) {
    const policy = input.lotteryPolicy as LotteryDiagnosticPolicy;
    if (!policy.version.trim() || !finite(policy.maximumLowDelta) || policy.maximumLowDelta <= 0
      || !finite(policy.maximumShortDte) || policy.maximumShortDte <= 0
      || !finite(policy.requiredMoveToExpectedMoveRatio) || policy.requiredMoveToExpectedMoveRatio <= 0) {
      return { ...base, state: 'BLOCKED_MISSING_POLICY', reasons: ['INVALID_POLICY:LOTTERY_DIAGNOSTIC_THRESHOLDS'],
        geometryState: 'VALID', entryCashflowUsd: null, maxProfitUsd: null, maxLossUsd: null,
        afterCostMaxProfitUsd: null, afterCostMaxLossUsd: null, breakevens: [], greeks: null,
        requiredMovePct: requiredMove, expectedMovePct: input.expectedMovePct, lotteryTicketOptionSuspected: null,
        lotteryDiagnosticReasons: [] };
    }
    if (input.absoluteDelta !== null && input.absoluteDelta <= policy.maximumLowDelta) lotteryReasons.push('LOW_DELTA');
    if (input.dte !== null && input.dte <= policy.maximumShortDte) lotteryReasons.push('SHORT_DTE');
    if (requiredMove !== null && input.expectedMovePct !== null && input.expectedMovePct > 0
      && requiredMove / input.expectedMovePct >= policy.requiredMoveToExpectedMoveRatio) lotteryReasons.push('REQUIRED_MOVE_EXCEEDS_EXPECTED_MOVE');
  }
  const costs = input.totalEntryExitCostsUsd;
  const afterProfit = costs === null || profile.maxProfit === 'UNBOUNDED' ? profile.maxProfit === 'UNBOUNDED' ? 'UNBOUNDED' : null
    : money(Math.max(0, profile.maxProfit - costs));
  const afterLoss = costs === null || profile.maxLoss === 'UNBOUNDED' ? profile.maxLoss === 'UNBOUNDED' ? 'UNBOUNDED' : null
    : money(profile.maxLoss + costs);
  return { ...base, state: 'COMPLETE', reasons: [], geometryState: 'VALID', entryCashflowUsd: profile.entryCashflow,
    maxProfitUsd: profile.maxProfit, maxLossUsd: profile.maxLoss, afterCostMaxProfitUsd: afterProfit,
    afterCostMaxLossUsd: afterLoss, breakevens: profile.breakevens,
    greeks: positionGreeks(input.legs, { spot: input.spot }), requiredMovePct: requiredMove,
    expectedMovePct: input.expectedMovePct, lotteryTicketOptionSuspected: directional ? lotteryReasons.length === 3 : null,
    lotteryDiagnosticReasons: lotteryReasons };
}
