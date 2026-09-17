import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementActionFrontier } from '../src/theta/management-action-frontier.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';
import {
  evaluatePaperBootstrapManagementPolicy, PaperBootstrapManagementPolicyProvider,
  type RollCandidate,
} from '../src/theta/paper-bootstrap-management-policy.js';

const state = (lifecycleState: string, overrides: Record<string, unknown> = {},
  observedAt = '2026-09-12T14:00:00.000Z', expiration = '2026-10-16') => assembleManagementInput({
  chain_id: 'chain', lifecycle_state: lifecycleState, underlying_id: 'underlying', underlying: 'AAPL',
  option_leg_id: 'leg', option_contract_id: 'contract', quantity: '1',
  entry_credit_debit: '200', contract_symbol: 'AAPL261016P00200000', option_type: 'PUT', strike: '200',
  expiration_date: expiration, multiplier: '100', bid: '1', ask: '1.1', quote_as_of: observedAt,
  feed: 'OPRA', quote_quality: 'GOOD', realized_option_pnl: '0',
  open_stock_shares: lifecycleState === 'RECOVERY_WAIT' ? '100' : '0',
  stock_basis_per_share: lifecycleState === 'RECOVERY_WAIT' ? '195' : null, realized_stock_pnl: '0', dividends: '0', fees: '0',
  buying_power: '50000', options_buying_power: '40000', account_as_of: observedAt, fusion_snapshot_id: 'fusion',
  snapshot_json: { underlyingState: { last: 205 }, marketSession: { isOpen: false },
    riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } },
  broker_position: lifecycleState === 'RECOVERY_WAIT' ? { currentPrice: 190 } : null,
  ...overrides,
}, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt });

const rollCandidate = (overrides: Partial<RollCandidate> = {}): RollCandidate => ({
  optionContractId: 'target', symbol: 'AAPL261120P00195000', optionType: 'PUT', strike: 195,
  expiration: '2026-11-20', multiplier: 100, quantity: 1, bid: 1.5, ask: 1.6, ...overrides,
});

test('CSP_OPEN with no known reason to act and no roll candidate holds', () => {
  const evidence = evaluatePaperBootstrapManagementPolicy(state('CSP_OPEN'));
  assert.ok(evidence !== null);
  assert.equal(evidence?.selectedAction, 'HOLD');
  assert.ok(evidence?.reasonCodes.includes('BOOTSTRAP_DETERMINISTIC_NO_EMPIRICAL_CLAIM'));
});

test('CSP_OPEN near expiration with near-exhausted remaining value closes deterministically', () => {
  const input = state('CSP_OPEN', { bid: 0.01, ask: 0.02 }, '2026-10-13T14:00:00.000Z');
  const evidence = evaluatePaperBootstrapManagementPolicy(input);
  assert.equal(evidence?.selectedAction, 'CLOSE_FULL');
  const frontier = buildManagementActionFrontier(input, evidence ?? null);
  assert.equal(frontier.selectedAction, 'CLOSE_FULL');
  assert.equal(frontier.decisionState, 'ACTION_SELECTED');
});

test('CSP_OPEN with a complete, positive-net-credit roll candidate rolls without any empirical EV model', () => {
  const input = state('CSP_OPEN', {}, '2026-09-12T14:00:00.000Z');
  const withCandidate = { ...input, rollCandidate: rollCandidate() };
  const evidence = evaluatePaperBootstrapManagementPolicy(withCandidate);
  assert.equal(evidence?.selectedAction, 'ROLL');
  const execution = evidence?.actionValues.find((value) => value.action === 'ROLL')?.executionEvidence;
  assert.equal(execution?.deterministicEconomicsValidated, true);
  assert.ok(execution?.deterministicNetCredit !== null && (execution.deterministicNetCredit ?? 0) > 0);
  assert.equal(execution?.empiricalEconomicsReady, false);
  const frontier = buildManagementActionFrontier(input, evidence ?? null);
  assert.equal(frontier.selectedAction, 'ROLL');
  assert.equal(frontier.decisionState, 'ACTION_SELECTED');
  assert.ok(!frontier.actions.find((action) => action.action === 'ROLL')?.blockers.includes('EMPIRICAL_ACTION_EV_UNKNOWN'));
});

