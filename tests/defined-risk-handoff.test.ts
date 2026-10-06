import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrokerOrderRequest, BrokerOrderSnapshot, PaperBrokerAdapter } from '../src/execution/broker.js';
import { executionOptionQuoteContractVersion, type ExecutionOptionQuote } from '../src/execution/execution-option-quote.js';
import { MasterPaperActionHandoff, masterPaperActionPlanSchema, prepareMasterPaperAction, type ApprovedMasterPaperActionPlan,
  type ExecutionOptionQuoteSource } from '../src/execution/master-paper-action-handoff.js';
import { assembleDefinedRiskPaperEvidencePlan, type DefinedRiskPlanAssemblyInput } from '../src/execution/defined-risk-plan-assembly.js';
import { MasterPaperExecutionOrchestrator } from '../src/execution/master-paper-execution-orchestrator.js';
import { InMemoryPaperOrderStore, PaperOrderCoordinator } from '../src/execution/paper-order-coordinator.js';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';
import { buildStrategyPaperAuthorityReceipt } from '../src/theta/strategy-paper-authority.js';
import { buildDefinedRiskProductionDecision } from '../src/theta/defined-risk-production-decision.js';
import { buildPaperEntrySafetyPolicyReceipt } from '../src/theta/paper-entry-safety-policy.js';
import { testAegisAssessmentIdentity } from './fixtures/aegis-assessment-identity.js';

const NOW = '2026-09-14T15:00:00.000Z';
const SHORT = 'AAPL260925P00190000', LONG = 'AAPL260925P00185000';
const SHORT_ID = '81111111-1111-4111-8111-111111111111', LONG_ID = '82222222-2222-4222-8222-222222222222';
const PERSISTED = '44444444-4444-4444-8444-444444444444';
const contract = (symbol: string, strike: number, bid: number, ask: number) => normalizeOptionContract({ source: 'ALPACA', underlying: 'AAPL', optionSymbol: symbol, occSymbol: symbol,
  optionType: 'PUT', strike, expiration: '2026-09-25', asOfDate: '2026-09-14', multiplier: 100, underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: NOW,
  bid, ask, bidSize: 20, askSize: 20, lastTradePrice: bid, lastTradeSize: 1, quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 100, volumeSource: 'ALPACA', openInterest: 1000,
  openInterestSource: 'OPTIONOMICS', iv: 0.3, delta: -0.2, gamma: 0.02, theta: -0.1, vega: 0.1, rho: -0.01, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA',
  dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2, contractTradable: true, deliverableClassification: 'STANDARD_EQUITY' }, NOW);
const route = (eligible: readonly StrategyFamily[]) => parseStrategyRoutingResponse({ contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'd-snap', timestamp: NOW,
  policyVersion: 'router-v1', results: (['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'] as const).map((strategyFamily) => ({ strategyFamily,
    eligible: eligible.includes(strategyFamily), eligibilityState: eligible.includes(strategyFamily) ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
    reasons: [{ code: 'TEST', polarity: 0, detail: 'test' }], policyVersion: 'router-v1' })) });
const authority = (patch: Record<string, unknown> = {}) => buildStrategyPaperAuthorityReceipt({ strategy: 'THETA_DEFINED_RISK', ownerPaperAuthorization: true,
  technicalStrategyCertification: true, idempotencyCertified: true, riskAuthorization: true, currentActionAuthorization: true, brokerCapability: 'SUPPORTED', decisionPlanBound: true,
  reconciliationCertified: true, managementCoverageCertified: true, restartRecoveryCertified: true, wholeChainAccountingCertified: true, strategyCanaryAccepted: false,
  liveAuthorization: false, observedAt: NOW, evidenceIds: ['phase4-d-handoff-tests'], ...patch });
