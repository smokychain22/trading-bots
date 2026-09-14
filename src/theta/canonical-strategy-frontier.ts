import { createHash } from 'node:crypto';
import type { JsonValue } from '../market/fusion-snapshot.js';
import type { NormalizedOptionContract } from './option-contract.js';
import type { StrategyRoutingResponse } from './strategy-router-contract.js';
import { canonicalThetaStrategySources, type ThetaStrategyBranch } from './strategy-package.js';

export const canonicalStrategyFrontierVersion = 'theta-canonical-strategy-frontier-v1' as const;

export type CanonicalFrontierAction =
  | 'OPEN_CSP' | 'OPEN_DEFINED_RISK' | 'RECOVERY_WAIT' | 'SELL_STOCK' | 'SELL_CC';

export interface CanonicalFrontierLeg {
  readonly positionIntent: 'SELL_TO_OPEN' | 'BUY_TO_OPEN';
  readonly optionSymbol: string;
  readonly optionType: 'PUT' | 'CALL';
  readonly strike: number;
  readonly expiration: string;
  readonly multiplier: number;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly quoteTimestamp: string | null;
}

export interface CanonicalFrontierEconomics {
  readonly premiumPerShare: number | null;
  readonly grossPremium: number | null;
  readonly collateral: number | null;
  readonly maxProfit: number | null;
  readonly maxLoss: number | null;
  readonly breakEven: number | null;
  readonly downsideCushion: number | null;
  readonly retainedUpside: number | null;
  readonly callAwayProceeds: number | null;
  readonly wholeChainPnlAtCallAway: number | null;
  readonly capitalDayYield: number | null;
  readonly expectedAfterCostEv: null;
}

export interface CanonicalFrontierCandidate {
  readonly candidateId: string;
  readonly branch: ThetaStrategyBranch;
  readonly action: CanonicalFrontierAction;
  readonly underlying: string;
  readonly legs: readonly CanonicalFrontierLeg[];
  readonly dte: number | null;
  readonly delta: number | null;
  readonly moneyness: number | null;
  readonly spreadPct: number | null;
  readonly liquidity: { readonly volume: number | null; readonly openInterest: number | null };
  readonly economics: CanonicalFrontierEconomics;
  readonly assignmentCapacityQty: number | null;
  readonly hardBlockers: readonly string[];
  readonly softEvidence: readonly string[];
  readonly unknownEvidence: readonly string[];
  readonly structurallyFeasible: boolean;
  readonly riskFeasible: boolean;
  readonly paretoRank: number | null;
  readonly dominatedBy: readonly string[];
  readonly executionAuthorized: false;
}

export interface CanonicalBranchFrontier {
  readonly branch: ThetaStrategyBranch;
  readonly strategyVersion: string;
  readonly status: 'RESEARCH_ONLY' | 'SHADOW';
  readonly applicable: boolean;
  readonly evaluated: boolean;
  readonly routeReasons: readonly string[];
  readonly evaluationState: 'EVALUATED' | 'NOT_APPLICABLE' | 'BLOCKED_MISSING_INPUT';
  readonly candidateCount: number;
  readonly mechanicallyRejected: number;
  readonly enumerationTruncated: boolean;
  readonly hardVetoed: number;
  readonly softRanked: number;
  readonly dataInsufficient: number;
  readonly candidates: readonly CanonicalFrontierCandidate[];
  readonly bestCandidateId: string | null;
  readonly secondBestCandidateId: string | null;
  readonly bestRejectedCandidateId: string | null;
  readonly empiricalEconomicsReady: false;
  readonly executionAuthorized: false;
}

