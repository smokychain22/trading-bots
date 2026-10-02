import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { actionPlanContentHash, planIntegrityMismatch, verifyActionPlanRow, type ActionPlanRowForIntegrity } from '../src/execution/action-plan-integrity.js';
import { masterPaperActionPlanVersion, type ApprovedMasterPaperActionPlan } from '../src/execution/master-paper-action-handoff.js';
import { PostgresMasterPaperActionPlanStore } from '../src/execution/postgres-master-paper-action-plan-store.js';

const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-13T14:00:00.000Z';

const plan: ApprovedMasterPaperActionPlan = {
  contractVersion: masterPaperActionPlanVersion, actionPlanId: id(1), decisionAuthority: 'MANAGEMENT',
  managementInputSnapshotId: id(2), managementActionFrontierId: id(3), actionGroupId: id(1), legSequence: 1, dependsOnActionPlanId: null,
  executionAccountId: id(4), decisionId: id(5), candidateId: `management:${id(3)}:SELL_STOCK`, strategyVersion: 'theta-recovery-v1',
  chainId: id(6), optionContractId: null, underlyingId: id(7), underlying: 'AAPL', optionType: null, symbol: 'AAPL',
  quantity: 100, canonicalQuantity: 100, paperEvidenceQuantity: 100, paperEvidenceRiskCap: 100, paperEvidenceCapReason: 'CANONICAL_QUANTITY_LOWER',
  executionTier: 'PAPER_EVIDENCE', multiplier: 1, action: 'SELL_STOCK', economicBoundary: 190, economicsRemainPositive: true,
  expectedAfterCostEv: null, empiricalEconomicsReady: false, selectedByCanonicalAuthority: true, hardValidityPassed: true,
  accountVerified: true, optionsCapabilityVerified: true, noEquivalentExposureConflict: true, aegisState: 'ALLOW_FULL', killSwitchActive: false,
  decisionExpiresAt: '2026-10-13T14:00:30.000Z', pricingPolicy: { waitIntervalMs: 5000, maxAttempts: 3, concessionFractions: [0, 0.5, 1], tickSize: 0.01 },
  pricingAttempt: 0, previousLimit: null, committedShortCallContracts: 0, brokerConfirmedShares: 100, freeSellableShares: 100,
};

const sealed = (value: ApprovedMasterPaperActionPlan = plan, overrides: Partial<ActionPlanRowForIntegrity> = {}): ActionPlanRowForIntegrity => ({
  action_plan_id: value.actionPlanId, decision_id: value.decisionId, execution_account_id: value.executionAccountId, plan_version: value.contractVersion,
  plan_json: value, content_hash: actionPlanContentHash(value), execution_tier: value.executionTier, canonical_quantity: value.canonicalQuantity,
  paper_evidence_quantity: value.paperEvidenceQuantity, empirical_economics_ready: value.empiricalEconomicsReady,
  expected_after_cost_ev: value.expectedAfterCostEv, authority_kind: value.decisionAuthority,
  management_input_snapshot_id: value.managementInputSnapshotId, management_action_frontier_id: value.managementActionFrontierId,
  action_group_id: value.actionGroupId, leg_sequence: value.legSequence, depends_on_action_plan_id: value.dependsOnActionPlanId, ...overrides,
});

test('unchanged plan passes; database text/number round trips of the columns do not matter', () => {
  const result = verifyActionPlanRow(sealed());
  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  // numeric columns arrive from pg as strings or numbers, uuids/timestamps as strings: still intact
  assert.equal(verifyActionPlanRow(sealed(plan, { canonical_quantity: '100', paper_evidence_quantity: '100', leg_sequence: '1' })).ok, true);
  // a jsonb round trip (key order scrambled) is the same canonical payload
  const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(plan).reverse())));
  assert.equal(verifyActionPlanRow(sealed(plan, { plan_json: reordered })).ok, true);
  assert.equal(actionPlanContentHash(plan), actionPlanContentHash(reordered));
});

