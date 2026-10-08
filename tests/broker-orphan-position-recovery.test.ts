import assert from 'node:assert/strict';
import test from 'node:test';
import { brokerConfirmedPositionLifecycleRegistrationBlocked, buildOrphanRiskClosePlan, classifyBrokerConfirmedOrphan,
  decideOrphanRiskAction, parseOrphanRecoveryMode, type BrokerConfirmedOptionPosition, type OrphanCloseDirective,
  type OrphanManagementRepresentation, type OrphanRiskClosePolicy, type OrphanThetaLineage } from '../src/execution/broker-orphan-position-recovery.js';
import { prepareMasterPaperAction, type ExecutionOptionQuoteSource } from '../src/execution/master-paper-action-handoff.js';
import { executionOptionQuoteContractVersion, type ExecutionOptionQuote } from '../src/execution/execution-option-quote.js';

// The 2026-10-07 XLE incident shape: short 1 XLE261120P00057000 filled at 0.28, chain WAIT with no option leg, intent FILLED,
// SHORT_PUT_OPEN blocked by the schema-069 CHECK (23514). All identifiers are synthetic (public repository).
const SYMBOL = 'XLE261120P00057000';
const ids = { chain: 'a0000000-0000-4000-8000-000000000001', decision: 'a0000000-0000-4000-8000-000000000002',
  intent: 'a0000000-0000-4000-8000-000000000003', underlying: 'a0000000-0000-4000-8000-000000000004',
  contract: 'a0000000-0000-4000-8000-000000000005', account: 'a0000000-0000-4000-8000-000000000006',
  input: 'a0000000-0000-4000-8000-000000000007', frontier: 'a0000000-0000-4000-8000-000000000008' };
const NOW = '2026-10-07T16:30:00.000Z';

const position = (patch: Partial<BrokerConfirmedOptionPosition> = {}): BrokerConfirmedOptionPosition => ({
  symbol: SYMBOL, signedQuantity: -1, averageEntryPricePerShare: 0.28, observedAt: NOW, reconciliationQuality: 'GOOD', ...patch });
const lineage = (patch: Partial<OrphanThetaLineage> = {}, intent: Partial<OrphanThetaLineage['orderIntent']> = {}): OrphanThetaLineage => ({
  chainId: ids.chain, chainKind: 'WHEEL', chainLifecycleState: 'WAIT', chainClosed: false, openOptionLegCount: 0,
  lifecycleApplication: { state: 'BLOCKED', blockedCode: 'POSTGRES_23514_LIFECYCLE_APPLICATION_EVENT_KIND_CHECK' },
  decisionId: ids.decision,
  orderIntent: { orderIntentId: ids.intent, clientOrderId: 'theta-synthetic-client-order', chainId: ids.chain, decisionId: ids.decision,
    status: 'FILLED', thetaAction: 'OPEN_CSP', side: 'SELL', positionIntent: 'sell_to_open', symbol: SYMBOL, quantity: 1, ...intent },
  brokerOrder: { orderIntentId: ids.intent, status: 'FILLED', symbol: SYMBOL, filledQuantity: 1 },
  fills: [{ quantity: 1, pricePerShare: 0.28, occurredAt: '2026-10-07T13:47:57.000Z' }],
  nonTerminalChainOrders: 0,
  identity: { strategyBranch: 'THETA_CONVENTIONAL', candidateId: 'a0000000-0000-4000-8000-000000000009',
    actionPlanId: 'a0000000-0000-4000-8000-00000000000a', providerOrderId: 'synthetic-broker-order-1' },
  underlyingId: ids.underlying, optionContractId: ids.contract, multiplier: 100, ...patch });

const confirmed = (): OrphanManagementRepresentation => {
  const result = classifyBrokerConfirmedOrphan(position(), [lineage()]);
  assert.equal(result.state, 'ORPHAN_CONFIRMED');
  return (result as Extract<typeof result, { state: 'ORPHAN_CONFIRMED' }>).representation;
};
const policy: OrphanRiskClosePolicy = { policyVersion: 'test-orphan-risk-v1', askMultipleOfEntry: 3, spotWithinFractionOfStrike: 0.10,
  maximumQuoteAgeMs: 10_000 };