export interface CanonicalStrategyFrontier {
  readonly contractVersion: typeof canonicalStrategyFrontierVersion;
  readonly snapshotId: string;
  readonly timestamp: string;
  readonly strategyVersion: string;
  readonly branches: readonly CanonicalBranchFrontier[];
  readonly branchesConsidered: readonly ThetaStrategyBranch[];
  readonly branchesEvaluated: readonly ThetaStrategyBranch[];
  readonly selectedBranch: ThetaStrategyBranch | null;
  readonly selectedCandidateId: string | null;
  readonly bestRejectedCandidateId: string | null;
  readonly globalWaitEarned: boolean;
  readonly globalWaitReasons: readonly string[];
  readonly empiricalEconomicsReady: false;
  readonly executionAuthorized: false;
  readonly optionomicsContext: JsonValue;
  readonly contentHash: string;
}

export interface CanonicalStrategyFrontierInput {
  readonly snapshotId: string;
  readonly timestamp: string;
  readonly strategyVersion: string;
  readonly contracts: readonly NormalizedOptionContract[];
  readonly routing: StrategyRoutingResponse | null;
  readonly stock: {
    readonly underlying: string;
    readonly shares: number;
    readonly currentPrice: number | null;
    readonly brokerCostBasisPerShare: number | null;
    readonly wholeChainEconomicBasisPerShare: number | null;
  } | null;
  readonly assignmentCapacityQty: number | null;
  readonly aegisNewRiskState: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO' | 'DEFINED_RISK_ONLY' | 'EMERGENCY_EXIT_ONLY' | null;
  readonly eventState: string | null;
  readonly unmanagedBrokerPositionCount: number;
  readonly unevaluatedUnderlyingCount: number;
  readonly optionomicsContext: JsonValue;
}

const branchOrder: readonly ThetaStrategyBranch[] = [
  'THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK', 'THETA_RECOVERY', 'THETA_CC',
];
const maxDefinedRiskStructuresPerCycle = 1_000;

const familyByBranch = {
  THETA_CONVENTIONAL: 'THETA_Q', THETA_HOLD_STRIKE: 'THETA_H', THETA_DEFINED_RISK: 'THETA_D',
  THETA_RECOVERY: 'THETA_A', THETA_CC: 'THETA_C',
} as const;

const sourceByBranch = new Map(canonicalThetaStrategySources.map((source) => [source.branch, source]));
const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = (value: unknown): string => createHash('sha256').update(stable(value)).digest('hex');

function leg(contract: NormalizedOptionContract, positionIntent: CanonicalFrontierLeg['positionIntent']): CanonicalFrontierLeg {
  return {
    positionIntent, optionSymbol: contract.optionSymbol, optionType: contract.optionType,
    strike: contract.strike, expiration: contract.expiration, multiplier: contract.multiplier,
    bid: contract.bid, ask: contract.ask, quoteTimestamp: contract.quoteTimestamp,
  };
}

function commonEvidence(contract: NormalizedOptionContract, input: CanonicalStrategyFrontierInput): {
  hardBlockers: string[]; softEvidence: string[]; unknownEvidence: string[];
} {
  const hardBlockers: string[] = [];
  const softEvidence: string[] = [];
  const unknownEvidence: string[] = [];
  if (contract.occSymbol === null) hardBlockers.push('OCC_IDENTITY_UNKNOWN');
  if (!contract.executable) hardBlockers.push(`EXECUTION_QUOTE_NOT_QUALIFIED:${contract.nonExecutableReason ?? 'UNKNOWN'}`);
  if (input.aegisNewRiskState === null) unknownEvidence.push('AEGIS_STATE_UNKNOWN');
  else if (['HOLD_ONLY', 'HARD_VETO', 'EMERGENCY_EXIT_ONLY'].includes(input.aegisNewRiskState)) hardBlockers.push(`AEGIS_${input.aegisNewRiskState}`);
  if (input.eventState === null) unknownEvidence.push('EVENT_STATE_UNKNOWN');
  else softEvidence.push(`EVENT_STATE:${input.eventState}`);
  if (contract.iv === null) unknownEvidence.push('IV_UNKNOWN');
  if (contract.delta === null) unknownEvidence.push('DELTA_UNKNOWN');
  if (contract.openInterest === null) unknownEvidence.push('OPEN_INTEREST_UNKNOWN');
  if (contract.volume === null) unknownEvidence.push('VOLUME_UNKNOWN');
  return { hardBlockers, softEvidence, unknownEvidence };
}