const dInput = () => ({ snapshotId: 'd-snap', timestamp: NOW, strategyVersion: 'strategy-v1', contracts: [contract(SHORT, 190, 2.0, 2.1), contract(LONG, 185, 0.8, 0.9)],
  routing: route(['THETA_D']), stock: null, assignmentCapacityQty: 2, buyingPower: 100_000, brokerAllowedQty: 2,
  sizingPolicy: { riskBudgetQtyCap: 2, collateralQtyCap: 2, concentrationQtyCap: 2, assignmentCapacityQtyCap: 2, tailRiskQtyCap: 2, correlationQtyCap: 2, liquidityQtyCap: 2, reducedStateMultiplier: 0.5 },
  aegisNewRiskState: 'ALLOW_FULL' as const, eventState: 'CLEAR' as const, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0, optionomicsContext: {} });
const entrySafetyPolicy = buildPaperEntrySafetyPolicyReceipt({ decisionAsOf: NOW,
  companyEvent: { policyVersion: 'theta-company-event-paper-policy-v1', authority: 'PAPER_BOOTSTRAP_NOT_COMPLETE_COMPANY_COVERAGE',
    action: 'CLEAR', state: 'KNOWN_AFTER_EXPIRY_CLEAR', decisionAsOf: NOW, validThrough: '2026-10-31',
    instrument: { policyVersion: 'theta-paper-instrument-classification-v1', symbol: 'AAPL', state: 'OPERATING_COMPANY', paperBootstrapApproved: true,
      authority: 'VERSIONED_MANIFEST', evidenceIds: ['manifest-aapl'], observedAt: '2026-09-01T00:00:00.000Z', reason: 'TEST' },
    earningsDistanceTradingSessions: 40, sessionsThroughExpiration: 9, macroState: 'KNOWN_FALSE', evidenceIds: ['event-1'], reason: 'TEST' },
  corporateAction: { policyVersion: 'theta-corporate-action-paper-policy-v1', authority: 'PAPER_BOOTSTRAP_NOT_COMPLETE_NEGATIVE_ASSURANCE',
    action: 'CLEAR', state: 'PAPER_BOOTSTRAP_LIMITED', decisionAsOf: NOW, queryObservedAt: NOW,
    queryWindow: { start: '2026-09-14', end: '2026-10-29' }, paginationComplete: true, negativeCoverageQualified: false,
    positiveRelevance: 'EXPIRED_NOT_RELEVANT', missingPrerequisites: [], evidenceIds: [], reason: 'TEST' },
});

function dFrontier() {
  const structural = buildCanonicalStrategyFrontier(dInput() as Parameters<typeof buildCanonicalStrategyFrontier>[0]);
  const receipt = authority();
  const decision = buildDefinedRiskProductionDecision({ structuralFrontier: structural, thetaQDecision: { winningAction: 'PASS' }, holdStrikeDecisionProduced: false, authority: receipt });
  assert.ok(decision, 'fixture must produce a D decision (no vacuous pass)');
  return { frontier: buildCanonicalStrategyFrontier({ ...dInput(), paperEntryDecision: decision } as Parameters<typeof buildCanonicalStrategyFrontier>[0]), receipt };
}

function assemblyInput(patch: Partial<DefinedRiskPlanAssemblyInput> = {}): DefinedRiskPlanAssemblyInput {
  const { frontier, receipt } = dFrontier();
  assert.equal(frontier.primaryAction, 'OPEN_DEFINED_RISK');
  return { frontier, executionAccountId: '22222222-2222-4222-8222-222222222222', decisionId: '33333333-3333-4333-8333-333333333333',
    persistedCandidateId: PERSISTED, persistedLegs: [{ legIndex: 1, occSymbol: SHORT, optionContractId: SHORT_ID }, { legIndex: 2, occSymbol: LONG, optionContractId: LONG_ID }],
    underlyingId: '77777777-7777-4777-8777-777777777777', accountStatus: 'ACTIVE', optionsApprovedLevel: 3, optionsTradingLevel: 3,
    aegisState: 'ALLOW_FULL', aegisInputOrigin: 'DERIVED_FROM_REAL',
    aegisAssessmentIdentity: testAegisAssessmentIdentity({ runtimeCandidateRef: frontier.selectedCandidateId as string, strategyBranch: 'THETA_DEFINED_RISK',
      persistedCandidateId: PERSISTED, optionSymbol: SHORT, decisionAsOf: NOW }),
    entrySafetyPolicy, openPositionSymbols: [], openOrderSymbols: [], paperEvidenceRiskCap: 1, firstCanaryCompleted: false,
    modeledRoundTripCostPerContract: 1.3, now: NOW, decisionExpiresAt: '2026-09-14T15:00:40.000Z', strategyPaperAuthority: receipt, ...patch };
}