const quote = (bid: number, ask: number): ExecutionOptionQuote => ({ contractVersion: executionOptionQuoteContractVersion,
  contractId: SYMBOL, providerContractId: SYMBOL, bid, ask, bidSize: 10, askSize: 10, providerTimestamp: NOW,
  optionIdentity: { underlying: 'XLE', optionSymbol: SYMBOL, expiration: '2026-11-20', strike: 57, optionType: 'PUT', multiplier: 100,
    contractTradable: true, exerciseStyle: 'american', deliverableClassification: 'STANDARD_EQUITY' },
  receivedAtUtc: NOW, receivedAtMonotonic: 1, sequence: 1, provider: 'ALPACA', sourceSemantics: 'CONSOLIDATED_NBBO',
  connectionState: 'CONNECTED', subscriptionState: 'ACTIVE',
  provenance: { authenticated: true, exactContractMapping: true, documentedForOrderPricing: true } } as ExecutionOptionQuote);
const planInput = (rep: OrphanManagementRepresentation, directive: OrphanCloseDirective) => ({ representation: rep, directive,
  executionAccountId: ids.account, strategyVersion: 'theta-conventional-v1', managementInputSnapshotId: ids.input,
  managementActionFrontierId: ids.frontier, optionsCapabilityVerified: true, accountActive: true, killSwitchActive: false,
  now: NOW, decisionExpiresAt: '2026-10-07T16:30:25.000Z' });

test('XLE lineage is classified as a lifecycle-registration-blocked orphan with HOLD/CLOSE_RISK only', () => {
  const rep = confirmed();
  assert.equal(rep.classification, brokerConfirmedPositionLifecycleRegistrationBlocked);
  assert.equal(rep.lifecycleBlockedCode, 'POSTGRES_23514_LIFECYCLE_APPLICATION_EVENT_KIND_CHECK');
  assert.deepEqual([rep.underlying, rep.optionType, rep.strike, rep.expiration, rep.contracts, rep.multiplier],
    ['XLE', 'PUT', 57, '2026-11-20', 1, 100]);
  assert.equal(rep.entryCreditDebit, 28);
  assert.deepEqual(rep.permittedActions, ['HOLD', 'CLOSE_RISK']);
  assert.equal(rep.defaultAction, 'HOLD');
  assert.ok(Object.isFrozen(rep));
});

test('(b) HOLD when no trigger fires, and HOLD when no owner policy exists', () => {
  const rep = confirmed();
  const market = { bid: 0.35, ask: 0.37, quoteTimestamp: NOW, spot: 63.1, now: NOW };
  assert.equal(decideOrphanRiskAction(rep, market, policy).action, 'HOLD');
  assert.deepEqual(decideOrphanRiskAction(rep, { ...market, ask: 5 }, null),
    { action: 'HOLD', reasons: ['ORPHAN_RISK_CLOSE_POLICY_NOT_CONFIGURED'] });
  // A fired trigger without a fresh executable quote is never priced blind.
  const stale = decideOrphanRiskAction(rep, { ...market, spot: 62, quoteTimestamp: '2026-10-07T16:00:00.000Z' }, policy);
  assert.equal(stale.action, 'HOLD');
  assert.ok(stale.reasons.includes('ORPHAN_CLOSE_REQUIRED_QUOTE_NOT_FRESH'));
});

test('(a) a risk trigger yields one BUY_TO_CLOSE qty 1 plan that passes the coordinator pre-submit handoff (no submit)', async () => {
  const rep = confirmed();
  const decision = decideOrphanRiskAction(rep, { bid: 0.80, ask: 0.86, quoteTimestamp: NOW, spot: 62.4, now: NOW }, policy);
  assert.equal(decision.action, 'CLOSE_RISK');
  if (decision.action !== 'CLOSE_RISK') return;
  assert.deepEqual([...decision.reasons].sort(), ['ORPHAN_RISK_MARK_MULTIPLE', 'ORPHAN_RISK_SPOT_NEAR_STRIKE']);
  const built = buildOrphanRiskClosePlan(planInput(rep, decision.directive));
  assert.equal(built.state, 'READY', JSON.stringify(built.blockers));
  if (built.state !== 'READY') return;
  assert.deepEqual([built.plan.action, built.plan.quantity, built.plan.symbol, built.plan.decisionAuthority],
    ['CLOSE_CSP', 1, SYMBOL, 'MANAGEMENT']);
  const requested: string[] = [];
  const source: ExecutionOptionQuoteSource = { getCurrentQuote: async (plan) => { requested.push(plan.symbol); return quote(0.80, 0.86); } };
  // prepareMasterPaperAction is the read-only half of the coordinator handoff: it has no broker/POST dependency at all.
  const prepared = await prepareMasterPaperAction(built.plan, source, NOW, true, undefined, () => NOW);
  assert.equal(prepared.state, 'READY_TO_SUBMIT', JSON.stringify(prepared.blockers));
  assert.deepEqual(requested, [SYMBOL]);
  const request = prepared.command?.request;
  assert.equal(request?.side, 'buy');
  assert.equal(request?.position_intent, 'buy_to_close');
  assert.equal(request?.symbol, SYMBOL);
  assert.equal(Number(request?.qty), 1);
  assert.ok(Number(request?.limit_price) <= 0.86 && Number(request?.limit_price) >= 0.80);
  assert.equal(prepared.command?.action, 'CLOSE_CSP');
});

