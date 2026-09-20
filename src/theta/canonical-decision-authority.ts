import type { NewRiskDecisionReceipt } from './decision-assembly.js';
import type { CanonicalStrategyFrontier, CanonicalFrontierAction } from './canonical-strategy-frontier.js';
import type { ThetaStrategyBranch } from './strategy-package.js';

export const unavailableCanonicalDecisionAuthorityVersion = 'theta-canonical-decision-authority-unavailable-v1' as const;

export interface ResolvedCanonicalDecisionAuthority {
  readonly selectedCandidateRef: string | null;
  readonly actionCode: CanonicalFrontierAction | 'GLOBAL_WAIT' | 'MANAGEMENT_AUTHORITY' | 'SYSTEM_HOLD';
  readonly quantity: number;
  readonly strategyBranch: ThetaStrategyBranch | null;
  readonly decisionAuthorityVersion: string;
  readonly reasonCodes: readonly string[];
  readonly subordinateReceipt: NewRiskDecisionReceipt;
}

/**
 * Establishes one sovereign selection boundary. NewRiskDecisionReceipt is
 * retained as candidate/economics evidence only. It never supplies the
 * selected candidate, action, or quantity when the canonical frontier is
 * missing, stale, or otherwise unavailable.
 */
export function resolveCanonicalDecisionAuthority(
  frontier: CanonicalStrategyFrontier | null | undefined,
  subordinateReceipt: NewRiskDecisionReceipt,
): ResolvedCanonicalDecisionAuthority {
  if (frontier == null) {
    return {
      selectedCandidateRef: null,
      actionCode: 'SYSTEM_HOLD',
      quantity: 0,
      strategyBranch: null,
      decisionAuthorityVersion: unavailableCanonicalDecisionAuthorityVersion,
      reasonCodes: ['CANONICAL_DECISION_AUTHORITY_UNAVAILABLE'],
      subordinateReceipt,
    };
  }
  return {
    selectedCandidateRef: frontier.selectedCandidateId,
    actionCode: frontier.primaryAction,
    quantity: frontier.selectedQuantity,
    strategyBranch: frontier.selectedBranch,
    decisionAuthorityVersion: frontier.decisionAuthorityVersion,
    reasonCodes: frontier.globalWaitEarned ? frontier.globalWaitReasons
      : frontier.primaryAction === 'MANAGEMENT_AUTHORITY' ? ['MANAGEMENT_FIRST']
        : frontier.selectedCandidateId === null ? ['CANONICAL_STRUCTURAL_SELECTION_UNAVAILABLE']
          : ['CANONICAL_STRUCTURAL_SELECTION'],
    subordinateReceipt,
  };
}
