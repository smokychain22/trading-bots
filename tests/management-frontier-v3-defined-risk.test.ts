import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { buildDefinedRiskManagementActionFrontier, managementActionFrontierVersion, managementActionFrontierVersionV3,
  type DefinedRiskManagementProposal } from '../src/theta/management-action-frontier.js';
import { assessDefinedRiskManagement, definedRiskManagementProposal, type DefinedRiskManagementInput } from '../src/execution/defined-risk-management.js';

// Management-authority revision v3: a native spread is decided by the ONE sovereign management frontier (D proposes, the frontier selects,
// the coordinator executes). Wheel frontiers stay on v2.
const NOW = '2026-10-07T15:00:00.000Z';
const proposal = (patch: Partial<DefinedRiskManagementProposal> = {}): DefinedRiskManagementProposal => ({ producerVersion: 'theta-defined-risk-management-v1',
  chainId: '11111111-1111-4111-8111-111111111111', orderIntentId: '22222222-2222-4222-8222-222222222222', positionState: 'OPEN', proposedAction: 'HOLD',
  closeRequired: false, quotesExecutable: true, closeQuantity: 1, nakedShortContracts: 0, reasons: ['NO_D_SAFETY_TRIGGER'], proposalHash: 'a'.repeat(64), ...patch });

test('v3 D frontier: a healthy spread HOLDs; a required close with both legs quoted selects CLOSE_FULL; the frontier is v3 / DEFINED_RISK_OPEN', () => {
  const hold = buildDefinedRiskManagementActionFrontier(proposal());
  assert.equal(hold.contractVersion, managementActionFrontierVersionV3);
  assert.equal(hold.lifecycleState, 'DEFINED_RISK_OPEN');
  assert.equal(hold.selectedAction, 'HOLD');
  assert.deepEqual(hold.actions.map((action) => action.action), ['HOLD', 'CLOSE_FULL', 'EMERGENCY_RISK_REDUCTION']);
  const close = buildDefinedRiskManagementActionFrontier(proposal({ proposedAction: 'CLOSE_FULL', closeRequired: true, reasons: ['D_EXPIRY_PIN_RISK'] }));
  assert.equal(close.selectedAction, 'CLOSE_FULL');
  assert.equal(close.decisionState, 'ACTION_SELECTED');
  assert.deepEqual(close.actions.find((action) => action.action === 'CLOSE_FULL')?.requiredOptionPositionIntents, ['BUY_TO_CLOSE', 'SELL_TO_CLOSE'],
    'the close is the whole package: both legs');
  assert.notEqual(managementActionFrontierVersion, managementActionFrontierVersionV3, 'Wheel frontiers keep the v2 contract');
});

test('v3 D frontier: a required close that is not executable (a leg unquoted / nothing hedged) is HOLD with the mandatory close recorded, never a one-leg order', () => {
  for (const patch of [{ quotesExecutable: false }, { closeQuantity: 0 }]) {
    const frontier = buildDefinedRiskManagementActionFrontier(proposal({ proposedAction: 'HOLD', closeRequired: true, ...patch }));
    assert.equal(frontier.selectedAction, 'HOLD');
    assert.ok(frontier.reasonCodes.includes('D_MANDATORY_CLOSE_FULL_NOT_FEASIBLE'));
    assert.equal(frontier.actions.find((action) => action.action === 'CLOSE_FULL')?.feasibility, 'INFEASIBLE');
  }
  // the frontier is the authority: a producer that proposes CLOSE_FULL on unexecutable quotes still can not get a close selected
  assert.equal(buildDefinedRiskManagementActionFrontier(proposal({ proposedAction: 'CLOSE_FULL', closeRequired: true, quotesExecutable: false })).selectedAction, 'HOLD');
});

test('v3 D frontier: an unhedged short selects EMERGENCY_RISK_REDUCTION (escalation-only), never HOLD and never a package close of a structure that no longer exists', () => {
  const frontier = buildDefinedRiskManagementActionFrontier(proposal({ proposedAction: 'EMERGENCY_RISK_REDUCTION', positionState: 'DIVERGED_EMERGENCY', nakedShortContracts: 1,
    closeRequired: false, reasons: ['NAKED_SHORT_PUT_EXPOSURE'] }));
  assert.equal(frontier.selectedAction, 'EMERGENCY_RISK_REDUCTION');
  const emergency = frontier.actions.find((action) => action.action === 'EMERGENCY_RISK_REDUCTION');
  assert.ok(emergency?.reasons.includes('ESCALATION_ONLY_NO_AUTOMATED_ORDER'));
  assert.equal(emergency?.executionEvidence, null, 'no executable order is attached to the emergency in this revision');
  assert.equal(frontier.actions.find((action) => action.action === 'HOLD')?.feasibility, 'INFEASIBLE');
  assert.equal(frontier.actions.find((action) => action.action === 'CLOSE_FULL')?.feasibility, 'INFEASIBLE');
});

test('v3 D frontier: unknown broker leg truth is a SYSTEM_HOLD; a terminal spread has no frontier action', () => {
  const unknown = buildDefinedRiskManagementActionFrontier(proposal({ proposedAction: 'WAIT_FOR_BROKER_TRUTH', closeRequired: true, reasons: ['BROKER_LEG_QUANTITY_UNKNOWN'] }));
  assert.equal(unknown.selectedAction, 'HOLD');
  assert.equal(unknown.decisionState, 'SYSTEM_HOLD_MISSING_EVIDENCE');
  assert.equal(unknown.actions.find((action) => action.action === 'CLOSE_FULL')?.feasibility, 'INFEASIBLE');
  const terminal = buildDefinedRiskManagementActionFrontier(proposal({ proposedAction: 'NO_ACTION_TERMINAL', positionState: 'CLOSED' }));
  assert.equal(terminal.selectedAction, null);
  assert.ok(terminal.actions.every((action) => action.feasibility === 'INFEASIBLE'));
});

