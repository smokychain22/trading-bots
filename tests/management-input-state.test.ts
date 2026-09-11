import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleManagementInput, diffManagementInputs } from '../src/theta/management-input-state.js';

const base = {
  chain_id: 'chain-1', lifecycle_state: 'CSP_OPEN', underlying: 'AAPL', option_leg_id: 'leg-1', quantity: '1',
  entry_credit_debit: '200', contract_symbol: 'AAPL261016P00200000', option_type: 'PUT', strike: '200',
  expiration_date: '2026-10-16', multiplier: '100', bid: '1.00', ask: '1.10',
  quote_as_of: '2026-09-12T14:00:00.000Z', feed: 'OPRA', quote_quality: 'GOOD', realized_option_pnl: '-50',
  open_stock_shares: '0', stock_basis_per_share: null, realized_stock_pnl: '0', dividends: '0', fees: '2',
  buying_power: '50000', options_buying_power: '40000', fusion_snapshot_id: 'fusion-1',
  snapshot_json: { eventState: { state: 'CLEAR' }, riskState: { assignmentCapacity: 2 },
    portfolioExposure: { concentration: 0.1, sectorCorrelation: 0.2 }, expertPriorState: { state: 'GOOD' } },
  broker_position: null,
};

test('management assembly uses executable ask for a short option and preserves whole-chain loss', () => {
  const state = assembleManagementInput(base, {
    managementInputSnapshotId: 'input-1', reconciliationSnapshotId: 'recon-1', observedAt: '2026-09-12T14:00:00.000Z',
  });
  assert.ok(state.economics.unrealizedOptionPnl !== null && Math.abs(state.economics.unrealizedOptionPnl - 90) < 1e-9);
  assert.equal(state.economics.realizedOptionPnl, -50);
  assert.ok(state.economics.wholeChainPnl !== null && Math.abs(state.economics.wholeChainPnl - 38) < 1e-9);
  assert.equal(state.market.moneyness, null);
  assert.equal(state.economicModelState, 'EV_MODEL_NOT_EMPIRICALLY_READY');
});

test('missing quote and multiplier stay unknown and create mechanical blockers', () => {
  const state = assembleManagementInput({ ...base, multiplier: null, bid: null, ask: null, quote_as_of: null }, {
    managementInputSnapshotId: 'input-2', reconciliationSnapshotId: 'recon-1', observedAt: '2026-09-12T14:00:00.000Z',
  });
  assert.equal(state.economics.unrealizedOptionPnl, null);
  assert.equal(state.economics.wholeChainPnl, null);
  assert.deepEqual(state.hardBlockers, ['EXECUTABLE_QUOTE_UNAVAILABLE', 'MULTIPLIER_UNKNOWN']);
  assert.ok(state.unknownFields.includes('market.iv'));
  assert.ok(state.unknownFields.includes('context.dividendExDateState'));
});

test('real broker stock marks expose assigned inventory losses', () => {
  const state = assembleManagementInput({ ...base, contract_symbol: null, option_leg_id: null, quantity: null,
    entry_credit_debit: null, bid: null, ask: null, quote_as_of: null, lifecycle_state: 'RECOVERY_WAIT',
    open_stock_shares: '100', stock_basis_per_share: '198', broker_position: { currentPrice: 180 } }, {
    managementInputSnapshotId: 'input-3', reconciliationSnapshotId: 'recon-1', observedAt: '2026-09-12T14:00:00.000Z',
  });
  assert.equal(state.economics.unrealizedStockPnl, -1800);
  assert.equal(state.economics.wholeChainPnl, -1852);
});

test('management changes identify economic and market changes without treating IDs as strategy evidence', () => {
  const previous = assembleManagementInput(base, {
    managementInputSnapshotId:'old',reconciliationSnapshotId:'old-recon',observedAt:'2026-09-12T14:00:00.000Z',
  });
  const current = assembleManagementInput({ ...base, ask:'1.50' }, {
    managementInputSnapshotId:'new',reconciliationSnapshotId:'new-recon',observedAt:'2026-09-12T14:00:01.000Z',
  });
  const changes = diffManagementInputs(previous,current);
  assert.ok(changes.some((change) => change.path === 'market.optionAsk'));
  assert.ok(changes.some((change) => change.path === 'economics.unrealizedOptionPnl'));
  assert.equal(changes.some((change) => change.path === 'managementInputSnapshotId'),false);
});

test('management content hash is deterministic and excludes its random persistence id', () => {
  const first = assembleManagementInput(base, {
    managementInputSnapshotId:'one',reconciliationSnapshotId:'recon',observedAt:'2026-09-12T14:00:00.000Z',
  });
  const second = assembleManagementInput(base, {
    managementInputSnapshotId:'two',reconciliationSnapshotId:'recon',observedAt:'2026-09-12T14:00:00.000Z',
  });
  assert.equal(first.contentHash,second.contentHash);
});
