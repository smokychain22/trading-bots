import type { CanonicalFrontierCandidate, CanonicalStrategyFrontier } from './canonical-strategy-frontier.js';
import type { QEntryFunnelSummary } from './q-entry-funnel.js';

export const decisionExplanationVersion='theta-decision-explanation-v1' as const;
export interface DecisionExplanationInput {readonly action:string;readonly feasibleAlternatives:readonly string[];
  readonly infeasibleAlternatives:readonly {action:string;reason:string}[];readonly reasonCodes:readonly string[];
  readonly requiredMissingFields:readonly string[];readonly optionalMissingFields:readonly string[];readonly sessionState:string;
  readonly timeState:string;readonly positionPath:string|null;readonly strategyApplicability:string;readonly providerEvidence:string;
  readonly riskOfAction:string;readonly riskOfInaction:string;readonly quoteAuthorityStatus:string;readonly policyStatus:string;}
export function assembleDecisionExplanation(input:DecisionExplanationInput){
  const classification=input.action==='WAIT'?'WHY_WAIT':input.action==='HOLD'||input.action==='HOLD_CC'?'WHY_HOLD':'WHY_ACTION';
  return {version:decisionExplanationVersion,classification,selectedAction:input.action,
    feasibleAlternatives:[...new Set(input.feasibleAlternatives)].sort(),infeasibleAlternatives:[...input.infeasibleAlternatives]
      .sort((a,b)=>a.action.localeCompare(b.action)),reasonCodes:[...new Set(input.reasonCodes)].sort(),
    requiredMissingFields:[...new Set(input.requiredMissingFields)].sort(),optionalMissingFields:[...new Set(input.optionalMissingFields)].sort(),
    sessionState:input.sessionState,timeState:input.timeState,positionPath:input.positionPath,
    strategyApplicability:input.strategyApplicability,providerEvidence:input.providerEvidence,riskOfAction:input.riskOfAction,
    riskOfInaction:input.riskOfInaction,quoteAuthorityStatus:input.quoteAuthorityStatus,policyStatus:input.policyStatus,
    executionAuthorized:false as const};
}

export const canonicalDecisionExplanationVersion = 'theta-canonical-decision-explanation-v2' as const;

export interface CanonicalDecisionExplanation {
  readonly contractVersion: typeof canonicalDecisionExplanationVersion;
  readonly snapshotId: string | null;
  readonly decisionAt: string | null;
  readonly action: string;
  readonly whyUnderlying: {
    readonly underlying: string | null;
    readonly state: 'SELECTED' | 'WAIT' | 'NOT_REACHED';
    readonly reasons: readonly string[];
  };
  readonly whyStrategy: {
    readonly branch: string | null;
    readonly selectionBasis: string | null;
    readonly reasons: readonly string[];
  };
  readonly whyExpiry: {
    readonly expiration: string | null;
    readonly dte: number | null;
    readonly reasons: readonly string[];
  };
  readonly whyStrike: {
    readonly strike: number | null;
    readonly delta: number | null;
    readonly moneyness: number | null;
    readonly breakeven: number | null;
    readonly reasons: readonly string[];
  };
  readonly whyNow: {
    readonly quoteTimestamp: string | null;
    readonly aegisState: string | null;
    readonly eventEvidence: readonly string[];
    readonly waitReasons: readonly string[];
  };
  readonly whySize: {
    readonly quantity: number | null;
    readonly bindingConstraint: string | null;
    readonly caps: readonly { readonly name: string; readonly value: number | null; readonly state: string }[];
    readonly reasons: readonly string[];
  };
  readonly alternatives: {
    readonly secondBestCandidateId: string | null;
    readonly nearMissCandidateId: string | null;
    readonly bestRejectedCandidateId: string | null;
    readonly branchesConsidered: readonly string[];
    readonly branchesEvaluated: readonly string[];
  };
  readonly funnel: {
    readonly fullReceiptHash: string | null;
    readonly dominantBlocker: string | null;
    readonly extinctionStage: string | null;
    readonly terminalReasonCounts: Readonly<Record<string, number>>;
  };
  readonly empiricalUtilityState: 'UNKNOWN_NOT_YET_CALIBRATED' | 'NOT_REACHED';
  readonly executionAuthorized: false;
}

function selectedCandidate(frontier: CanonicalStrategyFrontier): CanonicalFrontierCandidate | null {
  if (frontier.selectedCandidateId === null) return null;
  return frontier.branches.flatMap((branch) => branch.candidates)
    .find((candidate) => candidate.candidateId === frontier.selectedCandidateId) ?? null;
}

/**
 * Produces one structured explanation from the canonical frontier that made
 * the decision. It does not rank again, infer missing evidence, or authorize
 * execution. A WAIT explanation preserves the exact canonical wait reasons.
 */