function singleLegPutCandidate(branch: 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE', contract: NormalizedOptionContract,
  input: CanonicalStrategyFrontierInput): CanonicalFrontierCandidate {
  const evidence = commonEvidence(contract, input);
  if (input.aegisNewRiskState === 'DEFINED_RISK_ONLY') evidence.hardBlockers.push('AEGIS_DEFINED_RISK_ONLY');
  const premium = finite(contract.bid) ? contract.bid : null;
  const collateral = contract.strike * contract.multiplier;
  if (input.assignmentCapacityQty === null) evidence.unknownEvidence.push('ASSIGNMENT_CAPACITY_UNKNOWN');
  else if (input.assignmentCapacityQty <= 0) evidence.hardBlockers.push('NO_ASSIGNMENT_CAPACITY');
  const cushion = finite(contract.underlyingReferencePrice) && finite(contract.breakEven) && contract.underlyingReferencePrice > 0
    ? (contract.underlyingReferencePrice - contract.breakEven) / contract.underlyingReferencePrice : null;
  return {
    candidateId: `${branch}:${contract.optionSymbol}`, branch, action: 'OPEN_CSP', underlying: contract.underlying,
    legs: [leg(contract, 'SELL_TO_OPEN')], dte: contract.dte, delta: contract.delta, moneyness: contract.moneyness,
    spreadPct: contract.spreadPct, liquidity: { volume: contract.volume, openInterest: contract.openInterest },
    economics: {
      premiumPerShare: premium, grossPremium: premium === null ? null : premium * contract.multiplier,
      collateral, maxProfit: premium === null ? null : premium * contract.multiplier, maxLoss: null,
      breakEven: contract.breakEven, downsideCushion: cushion, retainedUpside: null, callAwayProceeds: null,
      wholeChainPnlAtCallAway: null, capitalDayYield: premium === null || contract.dte <= 0 ? null : premium * contract.multiplier / (collateral * contract.dte),
      expectedAfterCostEv: null,
    },
    assignmentCapacityQty: input.assignmentCapacityQty, ...evidence,
    structurallyFeasible: evidence.hardBlockers.length === 0, riskFeasible: evidence.hardBlockers.length === 0,
    paretoRank: null, dominatedBy: [], executionAuthorized: false,
  };
}

