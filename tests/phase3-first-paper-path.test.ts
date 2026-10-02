// Phase 3 -- FIRST PAPER PATH REACHABILITY (offline composition).
//
// Proves the chain a natural canonical candidate must travel to become exactly one Paper order, using the real modules end to end:
//   canonical frontier -> structuralSizing -> Paper evidence cap (canary = 1) -> NEW_RISK action plan -> pre-submit handoff
//   -> PaperOrderCoordinator -> (fake) Alpaca PAPER broker.
// and the converse: quantity zero is NO order, and nothing is forced. No live data, no real broker.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrokerOrderRequest, BrokerOrderSnapshot, PaperBrokerAdapter } from '../src/execution/broker.js';
import { executionOptionQuoteContractVersion, type ExecutionOptionQuote } from '../src/execution/execution-option-quote.js';
import { applyPaperEvidenceRiskCap } from '../src/execution/execution-authorization-tier.js';
import { MasterPaperActionHandoff, masterPaperActionPlanVersion, prepareMasterPaperAction, type ApprovedMasterPaperActionPlan,
  type ExecutionOptionQuoteSource } from '../src/execution/master-paper-action-handoff.js';
import { MasterPaperExecutionOrchestrator } from '../src/execution/master-paper-execution-orchestrator.js';
import { InMemoryPaperOrderStore, PaperOrderCoordinator } from '../src/execution/paper-order-coordinator.js';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import { buildPaperEntrySafetyPolicyReceipt } from '../src/theta/paper-entry-safety-policy.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';
import { testAegisAssessmentIdentity } from './fixtures/aegis-assessment-identity.js';

const NOW = '2026-09-14T15:00:00.000Z';
const symbol = 'AAPL261016P00150000';
const contract = normalizeOptionContract({
  source: 'ALPACA', underlying: 'AAPL', optionSymbol: symbol, occSymbol: symbol, optionType: 'PUT', strike: 150, expiration: '2026-10-16',
  asOfDate: '2026-09-14', multiplier: 100, underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: NOW,
  bid: 1.2, ask: 1.3, bidSize: 20, askSize: 18, lastTradePrice: 1.25, lastTradeSize: 1, quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250,
  volumeSource: 'ALPACA', openInterest: 1200, openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.2, gamma: 0.01, theta: -0.04, vega: 0.12,
  rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 30,
  maxSpreadPctForExecutable: 0.2,
}, NOW);
const families: StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];
const routing = parseStrategyRoutingResponse({
  contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
  results: families.map((strategyFamily) => ({ strategyFamily, eligible: strategyFamily === 'THETA_Q',
    eligibilityState: strategyFamily === 'THETA_Q' ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
    reasons: [{ code: 'R', polarity: 0, detail: 'first paper path' }], policyVersion: 'router-v1' })),
});
const sizingPolicy = { riskBudgetQtyCap: 4, collateralQtyCap: 4, concentrationQtyCap: 4, assignmentCapacityQtyCap: 4, tailRiskQtyCap: 4,
  correlationQtyCap: 4, liquidityQtyCap: 4, reducedStateMultiplier: 0.5 };
const frontierFor = (buyingPower: number) => buildCanonicalStrategyFrontier({
  snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'theta-strategy-package-v1', stock: null, assignmentCapacityQty: 4, aegisNewRiskState: 'ALLOW_FULL',
  buyingPower, brokerAllowedQty: 4, sizingPolicy, eventState: 'CLEAR', unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
  optionomicsContext: { state: 'UNKNOWN' }, contracts: [contract], routing,
} as never);

