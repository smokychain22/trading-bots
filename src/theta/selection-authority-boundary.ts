import { assessEmpiricalPolicyPromotion } from './empirical-policy-promotion.js';

export const selectionAuthorityBoundaryVersion = 'theta-selection-authority-boundary-v1' as const;
export type SelectionAuthorityMode = 'STRUCTURAL_SAFE_FALLBACK' | 'EMPIRICAL_SHADOW' | 'EMPIRICAL_PROMOTED';

export interface SelectionAuthorityBoundary {
  readonly version: typeof selectionAuthorityBoundaryVersion;
  readonly activeMode: 'STRUCTURAL_SAFE_FALLBACK';
  readonly shadowMode: 'EMPIRICAL_SHADOW';
  readonly promotedModeAvailable: false;
  readonly sovereignAuthority: 'CANONICAL_DECISION_AUTHORITY';
  readonly brokerAuthority: false;
  readonly blockers: readonly string[];
}

/**
 * The deterministic structural frontier is the only active selector. Research
 * utility may be recorded as shadow evidence, but this release has no code path
 * that can activate an empirical selector or create a second authority.
 */
export function resolveSelectionAuthorityBoundary(empiricalPromotionReceipt?: unknown): SelectionAuthorityBoundary {
  const assessment = empiricalPromotionReceipt === undefined ? null : assessEmpiricalPolicyPromotion(empiricalPromotionReceipt);
  const blockers = assessment === null ? ['EMPIRICAL_PROMOTION_RECEIPT_NOT_SUPPLIED']
    : assessment.blockers.length > 0 ? assessment.blockers
      : ['EMPIRICAL_ACTIVATION_NOT_IMPLEMENTED', 'OWNER_ACTIVATION_REQUIRED'];
  return {
    version: selectionAuthorityBoundaryVersion,
    activeMode: 'STRUCTURAL_SAFE_FALLBACK',
    shadowMode: 'EMPIRICAL_SHADOW',
    promotedModeAvailable: false,
    sovereignAuthority: 'CANONICAL_DECISION_AUTHORITY',
    brokerAuthority: false,
    blockers,
  };
}
