import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { deriveQualifiedAccountEnvelope, type AccountCapitalInput } from '../src/execution/qualified-account-capital.js';
import { capitalAdmission, type CapitalProposal } from '../src/execution/portfolio-capital-reservation.js';
import { capitalInput } from './fixtures/qualified-account-capital.js';
function required<T>(value: T | undefined | null): T { assert.ok(value != null); return value; }
const fixtureProposal = (): CapitalProposal => ({ reservationId: randomUUID(), proposalRef: randomUUID(), decisionId: randomUUID(),
  candidateRef: 'fixture-XLE', strategy: 'THETA_CONVENTIONAL', quantity: 2, canonicalMaximumQuantity: 2,
  quoteExpiresAt: '2026-10-08T13:30:40Z', authorityHash: 'd'.repeat(64), perUnit: {
    CASH: '5701', BROKER: '5701', PORTFOLIO: '5700', ASSIGNMENT: '5700', 'TICKER:XLE': '5700',
    'SECTOR:SINGLE_UNDERLYING_PROXY:XLE': '5700', 'CORRELATION:SINGLE_UNDERLYING_PROXY:XLE': '5700' } });
function partialInput(): AccountCapitalInput {
  const v = capitalInput(), p = fixtureProposal();
  v.orders.rows.push({ orderId: 'broker-order', clientOrderId: 'client-order', symbol: 'XLE261120P00057000',
    quantity: 2, filledQuantity: 1, positionIntent: 'sell_to_open', status: 'partially_filled' });
  v.commitments.push({ reservationId: p.reservationId, remainingQuantity: 2, proposal: p, accountHash: v.accountHash,
    intent: { orderIntentId: randomUUID(), decisionId: p.decisionId, clientOrderId: 'client-order', brokerOrderId: 'broker-order',
      symbol: 'XLE261120P00057000', quantity: 2, filledQuantity: 1, orderClass: 'simple' } });
  return v;
}

test('qualified CSP envelope keeps broker-net BP distinct from policy and secured cash usage', () => {
  const result = deriveQualifiedAccountEnvelope(capitalInput());
  assert.equal(result.state, 'QUALIFIED'); if (result.state !== 'QUALIFIED') return;
  assert.equal(result.envelope.available.BROKER, '94328');
  assert.equal(result.envelope.available.CASH, '94328.00000000');
  assert.equal(result.usedByDimension.PORTFOLIO, '5700.00000000');
  assert.equal(result.envelope.available['TICKER:XLE'], '16799.99999999');
  assert.equal(result.softLimitByDimension['TICKER:XLE'], '15000.00000000');
  assert.equal(result.aegisReassessmentRequired, true);
  assert.equal(result.brokerAuthority, false);
});

test('pending reflection credits only deducted unfilled units, keeping fees and unproved BP/filled lots reserved', () => {
  const v = partialInput(), r = deriveQualifiedAccountEnvelope(v);
  assert.equal(r.state, 'QUALIFIED'); if (r.state !== 'QUALIFIED') return;
  const c = required(v.commitments[0]);
  assert.equal(r.usedByDimension.PORTFOLIO, '11400.00000000', 'filled position plus unfilled order, no doubled original order qty');
  assert.equal(r.envelope.reflected[c.reservationId]?.CASH, '5700.00000000');
  assert.equal(r.envelope.reflected[c.reservationId]?.BROKER, undefined);
  assert.ok(r.retainedReasons.some(x => x.endsWith('BROKER_BP_ATTRIBUTION_UNPROVEN_RETAINED')));
  assert.deepEqual(capitalAdmission(r.envelope, [c], { ...fixtureProposal(), quantity: 1 }), ['CAPITAL_EXHAUSTED:TICKER:XLE']);
});

test('unknown balances, incoherent snapshots, incomplete orders and policy conflicts cannot create capacity', () => {
  const changes: ((v: AccountCapitalInput) => unknown)[] = [
    v => ({ ...v, account: { ...v.account, optionsBuyingPower: null } }),
    v => ({ ...v, account: { ...v.account, cash: '-1' } }),
    v => ({ ...v, account: { ...v.account, equity: 'NaN' } }),
    v => ({ ...v, orders: { ...v.orders, complete: false } }),
    v => ({ ...v, positions: { ...v.positions, accountHash: 'e'.repeat(64) } }),
    v => ({ ...v, orders: { ...v.orders, snapshotId: 'different' } }),
    v => ({ ...v, policyHash: 'f'.repeat(64) }),
    v => ({ ...v, now: '2026-10-08T13:30:45Z' }),
    v => ({ ...v, now: '2026-10-08T13:29:59Z' }),
    v => ({ ...v, positions: { ...v.positions, receivedAt: '2026-10-08T13:29:59Z' } }),
    v => ({ ...v, contracts: [] }),
    v => ({ ...v, contracts: v.contracts.map(c => ({ ...c, multiplier: Number.MAX_SAFE_INTEGER + 1 })) }),
    v => ({ ...v, underlyings: ['XLE', 'SPY'] }),
    v => ({ ...v, positions: { ...v.positions, rows: [...v.positions.rows, ...v.positions.rows] } }),
  ];
  for (const change of changes) {
    const r = deriveQualifiedAccountEnvelope(change(capitalInput()));
    assert.equal(r.state, 'BLOCKED'); assert.equal(r.envelope, null);
  }
});