export function buildCanonicalDecisionExplanation(input: {
  readonly frontier: CanonicalStrategyFrontier | null;
  readonly qEntryFunnel: QEntryFunnelSummary | null;
}): CanonicalDecisionExplanation {
  const frontier = input.frontier;
  if (frontier === null) return {
    contractVersion: canonicalDecisionExplanationVersion,
    snapshotId: null, decisionAt: null, action: 'SYSTEM_HOLD',
    whyUnderlying: { underlying: null, state: 'NOT_REACHED', reasons: ['CANONICAL_FRONTIER_NOT_REACHED'] },
    whyStrategy: { branch: null, selectionBasis: null, reasons: ['CANONICAL_FRONTIER_NOT_REACHED'] },
    whyExpiry: { expiration: null, dte: null, reasons: ['CANDIDATE_NOT_SELECTED'] },
    whyStrike: { strike: null, delta: null, moneyness: null, breakeven: null, reasons: ['CANDIDATE_NOT_SELECTED'] },
    whyNow: { quoteTimestamp: null, aegisState: null, eventEvidence: [], waitReasons: ['CANONICAL_FRONTIER_NOT_REACHED'] },
    whySize: { quantity: null, bindingConstraint: null, caps: [], reasons: ['SIZING_NOT_REACHED'] },
    alternatives: { secondBestCandidateId: null, nearMissCandidateId: null, bestRejectedCandidateId: null,
      branchesConsidered: [], branchesEvaluated: [] },
    funnel: { fullReceiptHash: input.qEntryFunnel?.fullReceiptHash ?? null,
      dominantBlocker: input.qEntryFunnel?.dominantBlocker ?? null,
      extinctionStage: input.qEntryFunnel?.extinctionStage ?? null,
      terminalReasonCounts: input.qEntryFunnel?.terminalReasonCounts ?? {} },
    empiricalUtilityState: 'NOT_REACHED', executionAuthorized: false,
  };
  const candidate = selectedCandidate(frontier);
  const selectedBranch = frontier.branches.find((branch) => branch.branch === frontier.selectedBranch) ?? null;
  const leg = candidate?.legs[0] ?? null;
  const eventEvidence = candidate?.softEvidence.filter((reason) => reason.startsWith('EVENT_STATE:')) ?? [];
  const branchReasons = selectedBranch === null
    ? frontier.globalWaitReasons
    : [...selectedBranch.routeReasons, ...(candidate?.hardBlockers ?? []), ...(candidate?.unknownEvidence ?? [])];
  return {
    contractVersion: canonicalDecisionExplanationVersion,
    snapshotId: frontier.snapshotId, decisionAt: frontier.timestamp, action: frontier.primaryAction,
    whyUnderlying: {
      underlying: candidate?.underlying ?? null,
      state: candidate === null ? 'WAIT' : 'SELECTED',
      reasons: candidate === null ? frontier.globalWaitReasons : ['CANONICAL_FRONTIER_SELECTED', ...candidate.softEvidence],
    },
    whyStrategy: {
      branch: frontier.selectedBranch,
      selectionBasis: frontier.entrySelectionBasis ?? null,
      reasons: [...new Set(branchReasons)].sort(),
    },
    whyExpiry: {
      expiration: leg?.expiration ?? null, dte: candidate?.dte ?? null,
      reasons: candidate === null ? ['CANDIDATE_NOT_SELECTED']
        : [`PARETO_RANK:${candidate.paretoRank ?? 'UNKNOWN'}`, `DOMINATED_BY:${candidate.dominatedBy.length}`],
    },
    whyStrike: {
      strike: leg?.strike ?? null, delta: candidate?.delta ?? null, moneyness: candidate?.moneyness ?? null,
      breakeven: candidate?.economics.breakEven ?? null,
      reasons: candidate === null ? ['CANDIDATE_NOT_SELECTED']
        : [`STRUCTURALLY_FEASIBLE:${candidate.structurallyFeasible}`, `RISK_FEASIBLE:${candidate.riskFeasible}`],
    },
    whyNow: {
      quoteTimestamp: leg?.quoteTimestamp ?? null, aegisState: candidate?.aegisState ?? null,
      eventEvidence, waitReasons: frontier.globalWaitReasons,
    },
    whySize: {
      quantity: candidate?.sizing.quantity ?? frontier.selectedQuantity,
      bindingConstraint: candidate?.sizing.bindingConstraint ?? null,
      caps: candidate?.sizing.waterfall?.caps.map((cap) => ({ ...cap })) ?? [],
      reasons: candidate?.sizing.reasons ?? (frontier.selectedQuantity === 0 ? ['NO_SELECTED_POSITIVE_QUANTITY'] : []),
    },
    alternatives: {
      secondBestCandidateId: frontier.secondBestCandidateId,
      nearMissCandidateId: frontier.nearMissCandidateId,
      bestRejectedCandidateId: frontier.bestRejectedCandidateId,
      branchesConsidered: frontier.branchesConsidered,
      branchesEvaluated: frontier.branchesEvaluated,
    },
    funnel: {
      fullReceiptHash: input.qEntryFunnel?.fullReceiptHash ?? null,
      dominantBlocker: input.qEntryFunnel?.dominantBlocker ?? null,
      extinctionStage: input.qEntryFunnel?.extinctionStage ?? null,
      terminalReasonCounts: input.qEntryFunnel?.terminalReasonCounts ?? {},
    },
    empiricalUtilityState: frontier.empiricalUtilityState,
    executionAuthorized: false,
  };
}
