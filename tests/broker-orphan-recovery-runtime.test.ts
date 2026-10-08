import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import pg, { type Pool, type PoolClient } from 'pg';
import {
  brokerConfirmedPositionLifecycleRegistrationBlocked, buildOrphanManagementAuthority, buildOrphanManagementDecisionDraft,
  buildOrphanRiskClosePlan, classifyBrokerConfirmedOrphan, decideOrphanRiskAction, orphanLineageIncomplete,
  orphanManagementAuthorityRef, parseOrphanRiskClosePolicy, type BrokerConfirmedOptionPosition, type OrphanManagementRepresentation,
  type OrphanRiskClosePolicy, type OrphanThetaLineage,
} from '../src/execution/broker-orphan-position-recovery.js';
import {
  loadBrokerConfirmedOrphanCandidates, PostgresOrphanManagementAuthorityStore, runBrokerOrphanRecovery,
  type OrphanCandidate, type OrphanRecoveryDependencies,
} from '../src/execution/postgres-broker-orphan-recovery.js';
import { PostgresMasterPaperActionPlanStore } from '../src/execution/postgres-master-paper-action-plan-store.js';
import { mergeConvergencePasses, type FillLifecycleOrchestrationReport } from '../src/execution/postgres-broker-fill-lifecycle-orchestrator.js';
import { loadEnvironment } from '../src/config/environment.js';

// Synthetic XLE incident lineage (public repository: no real identifiers).
const SYMBOL = 'XLE261120P00057000';
const ids = { chain: 'b0000000-0000-4000-8000-000000000001', decision: 'b0000000-0000-4000-8000-000000000002',
  intent: 'b0000000-0000-4000-8000-000000000003', underlying: 'b0000000-0000-4000-8000-000000000004',
  contract: 'b0000000-0000-4000-8000-000000000005', account: 'b0000000-0000-4000-8000-000000000006',
  reconciliation: 'b0000000-0000-4000-8000-000000000007', fusion: 'b0000000-0000-4000-8000-000000000008' };
const NOW = '2026-10-07T16:30:00.000Z';
const position: BrokerConfirmedOptionPosition = { symbol: SYMBOL, signedQuantity: -1, averageEntryPricePerShare: 0.28,
  observedAt: NOW, reconciliationQuality: 'GOOD' };
const lineage = (patch: Partial<OrphanThetaLineage> = {}, identity: Partial<OrphanThetaLineage['identity']> = {}): OrphanThetaLineage => ({
  chainId: ids.chain, chainKind: 'WHEEL', chainLifecycleState: 'WAIT', chainClosed: false, openOptionLegCount: 0,
  lifecycleApplication: { state: 'NONE', blockedCode: null }, decisionId: ids.decision,
  orderIntent: { orderIntentId: ids.intent, clientOrderId: 'theta-synthetic-client', chainId: ids.chain, decisionId: ids.decision,
    status: 'FILLED', thetaAction: 'OPEN_CSP', side: 'SELL', positionIntent: 'sell_to_open', symbol: SYMBOL, quantity: 1 },
  brokerOrder: { orderIntentId: ids.intent, status: 'FILLED', symbol: SYMBOL, filledQuantity: 1 },
  fills: [{ quantity: 1, pricePerShare: 0.28, occurredAt: '2026-10-07T13:47:57.000Z' }], nonTerminalChainOrders: 0,
  identity: { strategyBranch: 'THETA_CONVENTIONAL', candidateId: 'b0000000-0000-4000-8000-000000000009',
    actionPlanId: 'b0000000-0000-4000-8000-00000000000a', providerOrderId: 'synthetic-broker-order', ...identity },
  underlyingId: ids.underlying, optionContractId: ids.contract, multiplier: 100, ...patch });
const representation = (): OrphanManagementRepresentation => {
  const result = classifyBrokerConfirmedOrphan(position, [lineage()]);
  assert.equal(result.state, 'ORPHAN_CONFIRMED');
  return (result as Extract<typeof result, { state: 'ORPHAN_CONFIRMED' }>).representation;
};
const policy: OrphanRiskClosePolicy = { policyVersion: 'test-orphan-risk-v1', askMultipleOfEntry: 3, maximumQuoteAgeMs: 10_000 };
const calmMarket = { bid: 0.35, ask: 0.37, quoteTimestamp: NOW, spot: 63.1, now: NOW };
const riskMarket = { bid: 0.84, ask: 0.90, quoteTimestamp: NOW, spot: 62.4, now: NOW };

