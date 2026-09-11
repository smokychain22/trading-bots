import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyAndApplyBrokerLifecycle, type LifecycleApplicationStore } from '../src/execution/broker-lifecycle-application.js';
import type { ManagedOptionLifecycleInput } from '../src/execution/broker-lifecycle-evidence.js';
import type { LifecycleApplication } from '../src/theta/postgres-lifecycle-application-store.js';

const input = (confirmed: boolean): ManagedOptionLifecycleInput => ({
  chainId:'chain-1', currentState:'CSP_OPEN', legKind:'SHORT_PUT', optionSymbol:'AAPL261016P00150000',
  underlyingSymbol:'AAPL', contracts:1, multiplier:100,
  previousPositions:[{ symbol:'AAPL261016P00150000', quantity:-1 }],
  currentPositions:confirmed ? [{ symbol:'AAPL', quantity:100 }] : [],
  activities:confirmed ? [{ id:'activity-1', activityType:'OPASN', symbol:'AAPL261016P00150000', quantity:1,
    price:null, date:'2026-10-16', orderId:null }] : [], observedAt:'2026-10-16T21:00:00.000Z',
});

const application = (): LifecycleApplication => ({ eventKind:'SHORT_PUT_ASSIGNMENT',
  evidenceKey:createHash('sha256').update('event').digest('hex'), chainId:'chain-1', occurredAt:'2026-10-16T21:00:00.000Z',
  decisionId:null, providerActivityRefHash:createHash('sha256').update('activity-1').digest('hex'),
  optionLegId:'leg-1', stockLotId:'stock-1', shares:100, strikePrice:150, brokerBasisPerShare:null,
  economicBasisPerShare:150, realizedOptionPnl:200 });

test('UNKNOWN broker lifecycle evidence never reaches the atomic writer', async () => {
  let calls = 0;
  const store: LifecycleApplicationStore = { apply: async () => { calls += 1; throw new Error('must not run'); } };
  const result = await classifyAndApplyBrokerLifecycle(input(false), store, () => application());
  assert.equal(result.evidence.state, 'UNKNOWN');
  assert.equal(result.application, null);
  assert.equal(calls, 0);
});

test('confirmed broker lifecycle evidence reaches the atomic writer exactly once', async () => {
  let calls = 0;
  const store: LifecycleApplicationStore = { apply: async (value) => {
    calls += 1; return { applicationId:'app-1', duplicate:false, chainId:value.chainId,
      eventKind:value.eventKind, transitionPath:['ASSIGNED','STOCK_HELD','RECOVERY_WAIT'], finalState:'RECOVERY_WAIT' };
  } };
  const result = await classifyAndApplyBrokerLifecycle(input(true), store, () => application());
  assert.equal(result.evidence.state, 'CONFIRMED');
  assert.equal(result.application?.finalState, 'RECOVERY_WAIT');
  assert.equal(calls, 1);
});

test('a mismatched broker evidence hash is rejected before persistence', async () => {
  const store: LifecycleApplicationStore = { apply: async () => { throw new Error('must not run'); } };
  await assert.rejects(() => classifyAndApplyBrokerLifecycle(input(true), store, () => ({ ...application(),
    providerActivityRefHash:createHash('sha256').update('wrong').digest('hex') })), /BROKER_EVIDENCE_MISMATCH/);
});
