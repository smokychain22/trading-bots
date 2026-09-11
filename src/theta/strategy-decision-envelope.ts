import type { NewRiskDecisionReceipt } from './decision-assembly.js';
import type { ThetaStrategyBranch } from './strategy-package.js';

export const strategyDecisionEnvelopeVersion = 'theta-strategy-decision-envelope-v1' as const;

export interface StrategyDecisionEnvelope {
  readonly contractVersion: typeof strategyDecisionEnvelopeVersion;
  readonly strategyVersionId: string;
  readonly strategyBranch: ThetaStrategyBranch;
  readonly receipt: NewRiskDecisionReceipt;
  readonly selectedAction: NewRiskDecisionReceipt['winningAction'];
  readonly selectedCandidateId: string | null;
  readonly consideredAlternatives: NewRiskDecisionReceipt['alternatives'];
  readonly secondBestCandidateId: string | null;
  readonly hardBlockers: readonly string[];
  readonly softEvidence: readonly string[];
  readonly economics: { readonly evNet: number | null; readonly returnPerCapitalDay: number | null };
  readonly risk: { readonly aegisState: string | null; readonly quantity: number };
  readonly uncertainty: number | null;
  readonly invalidationConditions: readonly string[];
  readonly nextReevaluationTriggers: readonly string[];
  readonly globalWaitEvidence: null;
  readonly executionAuthorized: false;
}

const openAction = (action: NewRiskDecisionReceipt['winningAction']): boolean => action.startsWith('OPEN_');

export function buildStrategyDecisionEnvelope(input: {
  readonly strategyVersionId: string;
  readonly strategyBranch: ThetaStrategyBranch;
  readonly receipt: NewRiskDecisionReceipt;
}): StrategyDecisionEnvelope {
  const selected = input.receipt.selectedCandidateId === null ? null
    : input.receipt.alternatives.find((alternative) => alternative.candidateId === input.receipt.selectedCandidateId) ?? null;
  const rankedKnown = input.receipt.alternatives.filter((alternative) => alternative.returnPerCapitalDay !== null)
    .sort((a, b) => (b.returnPerCapitalDay as number) - (a.returnPerCapitalDay as number)
      || a.candidateId.localeCompare(b.candidateId));
  const secondBestCandidateId = rankedKnown.find((candidate) => candidate.candidateId !== input.receipt.selectedCandidateId)?.candidateId ?? null;
  const hardBlockers = input.receipt.failClosedReason === null ? [] : [...input.receipt.reasonCodes];
  const invalidationConditions = openAction(input.receipt.winningAction) ? [
    'BROKER_OR_QUOTE_STATE_NO_LONGER_GOOD', 'OWNERSHIP_THESIS_DETERIORATES', 'EVENT_STATE_CHANGES',
    'AEGIS_STATE_TIGHTENS', 'ASSIGNMENT_CAPACITY_CHANGES', 'LIFECYCLE_STATE_CHANGES',
  ] : ['REQUIRED_DATA_BECOMES_GOOD', 'MARKET_SESSION_CHANGES', 'LIFECYCLE_STATE_CHANGES', 'STRATEGY_VERSION_CHANGES'];
  return {
    contractVersion: strategyDecisionEnvelopeVersion,
    strategyVersionId: input.strategyVersionId,
    strategyBranch: input.strategyBranch,
    receipt: input.receipt,
    selectedAction: input.receipt.winningAction,
    selectedCandidateId: input.receipt.selectedCandidateId,
    consideredAlternatives: input.receipt.alternatives,
    secondBestCandidateId,
    hardBlockers,
    softEvidence: [],
    economics: { evNet: selected?.evNet ?? null, returnPerCapitalDay: selected?.returnPerCapitalDay ?? null },
    risk: { aegisState: selected?.aegisState ?? null, quantity: input.receipt.quantity },
    uncertainty: null,
    invalidationConditions,
    nextReevaluationTriggers: ['NEXT_SCHEDULED_CYCLE', 'BROKER_ACTIVITY', 'MARKET_SESSION_TRANSITION', 'DATA_FRESHNESS_CHANGE'],
    globalWaitEvidence: null,
    executionAuthorized: false,
  };
}
