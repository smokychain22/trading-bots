import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { assembleManagementInput, bindManagementWholeChainEvidence, PostgresManagementInputStore,
  type ManagementInputState } from '../src/theta/management-input-state.js';
import { componentsFromEvidence, knownField, unknownField, wholeChainComponentEvidenceVersion,
  wholeChainEvidenceHash, type WholeChainComponentEvidence } from '../src/theta/whole-chain-component-evidence.js';
import { PaperBootstrapManagementPolicyProvider } from '../src/theta/paper-bootstrap-management-policy.js';
import { buildRecoveryState } from '../src/theta/recovery-state.js';

const row = { chain_id: 'chain-1', underlying: 'SPY', underlying_id: 'spy', lifecycle_state: 'RECOVERY_WAIT',
  realized_option_pnl: 200, realized_stock_pnl: 0, open_stock_shares: 100, stock_basis_per_share: 100,
  dividends: 0, fees: 0, unknown_fill_fees: false,
  broker_position: { currentPrice: 101 }, snapshot_json: { marketSession: { isOpen: true } } };

function evidence(chainId: string, asOf: string, missingFees = false): WholeChainComponentEvidence {
  const source = [{ relation: 'synthetic.ledger', columns: ['amount'], recordIds: ['f1'], observedAt: asOf }];
  const known = (value: number) => knownField(value, asOf, source);
  const base = { contractVersion: wholeChainComponentEvidenceVersion, chainId, asOf,
    initialPutPremium: known(200), putCloseCosts: known(0), rollCredits: known(0), rollCloseCosts: known(0),
    assignmentStrike: known(100), stockSharesAssigned: known(100), assignmentObservedAt: knownField(asOf, asOf, source),
    dividends: known(0), coveredCallPremium: known(0), coveredCallCloseCosts: known(0),
    stockSaleOrCallAwayProceeds: unknownField<number>(asOf, ['NO_EXIT']),
    fees: missingFees ? unknownField<number>(asOf, ['FEES_UNVERIFIED']) : known(0),
    tcaExecutionShortfall: known(0), currentStockMarkPerShare: known(101), openStockShares: known(100), stockLotBasisReferences: [] };
  const projected = componentsFromEvidence(base);
  const body = { ...base, components: projected.components, componentBlockers: projected.blockers };
  return { ...body, contentHash: wholeChainEvidenceHash(body) };
}

test('resident management assembly loads canonical whole-chain components sequentially before persisting and evaluating policy', async () => {
  let activeLoads = 0, maxLoads = 0, released = 0, persistenceStarted = false;
  const loaded: string[] = [], persisted: ManagementInputState[] = [];
  const client = Object.assign(new EventEmitter(), {
    release() { released++; },
    async query(sql: string, args?: unknown[]) {
      if (sql.includes('INSERT INTO trade.management_input_snapshot')) persisted.push(JSON.parse(String(args?.[7])));
      return { rows: [], rowCount: 0 };
    },
  });
  const pool = { query: async (sql: string) => {
    assert.ok(sql.includes("f.snapshot_json #>> '{underlyingState,symbol}'=u.symbol"), 'latest snapshot must belong to this chain underlying');
    return { rows: [row, { ...row, chain_id: 'chain-2' }], rowCount: 2 };
  },
    connect: async () => { persistenceStarted = true; assert.equal(activeLoads, 0); return client as unknown as PoolClient; } } as unknown as Pool;
  const store = new PostgresManagementInputStore(pool, { async load(chainId, asOf, context) {
    assert.equal(persistenceStarted, false);
    assert.equal(context.connectionId, 'connection'); assert.equal(context.reconciliationSnapshotId, 'recon');
    activeLoads++; maxLoads = Math.max(maxLoads, activeLoads);
    await Promise.resolve(); loaded.push(chainId); activeLoads--;
    return evidence(chainId, asOf);
  } });
  const states = await store.assembleAndPersistOpenChains('connection', 'recon', '2026-09-18T15:00:00Z');
  assert.deepEqual(loaded, ['chain-1', 'chain-2']); assert.equal(maxLoads, 1); assert.equal(released, 1);
  assert.deepEqual(persisted, states);
  for (const state of states) {
    assert.equal(state.wholeChainComponents?.initialPutPremium, 200);
    assert.equal(buildRecoveryState(state, null, null, state.wholeChainComponents).canonicalEffectiveBasisPerShare, 98);
    const policy = await new PaperBootstrapManagementPolicyProvider().evaluate(state);
    assert.ok(policy?.actionValues.find(value => value.action === 'SELL_STOCK')?.reasons
      .includes('BASIS_SOURCE_CANONICAL_WHOLE_CHAIN'));
  }
});

test('canonical whole-chain binding rejects identity hash and projection tampering and preserves unknown fees', () => {
  const asOf = '2026-09-18T15:00:00Z';
  const state = assembleManagementInput(row, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt: asOf });
  const valid = evidence(state.chainId, asOf);
  assert.throws(() => bindManagementWholeChainEvidence(state, { ...valid, chainId: 'wrong' }), /IDENTITY_MISMATCH/);
  assert.throws(() => bindManagementWholeChainEvidence(state, { ...valid, contentHash: 'wrong' }), /HASH_MISMATCH/);
  const forged = { ...valid, components: null };
  const { contentHash: previousHash, ...unsigned } = forged;
  assert.ok(previousHash);
  assert.throws(() => bindManagementWholeChainEvidence(state, { ...forged, contentHash: wholeChainEvidenceHash(unsigned) }), /PROJECTION_MISMATCH/);
  const bound = bindManagementWholeChainEvidence(state, evidence(state.chainId, asOf, true));
  assert.equal(bound.wholeChainComponents, null);
  assert.equal(bound.wholeChainComponentEvidence?.fees.status, 'UNKNOWN');
  assert.ok(bound.unknownFields.includes('wholeChain.fees:UNKNOWN'));
  assert.deepEqual(bound.hardBlockers, state.hardBlockers, 'missing accounting must not globally forbid risk-reducing actions');
  assert.notEqual(bound.contentHash, state.contentHash);
});
