import { createHash } from 'node:crypto';
import { canonicalJson } from '../research/point-in-time-evidence.js';
import { masterPaperActionPlanSchema, type ApprovedMasterPaperActionPlan } from './master-paper-action-handoff.js';

/**
 * ACTION_PLAN_INTEGRITY. A published plan is an IMMUTABLE ECONOMIC PAYLOAD (plan_json + content_hash and the denormalized
 * economic columns) plus MUTABLE OPERATIONAL METADATA (status, claim fields, blockers, not_before, updated_at, the linked order
 * intent). Only the payload is hashed; operational columns never enter the hash, so a status transition cannot invalidate it.
 * Any divergence between the stored payload, its hash, or its denormalized columns means the plan is not the one that was
 * approved: PLAN_INTEGRITY_MISMATCH, no order.
 */

export const planIntegrityMismatch = 'PLAN_INTEGRITY_MISMATCH' as const;

export const actionPlanContentHash = (plan: unknown): string => createHash('sha256').update(canonicalJson(plan)).digest('hex');

export interface ActionPlanRowForIntegrity {
  readonly action_plan_id: unknown;
  readonly decision_id: unknown;
  readonly execution_account_id: unknown;
  readonly plan_version: unknown;
  readonly plan_json: unknown;
  readonly content_hash: unknown;
  readonly execution_tier: unknown;
  readonly canonical_quantity: unknown;
  readonly paper_evidence_quantity: unknown;
  readonly empirical_economics_ready: unknown;
  readonly expected_after_cost_ev: unknown;
  readonly authority_kind: unknown;
  readonly management_input_snapshot_id: unknown;
  readonly management_action_frontier_id: unknown;
  readonly action_group_id: unknown;
  readonly leg_sequence: unknown;
  readonly depends_on_action_plan_id: unknown;
}

/** SELECT list (table alias `p`) that exposes the sealed payload and its denormalized columns under `ip_` aliases. */
export const planIntegritySelectColumns = `p.action_plan_id AS ip_action_plan_id,p.decision_id AS ip_decision_id,p.execution_account_id AS ip_execution_account_id,
  p.plan_version AS ip_plan_version,p.plan_json AS ip_plan_json,p.content_hash AS ip_content_hash,p.execution_tier AS ip_execution_tier,
  p.canonical_quantity AS ip_canonical_quantity,p.paper_evidence_quantity AS ip_paper_evidence_quantity,
  p.empirical_economics_ready AS ip_empirical_economics_ready,p.expected_after_cost_ev AS ip_expected_after_cost_ev,
  p.authority_kind AS ip_authority_kind,p.management_input_snapshot_id AS ip_management_input_snapshot_id,
  p.management_action_frontier_id AS ip_management_action_frontier_id,p.action_group_id AS ip_action_group_id,
  p.leg_sequence AS ip_leg_sequence,p.depends_on_action_plan_id AS ip_depends_on_action_plan_id`;

export const planIntegrityRowFromAliases = (row: Record<string, unknown>): ActionPlanRowForIntegrity => ({
  action_plan_id: row.ip_action_plan_id, decision_id: row.ip_decision_id, execution_account_id: row.ip_execution_account_id,
  plan_version: row.ip_plan_version, plan_json: row.ip_plan_json, content_hash: row.ip_content_hash, execution_tier: row.ip_execution_tier,
  canonical_quantity: row.ip_canonical_quantity, paper_evidence_quantity: row.ip_paper_evidence_quantity,
  empirical_economics_ready: row.ip_empirical_economics_ready, expected_after_cost_ev: row.ip_expected_after_cost_ev,
  authority_kind: row.ip_authority_kind, management_input_snapshot_id: row.ip_management_input_snapshot_id,
  management_action_frontier_id: row.ip_management_action_frontier_id, action_group_id: row.ip_action_group_id,
  leg_sequence: row.ip_leg_sequence, depends_on_action_plan_id: row.ip_depends_on_action_plan_id,
});

/**
 * Is the management decision still the current one for its chain? The chain must be open and in the lifecycle state the decision
 * was made in. A ROLL has two legs: the open leg (leg_sequence > 1) only becomes claimable after the close leg is FILLED, and the
 * fill lifecycle then moves the chain to ROLL_DECISION, so for that leg ROLL_DECISION is the expected, current state.
 */