const entrySafetyPolicy = buildPaperEntrySafetyPolicyReceipt({ decisionAsOf: NOW,
  companyEvent: { policyVersion: 'theta-company-event-paper-policy-v1', authority: 'PAPER_BOOTSTRAP_NOT_COMPLETE_COMPANY_COVERAGE', action: 'CLEAR',
    state: 'KNOWN_AFTER_EXPIRY_CLEAR', decisionAsOf: NOW, validThrough: '2026-10-31',
    instrument: { policyVersion: 'theta-paper-instrument-classification-v1', symbol: 'AAPL', state: 'OPERATING_COMPANY', paperBootstrapApproved: true,
      authority: 'VERSIONED_MANIFEST', evidenceIds: ['manifest-aapl'], observedAt: '2026-09-01T00:00:00.000Z', reason: 'TEST' },
    earningsDistanceTradingSessions: 40, sessionsThroughExpiration: 24, macroState: 'KNOWN_FALSE', evidenceIds: ['event-1'], reason: 'TEST' },
  corporateAction: { policyVersion: 'theta-corporate-action-paper-policy-v1', authority: 'PAPER_BOOTSTRAP_NOT_COMPLETE_NEGATIVE_ASSURANCE', action: 'CLEAR',
    state: 'PAPER_BOOTSTRAP_LIMITED', decisionAsOf: NOW, queryObservedAt: NOW, queryWindow: { start: '2026-09-14', end: '2026-10-29' },
    paginationComplete: true, negativeCoverageQualified: false, positiveRelevance: 'EXPIRED_NOT_RELEVANT', missingPrerequisites: [], evidenceIds: [], reason: 'TEST' },
});
const quote: ExecutionOptionQuote = { contractVersion: executionOptionQuoteContractVersion, contractId: symbol, providerContractId: symbol, bid: 1.2, ask: 1.3,
  bidSize: 10, askSize: 12, providerTimestamp: NOW, optionIdentity: { underlying: 'AAPL', optionSymbol: symbol, expiration: '2026-10-16', strike: 150,
    optionType: 'PUT', multiplier: 100, contractTradable: true, exerciseStyle: 'american', deliverableClassification: 'STANDARD_EQUITY' },
  receivedAtUtc: NOW, receivedAtMonotonic: 1, sequence: 1, provider: 'ALPACA', sourceSemantics: 'CONSOLIDATED_NBBO', connectionState: 'CONNECTED',
  subscriptionState: 'ACTIVE', provenance: { authenticated: true, exactContractMapping: true, documentedForOrderPricing: true } };

class Quotes implements ExecutionOptionQuoteSource { async getCurrentQuote() { return quote; } }
class Broker implements PaperBrokerAdapter {
  readonly accountKind = 'MASTER_API_KEY' as const; readonly environment = 'PAPER' as const; submitted: BrokerOrderRequest[] = [];
  getAccount = async () => ({}); getPositions = async () => []; getOrders = async () => []; getOrder = async () => null;
  getOrderByClientOrderId = async () => null; getActivities = async () => []; replaceOrder = async () => { throw new Error('unused'); };
  cancelOrder = async () => {};
  submitOrder = async (request: BrokerOrderRequest): Promise<BrokerOrderSnapshot> => { this.submitted.push(request); return { id: 'b1',
    clientOrderId: request.client_order_id, symbol: request.symbol, qty: request.qty, filledQty: 0, filledAvgPrice: null, side: request.side,
    status: 'accepted', limitPrice: Number(request.limit_price), submittedAt: NOW, replacedBy: null, replaces: null }; };
}

const planFrom = (canonicalQuantity: number, riskCap: number): ApprovedMasterPaperActionPlan => {
  const sized = applyPaperEvidenceRiskCap(canonicalQuantity, riskCap);
  return { contractVersion: masterPaperActionPlanVersion, actionPlanId: '11111111-1111-4111-8111-111111111111', decisionAuthority: 'NEW_RISK',
    managementInputSnapshotId: null, managementActionFrontierId: null, actionGroupId: '11111111-1111-4111-8111-111111111111', legSequence: 1,
    dependsOnActionPlanId: null, executionAccountId: '22222222-2222-4222-8222-222222222222', decisionId: '33333333-3333-4333-8333-333333333333',
    candidateId: '44444444-4444-4444-8444-444444444444', strategyVersion: 'theta-conventional-v1', chainId: '55555555-5555-4555-8555-555555555555',
    optionContractId: '66666666-6666-4666-8666-666666666666', underlyingId: '77777777-7777-4777-8777-777777777777', underlying: 'AAPL',
    optionType: 'PUT', symbol, quantity: sized.paperEvidenceQuantity, canonicalQuantity: sized.canonicalQuantity,
    paperEvidenceQuantity: sized.paperEvidenceQuantity, paperEvidenceRiskCap: sized.paperEvidenceRiskCap, paperEvidenceCapReason: sized.paperEvidenceCapReason,
    executionTier: 'PAPER_EVIDENCE', multiplier: 100, action: 'OPEN_CSP', economicBoundary: 1.2, economicsRemainPositive: true, expectedAfterCostEv: null,
    empiricalEconomicsReady: false, selectedByCanonicalAuthority: true, hardValidityPassed: true, accountVerified: true, optionsCapabilityVerified: true,
    noEquivalentExposureConflict: true, aegisState: 'ALLOW_FULL', killSwitchActive: false, aegisAssessmentIdentity: testAegisAssessmentIdentity(),
    decisionExpiresAt: '2026-09-14T15:01:00.000Z', pricingPolicy: { waitIntervalMs: 1000, maxAttempts: 2, concessionFractions: [0, 0.5], tickSize: 0.01 },
    pricingAttempt: 0, previousLimit: null, entrySafetyPolicy } as unknown as ApprovedMasterPaperActionPlan;
};
const handoffFor = (broker: Broker) => new MasterPaperActionHandoff(new Quotes(), new MasterPaperExecutionOrchestrator(
  new PaperOrderCoordinator(broker, new InMemoryPaperOrderStore(), { masterEnabled: true, followerEnabled: false, pauseNewOrders: false })), undefined, () => NOW);

