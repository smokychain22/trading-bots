import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFirstCanaryAcceptanceReceipt, type FirstCanaryAcceptanceInput } from '../src/execution/first-canary-acceptance.js';
import type { Evidence } from '../src/theta/first-paper-order-readiness.js';

const at = '2026-09-21T14:35:00.000Z';
const good = <T>(value: T): Evidence<T> => ({ state:'GOOD', value, source:'ALPACA_PAPER', asOf:at });
const input = (): FirstCanaryAcceptanceInput => ({
  asOf:at,
  expected:{ executionAccountId:'master-paper-account',occContract:'AAPL261016P00150000',side:'sell',positionIntent:'sell_to_open',quantity:1,clientOrderId:'theta-canary-1' },
  persistence:{ decisionPersisted:good(true),orderIntentPersisted:good(true),idempotencyReserved:good(true),deterministicClientOrderId:good(true) },
  broker:{ executionAccountId:good('master-paper-account'),occContract:good('AAPL261016P00150000'),side:good('sell'),positionIntent:good('sell_to_open'),
    requestedQuantity:good(1),filledQuantity:good(1),clientOrderId:good('theta-canary-1'),orderState:good('FILLED'),acknowledgementObserved:good(true),duplicateEconomicExposureCount:good(1) },
  evidence:{ reconciliationComplete:good(true),tcaPersisted:good(true),lifecycleApplied:good(true),newRiskRelocked:good(true),managementEnabled:good(true),
    followerMutationCount:good(0),liveMutationCount:good(0) },
});

test('a reconciled filled canary is accepted only with TCA, lifecycle, relock, and isolation evidence',()=>{
  const receipt=buildFirstCanaryAcceptanceReceipt(input());
  assert.equal(receipt.status,'ACCEPTED');
  assert.deepEqual(receipt.blockers,[]);
  assert.deepEqual(receipt.pending,[]);
  assert.match(receipt.contentHash,/^[0-9a-f]{64}$/);
});

test('an acknowledged working canary remains in progress rather than being called accepted',()=>{
  const base=input();
  const receipt=buildFirstCanaryAcceptanceReceipt({...base,broker:{...base.broker,orderState:good('WORKING'),filledQuantity:good(0)}});
  assert.equal(receipt.status,'IN_PROGRESS');
  assert.deepEqual(receipt.pending,['BROKER_ORDER_WORKING']);
});

test('a broker rejection is recorded without claiming canary acceptance or fill economics',()=>{
  const base=input();
  const receipt=buildFirstCanaryAcceptanceReceipt({...base,broker:{...base.broker,orderState:good('REJECTED'),filledQuantity:good(0)},
    evidence:{...base.evidence,tcaPersisted:good(false),lifecycleApplied:good(false)}});
  assert.equal(receipt.status,'FAILED');
  assert.deepEqual(receipt.blockers,['BROKER_ORDER_REJECTED']);
});

test('a canceled or expired unfilled order cannot remain pending forever or count as accepted',()=>{
  const base=input();
  for (const state of ['CANCELED','EXPIRED'] as const) {
    const receipt=buildFirstCanaryAcceptanceReceipt({...base,broker:{...base.broker,orderState:good(state),filledQuantity:good(0)},
      evidence:{...base.evidence,tcaPersisted:good(false),lifecycleApplied:good(false)}});
    assert.equal(receipt.status,'FAILED');
    assert.ok(receipt.blockers.includes(`BROKER_ORDER_${state}`));
  }
});

test('identity mismatch, duplicate exposure, follower mutation, or missing relock fails acceptance',()=>{
  const base=input();
  const receipt=buildFirstCanaryAcceptanceReceipt({...base,broker:{...base.broker,occContract:good('MSFT261016P00150000'),duplicateEconomicExposureCount:good(2)},
    evidence:{...base.evidence,newRiskRelocked:good(false),followerMutationCount:good(1)}});
  assert.equal(receipt.status,'FAILED');
  assert.ok(receipt.blockers.includes('BROKER_CONTRACT_MISMATCH'));
  assert.ok(receipt.blockers.includes('DUPLICATE_ECONOMIC_EXPOSURE'));
  assert.ok(receipt.blockers.includes('NEW_RISK_RELOCKED_FALSE'));
  assert.ok(receipt.blockers.includes('FOLLOWER_MUTATION_DETECTED'));
});