test('generic identity: a missing lineage member is RECONCILING (never a guessed recovery); D spreads are never adopted', () => {
  for (const [field, patch] of [['STRATEGY_BRANCH', { strategyBranch: null }], ['CANDIDATE', { candidateId: null }],
    ['ACTION_PLAN', { actionPlanId: null }], ['BROKER_ORDER_ID', { providerOrderId: null }]] as const) {
    const result = classifyBrokerConfirmedOrphan(position, [lineage({}, patch)]);
    assert.deepEqual(result, { state: 'RECONCILING', reason: orphanLineageIncomplete, missing: [field] });
  }
  const noClient = classifyBrokerConfirmedOrphan(position, [{ ...lineage(), orderIntent: { ...lineage().orderIntent, clientOrderId: '' } }]);
  assert.equal(noClient.state, 'RECONCILING');
  const spread = classifyBrokerConfirmedOrphan(position, [lineage({}, { strategyBranch: 'THETA_DEFINED_RISK' })]);
  assert.equal(spread.state === 'REFUSED' && spread.reason, 'ORPHAN_STRATEGY_NOT_SUPPORTED');
  // Every registration-failure cause is the same orphan: blocked by a schema error, or never attempted (crash / commit failure).
  for (const lifecycleApplication of [{ state: 'NONE' as const, blockedCode: null },
    { state: 'BLOCKED' as const, blockedCode: 'POSTGRES_23514_LIFECYCLE_APPLICATION_EVENT_KIND_CHECK' }]) {
    assert.equal(classifyBrokerConfirmedOrphan(position, [lineage({ lifecycleApplication })]).state, 'ORPHAN_CONFIRMED');
  }
  const rep = representation();
  assert.deepEqual([rep.strategyBranch, rep.clientOrderId, rep.providerOrderId], ['THETA_CONVENTIONAL', 'theta-synthetic-client', 'synthetic-broker-order']);
});

test('governed authority rows are deterministic (restart/replay maps to the same rows) and select only HOLD or CLOSE_FULL', () => {
  const rep = representation();
  const build = (market = calmMarket, p: OrphanRiskClosePolicy | null = policy) => buildOrphanManagementAuthority({ representation: rep,
    decision: decideOrphanRiskAction(rep, market, p), market, policy: p, reconciliationSnapshotId: ids.reconciliation,
    fusionSnapshotId: ids.fusion, observedAt: NOW });
  const hold = build();
  assert.deepEqual(build(), hold);
  assert.equal(hold.frontier.selectedAction, 'HOLD');
  assert.equal(hold.inputSnapshot.lifecycleState, 'WAIT');
  assert.equal(hold.inputSnapshot.inputJson.inputKind, 'BROKER_CONFIRMED_ORPHAN');
  assert.equal(hold.inputSnapshot.inputJson.underlyingId, ids.underlying);
  assert.deepEqual(hold.frontier.actions.map((action) => action.action), ['HOLD', 'CLOSE_FULL']);
  const close = build(riskMarket);
  assert.equal(close.frontier.selectedAction, 'CLOSE_FULL');
  assert.notEqual(close.frontier.managementActionFrontierId, hold.frontier.managementActionFrontierId);
  const noPolicy = build(riskMarket, null);
  assert.equal(noPolicy.frontier.selectedAction, 'HOLD');
  assert.equal(noPolicy.frontier.policyVersion, null);
  assert.equal(noPolicy.frontier.policyEvidenceHash, null);
  assert.throws(() => buildOrphanManagementAuthority({ representation: { ...rep, contracts: 2 }, decision: decideOrphanRiskAction(rep, calmMarket, policy),
    market: calmMarket, policy, reconciliationSnapshotId: ids.reconciliation, fusionSnapshotId: ids.fusion, observedAt: NOW }),
  /ORPHAN_REPRESENTATION_TAMPERED/);
});