const quote = (symbol: string, strike: number, bid: number, ask: number,
  semantics: 'PAPER_INDICATIVE_REFERENCE' | 'CONSOLIDATED_NBBO' = 'PAPER_INDICATIVE_REFERENCE'): ExecutionOptionQuote => ({
  contractVersion: executionOptionQuoteContractVersion, contractId: symbol, providerContractId: symbol,
  optionIdentity: { underlying: 'AAPL', optionSymbol: symbol, expiration: '2026-09-25', strike, optionType: 'PUT', multiplier: 100,
    contractTradable: true, exerciseStyle: 'american', deliverableClassification: 'STANDARD_EQUITY' },
  bid, ask, bidSize: 10, askSize: 10, providerTimestamp: NOW, receivedAtUtc: NOW, receivedAtMonotonic: 1, sequence: 1, provider: 'ALPACA',
  ...(semantics === 'PAPER_INDICATIVE_REFERENCE'
    ? { source: 'BROKER_INDICATIVE', entitlementState: 'QUALIFIED', sourceSemantics: semantics, connectionState: 'CONNECTED', subscriptionState: 'ACTIVE',
      provenance: { authenticated: true, exactContractMapping: true, documentedForOrderPricing: false, feed: 'INDICATIVE', paperOnly: true,
        semanticUse: 'MASTER_THETA_PAPER_LIMIT_REFERENCE', requestedAt: NOW } }
    : { sourceSemantics: semantics, connectionState: 'CONNECTED', subscriptionState: 'ACTIVE',
      provenance: { authenticated: true, exactContractMapping: true, documentedForOrderPricing: true } }),
} as ExecutionOptionQuote);

class LegQuotes implements ExecutionOptionQuoteSource {
  readonly requested: string[] = [];
  constructor(private readonly quotes: Record<string, ExecutionOptionQuote | null>) {}
  async getCurrentQuote(plan: ApprovedMasterPaperActionPlan) { this.requested.push(plan.symbol); return this.quotes[plan.symbol] ?? null; }
}
const goodQuotes = () => new LegQuotes({ [SHORT]: quote(SHORT, 190, 2.0, 2.1), [LONG]: quote(LONG, 185, 0.8, 0.9) });

class Broker implements PaperBrokerAdapter {
  readonly accountKind = 'MASTER_API_KEY' as const; readonly environment = 'PAPER' as const; readonly submitted: BrokerOrderRequest[] = [];
  getAccount = async () => ({}); getPositions = async () => []; getOrders = async () => []; getOrder = async () => null; getOrderByClientOrderId = async () => null;
  getActivities = async () => []; replaceOrder = async () => { throw new Error('unused'); }; cancelOrder = async () => {};
  submitOrder = async (request: BrokerOrderRequest): Promise<BrokerOrderSnapshot> => { this.submitted.push(request); return { id: 'broker-d-1',
    clientOrderId: request.client_order_id, symbol: request.symbol, qty: request.qty, filledQty: 0, filledAvgPrice: null, side: request.side,
    status: 'accepted', limitPrice: Number(request.limit_price), submittedAt: NOW, replacedBy: null, replaces: null, orderClass: request.order_class,
    legs: request.legs?.map((leg, index) => ({ id: `leg-${index + 1}`, symbol: leg.symbol, side: leg.side, positionIntent: leg.position_intent,
      ratioQty: leg.ratio_qty, qty: leg.ratio_qty * request.qty, filledQty: 0, filledAvgPrice: null, status: 'accepted' })) } as BrokerOrderSnapshot; };
}

