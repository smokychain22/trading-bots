import assert from 'node:assert/strict';
import test from 'node:test';
import { brokerPayloadForOrder, multiLegPackageIdentity, parseBrokerOrder } from '../src/execution/broker.js';
import { buildDefinedRiskPaperCommand, reconcileDefinedRiskParent } from '../src/execution/defined-risk-paper-order.js';
import { buildStrategyPaperAuthorityReceipt, assertStrategyPaperOrderAllowed } from '../src/theta/strategy-paper-authority.js';
import type { DefinedRiskLockedPlan } from '../src/research/defined-risk-locked-plan.js';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';
import { assembleMasterPaperEvidencePlan } from '../src/execution/master-paper-plan-assembly.js';
import { buildPaperEntrySafetyPolicyReceipt } from '../src/theta/paper-entry-safety-policy.js';
import { testAegisAssessmentIdentity } from './fixtures/aegis-assessment-identity.js';
import { buildEntryThesisReceipt } from '../src/theta/entry-thesis-receipt.js';
import { loadManagementEntryThesis } from '../src/theta/management-entry-thesis.js';
import { buildManagementActionFrontier } from '../src/theta/management-action-frontier.js';
import { buildT0ReplayBundle, replayFromT0Bundle } from '../src/theta/t0-replay-bundle.js';
import { buildHoldStrikeProductionDecision } from '../src/theta/hold-strike-production-decision.js';

const NOW = '2026-09-14T15:00:00.000Z';
const UUID = {
  account: '10000000-0000-4000-8000-000000000001', decision: '10000000-0000-4000-8000-000000000002',
  candidate: '10000000-0000-4000-8000-000000000003', contract: '10000000-0000-4000-8000-000000000004',
  underlying: '10000000-0000-4000-8000-000000000005', chain: '10000000-0000-4000-8000-000000000006',
};

const dPlan = (): DefinedRiskLockedPlan => ({
  contractVersion: 'theta-defined-risk-locked-plan-v1', planId: 'd-plan', strategy: 'THETA_DEFINED_RISK',
  action: 'OPEN_DEFINED_RISK', planState: 'READY_LOCKED', underlying: 'SPY', candidateId: 'THETA_DEFINED_RISK:d1',
  snapshotId: 'snap', decisionCycleId: 'cycle', decisionAsOf: NOW, strategyVersion: 'd-v1', sourceEvidenceIds: ['e1'],
  legs: [
    { sequence: 1, occSymbol: 'SPY261016P00650000', side: 'SELL_TO_OPEN', optionType: 'PUT', quantity: 1,
      strike: 650, expiration: '2026-10-16', multiplier: 100, bid: 2, ask: 2.1, quoteTimestamp: NOW },
    { sequence: 2, occSymbol: 'SPY261016P00645000', side: 'BUY_TO_OPEN', optionType: 'PUT', quantity: 1,
      strike: 645, expiration: '2026-10-16', multiplier: 100, bid: 0.8, ask: 0.9, quoteTimestamp: NOW },
  ],
  quantity: 1, netLimitCreditPerShare: 1.1, netLimitCreditTotal: 110, maxProfit: 110, maxLoss: 390,
  breakEven: 648.9, capitalRequirement: 390, aegisReceipt: { state: 'ALLOW_FULL', bindingReasons: [] },
  sizingReceipt: { quantity: 1, bindingConstraint: 'DEFINED_RISK_MAX_LOSS', reasons: [] },
  brokerMultiLegSupport: 'ATOMIC_MULTI_LEG_SUPPORTED', brokerMultiLegCapabilityVersion: 'alpaca-options-level-3-mleg-docs-2026-10-06',
  runtimeMutationAdapter: 'NOT_IMPLEMENTED_RESEARCH_ONLY', brokerAuthority: false, submissionAllowed: false,
  contentHash: 'a'.repeat(64),
});