function definedRiskCandidate(shortPut: NormalizedOptionContract, longPut: NormalizedOptionContract,
  input: CanonicalStrategyFrontierInput): CanonicalFrontierCandidate {
  const shortEvidence = commonEvidence(shortPut, input);
  const longEvidence = commonEvidence(longPut, input);
  const hardBlockers = [...shortEvidence.hardBlockers, ...longEvidence.hardBlockers];
  const width = shortPut.strike - longPut.strike;
  const netCredit = finite(shortPut.bid) && finite(longPut.ask) ? shortPut.bid - longPut.ask : null;
  if (!(width > 0)) hardBlockers.push('INVALID_SPREAD_WIDTH');
  if (shortPut.expiration !== longPut.expiration) hardBlockers.push('MISMATCHED_EXPIRATION');
  if (shortPut.multiplier !== longPut.multiplier) hardBlockers.push('MISMATCHED_MULTIPLIER');
  if (netCredit === null) hardBlockers.push('MULTI_LEG_PRICE_UNKNOWN');
  else if (netCredit <= 0) hardBlockers.push('NON_POSITIVE_NET_CREDIT');
  const multiplier = shortPut.multiplier;
  const maxProfit = netCredit === null ? null : netCredit * multiplier;
  const maxLoss = netCredit === null ? null : (width - netCredit) * multiplier;
  return {
    candidateId: `THETA_DEFINED_RISK:${shortPut.optionSymbol}:${longPut.optionSymbol}`,
    branch: 'THETA_DEFINED_RISK', action: 'OPEN_DEFINED_RISK', underlying: shortPut.underlying,
    legs: [leg(shortPut, 'SELL_TO_OPEN'), leg(longPut, 'BUY_TO_OPEN')], dte: shortPut.dte,
    delta: shortPut.delta, moneyness: shortPut.moneyness,
    spreadPct: finite(shortPut.spreadPct) && finite(longPut.spreadPct) ? shortPut.spreadPct + longPut.spreadPct : null,
    liquidity: {
      volume: finite(shortPut.volume) && finite(longPut.volume) ? Math.min(shortPut.volume, longPut.volume) : null,
      openInterest: finite(shortPut.openInterest) && finite(longPut.openInterest) ? Math.min(shortPut.openInterest, longPut.openInterest) : null,
    },
    economics: {
      premiumPerShare: netCredit, grossPremium: maxProfit, collateral: maxLoss, maxProfit, maxLoss,
      breakEven: netCredit === null ? null : shortPut.strike - netCredit, downsideCushion: null,
      retainedUpside: null, callAwayProceeds: null, wholeChainPnlAtCallAway: null,
      capitalDayYield: maxProfit === null || maxLoss === null || maxLoss <= 0 || shortPut.dte <= 0 ? null : maxProfit / (maxLoss * shortPut.dte),
      expectedAfterCostEv: null,
    },
    assignmentCapacityQty: null, hardBlockers: [...new Set(hardBlockers)],
    softEvidence: [...new Set([...shortEvidence.softEvidence, ...longEvidence.softEvidence])],
    unknownEvidence: [...new Set([...shortEvidence.unknownEvidence, ...longEvidence.unknownEvidence])],
    structurallyFeasible: hardBlockers.length === 0, riskFeasible: hardBlockers.length === 0,
    paretoRank: null, dominatedBy: [], executionAuthorized: false,
  };
}

function stockActionCandidate(action: 'RECOVERY_WAIT' | 'SELL_STOCK', input: CanonicalStrategyFrontierInput): CanonicalFrontierCandidate {
  const stock = input.stock as NonNullable<CanonicalStrategyFrontierInput['stock']>;
  const hardBlockers: string[] = stock.shares <= 0 ? ['NO_CONFIRMED_STOCK_INVENTORY'] : [];
  const unknownEvidence: string[] = [];
  if (stock.currentPrice === null) unknownEvidence.push('STOCK_MARK_UNKNOWN');
  if (stock.brokerCostBasisPerShare === null) unknownEvidence.push('BROKER_COST_BASIS_UNKNOWN');
  if (stock.wholeChainEconomicBasisPerShare === null) unknownEvidence.push('WHOLE_CHAIN_ECONOMIC_BASIS_UNKNOWN');
  if (input.eventState === null) unknownEvidence.push('EVENT_STATE_UNKNOWN');
  if (action === 'SELL_STOCK' && stock.currentPrice === null) hardBlockers.push('EXECUTABLE_STOCK_PRICE_UNKNOWN');
  return {
    candidateId: `THETA_RECOVERY:${stock.underlying}:${action}`, branch: 'THETA_RECOVERY', action,
    underlying: stock.underlying, legs: [], dte: null, delta: null, moneyness: null, spreadPct: null,
    liquidity: { volume: null, openInterest: null },
    economics: {
      premiumPerShare: null, grossPremium: null, collateral: null, maxProfit: null, maxLoss: null, breakEven: null,
      downsideCushion: null, retainedUpside: null, callAwayProceeds: null, wholeChainPnlAtCallAway: null,
      capitalDayYield: null, expectedAfterCostEv: null,
    },
    assignmentCapacityQty: null, hardBlockers, softEvidence: [`OWNERSHIP_STATE:STOCK_HELD`, `ACTION:${action}`], unknownEvidence,
    structurallyFeasible: hardBlockers.length === 0, riskFeasible: hardBlockers.length === 0,
    paretoRank: null, dominatedBy: [], executionAuthorized: false,
  };
}