function readyPlan(): ApprovedMasterPaperActionPlan {
  const assembled = assembleDefinedRiskPaperEvidencePlan(assemblyInput());
  assert.equal(assembled.state, 'READY', JSON.stringify(assembled.blockers));
  return assembled.plan as ApprovedMasterPaperActionPlan;
}

test('D plan assembly: one sealed two-leg package from the persisted leg identity, canary-capped, short leg first', () => {
  const plan = readyPlan();
  assert.equal(masterPaperActionPlanSchema.parse(plan).action, 'OPEN_DEFINED_RISK');
  assert.equal(plan.strategyBranch, 'THETA_DEFINED_RISK');
  assert.equal(plan.optionContractId, null, 'a spread has no representative contract');
  assert.equal(plan.symbol, SHORT);
  assert.deepEqual(plan.definedRisk?.legs.map((leg) => [leg.legIndex, leg.occSymbol, leg.optionContractId, leg.positionIntent]),
    [[1, SHORT, SHORT_ID, 'sell_to_open'], [2, LONG, LONG_ID, 'buy_to_open']]);
  assert.equal(plan.quantity, 1, 'the first D canary is one spread even when canonical sizing allows more');
  assert.equal(plan.expectedAfterCostEv, null, 'structural credit is never reported as expectancy');
});

test('D plan assembly fails closed on every D-specific gate', () => {
  const blockers = (patch: Partial<DefinedRiskPlanAssemblyInput>) => assembleDefinedRiskPaperEvidencePlan(assemblyInput(patch)).blockers;
  assert.ok(blockers({ optionsApprovedLevel: 2, optionsTradingLevel: 2 }).includes('OPTIONS_LEVEL_3_REQUIRED_FOR_NATIVE_MULTI_LEG'));
  assert.ok(blockers({ persistedLegs: [{ legIndex: 1, occSymbol: SHORT, optionContractId: SHORT_ID }] }).includes('PERSISTED_LEG_CONTRACT_IDENTITY_MISSING'));
  assert.ok(blockers({ strategyPaperAuthority: authority({ brokerCapability: 'UNKNOWN' }) }).includes('D_STRATEGY_PAPER_AUTHORITY_INVALID'),
    'unverified account mleg entitlement keeps D unauthorized');
  assert.ok(blockers({ strategyPaperAuthority: undefined }).includes('D_STRATEGY_PAPER_AUTHORITY_INVALID'));
  assert.ok(blockers({ openOrderSymbols: [LONG] }).includes('EQUIVALENT_EXPOSURE_CONFLICT'));
  assert.ok(blockers({ modeledRoundTripCostPerContract: null }).includes('COST_MODEL_INCOMPLETE'));
  assert.ok(blockers({ aegisAssessmentIdentity: testAegisAssessmentIdentity({ runtimeCandidateRef: `THETA_CONVENTIONAL:${SHORT}`, optionSymbol: SHORT, persistedCandidateId: PERSISTED, decisionAsOf: NOW }) })
    .includes('AEGIS_ASSESSMENT_LINEAGE_INVALID'), 'Q\'s per-symbol assessment never authorizes D');
  assert.deepEqual(blockers({ modeledRoundTripCostPerContract: 80 }), ['FORWARD_STRUCTURAL_ECONOMICS_NOT_POSITIVE']);
});