export function managementDecisionIsCurrent(input: { readonly legSequence: number; readonly chainClosed: boolean;
  readonly chainState: string | null; readonly planState: string | null }): boolean {
  if (input.chainClosed || input.chainState === null || input.planState === null) return false;
  if (input.chainState === input.planState) return true;
  return input.legSequence > 1 && input.chainState === 'ROLL_DECISION';
}

export type ActionPlanIntegrityResult =
  | { readonly ok: true; readonly plan: ApprovedMasterPaperActionPlan; readonly mismatches: readonly [] }
  | { readonly ok: false; readonly plan: null; readonly mismatches: readonly string[] };

const sameText = (stored: unknown, expected: string | null): boolean =>
  (stored === null || stored === undefined ? null : String(stored)) === expected;
const sameNumber = (stored: unknown, expected: number | null): boolean => {
  if (stored === null || stored === undefined) return expected === null;
  return expected !== null && Number(stored) === expected;
};

/** Recomputes the hash and cross-checks every denormalized economic column against the stored payload. Never throws. */
export function verifyActionPlanRow(row: ActionPlanRowForIntegrity): ActionPlanIntegrityResult {
  const mismatches: string[] = [];
  const fail = (...items: string[]): ActionPlanIntegrityResult => ({ ok: false, plan: null, mismatches: [...mismatches, ...items] });
  const parsed = masterPaperActionPlanSchema.safeParse(row.plan_json);
  if (!parsed.success) return fail('PLAN_JSON_SCHEMA_INVALID');
  const plan = parsed.data as ApprovedMasterPaperActionPlan;
  if (actionPlanContentHash(plan) !== String(row.content_hash)) mismatches.push('CONTENT_HASH');
  // the stored JSON must itself be canonical-equal to what was hashed (no extra/stripped keys survive the strict parse)
  if (canonicalJson(plan) !== canonicalJson(row.plan_json)) mismatches.push('PLAN_JSON_NOT_CANONICAL_PAYLOAD');
  if (!sameText(row.action_plan_id, plan.actionPlanId)) mismatches.push('ACTION_PLAN_ID');
  if (!sameText(row.decision_id, plan.decisionId)) mismatches.push('DECISION_ID');
  if (!sameText(row.execution_account_id, plan.executionAccountId)) mismatches.push('EXECUTION_ACCOUNT_ID');
  if (!sameText(row.plan_version, plan.contractVersion)) mismatches.push('PLAN_VERSION');
  if (!sameText(row.execution_tier, plan.executionTier)) mismatches.push('EXECUTION_TIER');
  if (!sameNumber(row.canonical_quantity, plan.canonicalQuantity)) mismatches.push('CANONICAL_QUANTITY');
  if (!sameNumber(row.paper_evidence_quantity, plan.paperEvidenceQuantity)) mismatches.push('PAPER_EVIDENCE_QUANTITY');
  if (row.empirical_economics_ready !== plan.empiricalEconomicsReady) mismatches.push('EMPIRICAL_ECONOMICS_READY');
  if (!sameNumber(row.expected_after_cost_ev, plan.expectedAfterCostEv)) mismatches.push('EXPECTED_AFTER_COST_EV');
  if (!sameText(row.authority_kind, plan.decisionAuthority)) mismatches.push('AUTHORITY_KIND');
  if (!sameText(row.management_input_snapshot_id, plan.managementInputSnapshotId)) mismatches.push('MANAGEMENT_INPUT_SNAPSHOT_ID');
  if (!sameText(row.management_action_frontier_id, plan.managementActionFrontierId)) mismatches.push('MANAGEMENT_ACTION_FRONTIER_ID');
  if (!sameText(row.action_group_id, plan.actionGroupId)) mismatches.push('ACTION_GROUP_ID');
  if (!sameNumber(row.leg_sequence, plan.legSequence)) mismatches.push('LEG_SEQUENCE');
  if (!sameText(row.depends_on_action_plan_id, plan.dependsOnActionPlanId)) mismatches.push('DEPENDS_ON_ACTION_PLAN_ID');
  return mismatches.length === 0 ? { ok: true, plan, mismatches: [] } : { ok: false, plan: null, mismatches };
}