test('(c) every forbidden mutation is refused at the plan boundary', () => {
  const rep = confirmed();
  const base: OrphanCloseDirective = { thetaAction: 'CLOSE_CSP', side: 'BUY', positionIntent: 'buy_to_close', symbol: SYMBOL,
    quantity: 1, maximumDebitPerShare: 0.86, representationHash: rep.contentHash };
  const blocked = (directive: OrphanCloseDirective, patch: Record<string, unknown> = {}, representation = rep) => {
    const result = buildOrphanRiskClosePlan({ ...planInput(representation, directive), ...patch });
    assert.equal(result.state, 'BLOCKED');
    return result.blockers;
  };
  // Opening exposure / roll: a sell-side or open intent is not expressible as a risk close.
  assert.ok(blocked({ ...base, side: 'SELL' as 'BUY' }).includes('ORPHAN_ACTION_NOT_RISK_REDUCING'));
  assert.ok(blocked({ ...base, positionIntent: 'sell_to_open' as 'buy_to_close' }).includes('ORPHAN_ACTION_NOT_RISK_REDUCING'));
  assert.ok(blocked({ ...base, thetaAction: 'ROLL_CSP_CLOSE' as 'CLOSE_CSP' }).includes('ORPHAN_ACTION_NOT_RISK_REDUCING'));
  // Contract substitution.
  assert.ok(blocked({ ...base, symbol: 'XLE261120P00063000' }).includes('ORPHAN_CONTRACT_SUBSTITUTION_FORBIDDEN'));
  // Quantity increase / above broker quantity / partial.
  assert.ok(blocked({ ...base, quantity: 2 }).includes('ORPHAN_CLOSE_QUANTITY_EXCEEDS_BROKER_POSITION'));
  assert.ok(blocked({ ...base, quantity: 0 }).includes('ORPHAN_CLOSE_QUANTITY_INVALID'));
  // A representation edited after classification (e.g. contracts raised) is detected.
  assert.ok(blocked({ ...base, quantity: 2 }, {}, { ...rep, contracts: 2 }).includes('ORPHAN_REPRESENTATION_TAMPERED'));
  assert.ok(blocked({ ...base, representationHash: '0'.repeat(64) }).includes('ORPHAN_DIRECTIVE_REPRESENTATION_MISMATCH'));
  // Decision window may not exceed the management plan window; kill switch blocks.
  assert.ok(blocked(base, { decisionExpiresAt: '2026-10-07T16:35:00.000Z' }).includes('DECISION_EXPIRY_INVALID'));
  assert.ok(blocked(base, { killSwitchActive: true }).includes('KILL_SWITCH_ACTIVE'));
  // The decision type has no OPEN/ROLL/INCREASE variant; only HOLD and CLOSE_RISK exist.
  assert.deepEqual(rep.permittedActions, ['HOLD', 'CLOSE_RISK']);
});