const dAuthorization = buildStrategyPaperAuthorityReceipt({ strategy:'THETA_DEFINED_RISK',ownerPaperAuthorization:true,
  technicalStrategyCertification:true,idempotencyCertified:true,riskAuthorization:true,currentActionAuthorization:true,brokerCapability:'SUPPORTED',
  decisionPlanBound:true,reconciliationCertified:true,managementCoverageCertified:true,restartRecoveryCertified:true,
  wholeChainAccountingCertified:true,strategyCanaryAccepted:false,liveAuthorization:false,observedAt:NOW,evidenceIds:['phase4-d-tests'] });

const dLegContractEvidence=[
  {optionContractId:'20000000-0000-4000-8000-000000000001',providerContractId:'alpaca-short',deliverableIdentity:'STANDARD:SPY:100'},
  {optionContractId:'20000000-0000-4000-8000-000000000002',providerContractId:'alpaca-long',deliverableIdentity:'STANDARD:SPY:100'},
] as const;

test('native D command is one mleg parent and never sends naked parent symbol or side fields', () => {
  const command = buildDefinedRiskPaperCommand({ plan: dPlan(), authorization: dAuthorization,
    executionAccountId: UUID.account, decisionId: UUID.decision, chainId: UUID.chain, underlyingId: UUID.underlying,
    canonicalQuantity: 1, paperEvidenceQuantity: 1, paperEvidenceRiskCap: 1, limitCreditPerShare: 1.1,
    now: NOW, decisionExpiresAt: '2026-09-14T15:00:30.000Z', maximumQuoteAgeSeconds: 30, attempt: 1,
    legContractEvidence:dLegContractEvidence });
  assert.equal(command.request.order_class, 'mleg');
  assert.equal(command.request.legs?.length, 2);
  assert.equal(command.request.limit_price, '-1.10');
  assert.equal(command.request.symbol, multiLegPackageIdentity(command.request.legs ?? []));
  const payload = brokerPayloadForOrder(command.request);
  assert.equal(payload.order_class, 'mleg');
  assert.equal('symbol' in payload, false);
  assert.equal('side' in payload, false);
  assert.deepEqual((payload.legs as unknown[]).length, 2);
});

test('D pre-submit rejects a stale leg, crossed leg, wrong geometry, and invalid credit without producing a request', () => {
  const base = { plan: dPlan(), authorization: dAuthorization, executionAccountId: UUID.account,
    decisionId: UUID.decision, chainId: UUID.chain, underlyingId: UUID.underlying, canonicalQuantity: 1,
    paperEvidenceQuantity: 1, paperEvidenceRiskCap: 1, limitCreditPerShare: 1.1, now: NOW,
    decisionExpiresAt: '2026-09-14T15:00:30.000Z', maximumQuoteAgeSeconds: 30, attempt: 1,
    legContractEvidence:dLegContractEvidence } as const;
  assert.throws(() => buildDefinedRiskPaperCommand({ ...base, plan: { ...dPlan(), legs: [
    { ...dPlan().legs[0], quoteTimestamp: '2026-09-14T14:58:00.000Z' }, dPlan().legs[1]] } }), /QUOTE_NOT_EXECUTABLE/);
  assert.throws(() => buildDefinedRiskPaperCommand({ ...base, limitCreditPerShare: 1.21 }), /LIMIT_CREDIT_INVALID/);
  assert.throws(() => buildDefinedRiskPaperCommand({ ...base, plan: { ...dPlan(), legs: [dPlan().legs[0],
    { ...dPlan().legs[1], expiration: '2026-10-23' }] } }), /STRUCTURE_INVALID/);
  const incompleteAuthority = buildStrategyPaperAuthorityReceipt({ ...dAuthorization,
    managementCoverageCertified: false, evidenceIds: ['phase4-d-management-gap'] });
  assert.throws(() => buildDefinedRiskPaperCommand({ ...base, authorization: incompleteAuthority }),
    /DEFINED_RISK_AUTHORITY_INCOMPLETE/);
});