test('any economic mutation of the stored payload is PLAN_INTEGRITY_MISMATCH', () => {
  const mutate = (patch: Record<string, unknown>) => verifyActionPlanRow(sealed(plan, { plan_json: { ...plan, ...patch } }));
  for (const [label, patch] of [['quantity', { quantity: 200, paperEvidenceQuantity: 200, canonicalQuantity: 200 }], ['symbol', { symbol: 'MSFT' }],
    ['action', { action: 'CLOSE_CSP' }], ['limit economics', { economicBoundary: 1 }], ['decision id', { decisionId: id(99) }],
    ['chain', { chainId: id(98) }], ['pricing attempt', { pricingAttempt: 2 }], ['free shares', { freeSellableShares: 500 }]] as const) {
    const result = mutate(patch);
    assert.equal(result.ok, false, label);
    assert.ok(result.mismatches.includes('CONTENT_HASH') || result.mismatches.includes('PLAN_JSON_SCHEMA_INVALID'), label);
  }
  // hash altered with an intact payload
  assert.equal(verifyActionPlanRow(sealed(plan, { content_hash: 'f'.repeat(64) })).ok, false);
  // payload AND hash rewritten together: the denormalized economic columns still disagree
  const rewritten = { ...plan, quantity: 1000, paperEvidenceQuantity: 1000, canonicalQuantity: 1000, paperEvidenceRiskCap: 1000, brokerConfirmedShares: 1000, freeSellableShares: 1000 };
  const both = verifyActionPlanRow(sealed(rewritten, { canonical_quantity: 100, paper_evidence_quantity: 100 }));
  assert.equal(both.ok, false);
  assert.ok(both.mismatches.includes('CANONICAL_QUANTITY'));
  // each denormalized column independently
  for (const override of [{ decision_id: id(77) }, { execution_account_id: id(77) }, { plan_version: 'other' }, { execution_tier: 'EMPIRICALLY_PROMOTED_PAPER' },
    { empirical_economics_ready: true }, { expected_after_cost_ev: 5 }, { authority_kind: 'NEW_RISK' }, { action_group_id: id(77) }, { leg_sequence: 2 },
    { management_action_frontier_id: id(77) }, { depends_on_action_plan_id: id(77) }, { action_plan_id: id(77) }]) {
    assert.equal(verifyActionPlanRow(sealed(plan, override)).ok, false, JSON.stringify(override));
  }
  // a payload that is not a valid plan at all, or carries an extra key
  assert.equal(verifyActionPlanRow(sealed(plan, { plan_json: { nonsense: true } })).ok, false);
  assert.equal(verifyActionPlanRow(sealed(plan, { plan_json: { ...plan, injected: 1 } })).ok, false);
});

test('operational metadata is not part of the hash: status, claim fields and blockers never invalidate the payload', () => {
  const row = { ...sealed(), status: 'CLAIMED', claimed_by: 'worker', claimed_at: NOW, claim_expires_at: NOW, last_blockers_json: ['X'], not_before: NOW, updated_at: NOW };
  assert.equal(verifyActionPlanRow(row as unknown as ActionPlanRowForIntegrity).ok, true);
});