test('a natural candidate on an account that can size it: frontier quantity > 0 -> canary cap 1 -> exactly one Paper order, a bounded limit inside the BBO', async () => {
  const frontier = frontierFor(500_000);
  assert.ok(frontier.selectedQuantity > 1, `the account can size several contracts (got ${frontier.selectedQuantity})`);
  assert.equal(frontier.selectedCandidateId?.endsWith(symbol), true);
  const broker = new Broker();
  const result = await handoffFor(broker).execute(planFrom(frontier.selectedQuantity, 1), '2026-09-14T15:00:00.000Z', true);
  assert.equal(result.state, 'EXECUTED');
  assert.equal(broker.submitted.length, 1);
  const order = broker.submitted[0] as BrokerOrderRequest;
  assert.equal(order.qty, 1, 'the first canary is capped at one contract however many the account could size');
  assert.equal(order.side, 'sell');
  assert.equal(order.time_in_force, 'day');
  assert.ok(Number(order.limit_price) >= quote.bid && Number(order.limit_price) <= quote.ask, 'the limit sits inside the executable BBO');
});

test('quantity ZERO is no order: an account that cannot size the contract produces no plan, and a zero-quantity plan never reaches the broker', async () => {
  const frontier = frontierFor(1_000); // one cash-secured contract needs 15,000
  assert.equal(frontier.selectedQuantity, 0);
  assert.equal(frontier.selectedCandidateId, null);
  const broker = new Broker();
  const prepared = await prepareMasterPaperAction(planFrom(0, 1), new Quotes(), NOW, true).catch(() => null);
  assert.notEqual(prepared?.state, 'READY_TO_SUBMIT', 'a zero-quantity plan is never ready');
  const executed = await handoffFor(broker).execute(planFrom(0, 1), NOW, true).catch(() => null);
  assert.notEqual(executed?.state, 'EXECUTED');
  assert.equal(broker.submitted.length, 0, 'nothing is forced to one');
});

test('the canary cap can only reduce: a cap of zero is zero, and a larger canonical quantity is never raised', () => {
  assert.equal(applyPaperEvidenceRiskCap(3, 1).paperEvidenceQuantity, 1);
  assert.equal(applyPaperEvidenceRiskCap(3, 0).paperEvidenceQuantity, 0);
  assert.equal(applyPaperEvidenceRiskCap(0, 1).paperEvidenceQuantity, 0);
  assert.equal(applyPaperEvidenceRiskCap(1, 5).paperEvidenceQuantity, 1);
});

test('the gates stay closed without the owner flags: master disabled or new entries paused never reach the broker', async () => {
  const frontier = frontierFor(500_000);
  for (const control of [{ masterEnabled: false, followerEnabled: false, pauseNewOrders: false }, { masterEnabled: true, followerEnabled: false, pauseNewOrders: true }]) {
    const broker = new Broker();
    const handoff = new MasterPaperActionHandoff(new Quotes(), new MasterPaperExecutionOrchestrator(
      new PaperOrderCoordinator(broker, new InMemoryPaperOrderStore(), control)), undefined, () => NOW);
    await handoff.execute(planFrom(frontier.selectedQuantity, 1), NOW, true).catch(() => undefined);
    assert.equal(broker.submitted.length, 0, JSON.stringify(control));
  }
});
