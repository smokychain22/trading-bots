/**
 * COMMAND 4 item 7 / COMMAND 3 correction 7. Realized return-to-go builder
 * for management decisions. Research-only, `brokerAuthority: false`.
 *
 * Per COMMAND 3's own correction: for the action ACTUALLY TAKEN at a
 * management decision, the subsequent realized return from decision time
 * onward is FACTUAL once resolved (`REALIZED_RETURN_TO_GO`) -- this is
 * directly trainable, no OPE needed. Every OTHER action considered at that
 * SAME decision point (`ACTION_SPECIFIC_CONTINUATION_VALUE` for the
 * unchosen ones) remains counterfactual and must never inherit the chosen
 * action's realized result.
 */
import { identifiabilityTaxonomyVersion, type IdentifiabilityStatus } from './empirical-identifiability-taxonomy.js';

export const managementReturnToGoVersion = 'theta-management-return-to-go-v1' as const;

export interface ManagementActionAlternative {
  readonly action: string;
  readonly wasSelected: boolean;
}

export interface ManagementReturnToGoRow {
  readonly contractVersion: typeof managementReturnToGoVersion;
  readonly taxonomyVersion: typeof identifiabilityTaxonomyVersion;
  readonly managementDecisionPointId: string;
  readonly action: string;
  readonly identifiabilityStatus: IdentifiabilityStatus;
  readonly realizedReturnToGo: number | null;
  readonly resolvedAt: string | null;
}

/**
 * Builds one row per alternative considered at a management decision point.
 * Exactly the alternative with `wasSelected: true` may carry a non-null
 * `realizedReturnToGo`, and only once `resolvedReturnToGo`/`resolvedAt` are
 * both supplied for it -- every other alternative is forced to
 * `NOT_IDENTIFIABLE`/`null` regardless of what the caller passes for it,
 * structurally preventing the chosen action's result from leaking onto an
 * unchosen row.
 */
export function buildManagementReturnToGoRows(input: {
  readonly managementDecisionPointId: string;
  readonly alternatives: readonly ManagementActionAlternative[];
  readonly selectedActionResolvedReturnToGo: number | null;
  readonly selectedActionResolvedAt: string | null;
}): readonly ManagementReturnToGoRow[] {
  const selected = input.alternatives.filter((a) => a.wasSelected);
  if (selected.length !== 1) throw new Error('MANAGEMENT_RETURN_TO_GO_REQUIRES_EXACTLY_ONE_SELECTED_ALTERNATIVE');
  if (input.selectedActionResolvedReturnToGo !== null && input.selectedActionResolvedAt === null) {
    throw new Error('MANAGEMENT_RETURN_TO_GO_VALUE_WITHOUT_RESOLVED_AT');
  }

  return input.alternatives.map((alt) => {
    if (!alt.wasSelected) {
      return {
        contractVersion: managementReturnToGoVersion, taxonomyVersion: identifiabilityTaxonomyVersion,
        managementDecisionPointId: input.managementDecisionPointId, action: alt.action,
        identifiabilityStatus: 'NOT_IDENTIFIABLE', realizedReturnToGo: null, resolvedAt: null,
      };
    }
    const resolved = input.selectedActionResolvedReturnToGo !== null;
    return {
      contractVersion: managementReturnToGoVersion, taxonomyVersion: identifiabilityTaxonomyVersion,
      managementDecisionPointId: input.managementDecisionPointId, action: alt.action,
      identifiabilityStatus: resolved ? 'FACTUAL_OBSERVED' : 'NOT_IDENTIFIABLE',
      realizedReturnToGo: input.selectedActionResolvedReturnToGo, resolvedAt: input.selectedActionResolvedAt,
    };
  });
}
