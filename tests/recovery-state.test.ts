import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecoveryState } from '../src/theta/recovery-state.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';
import { computeEffectiveStockBasis, type WholeChainComponents } from '../src/theta/whole-chain-economics.js';

const state = (overrides: Record<string, unknown> = {}) => assembleManagementInput({
  chain_id: 'chain', lifecycle_state: 'RECOVERY_WAIT', underlying_id: 'underlying', underlying: 'AAPL',
  option_leg_id: null, option_contract_id: null, quantity: '0',
  entry_credit_debit: null, contract_symbol: null, option_type: null, strike: null,
  expiration_date: null, multiplier: null, bid: null, ask: null, quote_as_of: null,
  feed: null, quote_quality: null, realized_option_pnl: '0', open_stock_shares: '100',
  stock_basis_per_share: '195', realized_stock_pnl: '0', dividends: '0', fees: '0',
  buying_power: '50000', options_buying_power: '40000', account_as_of: '2026-09-12T14:00:00.000Z', fusion_snapshot_id: 'fusion',
  snapshot_json: { underlyingState: { last: 180 }, marketSession: { isOpen: false },
    riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } },
  broker_position: { currentPrice: 180 },
  ...overrides,
}, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt: '2026-09-12T14:00:00.000Z' });

test('computes distance-to-basis and drawdown honestly from known stock basis and mark', () => {
  const recovery = buildRecoveryState(state());
  assert.ok(recovery.distanceToBasisFraction !== null && recovery.distanceToBasisFraction < 0);
  assert.equal(recovery.drawdownFraction, recovery.distanceToBasisFraction);
});

test('never fabricates a recovery probability, recovery time, or further-downside estimate', () => {
  const recovery = buildRecoveryState(state());
  assert.equal(recovery.recoveryProbabilityEstimate, null);
  assert.equal(recovery.expectedRecoveryTimeDays, null);
  assert.equal(recovery.furtherDownsideEstimate, null);
});

test('capital-days and opportunity cost stay UNKNOWN without caller-supplied entry data, and are named as required', () => {
  const recovery = buildRecoveryState(state());
  assert.equal(recovery.capitalDaysSoFar, null);
  assert.equal(recovery.capitalOpportunityCostDollars, null);
  assert.ok(recovery.dataCompleteness.requiresCallerInput.some((field) => field.startsWith('assignedAtObservedAt')));
  assert.ok(recovery.dataCompleteness.requiresCallerInput.some((field) => field.startsWith('annualOpportunityCostRate')));
});

test('computes capital-days and opportunity cost honestly when the caller supplies entry data and a justified rate', () => {
  const recovery = buildRecoveryState(state(), '2026-08-13T14:00:00.000Z', 0.05);
  assert.ok(recovery.capitalDaysSoFar !== null && recovery.capitalDaysSoFar > 0);
  assert.ok(recovery.capitalOpportunityCostDollars !== null && recovery.capitalOpportunityCostDollars > 0);
});

test('without wholeChainComponents, canonicalEffectiveBasisPerShare is null and the broker-recorded figure is exposed separately with an honest source label', () => {
  const recovery = buildRecoveryState(state());
  assert.equal(recovery.canonicalEffectiveBasisPerShare, null);
  assert.equal(recovery.brokerRecordedBasisPerShare, 195); // the fixture's raw stock_basis_per_share
  assert.equal(recovery.basisSource, 'BROKER_RECORDED_REFERENCE');
  assert.equal(recovery.bestAvailableBasisPerShare, 195); // the lower-confidence reference actually used for calculations
  assert.ok(recovery.dataCompleteness.requiresCallerInput.some((field) => field.startsWith('wholeChainComponents (for the ONE canonical')));
});

test('with complete wholeChainComponents, canonicalEffectiveBasisPerShare is the SAME figure computeEffectiveStockBasis itself produces -- never a second formula, and basisSource is CANONICAL_WHOLE_CHAIN', () => {
  const chain: WholeChainComponents = {
    initialPutPremium: 300, rollCredits: 50, rollCloseCosts: 20, assignmentStrike: 195, stockSharesAssigned: 100,
    dividends: 0, coveredCallPremium: null, coveredCallCloseCosts: null, stockSaleOrCallAwayProceeds: null,
    fees: 3, slippage: 1, currentStockMarkPerShare: 180, openStockShares: 100,
  };
  const canonical = computeEffectiveStockBasis(chain);
  assert.equal(canonical.complete, true);
  const recovery = buildRecoveryState(state(), null, null, chain);
  assert.equal(recovery.canonicalEffectiveBasisPerShare, canonical.effectiveStockBasisPerShare);
  assert.equal(recovery.basisSource, 'CANONICAL_WHOLE_CHAIN');
  assert.equal(recovery.bestAvailableBasisPerShare, canonical.effectiveStockBasisPerShare);
  // The broker-recorded reference remains separately visible and
  // unchanged -- the canonical figure never overwrites it, it only takes
  // priority for bestAvailableBasisPerShare/basisSource.
  assert.equal(recovery.brokerRecordedBasisPerShare, 195);
  assert.notEqual(recovery.canonicalEffectiveBasisPerShare, 195);
});

test('with incomplete wholeChainComponents, canonicalEffectiveBasisPerShare stays null (never fabricated from partial data) and the broker reference is used as the lower-confidence fallback, named exactly why', () => {
  const incompleteChain: WholeChainComponents = {
    initialPutPremium: null, rollCredits: null, rollCloseCosts: null, assignmentStrike: 195, stockSharesAssigned: 100,
    dividends: 0, coveredCallPremium: null, coveredCallCloseCosts: null, stockSaleOrCallAwayProceeds: null,
    fees: 3, slippage: null, currentStockMarkPerShare: 180, openStockShares: 100,
  };
  const recovery = buildRecoveryState(state(), null, null, incompleteChain);
  assert.equal(recovery.canonicalEffectiveBasisPerShare, null);
  assert.equal(recovery.basisSource, 'BROKER_RECORDED_REFERENCE');
  assert.equal(recovery.bestAvailableBasisPerShare, 195);
  assert.ok(recovery.dataCompleteness.requiresCallerInput.some((field) =>
    field.includes('incomplete') && field.includes('initialPutPremium')));
});

test('with no canonical AND no broker basis available, basisSource is UNKNOWN and bestAvailableBasisPerShare is null -- never a fabricated zero', () => {
  const recovery = buildRecoveryState(state({ stock_basis_per_share: null }));
  assert.equal(recovery.canonicalEffectiveBasisPerShare, null);
  assert.equal(recovery.brokerRecordedBasisPerShare, null);
  assert.equal(recovery.basisSource, 'UNKNOWN');
  assert.equal(recovery.bestAvailableBasisPerShare, null);
});

test('a position at or above basis reports no drawdown', () => {
  const recovery = buildRecoveryState(state({ snapshot_json: { underlyingState: { last: 200 }, marketSession: { isOpen: false },
    riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } }, broker_position: { currentPrice: 200 } }));
  assert.ok(recovery.distanceToBasisFraction !== null && recovery.distanceToBasisFraction > 0);
  assert.equal(recovery.drawdownFraction, null);
});
