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

/**
 * ADVERSARIAL HARDENING (overnight §36): the exact 13 real canonical
 * management actions from `management-action-frontier.ts`'s
 * `ManagementFrontierAction`, plus `WAIT` (the 14th value the real
 * `p2e-evidence-store.ts` synthesizes for lifecycle states where no
 * management action applies -- confirmed real in the COMMAND 3 audit).
 * Kept as a literal, manually-synced list rather than importing the type
 * directly, so a real Codex enum change is a visible, reviewed diff here
 * too -- exactly the same discipline `export-schema-drift-detector.ts`
 * already uses for the export contract.
 */
export const CANONICAL_MANAGEMENT_ACTIONS: ReadonlySet<string> = new Set([
  'HOLD', 'CLOSE_FULL', 'ROLL', 'LET_EXPIRE', 'ACCEPT_ASSIGNMENT', 'REDEPLOY',
  'RECOVERY_WAIT', 'SELL_STOCK', 'SELL_CC', 'HOLD_CC', 'CLOSE_CC', 'ROLL_CC', 'ALLOW_CALL_AWAY',
  'WAIT',
]);

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
  // ADVERSARIAL (overnight §36): reject enum drift before it can silently
  // create an unrecognized-action row -- a typo'd or since-renamed action
  // string must fail loudly, never pass through as if it were real.
  const unrecognized = input.alternatives.find((a) => !CANONICAL_MANAGEMENT_ACTIONS.has(a.action));
  if (unrecognized !== undefined) throw new Error(`MANAGEMENT_RETURN_TO_GO_UNRECOGNIZED_ACTION:${unrecognized.action}`);
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

/**
 * COMMAND 5C-7 item 33-34 (management action-value pipeline, decision
 * timing research). Extends the factual return-to-go row above with the
 * additional fields the directive names: risk-to-go, capital-days-to-go,
 * tail outcome, and opportunity cost. Same structural discipline as
 * above -- only the selected alternative may carry non-null values;
 * unchosen alternatives are forced to `NOT_IDENTIFIABLE`/null regardless
 * of caller input.
 */
export interface ManagementActionValueInputs {
  readonly riskToGo: number | null;
  readonly capitalDaysToGo: number | null;
  readonly tailOutcome: number | null;
  readonly opportunityCost: number | null;
}

export interface ManagementActionValueRow extends ManagementReturnToGoRow, ManagementActionValueInputs {
  /** Command 5C-7 §34: too-early/too-late close, winner-to-loser, loss
   * acceleration, expiry/event/assignment proximity -- a real, closed
   * enum, never a new Production threshold. `null` when not yet
   * classifiable (e.g. the chain is still open). */
  readonly timingClassification: ManagementTimingClassification | null;
}

export type ManagementTimingClassification =
  | 'TOO_EARLY_CLOSE' | 'TOO_LATE_CLOSE' | 'WINNER_GIVEBACK' | 'WINNER_TO_LOSER'
  | 'LOSS_ACCELERATION' | 'EXPIRY_PROXIMITY_DRIVEN' | 'EVENT_PROXIMITY_DRIVEN' | 'ASSIGNMENT_PROXIMITY_DRIVEN' | 'NOT_CLASSIFIABLE';

export function buildManagementActionValueRows(input: {
  readonly managementDecisionPointId: string;
  readonly alternatives: readonly ManagementActionAlternative[];
  readonly selectedActionResolvedReturnToGo: number | null;
  readonly selectedActionResolvedAt: string | null;
  readonly selectedActionValues: ManagementActionValueInputs;
  readonly selectedActionTimingClassification: ManagementTimingClassification | null;
}): readonly ManagementActionValueRow[] {
  const baseRows = buildManagementReturnToGoRows(input);
  const emptyValues: ManagementActionValueInputs = { riskToGo: null, capitalDaysToGo: null, tailOutcome: null, opportunityCost: null };
  if (input.selectedActionValues.riskToGo !== null || input.selectedActionValues.capitalDaysToGo !== null
    || input.selectedActionValues.tailOutcome !== null || input.selectedActionValues.opportunityCost !== null) {
    if (input.selectedActionResolvedAt === null) throw new Error('MANAGEMENT_ACTION_VALUE_INPUTS_WITHOUT_RESOLVED_AT');
  }
  return baseRows.map((row) => ({
    ...row,
    ...(row.identifiabilityStatus === 'FACTUAL_OBSERVED' ? input.selectedActionValues : emptyValues),
    timingClassification: row.identifiabilityStatus === 'FACTUAL_OBSERVED' ? input.selectedActionTimingClassification : null,
  }));
}