test('Alpaca nested mleg response preserves every leg and exposes asymmetric partial risk', () => {
  const raw = { id: 'parent-1', client_order_id: 'theta-parent', qty: '2', filled_qty: '1', filled_avg_price: '-1.1',
    status: 'partially_filled', limit_price: '-1.1', submitted_at: NOW, order_class: 'mleg',
    legs: [
      { id: 'short-1', symbol: 'SPY261016P00650000', side: 'sell', position_intent: 'sell_to_open', ratio_qty: '1',
        qty: '2', filled_qty: '1', filled_avg_price: '2', status: 'partially_filled' },
      { id: 'long-1', symbol: 'SPY261016P00645000', side: 'buy', position_intent: 'buy_to_open', ratio_qty: '1',
        qty: '2', filled_qty: '0', filled_avg_price: null, status: 'new' },
    ] };
  const parsed = parseBrokerOrder(raw);
  assert.equal(parsed.orderClass, 'mleg');
  assert.equal(parsed.legs?.length, 2);
  const state = reconcileDefinedRiskParent(parsed);
  assert.equal(state.parentState, 'PARTIALLY_FILLED');
  assert.equal(state.asymmetricLegRisk, true);
  assert.equal(state.requiresReconciliation, true);
  assert.deepEqual(state.legs.map((leg) => leg.remainingQty), [1, 2]);
});

test('a parent reported filled with incomplete leg truth becomes UNKNOWN_RECONCILING', () => {
  const order = parseBrokerOrder({ id: 'p', client_order_id: 'c', qty: '1', filled_qty: '1', filled_avg_price: '1',
    status: 'filled', limit_price: '1', order_class: 'mleg', legs: [
      { id: 's', symbol: 'SPY261016P00650000', side: 'sell', position_intent: 'sell_to_open', ratio_qty: '1', qty: '1', filled_qty: '1', filled_avg_price: '2', status: 'filled' },
      { id: 'l', symbol: 'SPY261016P00645000', side: 'buy', position_intent: 'buy_to_open', ratio_qty: '1', qty: '1', filled_qty: '0', filled_avg_price: null, status: 'new' },
    ] });
  assert.equal(reconcileDefinedRiskParent(order).parentState, 'UNKNOWN_RECONCILING');
});

test('strategy authority requires owner, technical, risk, action, broker, management, accounting, and restart gates', () => {
  const complete = buildStrategyPaperAuthorityReceipt({ strategy: 'THETA_HOLD_STRIKE', ownerPaperAuthorization: true,
    technicalStrategyCertification: true, idempotencyCertified: true, riskAuthorization: true, currentActionAuthorization: true,
    brokerCapability: 'SUPPORTED', decisionPlanBound: true, reconciliationCertified: true,
    managementCoverageCertified: true, restartRecoveryCertified: true, wholeChainAccountingCertified: true,
    strategyCanaryAccepted: false, liveAuthorization: false, observedAt: NOW, evidenceIds: ['phase4-tests'] });
  assert.equal(complete.paperOpeningOrderAllowed, true);
  assert.equal(complete.maturity, 'PAPER_EXPERIMENTAL_AUTHORIZED');
  assert.doesNotThrow(() => assertStrategyPaperOrderAllowed(complete, 'THETA_HOLD_STRIKE'));
  const blocked = buildStrategyPaperAuthorityReceipt({ ...complete, brokerCapability: 'UNKNOWN', evidenceIds: ['read-only-account'] });
  assert.equal(blocked.paperOpeningOrderAllowed, false);
  assert.deepEqual(blocked.blockers, ['BROKER_CAPABILITY_UNKNOWN']);
});

function route(eligible: readonly StrategyFamily[]) {
  const all: readonly StrategyFamily[] = ['THETA_Q','THETA_H','THETA_R','THETA_A','THETA_C','THETA_D'];
  return parseStrategyRoutingResponse({ contractVersion:'theta-strategy-router-runtime-v1', snapshotId:'h-snap', timestamp:NOW,
    policyVersion:'router-v1', results:all.map((strategyFamily) => ({ strategyFamily, eligible:eligible.includes(strategyFamily),
      eligibilityState:eligible.includes(strategyFamily)?'ELIGIBLE_CHALLENGER':'INELIGIBLE_STATE',
      reasons:[{code:'TEST',polarity:0,detail:'test'}],policyVersion:'router-v1' })) });
}

