/**
 * R8 management-outcome learning schema, v2 (hardened). Research-only,
 * `brokerAuthority: false`. This is what happens AFTER Codex's real
 * management candidate sourcing begins accumulating real candidate/
 * action data -- this module never fits, ranks, or selects anything; it
 * only defines the durable record shape future empirical work will
 * need, and the honest provenance discipline for counterfactuals so an
 * estimate can never be silently mistaken for a realized broker outcome.
 *
 * v2 hardening, per direct user review:
 *  - v1 reused `wait-economic-contract.ts`'s `CounterfactualProvenance`
 *    (`OBSERVED | ESTIMABLE | NOT_IDENTIFIABLE`) for BOTH the selected
 *    action's own real outcome AND the alternatives THETA did not take.
 *    That let a selected action's outcome be labeled `ESTIMABLE` when
 *    broker/lifecycle evidence was simply missing -- a real action's
 *    result must never be reported the same way as a hypothetical one.
 *    Split into `SelectedActionOutcomeStatus`
 *    (`PENDING | OBSERVED | NOT_RECOVERABLE` -- what actually happened,
 *    or didn't yet, to the REAL action) and
 *    `ManagementCounterfactualProvenance`
 *    (`OBSERVED_PARALLEL | ESTIMABLE | NOT_IDENTIFIABLE` -- for
 *    alternatives THETA did NOT take). `OBSERVED_PARALLEL` is
 *    deliberately named to require a genuinely independent parallel
 *    execution/shadow observation, never merely "we're pretty sure this
 *    counts as observed" -- an ordinary unselected action is not
 *    magically observed just because it was correctly reasoned about.
 *  - v1's `ActionCounterfactual.action` used a coarse, invented 6-value
 *    label set (`HOLD | CLOSE | ROLL | ASSIGN | RECOVERY | CC`) instead
 *    of the real canonical vocabulary. Now imports and reuses
 *    `ManagementFrontierAction` directly from `management-action-
 *    frontier.ts` (Codex-owned, read-only here) -- the exact 13-action
 *    set the real policy actually selects from
 *    (`HOLD, CLOSE_FULL, ROLL, LET_EXPIRE, ACCEPT_ASSIGNMENT, REDEPLOY,
 *    RECOVERY_WAIT, SELL_STOCK, SELL_CC, HOLD_CC, CLOSE_CC, ROLL_CC,
 *    ALLOW_CALL_AWAY`) -- so e.g. `selectedAction = 'SELL_CC'` and a
 *    coarse `counterfactual.action = 'CC'` can never both exist and
 *    silently bypass the duplicate-action check the way two different
 *    label vocabularies could.
 */
import type { ManagementFrontierAction } from '../theta/management-action-frontier.js';

export const managementOutcomeSchemaVersion = 'theta-management-outcome-schema-v2' as const;

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
 * candidate set the policy actually saw -- never a synthetic
 * placeholder list. `selectedAction`/`secondBestAction`/
 * `bestRejectedAction`/`availableActions` all use the real canonical
 * action vocabulary.
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
  readonly availableActions: readonly ManagementFrontierAction[];
  readonly rollCandidateIds: readonly string[];
  readonly ccCandidateIds: readonly string[];
  readonly selectedAction: ManagementFrontierAction;
  readonly secondBestAction: ManagementFrontierAction | null;
  readonly bestRejectedAction: ManagementFrontierAction | null;
  readonly policyVersion: string;
  readonly actionReasonCodes: readonly string[];
}

/** What actually happened to the SELECTED (real) action -- never used
 * for a counterfactual. `NOT_RECOVERABLE` is distinct from `PENDING`:
 * it means the outcome will never be knowable (e.g. a broker-side
 * reconciliation gap), not merely "still open, will resolve later." */
export type SelectedActionOutcomeStatus = 'PENDING' | 'OBSERVED' | 'NOT_RECOVERABLE';

/** For an alternative THETA did NOT select. `OBSERVED_PARALLEL` requires
 * a genuinely independent parallel execution or equivalent real shadow
 * observation to exist -- never assigned merely because the estimate
 * feels confident. */
export type ManagementCounterfactualProvenance = 'OBSERVED_PARALLEL' | 'ESTIMABLE' | 'NOT_IDENTIFIABLE';

export interface ActionCounterfactual {
  readonly action: ManagementFrontierAction;
  readonly value: number | null;
  readonly provenance: ManagementCounterfactualProvenance;
}

export interface ManagementOutcomeRecord {
  readonly decision: ManagementDecisionRecord;
  /** The SELECTED action's own real, broker-observed result -- `null`
   * whenever `selectedActionOutcomeStatus` is not `OBSERVED`. */
  readonly realizedActionResult: number | null;
  readonly selectedActionOutcomeStatus: SelectedActionOutcomeStatus;
  /** One entry per alternative action considered, covering actions NOT
   * selected -- the selected action's own result belongs in
   * `realizedActionResult` above, never duplicated here. */
  readonly counterfactuals: readonly ActionCounterfactual[];
}

function validateSelectedOutcome(value: number | null, status: SelectedActionOutcomeStatus): string | null {
  if (status === 'OBSERVED' && value === null) return 'OBSERVED_STATUS_REQUIRES_A_NON_NULL_REALIZED_RESULT';
  if (status !== 'OBSERVED' && value !== null) return 'NON_OBSERVED_STATUS_MUST_NOT_CARRY_A_REALIZED_RESULT_VALUE';
  return null;
}

function validateCounterfactualPair(value: number | null, provenance: ManagementCounterfactualProvenance): string | null {
  if (provenance === 'NOT_IDENTIFIABLE' && value !== null) {
    return 'NOT_IDENTIFIABLE_PROVENANCE_MUST_NEVER_CARRY_A_NON_NULL_VALUE';
  }
  if (provenance !== 'NOT_IDENTIFIABLE' && value === null) {
    return 'OBSERVED_PARALLEL_OR_ESTIMABLE_PROVENANCE_REQUIRES_A_NON_NULL_VALUE';
  }
  return null;
}

export interface ManagementOutcomeValidationResult {
  readonly valid: boolean;
  readonly reason: string | null;
}

/**
 * Validates the selected-action outcome status/value pairing, every
 * counterfactual's provenance/value pairing, that the selected action
 * never appears a second time inside `counterfactuals`, and that no
 * counterfactual action is duplicated.
 */
export function validateManagementOutcomeRecord(record: ManagementOutcomeRecord): ManagementOutcomeValidationResult {
  const selectedReason = validateSelectedOutcome(record.realizedActionResult, record.selectedActionOutcomeStatus);
  if (selectedReason !== null) return { valid: false, reason: selectedReason };

  for (const counterfactual of record.counterfactuals) {
    const reason = validateCounterfactualPair(counterfactual.value, counterfactual.provenance);
    if (reason !== null) return { valid: false, reason: `${counterfactual.action}:${reason}` };
  }

  const duplicatesSelected = record.counterfactuals.some((c) => c.action === record.decision.selectedAction);
  if (duplicatesSelected) return { valid: false, reason: 'SELECTED_ACTION_MUST_NOT_ALSO_APPEAR_AS_A_COUNTERFACTUAL' };

  const actionCounts = new Map<ManagementFrontierAction, number>();
  for (const c of record.counterfactuals) actionCounts.set(c.action, (actionCounts.get(c.action) ?? 0) + 1);
  if ([...actionCounts.values()].some((count) => count > 1)) {
    return { valid: false, reason: 'DUPLICATE_COUNTERFACTUAL_ACTION' };
  }

  return { valid: true, reason: null };
}