function coveredCallCandidate(contract: NormalizedOptionContract, input: CanonicalStrategyFrontierInput): CanonicalFrontierCandidate {
  const stock = input.stock as NonNullable<CanonicalStrategyFrontierInput['stock']>;
  const evidence = commonEvidence(contract, input);
  if (input.aegisNewRiskState === 'DEFINED_RISK_ONLY') evidence.hardBlockers.push('AEGIS_DEFINED_RISK_ONLY');
  const coveredQty = Math.floor(stock.shares / contract.multiplier);
  if (coveredQty <= 0) evidence.hardBlockers.push('INSUFFICIENT_COVERED_SHARES');
  const premium = finite(contract.bid) ? contract.bid : null;
  const retainedUpside = stock.currentPrice === null ? null : (contract.strike - stock.currentPrice) * contract.multiplier;
  const callAwayProceeds = contract.strike * contract.multiplier;
  const chainPnlAtCallAway = stock.wholeChainEconomicBasisPerShare === null ? null
    : (contract.strike - stock.wholeChainEconomicBasisPerShare + (premium ?? 0)) * contract.multiplier;
  return {
    candidateId: `THETA_CC:${contract.optionSymbol}`, branch: 'THETA_CC', action: 'SELL_CC', underlying: contract.underlying,
    legs: [leg(contract, 'SELL_TO_OPEN')], dte: contract.dte, delta: contract.delta, moneyness: contract.moneyness,
    spreadPct: contract.spreadPct, liquidity: { volume: contract.volume, openInterest: contract.openInterest },
    economics: {
      premiumPerShare: premium, grossPremium: premium === null ? null : premium * contract.multiplier,
      collateral: 0, maxProfit: null, maxLoss: null, breakEven: null, downsideCushion: null,
      retainedUpside, callAwayProceeds, wholeChainPnlAtCallAway: chainPnlAtCallAway,
      capitalDayYield: null, expectedAfterCostEv: null,
    },
    assignmentCapacityQty: coveredQty, ...evidence,
    structurallyFeasible: evidence.hardBlockers.length === 0, riskFeasible: evidence.hardBlockers.length === 0,
    paretoRank: null, dominatedBy: [], executionAuthorized: false,
  };
}

type Objective = { readonly value: number | null; readonly direction: 'MAX' | 'MIN' };
function objectives(candidate: CanonicalFrontierCandidate): readonly Objective[] {
  return [
    { value: candidate.economics.grossPremium, direction: 'MAX' },
    { value: candidate.economics.collateral, direction: 'MIN' },
    { value: candidate.spreadPct, direction: 'MIN' },
    { value: candidate.economics.downsideCushion, direction: 'MAX' },
    { value: candidate.economics.retainedUpside, direction: 'MAX' },
  ];
}

function dominates(left: CanonicalFrontierCandidate, right: CanonicalFrontierCandidate): boolean {
  const rightObjectives = objectives(right);
  const pairs = objectives(left).flatMap((item, index) => {
    const other = rightObjectives[index];
    return other === undefined || !finite(item.value) || !finite(other.value) ? [] : [[item, other] as const];
  });
  if (pairs.length === 0) return false;
  const noWorse = pairs.every(([a, b]) => a.direction === 'MAX' ? (a.value as number) >= (b.value as number) : (a.value as number) <= (b.value as number));
  const better = pairs.some(([a, b]) => a.direction === 'MAX' ? (a.value as number) > (b.value as number) : (a.value as number) < (b.value as number));
  return noWorse && better;
}

function rankCandidates(candidates: readonly CanonicalFrontierCandidate[]): readonly CanonicalFrontierCandidate[] {
  const feasible = candidates.filter((candidate) => candidate.riskFeasible);
  return candidates.map((candidate) => {
    if (!candidate.riskFeasible) return candidate;
    const dominatedBy = feasible.filter((other) => other.candidateId !== candidate.candidateId && dominates(other, candidate))
      .map((other) => other.candidateId).toSorted();
    return { ...candidate, paretoRank: dominatedBy.length + 1, dominatedBy };
  }).toSorted((a, b) => (a.paretoRank ?? Number.MAX_SAFE_INTEGER) - (b.paretoRank ?? Number.MAX_SAFE_INTEGER)
    || a.unknownEvidence.length - b.unknownEvidence.length || a.candidateId.localeCompare(b.candidateId));
}

