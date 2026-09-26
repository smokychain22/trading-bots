import assert from 'node:assert/strict';
import test from 'node:test';
import { FilterInteractionTrialLedger, REGISTERED_FEATURE_INTERACTIONS } from '../src/research/filter-interaction-registry.js';

test('exactly the 7 directive-named interactions are pre-registered', () => {
  assert.equal(REGISTERED_FEATURE_INTERACTIONS.length, 7);
  const ids = REGISTERED_FEATURE_INTERACTIONS.map((i) => i.interactionId);
  assert.deepEqual(ids, [
    'FLOW_X_REGIME', 'FLOW_X_IV_RV', 'EVENT_X_DTE', 'TREND_X_VOLATILITY',
    'LIQUIDITY_X_EXECUTION_COST', 'CORRELATION_X_PORTFOLIO_EXPOSURE', 'DELTA_X_DTE',
  ]);
});

test('CORE CLAIM: an unregistered interaction cannot be trial-registered -- no unconstrained data mining', () => {
  const ledger = new FilterInteractionTrialLedger();
  assert.throws(() => ledger.register('MADE_UP_INTERACTION', true, '2026-09-26T00:00:00Z'), /FILTER_INTERACTION_NOT_PRE_REGISTERED/);
});

test('every registered trial counts toward numberOfTrials, including abandoned (evaluated=false) ones', () => {
  const ledger = new FilterInteractionTrialLedger();
  ledger.register('FLOW_X_REGIME', true, '2026-09-26T00:00:00Z');
  ledger.register('FLOW_X_IV_RV', false, '2026-09-26T00:00:00Z');
  assert.equal(ledger.numberOfTrials(), 2);
  assert.equal(ledger.trialIdentities().length, 2);
});

test('re-registering the same interaction produces a distinct trial identity each time', () => {
  const ledger = new FilterInteractionTrialLedger();
  const first = ledger.register('EVENT_X_DTE', true, '2026-09-26T00:00:00Z');
  const second = ledger.register('EVENT_X_DTE', true, '2026-09-26T01:00:00Z');
  assert.notEqual(first.trialIdentity, second.trialIdentity);
});