class Scripted extends EventEmitter {
  released: boolean[] = [];
  constructor(private readonly handler: (sql: string, values: readonly unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>) { super(); }
  query(sql: string, values: readonly unknown[] = []) { return this.handler(sql, values); }
  release(discard = false) { this.released.push(discard); }
}

const decisionColumns = { decision_id: id(5), decision_kind: 'MANAGEMENT' };
const ipColumns = (row: ActionPlanRowForIntegrity) => Object.fromEntries(Object.entries(row).map(([key, value]) => [`ip_${key}`, value]));

test('claimNext quarantines a corrupt plan row, emits an event and still claims the next intact plan', async () => {
  const corrupt = { ...plan, actionPlanId: id(11), actionGroupId: id(11), economicBoundary: 1 };
  const corruptRow = { action_plan_id: id(11), plan_json: corrupt, ...ipColumns(sealed(corrupt, { content_hash: 'e'.repeat(64) })), ...decisionColumns };
  const goodRow = { action_plan_id: plan.actionPlanId, plan_json: plan, ...ipColumns(sealed()), ...decisionColumns };
  const queue = [corruptRow, goodRow];
  const statements: { sql: string; values: readonly unknown[] }[] = [];
  const transaction = new Scripted(async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes('SELECT p.action_plan_id,p.plan_json')) { const next = queue.shift(); return { rows: next === undefined ? [] : [next], rowCount: next === undefined ? 0 : 1 }; }
    if (sql.includes("SET status='CLAIMED'")) return { rows: [{ action_plan_id: plan.actionPlanId }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const verify = new Scripted(async () => ({ rows: [], rowCount: 0 }));
  const pool = { connect: async () => (transaction as unknown as PoolClient) } as unknown as Pool;
  void verify;
  const claimed = await new PostgresMasterPaperActionPlanStore(pool).claimNext(plan.executionAccountId, 'worker-1', NOW);
  assert.equal(claimed?.actionPlanId, plan.actionPlanId);
  const quarantine = statements.find((s) => s.sql.includes("SET status='QUARANTINED',last_blockers_json=$3"));
  assert.ok(quarantine, 'corrupt plan quarantined');
  assert.equal(quarantine?.values[0], id(11));
  assert.deepEqual(JSON.parse(String(quarantine?.values[2])), [planIntegrityMismatch]);
  const event = statements.find((s) => s.sql.includes('INSERT INTO trade.master_paper_action_plan_event') && String(s.values[3]).includes('mismatches'));
  assert.ok(event, 'integrity event recorded');
  assert.ok(JSON.parse(String(event?.values[3])).mismatches.includes('CONTENT_HASH'));
  assert.equal(statements.filter((s) => s.sql.includes("SET status='CLAIMED'")).length, 1, 'only the intact plan is claimed');
});

test('claimNext never returns a plan when every candidate row is corrupt', async () => {
  const bad = (n: number) => { const p = { ...plan, actionPlanId: id(20 + n), actionGroupId: id(20 + n), quantity: 5 }; return { action_plan_id: p.actionPlanId, plan_json: p, ...ipColumns(sealed(p, { content_hash: 'd'.repeat(64) })), ...decisionColumns }; };
  const queue = [bad(1), bad(2)];
  let claimAttempts = 0;
  const transaction = new Scripted(async (sql) => {
    if (sql.includes('SELECT p.action_plan_id,p.plan_json')) { const next = queue.shift(); return { rows: next === undefined ? [] : [next], rowCount: next === undefined ? 0 : 1 }; }
    if (sql.includes("SET status='CLAIMED'")) claimAttempts += 1;
    return { rows: [], rowCount: 1 };
  });
  const pool = { connect: async () => (transaction as unknown as PoolClient) } as unknown as Pool;
  assert.equal(await new PostgresMasterPaperActionPlanStore(pool).claimNext(plan.executionAccountId, 'worker-1', NOW), null);
  assert.equal(claimAttempts, 0);
});

test('verifyBeforeSubmit proves the stored row is still the claimed plan and is CLAIMED', async () => {
  let chainRow: Record<string, unknown> = { closed_at: null, chain_state: 'RECOVERY_WAIT', plan_state: 'RECOVERY_WAIT' };
  const run = async (row: Record<string, unknown> | null, claimed: ApprovedMasterPaperActionPlan = plan) => {
    const client = new Scripted(async (sql) => sql.includes('trade.economic_chain') ? { rows: [chainRow], rowCount: 1 }
      : { rows: row === null ? [] : [row], rowCount: row === null ? 0 : 1 });
    const pool = { connect: async () => (client as unknown as PoolClient), query: async () => ({ rows: row === null ? [] : [row], rowCount: row === null ? 0 : 1 }) } as unknown as Pool;
    return new PostgresMasterPaperActionPlanStore(pool).verifyBeforeSubmit(plan.actionPlanId, claimed);
  };
  const stored = { ...ipColumns(sealed()), status: 'CLAIMED' };
  assert.deepEqual(await run(stored), { ok: true, mismatches: [] });
  assert.equal((await run(null)).ok, false);
  assert.deepEqual((await run({ ...stored, status: 'READY' })).mismatches, ['PLAN_NOT_CLAIMED']);
  const mutated = { ...plan, quantity: 500 };
  assert.equal((await run({ ...stored, ...ipColumns(sealed(mutated, { content_hash: actionPlanContentHash(plan) })) })).ok, false, 'stored payload mutated after claim');
  // the in-memory claimed plan differs from what is stored (tampered between claim and submit)
  assert.deepEqual((await run(stored, { ...plan, economicBoundary: 1 })).mismatches, ['CLAIMED_PLAN_DIFFERS_FROM_STORED']);
  // the management decision must still be current for its chain: chain closed or lifecycle moved on => PLAN_NO_LONGER_CURRENT (new decision)
  chainRow = { closed_at: null, chain_state: 'CC_OPEN', plan_state: 'RECOVERY_WAIT' };
  assert.deepEqual((await run(stored)).mismatches, ['PLAN_NO_LONGER_CURRENT']);
  chainRow = { closed_at: NOW, chain_state: 'CLOSED', plan_state: 'RECOVERY_WAIT' };
  assert.deepEqual((await run(stored)).mismatches, ['PLAN_NO_LONGER_CURRENT']);
  chainRow = { closed_at: null, chain_state: 'RECOVERY_WAIT', plan_state: null };
  assert.deepEqual((await run(stored)).mismatches, ['PLAN_NO_LONGER_CURRENT'], 'unknown decision lifecycle is never assumed current');
  chainRow = { closed_at: null, chain_state: 'RECOVERY_WAIT', plan_state: 'RECOVERY_WAIT' };
  assert.deepEqual(await run(stored), { ok: true, mismatches: [] });
});

test('replaying the same plan is deterministic: identical hash, identical canonical payload', () => {
  assert.equal(actionPlanContentHash(plan), actionPlanContentHash(JSON.parse(JSON.stringify(plan))));
  assert.notEqual(actionPlanContentHash(plan), actionPlanContentHash({ ...plan, economicBoundary: 190.01 }));
});