const hContract = normalizeOptionContract({ source:'ALPACA', underlying:'AAPL', optionSymbol:'AAPL260917P00190000',
  occSymbol:'AAPL260917P00190000', optionType:'PUT', strike:190, expiration:'2026-09-17', asOfDate:'2026-09-14', multiplier:100,
  underlyingBid:199.9,underlyingAsk:200.1,underlyingLast:200,underlyingTimestamp:NOW,bid:2,ask:2.1,bidSize:20,askSize:20,
  lastTradePrice:2.05,lastTradeSize:1,quoteTimestamp:NOW,tradeTimestamp:NOW,volume:100,volumeSource:'ALPACA',openInterest:1000,
  openInterestSource:'OPTIONOMICS',iv:0.3,delta:-0.2,gamma:0.02,theta:-0.1,vega:0.1,rho:-0.01,greeksTimestamp:NOW,
  greeksSource:'OPTIONOMICS',feed:'OPRA',dataQuality:'GOOD',maxQuoteAgeSecondsForExecutable:30,maxSpreadPctForExecutable:0.2 },NOW);

const hStrategyPaperAuthority=buildStrategyPaperAuthorityReceipt({strategy:'THETA_HOLD_STRIKE',ownerPaperAuthorization:true,
  technicalStrategyCertification:true,idempotencyCertified:true,riskAuthorization:true,currentActionAuthorization:true,
  brokerCapability:'SUPPORTED',decisionPlanBound:true,reconciliationCertified:true,managementCoverageCertified:true,
  restartRecoveryCertified:true,wholeChainAccountingCertified:true,strategyCanaryAccepted:false,liveAuthorization:false,
  observedAt:NOW,evidenceIds:['phase4-h-tests']});

const hFrontierInput = () => ({ snapshotId:'h-snap',timestamp:NOW,strategyVersion:'strategy-v1',
  contracts:[hContract],routing:route(['THETA_H']),stock:null,assignmentCapacityQty:2,buyingPower:100_000,brokerAllowedQty:2,
  sizingPolicy:{riskBudgetQtyCap:2,collateralQtyCap:2,concentrationQtyCap:2,assignmentCapacityQtyCap:2,
    tailRiskQtyCap:2,correlationQtyCap:2,liquidityQtyCap:2,reducedStateMultiplier:0.5},
  aegisNewRiskState:'ALLOW_FULL',eventState:'CLEAR',unmanagedBrokerPositionCount:0,unevaluatedUnderlyingCount:0,
  optionomicsContext:{},entryEligibilityByOptionSymbol:{[hContract.optionSymbol]:{
    basis:'PAPER_ENTRY_BOOTSTRAP_UNCALIBRATED',paperBootstrapPolicyVersion:'theta-paper-entry-bootstrap-v3',
    paperBootstrapAllowedUnknownComponents:['EventAdjustment','RecoveryQuality'],
    paperBootstrapReasonCodes:['EVENT_DISTANCE_UNKNOWN','RECOVERY_HISTORY_UNKNOWN','SEVERE_DRAWDOWN_MODEL_NOT_PROMOTED'],
  }},paperEntryDecision:{branch:'THETA_HOLD_STRIKE',snapshotId:'h-snap',timestamp:NOW,underlying:'AAPL',
    winningAction:'OPEN_FULL',selectedCandidateId:hContract.optionSymbol,quantity:1,technicalCertification:'CERTIFIED',
    paperAuthorization:'PAPER_EXPERIMENTAL_AUTHORIZED',strategyPaperAuthority:hStrategyPaperAuthority} } as const);

