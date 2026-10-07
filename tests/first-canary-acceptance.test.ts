import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFirstCanaryAcceptanceReceipt, type FirstCanaryAcceptanceInput } from '../src/execution/first-canary-acceptance.js';
import type { Evidence } from '../src/theta/first-paper-order-readiness.js';

const at = '2026-09-21T14:35:00.000Z';
const good = <T>(value: T): Evidence<T> => ({ state:'GOOD', value, source:'ALPACA_PAPER', asOf:at });
const input = (): FirstCanaryAcceptanceInput => ({
  asOf:at,
  expected:{ orderIntentId:'order-intent-1',executionAccountId:'master-paper-account',occContract:'AAPL261016P00150000',side:'sell',positionIntent:'sell_to_open',quantity:1,clientOrderId:'theta-canary-1' },
  persistence:{ decisionPersisted:good(true),orderIntentPersisted:good(true),idempotencyReserved:good(true),deterministicClientOrderId:good(true) },
  broker:{ executionAccountId:good('master-paper-account'),occContract:good('AAPL261016P00150000'),side:good('sell'),positionIntent:good('sell_to_open'),
    requestedQuantity:good(1),filledQuantity:good(1),clientOrderId:good('theta-canary-1'),orderState:good('FILLED'),acknowledgementObserved:good(true),duplicateEconomicExposureCount:good(1) },
  evidence:{ reconciliationComplete:good(true),tcaPersisted:good(true),lifecycleApplied:good(true),managementRegistered:good(true),
    futureObservationsScheduled:good(true),newRiskRelocked:good(true),managementEnabled:good(true),
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

test('a first canary larger than one contract is rejected even when broker quantities match',()=>{
  const base=input();
  const receipt=buildFirstCanaryAcceptanceReceipt({...base,
    expected:{...base.expected,quantity:2},
    broker:{...base.broker,requestedQuantity:good(2),filledQuantity:good(2)},
  });
  assert.equal(receipt.status,'FAILED');
  assert.ok(receipt.blockers.includes('FIRST_PAPER_CANARY_QUANTITY_MUST_BE_ONE'));
});

test('a filled canary cannot activate without management ownership and future observations',()=>{
  const base=input();
  const receipt=buildFirstCanaryAcceptanceReceipt({...base,evidence:{...base.evidence,
    managementRegistered:good(false),futureObservationsScheduled:good(false)}});
  assert.equal(receipt.status,'FAILED');
  assert.ok(receipt.blockers.includes('MANAGEMENT_REGISTERED_FALSE'));
  assert.ok(receipt.blockers.includes('FUTURE_OBSERVATIONS_SCHEDULED_FALSE'));
});

test('D CANARY: a native two-leg canary is accepted on its exact leg set (order-insensitive), and never with a leg missing, mismatched or partly filled', async () => {
  const { buildFirstCanaryAcceptanceReceipt } = await import('../src/execution/first-canary-acceptance.js');
  const at = '2026-10-07T15:00:00.000Z';
  const ok = <T>(value: T) => ({ state: 'GOOD' as const, value, source: 'TEST', asOf: at });
  const expectedLegs = [{ occ: 'SPY261016P00500000', positionIntent: 'sell_to_open', ratio: 1 }, { occ: 'SPY261016P00495000', positionIntent: 'buy_to_open', ratio: 1 }];
  const brokerLegs = (fills: [number, number], legs = expectedLegs) => ok([...legs].reverse().map((leg, index) => ({ ...leg, filledQuantity: fills[index] as number })));
  const input = (packageLegs: ReturnType<typeof brokerLegs>, orderState: 'FILLED' | 'WORKING' = 'FILLED') => ({ asOf: at,
    expected: { orderIntentId: 'i', executionAccountId: 'a', occContract: 'MLEG:pkg', side: 'sell' as const, positionIntent: 'sell_to_open' as const,
      quantity: 1, clientOrderId: 'c', package: { legs: expectedLegs } },
    persistence: { decisionPersisted: ok(true), orderIntentPersisted: ok(true), idempotencyReserved: ok(true), deterministicClientOrderId: ok(true) },
    broker: { executionAccountId: ok('a'), occContract: ok('MLEG:any-provider-order'), side: ok('buy'),
      positionIntent: { state: 'INVALID' as const, value: null, source: 'MLEG_PARENT', asOf: at }, requestedQuantity: ok(1),
      filledQuantity: ok(orderState === 'FILLED' ? 1 : 0), clientOrderId: ok('c'), orderState: ok(orderState), acknowledgementObserved: ok(true),
      duplicateEconomicExposureCount: ok(1), packageLegs },
    evidence: { reconciliationComplete: ok(true), tcaPersisted: ok(true), lifecycleApplied: ok(true), managementRegistered: ok(true),
      futureObservationsScheduled: ok(true), newRiskRelocked: ok(true), managementEnabled: ok(true), followerMutationCount: ok(0), liveMutationCount: ok(0) } });
  const accepted = buildFirstCanaryAcceptanceReceipt(input(brokerLegs([1, 1])));
  assert.equal(accepted.status, 'ACCEPTED', JSON.stringify(accepted.blockers));
  assert.equal(buildFirstCanaryAcceptanceReceipt(input(brokerLegs([1, 1]), 'WORKING')).status, 'IN_PROGRESS');
  assert.ok(buildFirstCanaryAcceptanceReceipt(input(brokerLegs([1, 0]))).blockers.includes('PACKAGE_LEG_FILL_NOT_COMPLETE'));
  const wrong = [{ ...expectedLegs[0]!, occ: 'SPY261016P00490000' }, expectedLegs[1]!];
  assert.ok(buildFirstCanaryAcceptanceReceipt(input(brokerLegs([1, 1], wrong))).blockers.includes('BROKER_PACKAGE_IDENTITY_MISMATCH'));
  const noLegs = { ...input(brokerLegs([1, 1])) };
  assert.ok(buildFirstCanaryAcceptanceReceipt({ ...noLegs, broker: { ...noLegs.broker, packageLegs: undefined } }).blockers.includes('BROKER_PACKAGE_LEGS_MISSING'));
  const { packageNetPrice } = await import('../src/execution/confirmed-fill-tca.js');
  assert.equal(Number(packageNetPrice([{ positionIntent: 'sell_to_open', ratio: 1, averageFillPrice: 1.1 }, { positionIntent: 'buy_to_open', ratio: 1, averageFillPrice: 0.45 }]).toFixed(2)), 0.65,
    'a credit spread nets the short premium minus the long premium');
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/execution/postgres-first-canary-acceptance.ts', 'utf8');
  assert.match(source, /JOIN market\.option_contract oc ON oc\.option_contract_id=oi\.option_contract_id/, 'the certified single-leg Q/H query is unchanged');
  assert.match(source, /const definedRisk=await reconcileDefinedRiskCanary\(input\);/, 'an mleg canary is never silently invisible to acceptance');
});

test('CANARY STATE MACHINE: every Alpaca status maps to one typed canary state; a partial fill is occupied (pending), never accepted or re-armable', async () => {
  const { classifyAlpacaCanaryOrderState } = await import('../src/execution/postgres-first-canary-acceptance.js');
  const expected: Record<string, string | null> = { new: 'WORKING', accepted: 'WORKING', pending_new: 'WORKING', partially_filled: 'PARTIAL', filled: 'FILLED',
    rejected: 'REJECTED', canceled: 'CANCELED', expired: 'EXPIRED', done_for_day: 'CANCELED', something_new: null };
  for (const [status, state] of Object.entries(expected)) {
    const actual = classifyAlpacaCanaryOrderState(status);
    if (state === null) assert.equal(actual, null, `${status} is UNKNOWN evidence, never a guessed state`);
    else assert.equal(actual, state, status);
  }
  const base = input();
  const partial = buildFirstCanaryAcceptanceReceipt({ ...base, broker: { ...base.broker, orderState: good('PARTIAL'), filledQuantity: good(0) } });
  assert.equal(partial.status, 'IN_PROGRESS');
  assert.deepEqual(partial.pending, ['BROKER_ORDER_PARTIAL']);
  const { unfilledTerminalBrokerOrderSql } = await import('../src/execution/paper-execution-authorization.js');
  const reArmable = unfilledTerminalBrokerOrderSql('bo');
  for (const status of ['PARTIAL', 'UNKNOWN_SUBMISSION', 'RECONCILING', 'SUBMITTED', 'ACKNOWLEDGED', 'REJECTED', 'FILLED']) {
    assert.ok(!reArmable.includes(`'${status}'`), `${status} never re-arms the canary lane`);
  }
});