test('D plan schema: the action, branch and two-leg package come together or not at all', () => {
  const plan = readyPlan();
  assert.throws(() => masterPaperActionPlanSchema.parse({ ...plan, definedRisk: undefined }), /DEFINED_RISK_PLAN_IDENTITY_INCOHERENT/);
  assert.throws(() => masterPaperActionPlanSchema.parse({ ...plan, action: 'OPEN_CSP' }), /DEFINED_RISK_PLAN_IDENTITY_INCOHERENT/);
  assert.throws(() => masterPaperActionPlanSchema.parse({ ...plan, strategyPaperAuthorityReceiptHash: undefined }), /D_NEW_RISK_PLAN_REQUIRES_STRATEGY_AUTHORITY/);
  assert.ok(plan.definedRisk);
  const [shortLeg, longLeg] = plan.definedRisk.legs;
  assert.throws(() => masterPaperActionPlanSchema.parse({ ...plan, definedRisk: { ...plan.definedRisk, legs: [{ ...shortLeg, strike: 180 }, longLeg] } }),
    /DEFINED_RISK_PLAN_GEOMETRY_INVALID/, 'inverted strikes are not a put credit spread');
  assert.throws(() => masterPaperActionPlanSchema.parse({ ...plan, optionContractId: SHORT_ID }), /DEFINED_RISK_PLAN_GEOMETRY_INVALID/);
});

test('D handoff: both legs quoted separately, ONE native mleg parent, honest indicative provenance', async () => {
  const quotes = goodQuotes();
  const prepared = await prepareMasterPaperAction(readyPlan(), quotes, NOW, true, undefined, () => NOW);
  assert.equal(prepared.state, 'READY_TO_SUBMIT', JSON.stringify(prepared.blockers));
  assert.deepEqual([...quotes.requested].sort(), [LONG, SHORT].sort(), 'each leg quoted on its own exact contract');
  assert.ok(prepared.command);
  const command = prepared.command;
  const request = command.request;
  assert.equal(request.order_class, 'mleg');
  assert.deepEqual(request.legs?.map((leg) => [leg.symbol, leg.side, leg.position_intent, leg.ratio_qty]),
    [[SHORT, 'sell', 'sell_to_open', 1], [LONG, 'buy', 'buy_to_open', 1]]);
  // package natural credit 2.0-0.9=1.10, far credit 2.1-0.8=1.30: attempt 0 starts at the favorable (far) side
  assert.equal(request.limit_price, '-1.30');
  assert.equal(request.qty, 1);
  assert.equal(command.executionEvidence.quoteFeed, 'INDICATIVE');
  assert.equal(command.executionEvidence.quoteSemantics, 'PAPER_INDICATIVE_REFERENCE');
  assert.equal(command.optionContractId, null);
  assert.equal(prepared.quote?.contractId, SHORT, 'the recorded reference is a real leg quote, never the derived package quote');

  const broker = new Broker();
  const coordinator = new PaperOrderCoordinator(broker, new InMemoryPaperOrderStore(), { masterEnabled: true, followerEnabled: false, pauseNewOrders: false });
  const result = await new MasterPaperActionHandoff(goodQuotes(), new MasterPaperExecutionOrchestrator(coordinator), undefined, () => NOW).execute(readyPlan(), NOW, true);
  assert.equal(result.state, 'EXECUTED', JSON.stringify(result.blockers));
  assert.equal(broker.submitted.length, 1, 'exactly one broker mutation: the native package');
  assert.equal(broker.submitted[0]?.order_class, 'mleg');
});