const entryPolicy = buildPaperEntrySafetyPolicyReceipt({ decisionAsOf:'2026-09-14T15:00:01.000Z',
  companyEvent:{policyVersion:'theta-company-event-paper-policy-v1',authority:'PAPER_BOOTSTRAP_NOT_COMPLETE_COMPANY_COVERAGE',
    action:'CLEAR',state:'KNOWN_AFTER_EXPIRY_CLEAR',decisionAsOf:'2026-09-14T15:00:01.000Z',validThrough:'2026-09-30',
    instrument:{policyVersion:'theta-paper-instrument-classification-v1',symbol:'AAPL',state:'OPERATING_COMPANY',paperBootstrapApproved:true,
      authority:'VERSIONED_MANIFEST',evidenceIds:['manifest'],observedAt:NOW,reason:'TEST'},earningsDistanceTradingSessions:20,
    sessionsThroughExpiration:3,macroState:'KNOWN_FALSE',evidenceIds:['event'],reason:'TEST'},
  corporateAction:{policyVersion:'theta-corporate-action-paper-policy-v1',authority:'PAPER_BOOTSTRAP_NOT_COMPLETE_NEGATIVE_ASSURANCE',
    action:'CLEAR',state:'PAPER_BOOTSTRAP_LIMITED',decisionAsOf:'2026-09-14T15:00:01.000Z',queryObservedAt:NOW,
    queryWindow:{start:'2026-09-14',end:'2026-09-30'},paginationComplete:true,negativeCoverageQualified:false,
    positiveRelevance:'EXPIRED_NOT_RELEVANT',missingPrerequisites:[],evidenceIds:[],reason:'TEST'} });

test('one canonical frontier can select H from an explicit certified receipt and build an H plan without relabeling it Q', () => {
  const raw=hFrontierInput();
  const structural=buildCanonicalStrategyFrontier({...raw,paperEntryDecision:undefined});
  const produced=buildHoldStrikeProductionDecision({structuralFrontier:structural,
    thetaQDecision:{winningAction:'PASS'},authority:hStrategyPaperAuthority});
  assert.ok(produced);
  const frontier = buildCanonicalStrategyFrontier({...raw,paperEntryDecision:produced});
  assert.equal(frontier.selectedBranch, 'THETA_HOLD_STRIKE');
  assert.equal(frontier.entrySelectionBasis, 'THETA_H_DECISION_BOUND');
  const identity = testAegisAssessmentIdentity({ runtimeCandidateRef:`THETA_HOLD_STRIKE:${hContract.optionSymbol}`,
    strategyBranch:'THETA_HOLD_STRIKE',persistedCandidateId:UUID.candidate,optionSymbol:hContract.optionSymbol,decisionAsOf:NOW });
  const result = assembleMasterPaperEvidencePlan({ frontier,executionAccountId:UUID.account,decisionId:UUID.decision,
    persistedCandidateId:UUID.candidate,optionContractId:UUID.contract,underlyingId:UUID.underlying,accountStatus:'ACTIVE',
    optionsApprovedLevel:3,optionsTradingLevel:3,aegisState:'ALLOW_FULL',aegisInputOrigin:'DERIVED_FROM_REAL',
    aegisAssessmentIdentity:identity,entrySafetyPolicy:entryPolicy,openPositionSymbols:[],openOrderSymbols:[],
    paperEvidenceRiskCap:1,firstCanaryCompleted:false,modeledRoundTripCostPerContract:1.7,strategyPaperAuthority:hStrategyPaperAuthority,
    now:'2026-09-14T15:00:01.000Z',decisionExpiresAt:'2026-09-14T15:00:30.000Z' });
  assert.equal(result.state, 'READY');
  if (result.state === 'READY') {
    assert.equal(result.plan.strategyBranch, 'THETA_HOLD_STRIKE');
    assert.equal(result.plan.symbol, hContract.optionSymbol);
    assert.equal(result.plan.action, 'OPEN_CSP');
  }
});