class ScriptedClient extends EventEmitter {
  queries: string[] = [];
  constructor(private readonly handler: (sql: string, values: readonly unknown[]) => { rows: unknown[]; rowCount: number }) { super(); }
  async query(sql: string, values: readonly unknown[] = []) { this.queries.push(sql); return this.handler(sql, values); }
  release() { /* scripted */ }
}
const poolOf = (...clients: ScriptedClient[]): Pool => {
  let cursor = 0;
  return { connect: async () => clients[cursor++] as unknown as PoolClient } as Pool;
};

test('the orphan close plan and decision pass the REAL publishManagementPlans authority checks unchanged', async () => {
  const rep = representation();
  const decision = decideOrphanRiskAction(rep, riskMarket, policy);
  assert.equal(decision.action, 'CLOSE_RISK');
  if (decision.action !== 'CLOSE_RISK') return;
  const authority = buildOrphanManagementAuthority({ representation: rep, decision, market: riskMarket, policy,
    reconciliationSnapshotId: ids.reconciliation, fusionSnapshotId: ids.fusion, observedAt: NOW });
  const built = buildOrphanRiskClosePlan({ representation: rep, directive: decision.directive, executionAccountId: ids.account,
    strategyVersion: 'theta-conventional-v1', managementInputSnapshotId: authority.frontier.managementInputSnapshotId,
    managementActionFrontierId: authority.frontier.managementActionFrontierId, optionsCapabilityVerified: true, accountActive: true,
    killSwitchActive: false, now: NOW, decisionExpiresAt: '2026-10-07T16:30:25.000Z' });
  assert.equal(built.state, 'READY', JSON.stringify(built.blockers));
  if (built.state !== 'READY') return;
  assert.equal(built.plan.candidateId, orphanManagementAuthorityRef(authority.frontier.managementActionFrontierId));
  const draft = buildOrphanManagementDecisionDraft({ plan: built.plan, authority, decision, policy, decidedAt: NOW });
  const transaction = new ScriptedClient((sql) => {
    if (sql.includes('FROM trade.management_action_frontier')) return { rowCount: 1, rows: [{
      management_action_frontier_id: authority.frontier.managementActionFrontierId, selected_action: authority.frontier.selectedAction,
      decision_state: authority.frontier.decisionState, policy_version: authority.frontier.policyVersion,
      policy_evidence_hash: authority.frontier.policyEvidenceHash, management_input_snapshot_id: authority.inputSnapshot.managementInputSnapshotId,
      fusion_snapshot_id: authority.inputSnapshot.fusionSnapshotId, chain_id: authority.inputSnapshot.chainId,
      input_json: authority.inputSnapshot.inputJson, account_kind: 'MASTER_API_KEY', account_ready: true }] };
    if (sql.includes('INSERT INTO trade.decision(')) return { rows: [{ decision_id: draft.decisionId }], rowCount: 1 };
    if (sql.includes('INSERT INTO trade.master_paper_action_plan(')) return { rows: [{ action_plan_id: built.plan.actionPlanId }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  assert.equal(await new PostgresMasterPaperActionPlanStore(poolOf(transaction)).publishManagementPlans(draft, [built.plan], NOW), 1);
  // A decision whose policy lineage differs from the persisted frontier is rejected by the same store.
  const mismatched = new ScriptedClient((sql) => sql.includes('FROM trade.management_action_frontier') ? { rowCount: 1, rows: [{
    management_action_frontier_id: authority.frontier.managementActionFrontierId, selected_action: 'HOLD', decision_state: 'ACTION_SELECTED',
    policy_version: policy.policyVersion, policy_evidence_hash: authority.frontier.policyEvidenceHash,
    management_input_snapshot_id: authority.inputSnapshot.managementInputSnapshotId, fusion_snapshot_id: ids.fusion, chain_id: ids.chain,
    input_json: authority.inputSnapshot.inputJson, account_kind: 'MASTER_API_KEY', account_ready: true }] } : { rows: [], rowCount: 0 });
  await assert.rejects(new PostgresMasterPaperActionPlanStore(poolOf(mismatched)).publishManagementPlans(draft, [built.plan], NOW),
    /MANAGEMENT_ACTION_SELECTION_MISMATCH/);
});

test('authority writer is idempotent, chain-guarded, and never mutates an immutable row', async () => {
  const rep = representation();
  const rows = buildOrphanManagementAuthority({ representation: rep, decision: decideOrphanRiskAction(rep, calmMarket, policy),
    market: calmMarket, policy, reconciliationSnapshotId: ids.reconciliation, fusionSnapshotId: ids.fusion, observedAt: NOW });
  const scripted = (chainState: string) => new ScriptedClient((sql) => {
    if (sql.includes('FROM trade.economic_chain')) return { rows: [{ state: chainState, closed_at: null }], rowCount: 1 };
    if (sql.includes('SELECT management_input_snapshot_id FROM')) return { rows: [{ management_input_snapshot_id: rows.inputSnapshot.managementInputSnapshotId }], rowCount: 1 };
    if (sql.includes('SELECT management_action_frontier_id FROM')) return { rows: [{ management_action_frontier_id: rows.frontier.managementActionFrontierId }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const client = scripted('WAIT');
  assert.deepEqual(await new PostgresOrphanManagementAuthorityStore(poolOf(client)).persist(rows), {
    managementInputSnapshotId: rows.inputSnapshot.managementInputSnapshotId, managementActionFrontierId: rows.frontier.managementActionFrontierId });
  const inserts = client.queries.filter((sql) => sql.includes('INSERT INTO'));
  assert.equal(inserts.length, 2);
  assert.ok(inserts.every((sql) => sql.includes('ON CONFLICT') && sql.includes('DO NOTHING')));
  assert.ok(!client.queries.some((sql) => /\bUPDATE\b|\bDELETE\b/.test(sql)));
  // Once the lifecycle owns the chain (SHORT_PUT_OPEN moved it to CSP_OPEN) the orphan authority can no longer be written.
  await assert.rejects(new PostgresOrphanManagementAuthorityStore(poolOf(scripted('CSP_OPEN'))).persist(rows), /ORPHAN_CHAIN_NO_LONGER_WAIT/);
});

const deps = (patch: Partial<OrphanRecoveryDependencies> = {}, candidates: readonly OrphanCandidate[] = [
  { position, lineages: [lineage()], fusionSnapshotId: ids.fusion, strategyVersion: 'theta-conventional-v1' }]) => {
  const calls = { persisted: 0, published: 0, market: 0 };
  const value: OrphanRecoveryDependencies = { mode: 'CLOSE_RISK_CERTIFIED', policy,
    reconciliation: { snapshotId: ids.reconciliation, observedAt: NOW, accountStatus: 'ACTIVE' }, executionAccountId: ids.account,
    optionsCapabilityVerified: true, killSwitchActive: false, decisionWindowMs: 30_000,
    loadCandidates: async () => candidates,
    readMarket: async () => { calls.market += 1; return riskMarket; },
    readChainInFlight: async () => ({ state: 'KNOWN', entries: [] }),
    persistAuthority: async (rows) => { calls.persisted += 1; return { managementInputSnapshotId: rows.inputSnapshot.managementInputSnapshotId,
      managementActionFrontierId: rows.frontier.managementActionFrontierId }; },
    publishManagementPlans: async (decision, plans) => {
      calls.published += 1;
      assert.equal(plans.length, 1);
      assert.deepEqual([plans[0]?.action, plans[0]?.quantity, plans[0]?.symbol, decision.actionCode], ['CLOSE_CSP', 1, SYMBOL, 'CLOSE_FULL']);
      return 1;
    }, ...patch };
  return { value, calls };
};

test('runtime OBSERVE (default) is read-only: reports the orphan, writes nothing, reads no market, publishes nothing', async () => {
  const { value, calls } = deps({ mode: 'OBSERVE' });
  const report = await runBrokerOrphanRecovery(value);
  assert.equal(report.blockingCode, brokerConfirmedPositionLifecycleRegistrationBlocked);
  assert.deepEqual(report.items.map((item) => item.state), ['OBSERVED']);
  assert.deepEqual(calls, { persisted: 0, published: 0, market: 0 });
  const off = deps({ mode: 'OFF' });
  assert.deepEqual(await runBrokerOrphanRecovery(off.value), { mode: 'OFF', items: [], blockingCode: null, published: 0 });
  assert.equal(loadEnvironment({}).THETA_ORPHAN_RECOVERY_MODE, 'OBSERVE');
  assert.equal(loadEnvironment({ THETA_ORPHAN_RECOVERY_MODE: '' }).THETA_ORPHAN_RECOVERY_MODE, 'OBSERVE');
  assert.throws(() => loadEnvironment({ THETA_ORPHAN_RECOVERY_MODE: 'SUBMIT' }), /THETA_ORPHAN_RECOVERY_MODE/);
});

test('runtime CLOSE_RISK_CERTIFIED: HOLD rows without policy; one published close on a trigger; in-flight converges to one owner', async () => {
  const noPolicy = deps({ policy: null });
  const held = await runBrokerOrphanRecovery(noPolicy.value);
  assert.deepEqual(held.items.map((item) => [item.state, item.reasons]), [['ORPHAN_HOLD', ['ORPHAN_RISK_CLOSE_POLICY_NOT_CONFIGURED']]]);
  assert.deepEqual(noPolicy.calls, { persisted: 1, published: 0, market: 1 });
  const fired = deps();
  const closed = await runBrokerOrphanRecovery(fired.value);
  assert.deepEqual(closed.items.map((item) => item.state), ['ORPHAN_CLOSE_PUBLISHED']);
  assert.equal(closed.published, 1);
  // Restart after publication: the READY plan is in flight, so no second close is ever published.
  const restart = deps({ readChainInFlight: async () => ({ state: 'KNOWN', entries: [{ source: 'ACTION_PLAN', id: 'p', decisionId: null }] }) });
  assert.deepEqual((await runBrokerOrphanRecovery(restart.value)).items.map((item) => item.reasons), [['MANAGEMENT_EQUIVALENT_ORDER_IN_FLIGHT']]);
  assert.equal(restart.calls.published, 0);
  // After the close order exists (non-terminal intent) the classifier itself refuses a second mutation.
  const submitted = deps({}, [{ position, lineages: [lineage({ nonTerminalChainOrders: 1 })], fusionSnapshotId: ids.fusion, strategyVersion: 'v' }]);
  const report = await runBrokerOrphanRecovery(submitted.value);
  assert.deepEqual(report.items.map((item) => item.state), ['ORPHAN_CLOSE_BLOCKED']);
  assert.equal(submitted.calls.published, 0);
  // Kill switch / management submission disabled: the plan builder blocks; nothing is published.
  const killed = deps({ killSwitchActive: true });
  assert.ok((await runBrokerOrphanRecovery(killed.value)).items[0]?.reasons.includes('KILL_SWITCH_ACTIVE'));
  assert.equal(killed.calls.published, 0);
  // Lifecycle owns it (SHORT_PUT_OPEN applied after 070): not an orphan, nothing reported.
  const owned = deps({}, [{ position, lineages: [lineage({ openOptionLegCount: 1 })], fusionSnapshotId: ids.fusion, strategyVersion: 'v' }]);
  assert.deepEqual(await runBrokerOrphanRecovery(owned.value), { mode: 'CLOSE_RISK_CERTIFIED', items: [], blockingCode: null, published: 0 });
  // Incomplete lineage is RECONCILING with its own typed code; nothing is written.
  const partial = deps({}, [{ position, lineages: [lineage({}, { actionPlanId: null })], fusionSnapshotId: ids.fusion, strategyVersion: 'v' }]);
  assert.equal((await runBrokerOrphanRecovery(partial.value)).blockingCode, orphanLineageIncomplete);
  assert.equal(partial.calls.persisted, 0);
});

test('owner policy parsing: absent/invalid is null (HOLD), never a default threshold', () => {
  assert.deepEqual(parseOrphanRiskClosePolicy(undefined), { policy: null, reason: 'NOT_CONFIGURED' });
  assert.equal(parseOrphanRiskClosePolicy('{').reason, 'INVALID');
  assert.equal(parseOrphanRiskClosePolicy(JSON.stringify({ policyVersion: 'v', maximumQuoteAgeMs: 5000 })).reason, 'INVALID');
  assert.equal(parseOrphanRiskClosePolicy(JSON.stringify({ policyVersion: 'v', maximumQuoteAgeMs: 120000, maximumDte: 3 })).reason, 'INVALID');
  assert.deepEqual(parseOrphanRiskClosePolicy(JSON.stringify({ policyVersion: 'v', maximumQuoteAgeMs: 10000, askMultipleOfEntry: 3 })).policy,
    { policyVersion: 'v', maximumQuoteAgeMs: 10000, askMultipleOfEntry: 3 });
});

test('open-then-close convergence: the second pass owns gap counts and never double-counts the open', () => {
  const result = (applicationId: string, eventKind: 'SHORT_PUT_OPEN' | 'OPTION_CLOSE', duplicate: boolean) =>
    ({ applicationId, duplicate, chainId: ids.chain, eventKind, transitionPath: [], finalState: 'CSP_OPEN' as const });
  const first: FillLifecycleOrchestrationReport = { inspected: 2, applied: 1, duplicates: 0, partial: 0, unresolved: 1,
    results: [result('open', 'SHORT_PUT_OPEN', false)] };
  const second: FillLifecycleOrchestrationReport = { inspected: 2, applied: 1, duplicates: 1, partial: 0, unresolved: 0,
    results: [result('open', 'SHORT_PUT_OPEN', true), result('close', 'OPTION_CLOSE', false)] };
  const merged = mergeConvergencePasses(first, second);
  assert.deepEqual([merged.applied, merged.duplicates, merged.unresolved], [2, 0, 0]);
  assert.deepEqual(merged.results.map((item) => item.eventKind), ['SHORT_PUT_OPEN', 'OPTION_CLOSE']);
});

test('DB: orphan candidate SQL is valid against the migrated schema (unknown snapshot -> no candidates)', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  try {
    assert.deepEqual(await loadBrokerConfirmedOrphanCandidates(pool, { reconciliationSnapshotId: ids.reconciliation,
      executionAccountId: ids.account }), []);
    // The lineage query is exercised too: EXPLAIN validates every column without needing fixture rows.
    await pool.query(`EXPLAIN SELECT 1 FROM trade.management_input_snapshot WHERE input_json->>'inputKind' IS DISTINCT FROM 'BROKER_CONFIRMED_ORPHAN'`);
  } finally { await pool.end(); }
});

test('missing order-intent lineage is visible, blocks recovery and never adopts or closes unexplained exposure', async () => {
  for (const signedQuantity of [-1, 1]) {
    const { value, calls } = deps({}, [{ position: { ...position, signedQuantity }, lineages: [], fusionSnapshotId: null, strategyVersion: null }]);
    const report = await runBrokerOrphanRecovery(value);
    assert.equal(report.blockingCode, orphanLineageIncomplete);
    assert.deepEqual(report.items.map(item => [item.state, item.reasons]),
      [['REFUSED', [signedQuantity < 0 ? 'ORPHAN_NO_THETA_LINEAGE' : 'ORPHAN_SIDE_MISMATCH']]]);
    assert.deepEqual(calls, { persisted: 0, published: 0, market: 0 });
  }
});

test('orphan loader binds snapshot and ownership to the same account and preserves malformed position evidence', async () => {
  for (const patch of [{ side: null }, { quantity: null }, { quantity: '' }, { quantity: false },
    { average_entry_price: '' }, { average_entry_price: -0.28 }]) {
    const pool = { query: async (sql: string, args: readonly unknown[]) => {
      if (sql.includes('SELECT bp.symbol')) {
        assert.deepEqual(args, [ids.reconciliation, ids.account]);
        assert.match(sql, /fa.follower_account_id=bp.connection_id/);
        assert.match(sql, /ea.execution_account_id=\$2/);
        assert.match(sql, /owner_intent.execution_account_id=ea.execution_account_id/);
        return { rows: [{ symbol: SYMBOL, quantity: -1, side: 'short', average_entry_price: 0.28, observed_at: NOW, data_quality: 'GOOD', ...patch }] };
      }
      return { rows: [] };
    } };
    const loaded = await loadBrokerConfirmedOrphanCandidates(pool as never, { reconciliationSnapshotId: ids.reconciliation, executionAccountId: ids.account });
    assert.equal(loaded.length, 1, 'malformed broker position remains visible');
    assert.equal(classifyBrokerConfirmedOrphan((loaded[0] as OrphanCandidate).position, [lineage()]).state, 'REFUSED');
  }
});