test('a roll candidate with a net debit never outranks passive HOLD', () => {
  // currentMark (close cost) is ~$105 (bid 1 / ask 1.1 * 100). A target with
  // far smaller premium (bid 0.3 / ask 0.4) yields LESS open credit than the
  // known cost to close the old leg -- a genuine net debit.
  const input = state('CSP_OPEN');
  const debitCandidate = rollCandidate({ bid: 0.3, ask: 0.4 });
  const evidence = evaluatePaperBootstrapManagementPolicy({ ...input, rollCandidate: debitCandidate });
  assert.equal(evidence?.selectedAction, 'HOLD');
  const rejected = evidence?.actionValues.find((value) => value.action === 'ROLL');
  assert.ok((rejected?.executionEvidence?.deterministicNetCredit ?? 0) < 0);
});

test('RECOVERY_WAIT with a covered call candidate at or above cost basis sells the call', () => {
  const input = state('RECOVERY_WAIT');
  const cc = rollCandidate({ optionType: 'CALL', strike: 200, bid: 1, ask: 1.2 });
  const evidence = evaluatePaperBootstrapManagementPolicy({ ...input, ccCandidate: cc });
  assert.equal(evidence?.selectedAction, 'SELL_CC');
  const execution = evidence?.actionValues.find((value) => value.action === 'SELL_CC')?.executionEvidence;
  assert.equal(execution?.deterministicEconomicsValidated, true);
  assert.ok((execution?.deterministicNetCredit ?? 0) > 0);
});

test('RECOVERY_WAIT rejects a covered call candidate priced below the known cost basis', () => {
  const input = state('RECOVERY_WAIT');
  const cc = rollCandidate({ optionType: 'CALL', strike: 190, bid: 1, ask: 1.2 });
  const evidence = evaluatePaperBootstrapManagementPolicy({ ...input, ccCandidate: cc });
  assert.equal(evidence?.selectedAction, 'RECOVERY_WAIT');
  const rejected = evidence?.actionValues.find((value) => value.action === 'SELL_CC');
  assert.ok(rejected?.reasons.includes('CC_STRIKE_BELOW_KNOWN_COST_BASIS_REJECTED'));
});

test('CC_OPEN with no known reason to act holds the covered call', () => {
  const evidence = evaluatePaperBootstrapManagementPolicy(state('CC_OPEN'));
  assert.equal(evidence?.selectedAction, 'HOLD_CC');
});

test('the policy never fabricates empirical readiness for any action it selects', () => {
  for (const lifecycle of ['CSP_OPEN', 'RECOVERY_WAIT', 'CC_OPEN']) {
    const evidence = evaluatePaperBootstrapManagementPolicy(state(lifecycle));
    for (const value of evidence?.actionValues ?? []) {
      assert.equal(value.executionEvidence?.empiricalEconomicsReady ?? false, false);
    }
  }
});

test('the provider wires an injected candidate source into evaluate()', async () => {
  const input = state('CSP_OPEN');
  const provider = new PaperBootstrapManagementPolicyProvider({
    async candidatesFor(chainId: string) {
      assert.equal(chainId, input.chainId);
      return { rollCandidate: rollCandidate(), ccCandidate: null };
    },
  });
  const evidence = await provider.evaluate(input);
  assert.equal(evidence?.selectedAction, 'ROLL');
});

test('the provider defaults to no candidates and stays passive', async () => {
  const provider = new PaperBootstrapManagementPolicyProvider();
  const evidence = await provider.evaluate(state('CSP_OPEN'));
  assert.equal(evidence?.selectedAction, 'HOLD');
});