test('H selection fails closed when its independent strategy authority is missing or tampered', () => {
  const input = hFrontierInput();
  const missing = buildCanonicalStrategyFrontier({ ...input, paperEntryDecision: undefined });
  assert.notEqual(missing.selectedBranch, 'THETA_HOLD_STRIKE');
  const tampered = buildCanonicalStrategyFrontier({ ...input, paperEntryDecision: {
    ...input.paperEntryDecision,
    strategyPaperAuthority: { ...input.paperEntryDecision.strategyPaperAuthority,
      contentHash: 'f'.repeat(64) },
  } });
  assert.notEqual(tampered.selectedBranch, 'THETA_HOLD_STRIKE');
});

test('H decision and independent authority survive T0 persistence input and replay without provider re-fetch', () => {
  const bundle = buildT0ReplayBundle(hFrontierInput());
  assert.equal(bundle.paperEntryDecision?.branch, 'THETA_HOLD_STRIKE');
  assert.equal(bundle.paperEntryDecision?.strategyPaperAuthority.contentHash, hStrategyPaperAuthority.contentHash);
  const replayed = replayFromT0Bundle(JSON.parse(JSON.stringify(bundle)) as typeof bundle);
  assert.equal(replayed.selectedBranch, 'THETA_HOLD_STRIKE');
  assert.equal(replayed.contentHash, bundle.expectedFrontierContentHash);
});

test('H thesis identity survives management loading and prohibits Q roll inheritance', () => {
  const claim = { state:'KNOWN' as const, statement:'test evidence', evidenceIds:['e1'] };
  const receipt = buildEntryThesisReceipt({ decisionId:'d',snapshotId:'s',candidateId:'h',decisionAt:NOW,underlying:'AAPL',
    strategy:'THETA_HOLD_STRIKE',whyUnderlying:claim,whyStrategy:claim,whyExpiry:claim,whyStrike:claim,whyNow:claim,
    quantityReason:claim,volatilityThesis:claim,directionalTolerance:claim,eventAssumptions:claim,breakEven:188,
    downsideCushion:0.05,assignmentWillingness:claim,expectedManagementPath:claim,
    expectedCapitalDays:{value:null,state:'EMPIRICALLY_UNPROVEN'},invalidationConditions:['RISK_EXIT'] });
  assert.equal(loadManagementEntryThesis(receipt,{decisionId:'d',snapshotId:'s',decidedAt:NOW,underlying:'AAPL',managementAsOf:NOW}).state,'VERIFIED');
  const state = { lifecycleState:'CSP_OPEN',strategyOrigin:'THETA_HOLD_STRIKE',chainId:'c',contentHash:'h',observedAt:NOW,
    contractVersion:'theta-management-input-v3',managementInputSnapshotId:'m',reconciliationSnapshotId:'r',fusionSnapshotId:'f',
    evidenceBundle:{decisionAsOf:NOW,reconciliationObservedAt:NOW,accountStateAsOf:NOW,accountReceivedAt:NOW,positionStateAsOf:NOW,
      fusionSnapshotAsOf:NOW,currentLegQuoteObservedAt:NOW,currentLegQuoteReceivedAt:NOW,timingState:'VALID'},
    underlying:'AAPL',underlyingId:'u',contract:{optionLegId:'l',optionContractId:'o',symbol:'AAPL260917P00190000',optionType:'PUT',
      strike:190,expiration:'2026-09-17',multiplier:100,contracts:1},economics:{entryCreditDebit:200,realizedOptionPnl:0,
      unrealizedOptionPnl:0,openStockShares:0,stockBasisPerShare:null,stockMarkPerShare:null,unrealizedStockPnl:null,
      realizedStockPnl:0,dividends:0,fees:0,wholeChainPnl:0},market:{spot:200,optionBid:1,optionAsk:1.1,quoteTimestamp:NOW,
      quoteFeed:'OPRA',quoteQuality:'GOOD',marketOpen:true,clockTimestamp:NOW,nextOpen:null,nextClose:null,calendarSessions:[],dte:3,
      moneyness:0.95,delta:-0.2,gamma:0.02,theta:-0.1,vega:0.1,iv:0.3,ivState:null},account:{buyingPower:10000,
      optionsBuyingPower:10000,availableCapital:10000},context:{eventState:'CLEAR',dividendExDateState:'CLEAR',ownershipQuality:'KNOWN',
      assignmentCapacity:1,assignmentCapacityEvidence:{state:'KNOWN',quantity:1,unit:'STANDARD_CONTRACTS',source:'ALPACA_ACCOUNT_BUYING_POWER',
        observedAt:NOW,validThrough:null,contentHash:'a'.repeat(64),reason:null},recoveryState:null,concentration:null,sectorCorrelation:null,
      aegisState:'ALLOW_FULL',executionState:'GOOD',regimeState:null,opportunityAlternatives:null,strategyVersions:null},unknownFields:[],
    hardBlockers:[],economicModelState:'EV_MODEL_NOT_EMPIRICALLY_READY' } as const;
  assert.equal(buildManagementActionFrontier(state).actions.some((action) => action.action === 'ROLL'), false);
});

