/**
 * R8 management-outcome learning schema (directive priority #4).
 * Research-only, `brokerAuthority: false`. This is what happens AFTER
 * Codex's real management candidate sourcing begins accumulating real
 * candidate/action data -- this module never fits, ranks, or selects
 * anything; it only defines the durable record shape future empirical
 * work will need, and the honest provenance discipline for
 * counterfactuals ("what would HOLD have produced instead") so an
 * estimate can never be silently mistaken for a realized broker outcome.
 */
import type { CounterfactualProvenance } from './wait-economic-contract.js';

export const managementOutcomeSchemaVersion = 'theta-management-outcome-schema-v1' as const;

export interface UnderlyingStateSnapshot {
  readonly last: number | null;
  readonly regimeCohort: string | null;
}

export interface OptionStateSnapshot {
  readonly bid: number | null;
  readonly ask: number | null;
  readonly delta: number | null;
}

/**
 * One immutable record of a single real management decision. Every
 * field is either a KNOWN fact at decision time (never a forecast) or
 * explicitly `null`. `rollCandidateIds`/`ccCandidateIds` are the REAL
 * candidate set the policy actually saw (from
 * `paper-bootstrap-candidate-source.ts` or an equivalent real producer)
 * -- never a synthetic placeholder list.
 */
export interface ManagementDecisionRecord {
  readonly chainId: string;
  readonly decisionTimestamp: string;
  readonly lifecycleState: string;
  readonly currentUnderlyingState: UnderlyingStateSnapshot;
  readonly currentOptionState: OptionStateSnapshot;
  readonly wholeChainRealizedPnlToDate: number | null;
  readonly currentExecutableCloseCost: number | null;
  readonly currentAnalyticalMark: number | null;
  readonly dte: number | null;
  readonly eventState: string | null;
  readonly ownershipState: string | null;
  readonly availableActions: readonly string[];
  readonly rollCandidateIds: readonly string[];
  readonly ccCandidateIds: readonly string[];
  readonly selectedAction: string;
  readonly secondBestAction: string | null;
  readonly bestRejectedAction: string | null;
  readonly policyVersion: string;
  readonly actionReasonCodes: readonly string[];
}

/**
 * The counterfactual value of ONE alternative action THETA did NOT
 * take, for the SAME decision. `provenance` governs what `value` is
 * allowed to be -- enforced by `validateManagementOutcomeRecord` below,
 * mirroring `wait-economic-contract.ts`'s identical discipline for the
 * exact same reason: REAL BROKER PNL != COUNTERFACTUAL PNL, and an
 * estimate must never silently look identical to an observed fact.
 */
export interface ActionCounterfactual {
  readonly action: 'HOLD' | 'CLOSE' | 'ROLL' | 'ASSIGN' | 'RECOVERY' | 'CC';
  readonly value: number | null;
  readonly provenance: CounterfactualProvenance;
}

export interface ManagementOutcomeRecord {
  readonly decision: ManagementDecisionRecord;
  /** The SELECTED action's own real, broker-observed result -- `null`
   * until resolved (the chain/episode is still open). */
  readonly realizedActionResult: number | null;
  readonly realizedActionResultProvenance: CounterfactualProvenance;
  /** One entry per alternative action considered (HOLD/CLOSE/ROLL/ASSIGN/
   * RECOVERY/CC), covering actions NOT selected -- the selected action's
   * own result belongs in `realizedActionResult` above, never duplicated
   * here as a counterfactual of itself. */
  readonly counterfactuals: readonly ActionCounterfactual[];
}

function validateProvenancePair(value: number | null, provenance: CounterfactualProvenance): string | null {
  if (provenance === 'NOT_IDENTIFIABLE' && value !== null) {
    return 'NOT_IDENTIFIABLE_PROVENANCE_MUST_NEVER_CARRY_A_NON_NULL_VALUE';
  }
  if (provenance !== 'NOT_IDENTIFIABLE' && value === null) {
    return 'OBSERVED_OR_ESTIMABLE_PROVENANCE_REQUIRES_A_NON_NULL_VALUE';
  }
  return null;
}

export interface ManagementOutcomeValidationResult {
  readonly valid: boolean;
  readonly reason: string | null;
}

/**
 * Validates provenance/value consistency for the realized result AND
 * every counterfactual, PLUS confirms the selected action never appears
 * a second time inside `counterfactuals` (which would let an estimate
 * silently overwrite or contradict the real observed result for the
 * same action).
 */
export function validateManagementOutcomeRecord(record: ManagementOutcomeRecord): ManagementOutcomeValidationResult {
  const realizedReason = validateProvenancePair(record.realizedActionResult, record.realizedActionResultProvenance);
  if (realizedReason !== null) return { valid: false, reason: realizedReason };

  for (const counterfactual of record.counterfactuals) {
    const reason = validateProvenancePair(counterfactual.value, counterfactual.provenance);
    if (reason !== null) return { valid: false, reason: `${counterfactual.action}:${reason}` };
  }

  const selectedActionNormalized = record.decision.selectedAction.toUpperCase();
  const duplicatesSelected = record.counterfactuals.some((c) => c.action === selectedActionNormalized);
  if (duplicatesSelected) return { valid: false, reason: 'SELECTED_ACTION_MUST_NOT_ALSO_APPEAR_AS_A_COUNTERFACTUAL' };

  const actionCounts = new Map<string, number>();
  for (const c of record.counterfactuals) actionCounts.set(c.action, (actionCounts.get(c.action) ?? 0) + 1);
  if ([...actionCounts.values()].some((count) => count > 1)) {
    return { valid: false, reason: 'DUPLICATE_COUNTERFACTUAL_ACTION' };
  }

  return { valid: true, reason: null };
}