test('the D producer maps onto the frontier: an emergency proposal from real producer output selects EMERGENCY_RISK_REDUCTION; a pin-risk close selects CLOSE_FULL', () => {
  const base: DefinedRiskManagementInput = { orderIntentId: '22222222-2222-4222-8222-222222222222', chainId: '11111111-1111-4111-8111-111111111111', state: 'OPEN',
    exposure: { shortOpen: 1, longOpen: 1, nakedShortContracts: 0, excessLongContracts: 0, hedgedSpreads: 1 }, shortSymbol: 'SPY261009P00500000', longSymbol: 'SPY261009P00495000',
    shortStrike: 500, longStrike: 495, observedAt: NOW, brokerOpenContracts: { short: 1, long: 1 },
    shortQuote: { symbol: 'SPY261009P00500000', bid: 1.0, ask: 1.1, observedAt: NOW }, longQuote: { symbol: 'SPY261009P00495000', bid: 0.4, ask: 0.5, observedAt: NOW },
    quoteFeed: 'INDICATIVE',
    spot: 500.2, dte: 0, marketOpen: true, closeOrderWorking: false, context: { eventState: 'CLEAR', aegisState: 'ALLOW_FULL', executionQuality: 'GOOD' },
    pinBandPct: 0.002, maximumQuoteAgeSeconds: 30 };
  const pin = assessDefinedRiskManagement(base);
  assert.equal(buildDefinedRiskManagementActionFrontier(definedRiskManagementProposal(pin, base)).selectedAction, 'CLOSE_FULL');
  const nakedInput = { ...base, state: 'DIVERGED_EMERGENCY' as const, brokerOpenContracts: { short: 1, long: 0 },
    exposure: { shortOpen: 1, longOpen: 0, nakedShortContracts: 1, excessLongContracts: 0, hedgedSpreads: 0 } };
  const naked = assessDefinedRiskManagement(nakedInput);
  assert.equal(buildDefinedRiskManagementActionFrontier(definedRiskManagementProposal(naked, nakedInput)).selectedAction, 'EMERGENCY_RISK_REDUCTION');
});

test('AUTHORITY: the D runner executes only the v3 frontier selection, and only the frontier module builds a frontier', () => {
  const runner = readFileSync(join(import.meta.dirname, '..', 'src', 'execution', 'defined-risk-management-runner.ts'), 'utf8');
  assert.match(runner, /buildDefinedRiskManagementActionFrontier\(definedRiskManagementProposal\(/);
  assert.match(runner, /const closeSelected = frontier\.selectedAction === 'CLOSE_FULL';/);
  assert.doesNotMatch(runner, /decision\.action === 'CLOSE_FULL'/, 'the producer\'s proposal must never trigger a close on its own');
});

test('D emergency plan is typed per state, names the one risk-reducing operator action, and stays ESCALATION_ONLY (no automated order)', async () => {
  const { definedRiskEmergencyPlan } = await import('../src/theta/management-action-frontier.js');
  assert.deepEqual(definedRiskEmergencyPlan(['NAKED_SHORT_PUT_EXPOSURE']), { kind: 'UNHEDGED_SHORT_PUT', operatorAction: 'BUY_TO_CLOSE_UNHEDGED_SHORT_PUT_WITH_LIMIT',
    autonomy: 'ESCALATION_ONLY', autonomyReason: 'AUTOMATED_SINGLE_LEG_EMERGENCY_ORDER_PATH_NOT_CERTIFIED' });
  assert.equal(definedRiskEmergencyPlan(['BROKER_SHOWS_UNHEDGED_SHORT_PUT', 'LEDGER_BROKER_LEG_MISMATCH']).kind, 'UNHEDGED_SHORT_PUT');
  assert.equal(definedRiskEmergencyPlan(['SHORT_STOCK_FROM_LONG_LEG_EXERCISE_WITHOUT_ASSIGNMENT']).operatorAction, 'BUY_TO_COVER_SHORT_STOCK_WITH_LIMIT');
  for (const reasons of [['LEG_TRUTH_INCONSISTENT'], ['DIVERGED_STATE_NOT_AUTO_RESOLVABLE'], ['LEDGER_BROKER_LEG_MISMATCH']]) {
    assert.equal(definedRiskEmergencyPlan(reasons).operatorAction, 'RECONCILE_BROKER_TRUTH_BEFORE_ANY_ORDER', 'divergence is reconciled, never traded through');
  }
  assert.equal(definedRiskEmergencyPlan(['SOMETHING_NEW']).kind, 'UNCLASSIFIED_EMERGENCY');
  const frontier = buildDefinedRiskManagementActionFrontier(proposal({ proposedAction: 'EMERGENCY_RISK_REDUCTION', positionState: 'DIVERGED_EMERGENCY',
    nakedShortContracts: 1, reasons: ['NAKED_SHORT_PUT_EXPOSURE'] }));
  const emergency = frontier.actions.find((action) => action.action === 'EMERGENCY_RISK_REDUCTION');
  assert.ok(emergency?.reasons.includes('D_EMERGENCY_KIND:UNHEDGED_SHORT_PUT'));
  assert.ok(emergency?.reasons.includes('OPERATOR_ACTION:BUY_TO_CLOSE_UNHEDGED_SHORT_PUT_WITH_LIMIT'));
  assert.equal(emergency?.executionEvidence, null, 'no executable order is attached');
});