test('partial-fill, identity, footprint and duplicate broker-reflection conflicts fail closed', () => {
  const cases: ((v: AccountCapitalInput) => void)[] = [
    v => { required(required(v.commitments[0]).intent).filledQuantity = 0; },
    v => { required(required(v.commitments[0]).intent).clientOrderId = 'wrong'; },
    v => { required(v.commitments[0]).accountHash = 'f'.repeat(64); },
    v => { required(required(v.commitments[0]).intent).decisionId = randomUUID(); },
    v => { required(v.commitments[0]).proposal.perUnit.PORTFOLIO = '5699'; },
    v => { required(v.orders.rows[0]).filledQuantity = 3; },
    v => { required(v.commitments[0]).remainingQuantity = 1; },
    v => { const other = structuredClone(required(v.commitments[0])); other.reservationId = randomUUID();
      other.proposal.reservationId = other.reservationId; v.commitments.push(other); },
  ];
  for (const change of cases) { const v = partialInput(); change(v); assert.equal(deriveQualifiedAccountEnvelope(v).state, 'BLOCKED'); }
});

test('closing and absent broker orders never release claims; native legs and stocks are explicitly unsupported', () => {
  const v = partialInput(); v.orders.rows = [];
  const r = deriveQualifiedAccountEnvelope(v); assert.equal(r.state, 'QUALIFIED');
  if (r.state === 'QUALIFIED') { assert.deepEqual(r.envelope.reflected, {}); assert.equal(r.retainedReasons.length, 1); }
  const closing = capitalInput();
  closing.orders.rows.push({ orderId: 'close', clientOrderId: 'close-client', symbol: 'XLE261120P00057000',
    quantity: 1, filledQuantity: 0, positionIntent: 'buy_to_close', status: 'accepted' });
  const c = deriveQualifiedAccountEnvelope(closing); assert.equal(c.state, 'QUALIFIED');
  if (c.state === 'QUALIFIED') assert.equal(c.usedByDimension.CASH, '5700.00000000');
  assert.equal(deriveQualifiedAccountEnvelope({ ...v, positions: { ...v.positions,
    rows: [{ ...v.positions.rows[0], quantity: 1, side: 'long' }] } }).state, 'BLOCKED');
});

test('exact multiplication, explicit multi-underlying groups and hard-limit equality survive admission', () => {
  const v = capitalInput(); v.account.equity = '100000.00000001';
  v.underlyings.push('SPY');
  v.groups = { evidenceHash: 'e'.repeat(64), policyVersion: v.policyVersion,
    observedAt: '2026-10-08T13:30:00Z', expiresAt: '2026-10-08T13:31:00Z',
    members: { XLE: { sector: 'ENERGY', correlation: 'CLUSTER_1' }, SPY: { sector: 'FUND', correlation: 'CLUSTER_1' } } };
  const r = deriveQualifiedAccountEnvelope(v); assert.equal(r.state, 'QUALIFIED'); if (r.state !== 'QUALIFIED') return;
  assert.equal(r.usedByDimension['CORRELATION:CLUSTER_1'], '5700.00000000');
  assert.equal(r.envelope.available['TICKER:SPY'], '22499.99999999');
  const p = fixtureProposal(); p.quantity = 1;
  p.perUnit = { CASH: '16800', BROKER: '16800', PORTFOLIO: '16800', ASSIGNMENT: '16800',
    'TICKER:XLE': '16800', 'SECTOR:ENERGY': '16800', 'CORRELATION:CLUSTER_1': '16800' };
  assert.deepEqual(capitalAdmission(r.envelope, [], p), ['CAPITAL_EXHAUSTED:TICKER:XLE']);
  v.groups.expiresAt = v.now;
  assert.equal(deriveQualifiedAccountEnvelope(v).state, 'BLOCKED');
  v.groups.expiresAt = '2026-10-08T13:31:00Z';
  v.groups.observedAt = '2026-10-08T13:30:03Z';
  assert.equal(deriveQualifiedAccountEnvelope(v).state, 'BLOCKED');
});