test('(d) symbol / side / quantity / lineage mismatches refuse with typed codes', () => {
  const reason = (p: BrokerConfirmedOptionPosition, l: readonly OrphanThetaLineage[]) => {
    const result = classifyBrokerConfirmedOrphan(p, l);
    return result.state === 'REFUSED' ? result.reason : 'CONFIRMED';
  };
  assert.equal(reason(position({ signedQuantity: -2 }), [lineage()]), 'ORPHAN_QUANTITY_MISMATCH');
  assert.equal(reason(position({ signedQuantity: 1 }), [lineage()]), 'ORPHAN_SIDE_MISMATCH');
  assert.equal(reason(position({ symbol: 'XLE261120C00057000' }), [lineage()]), 'ORPHAN_SIDE_MISMATCH');
  assert.equal(reason(position({ symbol: 'XLE261120P00058000' }), [lineage()]), 'ORPHAN_SYMBOL_MISMATCH');
  assert.equal(reason(position(), []), 'ORPHAN_NO_THETA_LINEAGE');
  assert.equal(reason(position(), [lineage(), lineage()]), 'ORPHAN_LINEAGE_AMBIGUOUS');
  assert.equal(reason(position(), [lineage({}, { side: 'BUY', positionIntent: 'buy_to_open' })]), 'ORPHAN_SIDE_MISMATCH');
  assert.equal(reason(position(), [lineage({}, { chainId: ids.decision })]), 'ORPHAN_LINEAGE_MISMATCH');
  assert.equal(reason(position(), [lineage({ brokerOrder: { orderIntentId: ids.intent, status: 'PARTIALLY_FILLED', symbol: SYMBOL,
    filledQuantity: 1 } })]), 'ORPHAN_LINEAGE_MISMATCH');
  assert.equal(reason(position(), [lineage({ openOptionLegCount: 1 })]), 'ORPHAN_ALREADY_LIFECYCLE_OWNED');
  assert.equal(reason(position(), [lineage({ lifecycleApplication: { state: 'APPLIED' } })]), 'ORPHAN_ALREADY_LIFECYCLE_OWNED');
  assert.equal(reason(position(), [lineage({ nonTerminalChainOrders: 1 })]), 'ORPHAN_ORDER_IN_FLIGHT');
  assert.equal(reason(position({ averageEntryPricePerShare: 0.40 }), [lineage()]), 'ORPHAN_FILL_PRICE_MISMATCH');
  assert.equal(reason(position({ reconciliationQuality: 'DEGRADED' }), [lineage()]), 'ORPHAN_BROKER_EVIDENCE_NOT_GOOD');
});

test('malformed broker price, fills and lifecycle counts cannot manufacture orphan ownership', () => {
  for (const averageEntryPricePerShare of [NaN, Infinity, -1, 0])
    assert.equal(classifyBrokerConfirmedOrphan(position({ averageEntryPricePerShare }), [lineage()]).state, 'REFUSED');
  for (const pricePerShare of [NaN, Infinity, -1, 0])
    assert.equal(classifyBrokerConfirmedOrphan(position(), [lineage({ fills: [{ quantity: 1, pricePerShare, occurredAt: NOW }] })]).state, 'REFUSED');
  for (const occurredAt of ['bad', '2026-10-08T00:00:00Z'])
    assert.equal(classifyBrokerConfirmedOrphan(position(), [lineage({ fills: [{ quantity: 1, pricePerShare: 0.28, occurredAt }] })]).state, 'REFUSED');
  for (const count of [NaN, -1, 0.5]) {
    assert.equal(classifyBrokerConfirmedOrphan(position(), [lineage({ openOptionLegCount: count })]).state, 'REFUSED');
    assert.equal(classifyBrokerConfirmedOrphan(position(), [lineage({ nonTerminalChainOrders: count })]).state, 'REFUSED');
  }
  assert.equal(classifyBrokerConfirmedOrphan(position(), [lineage({ fills: [
    { quantity: 0.5, pricePerShare: 0.28, occurredAt: NOW }, { quantity: 0.5, pricePerShare: 0.28, occurredAt: NOW },
  ] })]).state, 'REFUSED');
});

test('persisted enum casing for SELL_TO_OPEN is accepted without weakening side semantics', () => {
  const classified = classifyBrokerConfirmedOrphan(position(), [lineage({}, { side: 'sell', positionIntent: 'SELL_TO_OPEN' })]);
  assert.equal(classified.state, 'ORPHAN_CONFIRMED');
});

test('orphan recovery mode defaults to read-only OBSERVE; only an explicit value certifies the close path', () => {
  assert.equal(parseOrphanRecoveryMode(undefined), 'OBSERVE');
  assert.equal(parseOrphanRecoveryMode('ENFORCED'), 'OBSERVE');
  assert.equal(parseOrphanRecoveryMode('OFF'), 'OFF');
  assert.equal(parseOrphanRecoveryMode('CLOSE_RISK_CERTIFIED'), 'CLOSE_RISK_CERTIFIED');
});