function buildBranch(branch: ThetaStrategyBranch, input: CanonicalStrategyFrontierInput): CanonicalBranchFrontier {
  const source = sourceByBranch.get(branch);
  if (source === undefined) throw new Error(`CANONICAL_STRATEGY_SOURCE_MISSING:${branch}`);
  const route = input.routing?.results.find((result) => result.strategyFamily === familyByBranch[branch]) ?? null;
  const stockApplicable = (branch === 'THETA_RECOVERY' || branch === 'THETA_CC') && input.stock !== null && input.stock.shares > 0;
  const applicable = stockApplicable || route?.eligible === true;
  const routeReasons = route?.reasons.map((reason) => reason.code) ?? (input.routing === null ? ['ROUTER_RESULT_UNKNOWN'] : ['ROUTER_FAMILY_MISSING']);
  if (!applicable) return {
    branch, strategyVersion: source.strategyVersion, status: source.status as 'RESEARCH_ONLY' | 'SHADOW', applicable: false,
    evaluated: true, routeReasons, evaluationState: 'NOT_APPLICABLE', candidateCount: 0, mechanicallyRejected: 0, enumerationTruncated: false,
    hardVetoed: 0, softRanked: 0, dataInsufficient: 0, candidates: [], bestCandidateId: null,
    secondBestCandidateId: null, bestRejectedCandidateId: null, empiricalEconomicsReady: false, executionAuthorized: false,
  };

  let raw: CanonicalFrontierCandidate[] = [];
  let enumerationTruncated = false;
  if (branch === 'THETA_CONVENTIONAL' || branch === 'THETA_HOLD_STRIKE') {
    raw = input.contracts.filter((contract) => contract.optionType === 'PUT' && contract.dte >= source.lattice.dteMin && contract.dte <= source.lattice.dteMax)
      .map((contract) => singleLegPutCandidate(branch, contract, input));
  } else if (branch === 'THETA_DEFINED_RISK') {
    const puts = input.contracts.filter((contract) => contract.optionType === 'PUT' && contract.dte >= source.lattice.dteMin && contract.dte <= source.lattice.dteMax);
    outer: for (const shortPut of puts) for (const longPut of puts) {
      if (shortPut.expiration === longPut.expiration && longPut.strike < shortPut.strike) {
        if (raw.length >= maxDefinedRiskStructuresPerCycle) { enumerationTruncated = true; break outer; }
        raw.push(definedRiskCandidate(shortPut, longPut, input));
      }
    }
  } else if (branch === 'THETA_RECOVERY' && input.stock !== null) {
    const ccAlternatives = input.contracts.filter((contract) => contract.optionType === 'CALL' && contract.dte >= 1 && contract.dte <= 60)
      .map((contract) => {
        const candidate = coveredCallCandidate(contract, input);
        return { ...candidate, candidateId: `THETA_RECOVERY:${contract.optionSymbol}:SELL_CC`,
          branch: 'THETA_RECOVERY' as const, action: 'SELL_CC' as const };
      });
    raw = [stockActionCandidate('RECOVERY_WAIT', input), stockActionCandidate('SELL_STOCK', input), ...ccAlternatives];
  } else if (branch === 'THETA_CC' && input.stock !== null) {
    raw = input.contracts.filter((contract) => contract.optionType === 'CALL' && contract.dte >= source.lattice.dteMin && contract.dte <= source.lattice.dteMax)
      .map((contract) => coveredCallCandidate(contract, input));
  }
  const candidates = rankCandidates(raw);
  const feasible = candidates.filter((candidate) => candidate.riskFeasible);
  const rejected = candidates.filter((candidate) => !candidate.riskFeasible);
  return {
    branch, strategyVersion: source.strategyVersion, status: source.status as 'RESEARCH_ONLY' | 'SHADOW', applicable: true,
    evaluated: true, routeReasons: [...routeReasons, ...(enumerationTruncated ? ['DEFINED_RISK_ENUMERATION_BOUND_REACHED'] : [])],
    evaluationState: candidates.length === 0 || enumerationTruncated ? 'BLOCKED_MISSING_INPUT' : 'EVALUATED',
    candidateCount: candidates.length, mechanicallyRejected: 0, enumerationTruncated, hardVetoed: rejected.length,
    softRanked: feasible.length, dataInsufficient: candidates.filter((candidate) => candidate.unknownEvidence.length > 0).length,
    candidates, bestCandidateId: feasible[0]?.candidateId ?? null, secondBestCandidateId: feasible[1]?.candidateId ?? null,
    bestRejectedCandidateId: rejected[0]?.candidateId ?? null, empiricalEconomicsReady: false, executionAuthorized: false,
  };
}