test('D handoff never sends a partial package: a missing, stale, mixed-provenance or non-positive leg quote blocks the whole spread', async () => {
  const run = async (source: ExecutionOptionQuoteSource, marketOpen = true) => {
    const broker = new Broker();
    const coordinator = new PaperOrderCoordinator(broker, new InMemoryPaperOrderStore(), { masterEnabled: true, followerEnabled: false, pauseNewOrders: false });
    const result = await new MasterPaperActionHandoff(source, new MasterPaperExecutionOrchestrator(coordinator), undefined, () => NOW).execute(readyPlan(), NOW, marketOpen);
    assert.equal(broker.submitted.length, 0, `no broker mutation (${result.state})`);
    return result;
  };
  assert.equal((await run(new LegQuotes({ [SHORT]: quote(SHORT, 190, 2.0, 2.1), [LONG]: null }))).state, 'NO_QUOTE');
  assert.equal((await run(new LegQuotes({ [SHORT]: quote(SHORT, 190, 2.0, 2.1), [LONG]: { ...quote(LONG, 185, 0.8, 0.9), providerTimestamp: '2026-09-14T14:50:00.000Z' } })))
    .state, 'QUOTE_REJECTED');
  assert.equal((await run(new LegQuotes({ [SHORT]: quote(SHORT, 190, 2.0, 2.1), [LONG]: quote(LONG, 185, 0.8, 0.9, 'CONSOLIDATED_NBBO') }))).blockers[0],
    'DEFINED_RISK_LEG_QUOTE_PROVENANCE_MIXED_OR_UNPROVEN');
  // the long leg now costs more than the short leg pays: no credit package exists
  assert.equal((await run(new LegQuotes({ [SHORT]: quote(SHORT, 190, 0.5, 0.6), [LONG]: quote(LONG, 185, 0.8, 0.9) }))).state, 'PRICE_REJECTED');
  // a quote returned for the wrong contract is never used to price a leg
  assert.equal((await run(new LegQuotes({ [SHORT]: quote(SHORT, 190, 2.0, 2.1), [LONG]: quote(SHORT, 190, 0.8, 0.9) }))).state, 'QUOTE_REJECTED');
  assert.equal((await run(goodQuotes(), false)).state, 'BLOCKED');
});

test('runtime reads the persisted D leg identity strictly: wrong structure, missing or malformed legs read as missing', async () => {
  const { persistedDefinedRiskLegs } = await import('../src/research/production-shadow-runtime.js');
  const legs = [{ legIndex: 1, positionIntent: 'SELL_TO_OPEN', contractSymbol: SHORT, optionContractId: SHORT_ID },
    { legIndex: 2, positionIntent: 'BUY_TO_OPEN', contractSymbol: LONG, optionContractId: LONG_ID }];
  assert.deepEqual(persistedDefinedRiskLegs('PUT_CREDIT_SPREAD', { legs }),
    [{ legIndex: 1, occSymbol: SHORT, optionContractId: SHORT_ID }, { legIndex: 2, occSymbol: LONG, optionContractId: LONG_ID }]);
  assert.equal(persistedDefinedRiskLegs('CSP', { legs }), null);
  assert.equal(persistedDefinedRiskLegs('PUT_CREDIT_SPREAD', null), null);
  assert.equal(persistedDefinedRiskLegs('PUT_CREDIT_SPREAD', { legs: [legs[0], { ...legs[1], optionContractId: null }] }), null);
  // feeding the strict read into assembly: a one-leg persisted identity can never become a plan
  assert.ok(assembleDefinedRiskPaperEvidencePlan(assemblyInput({ persistedLegs: persistedDefinedRiskLegs('PUT_CREDIT_SPREAD', { legs: [legs[0]] }) }))
    .blockers.includes('PERSISTED_LEG_CONTRACT_IDENTITY_MISSING'));
});

test('a SELECTED D candidate without its own required AEGIS fails closed; with its own bound AEGIS it is valid', () => {
  assert.ok(assembleDefinedRiskPaperEvidencePlan(assemblyInput({ aegisState: null })).blockers.includes('AEGIS_SELECTION_LINEAGE_MISSING'));
  assert.ok(assembleDefinedRiskPaperEvidencePlan(assemblyInput({ aegisAssessmentIdentity: null })).blockers.includes('AEGIS_ASSESSMENT_LINEAGE_INVALID'));
  assert.ok(assembleDefinedRiskPaperEvidencePlan(assemblyInput({ aegisInputOrigin: null })).blockers.includes('AEGIS_REAL_INPUT_LINEAGE_MISSING'));
  assert.equal(assembleDefinedRiskPaperEvidencePlan(assemblyInput()).state, 'READY', 'own candidate-bound AEGIS identity: valid');
});