test('a SELECTED H candidate never borrows Q AEGIS: the Q per-symbol identity or no identity fails closed; its own bound identity is READY', () => {
  const raw = hFrontierInput();
  const produced = buildHoldStrikeProductionDecision({ structuralFrontier: buildCanonicalStrategyFrontier({ ...raw, paperEntryDecision: undefined }),
    thetaQDecision: { winningAction: 'PASS' }, authority: hStrategyPaperAuthority });
  assert.ok(produced, 'no vacuous pass');
  const frontier = buildCanonicalStrategyFrontier({ ...raw, paperEntryDecision: produced });
  const assemble = (aegisAssessmentIdentity: ReturnType<typeof testAegisAssessmentIdentity> | null) => assembleMasterPaperEvidencePlan({ frontier,
    executionAccountId: UUID.account, decisionId: UUID.decision, persistedCandidateId: UUID.candidate, optionContractId: UUID.contract, underlyingId: UUID.underlying,
    accountStatus: 'ACTIVE', optionsApprovedLevel: 3, optionsTradingLevel: 3, aegisState: 'ALLOW_FULL', aegisInputOrigin: 'DERIVED_FROM_REAL', aegisAssessmentIdentity,
    entrySafetyPolicy: entryPolicy, openPositionSymbols: [], openOrderSymbols: [], paperEvidenceRiskCap: 1, firstCanaryCompleted: false, modeledRoundTripCostPerContract: 1.7,
    strategyPaperAuthority: hStrategyPaperAuthority, now: '2026-09-14T15:00:01.000Z', decisionExpiresAt: '2026-09-14T15:00:30.000Z' });
  const qIdentity = testAegisAssessmentIdentity({ runtimeCandidateRef: `THETA_CONVENTIONAL:${hContract.optionSymbol}`, persistedCandidateId: UUID.candidate,
    optionSymbol: hContract.optionSymbol, decisionAsOf: NOW });
  assert.ok(assemble(qIdentity).blockers.includes('AEGIS_ASSESSMENT_LINEAGE_INVALID'), 'Q verdict for the same contract is never H evidence');
  assert.ok(assemble(null).blockers.includes('AEGIS_ASSESSMENT_LINEAGE_INVALID'), 'missing required AEGIS fails closed');
  const own = testAegisAssessmentIdentity({ runtimeCandidateRef: `THETA_HOLD_STRIKE:${hContract.optionSymbol}`, strategyBranch: 'THETA_HOLD_STRIKE',
    persistedCandidateId: UUID.candidate, optionSymbol: hContract.optionSymbol, decisionAsOf: NOW });
  const ready = assemble(own);
  assert.equal(ready.state, 'READY', JSON.stringify(ready.blockers));
  if (ready.state === 'READY') assert.equal(ready.plan.strategyBranch, 'THETA_HOLD_STRIKE', 'H identity survives into the plan');
});