export function buildCanonicalStrategyFrontier(input: CanonicalStrategyFrontierInput): CanonicalStrategyFrontier {
  const branches = branchOrder.map((branch) => buildBranch(branch, input));
  const applicable = branches.filter((branch) => branch.applicable);
  const evaluated = applicable.filter((branch) => branch.evaluated && branch.evaluationState !== 'BLOCKED_MISSING_INPUT');
  const feasible = branches.flatMap((branch) => branch.candidates).filter((candidate) => candidate.riskFeasible)
    .toSorted((a, b) => (a.paretoRank ?? Number.MAX_SAFE_INTEGER) - (b.paretoRank ?? Number.MAX_SAFE_INTEGER)
      || a.unknownEvidence.length - b.unknownEvidence.length || a.candidateId.localeCompare(b.candidateId));
  const blockedApplicable = applicable.filter((branch) => branch.evaluationState === 'BLOCKED_MISSING_INPUT');
  const feasibleBranches = [...new Set(feasible.map((candidate) => candidate.branch))];
  const structuralSelection = feasibleBranches.length === 1 ? feasible[0] ?? null : null;
  const managementIncomplete = input.unmanagedBrokerPositionCount > 0;
  const universeIncomplete = input.unevaluatedUnderlyingCount > 0;
  const globalWaitEarned = applicable.length > 0 && blockedApplicable.length === 0 && !managementIncomplete && !universeIncomplete && feasible.length === 0;
  const partial = {
    contractVersion: canonicalStrategyFrontierVersion, snapshotId: input.snapshotId, timestamp: input.timestamp,
    strategyVersion: input.strategyVersion, branches, branchesConsidered: applicable.map((branch) => branch.branch),
    branchesEvaluated: evaluated.map((branch) => branch.branch), selectedBranch: structuralSelection?.branch ?? null,
    selectedCandidateId: structuralSelection?.candidateId ?? null,
    bestRejectedCandidateId: branches.map((branch) => branch.bestRejectedCandidateId).find((id) => id !== null) ?? null,
    globalWaitEarned, globalWaitReasons: globalWaitEarned ? ['ALL_APPLICABLE_BRANCHES_EVALUATED', 'NO_RISK_FEASIBLE_ACTION']
      : [...blockedApplicable.map((branch) => `BRANCH_NOT_FULLY_EVALUATED:${branch.branch}`),
          ...(managementIncomplete ? ['OPEN_POSITION_MANAGEMENT_NOT_ATTACHED'] : []),
          ...(universeIncomplete ? [`UNDERLYINGS_NOT_EVALUATED:${input.unevaluatedUnderlyingCount}`] : [])],
    empiricalEconomicsReady: false as const, executionAuthorized: false as const, optionomicsContext: input.optionomicsContext,
  };
  return { ...partial, contentHash: digest(partial) };
}
