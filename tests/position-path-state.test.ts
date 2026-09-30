import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleManagementInput } from '../src/theta/management-input-state.js';
import { buildPositionPathCheckpoint, classifyPathCheckpoint } from '../src/theta/position-path-state.js';

function state(at = '2026-09-18T15:00:00.000Z', call = false) {
  const result = assembleManagementInput({ chain_id: 'chain', lifecycle_state: call ? 'CC_OPEN' : 'CSP_OPEN',
    underlying_id: 'underlying', underlying: 'TEST', option_leg_id: 'leg', option_contract_id: 'contract',
    quantity: 1, entry_credit_debit: 200, option_type: call ? 'CALL' : 'PUT', strike: 200,
    multiplier: 100, expiration_date: '2026-10-16', bid: 1, ask: 1.1, quote_as_of: at,
    quote_quality: 'GOOD', feed: 'OPRA', open_stock_shares: call ? 100 : 0, stock_basis_per_share: call ? 190 : null,
    realized_option_pnl: 0, realized_stock_pnl: 0, dividends: 0, fees: 0,
    snapshot_json: { eventState: { state: 'CLEAR' } },
  }, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt: at });
  return { ...result, hardBlockers: [], economics: { ...result.economics, wholeChainPnl: 20 } };
}

test('position path excludes future and same-time history instead of manufacturing a historical peak', () => {
  const current = state();
  const prior = buildPositionPathCheckpoint(state('2026-09-17T15:00:00.000Z'), []);
  const future = { ...prior, observedAt: '2026-09-19T15:00:00.000Z', currentWholeChainPnl: 10000 };
  const same = { ...future, observedAt: current.observedAt };
  const result = buildPositionPathCheckpoint(current, [future, same, prior]);
  assert.equal(result.peakWholeChainPnl, 20);
  assert.equal(result.profitGiveback, 0);
  assert.equal(result.capitalDaysObserved, 20000);
  assert.ok(result.unknownFields.includes('NON_PRIOR_HISTORY_EXCLUDED'));
});

test('position path hash binds history and stays deterministic under input order permutations', () => {
  const current = state();
  const prior = buildPositionPathCheckpoint(state('2026-09-17T15:00:00.000Z'), []);
  const earlier = { ...prior, checkpointIdentity: 'earlier', observedAt: '2026-09-16T15:00:00.000Z', currentWholeChainPnl: 100 };
  assert.deepEqual(buildPositionPathCheckpoint(current, [prior, earlier]), buildPositionPathCheckpoint(current, [earlier, prior]));
  assert.notEqual(buildPositionPathCheckpoint(current, [prior]).checkpointIdentity,
    buildPositionPathCheckpoint(current, [prior, earlier]).checkpointIdentity);
});

test('covered-call path uses stock capital and call breakeven, never put collateral and put breakeven', () => {
  const previous = buildPositionPathCheckpoint(state('2026-09-17T15:00:00.000Z', true), []);
  const result = buildPositionPathCheckpoint(state(undefined, true), [previous]);
  assert.equal(result.evidence.breakeven, 202);
  assert.equal(result.capitalDaysObserved, 19000);
  assert.equal(result.evidence.capitalDaysUnit, 'USD_CALENDAR_DAYS_INTERVAL');
});

test('equal event objects after storage roundtrip do not create spurious semantic path changes', () => {
  const previous = buildPositionPathCheckpoint(state(), []);
  const next = JSON.parse(JSON.stringify(previous));
  assert.equal(classifyPathCheckpoint(next, previous).evidenceKind, 'RAW_CYCLE_SNAPSHOT');
});
