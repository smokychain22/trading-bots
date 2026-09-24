import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrokerOrderRequest, BrokerOrderSnapshot, PaperBrokerAdapter } from '../src/execution/broker.js';
import { executionOptionQuoteContractVersion, type ExecutionOptionQuote } from '../src/execution/execution-option-quote.js';
import { MasterPaperActionHandoff, classifyMasterPaperActionExecution, masterPaperActionPlanSchema, masterPaperActionPlanVersion,
  prepareMasterPaperAction, preSubmitMaximumQuoteAgeMs, type ApprovedMasterPaperActionPlan,
  type ExecutionOptionQuoteSource } from '../src/execution/master-paper-action-handoff.js';
import { MasterPaperExecutionOrchestrator } from '../src/execution/master-paper-execution-orchestrator.js';
import { InMemoryPaperOrderStore, PaperOrderCoordinator } from '../src/execution/paper-order-coordinator.js';
import { applyPaperEvidenceRiskCap } from '../src/execution/execution-authorization-tier.js';
import { buildPaperEntrySafetyPolicyReceipt } from '../src/theta/paper-entry-safety-policy.js';
import { testAegisAssessmentIdentity } from './fixtures/aegis-assessment-identity.js';

const now='2026-09-14T14:00:00.000Z';
const entrySafetyPolicy=buildPaperEntrySafetyPolicyReceipt({decisionAsOf:now,
  companyEvent:{policyVersion:'theta-company-event-paper-policy-v1',authority:'PAPER_BOOTSTRAP_NOT_COMPLETE_COMPANY_COVERAGE',
    action:'CLEAR',state:'KNOWN_AFTER_EXPIRY_CLEAR',decisionAsOf:now,validThrough:'2026-10-31',
    instrument:{policyVersion:'theta-paper-instrument-classification-v1',symbol:'AAPL',state:'OPERATING_COMPANY',paperBootstrapApproved:true,
      authority:'VERSIONED_MANIFEST',evidenceIds:['manifest-aapl'],observedAt:'2026-09-01T00:00:00.000Z',reason:'TEST'},
    earningsDistanceTradingSessions:40,sessionsThroughExpiration:24,macroState:'KNOWN_FALSE',evidenceIds:['event-1'],reason:'TEST'},
  corporateAction:{policyVersion:'theta-corporate-action-paper-policy-v1',authority:'PAPER_BOOTSTRAP_NOT_COMPLETE_NEGATIVE_ASSURANCE',
    action:'CLEAR',state:'PAPER_BOOTSTRAP_LIMITED',decisionAsOf:now,queryObservedAt:now,
    queryWindow:{start:'2026-09-14',end:'2026-10-29'},paginationComplete:true,negativeCoverageQualified:false,
    positiveRelevance:'EXPIRED_NOT_RELEVANT',missingPrerequisites:[],evidenceIds:[],reason:'TEST'},
});
const quote:ExecutionOptionQuote={contractVersion:executionOptionQuoteContractVersion,contractId:'AAPL261016P00150000',
  providerContractId:'AAPL261016P00150000',bid:1.2,ask:1.3,bidSize:10,askSize:12,providerTimestamp:now,
  receivedAtUtc:now,receivedAtMonotonic:1,sequence:1,provider:'ALPACA',sourceSemantics:'CONSOLIDATED_NBBO',
  connectionState:'CONNECTED',subscriptionState:'ACTIVE',provenance:{authenticated:true,exactContractMapping:true,documentedForOrderPricing:true}};

const plan=(overrides:Partial<ApprovedMasterPaperActionPlan>={}):ApprovedMasterPaperActionPlan=>({
  contractVersion:masterPaperActionPlanVersion,actionPlanId:'11111111-1111-4111-8111-111111111111',
  decisionAuthority:'NEW_RISK',managementInputSnapshotId:null,managementActionFrontierId:null,
  actionGroupId:'11111111-1111-4111-8111-111111111111',legSequence:1,dependsOnActionPlanId:null,
  executionAccountId:'22222222-2222-4222-8222-222222222222',decisionId:'33333333-3333-4333-8333-333333333333',
  candidateId:'44444444-4444-4444-8444-444444444444',strategyVersion:'theta-conventional-v1',
  chainId:'55555555-5555-4555-8555-555555555555',optionContractId:'66666666-6666-4666-8666-666666666666',
  underlyingId:'77777777-7777-4777-8777-777777777777',underlying:'AAPL',optionType:'PUT',symbol:'AAPL261016P00150000',
  quantity:1,canonicalQuantity:1,paperEvidenceQuantity:1,paperEvidenceRiskCap:1,
  paperEvidenceCapReason:'CANONICAL_QUANTITY_LOWER',executionTier:'EMPIRICALLY_PROMOTED_PAPER',
  multiplier:100,action:'OPEN_CSP',economicBoundary:1.2,economicsRemainPositive:true,expectedAfterCostEv:15,
  empiricalEconomicsReady:true,selectedByCanonicalAuthority:true,hardValidityPassed:true,accountVerified:true,
  optionsCapabilityVerified:true,noEquivalentExposureConflict:true,aegisState:'ALLOW_FULL',killSwitchActive:false,
  aegisAssessmentIdentity:testAegisAssessmentIdentity(),
  decisionExpiresAt:'2026-09-14T14:01:00.000Z',pricingPolicy:{waitIntervalMs:1000,maxAttempts:2,
    concessionFractions:[0,0.5],tickSize:0.01},pricingAttempt:0,previousLimit:null,entrySafetyPolicy,...overrides});

class QuoteSource implements ExecutionOptionQuoteSource{constructor(private readonly value:ExecutionOptionQuote|null){}
  async getCurrentQuote(){return this.value;}}
class Broker implements PaperBrokerAdapter{
  readonly accountKind='MASTER_API_KEY' as const;readonly environment='PAPER' as const;submitCalls=0;
  getAccount=async()=>({});getPositions=async()=>[];getOrders=async()=>[];getOrder=async()=>null;getOrderByClientOrderId=async()=>null;
  getActivities=async()=>[];replaceOrder=async()=>{throw new Error('unused');};cancelOrder=async()=>{};
  submitOrder=async(request:BrokerOrderRequest):Promise<BrokerOrderSnapshot>=>{this.submitCalls+=1;return{id:'broker-1',
    clientOrderId:request.client_order_id,symbol:request.symbol,qty:request.qty,filledQty:0,filledAvgPrice:null,side:request.side,
    status:'accepted',limitPrice:Number(request.limit_price),submittedAt:now,replacedBy:null,replaces:null};};}

const setup=(value:ExecutionOptionQuote|null=quote)=>{const broker=new Broker();const coordinator=new PaperOrderCoordinator(broker,
  new InMemoryPaperOrderStore(),{masterEnabled:true,followerEnabled:false,pauseNewOrders:false});return{broker,
    handoff:new MasterPaperActionHandoff(new QuoteSource(value),new MasterPaperExecutionOrchestrator(coordinator))};};

test('approved canonical action reaches the existing Paper coordinator exactly once',async()=>{
  const {broker,handoff}=setup();const result=await handoff.execute(plan(),now,true);
  assert.equal(result.state,'EXECUTED');assert.equal(result.execution?.submittedNow,true);assert.equal(broker.submitCalls,1);
});

test('pre-submit freshness is independently versioned and bounded by the decision window',()=>{
  const policy={policyVersion:'pre-submit-test-v1',effectiveAt:'2026-09-01T00:00:00.000Z',maximumAgeMs:10_000};
  assert.equal(preSubmitMaximumQuoteAgeMs({policy,now,decisionExpiresAt:'2026-09-14T14:01:00.000Z'}),10_000);
  assert.equal(preSubmitMaximumQuoteAgeMs({policy,now,decisionExpiresAt:'2026-09-14T14:00:05.000Z'}),5_000);
  assert.equal(preSubmitMaximumQuoteAgeMs({policy:{...policy,effectiveAt:'2026-09-15T00:00:00.000Z'},now,
    decisionExpiresAt:'2026-09-14T14:01:00.000Z'}),null);
});

test('pre-submit policy rejects a quote that the longer action-plan window would otherwise accept',async()=>{
  const broker=new Broker();
  const coordinator=new PaperOrderCoordinator(broker,new InMemoryPaperOrderStore(),
    {masterEnabled:true,followerEnabled:false,pauseNewOrders:false});
  const handoff=new MasterPaperActionHandoff(
    new QuoteSource({...quote,providerTimestamp:'2026-09-14T13:59:40.000Z'}),
    new MasterPaperExecutionOrchestrator(coordinator),
    {policyVersion:'pre-submit-test-v1',effectiveAt:'2026-09-01T00:00:00.000Z',maximumAgeMs:10_000},
  );
  const result=await handoff.execute(plan(),now,true);
  assert.equal(result.state,'QUOTE_REJECTED');
  assert.ok(result.blockers.includes('QUOTE_STALE'));
  assert.equal(broker.submitCalls,0);
});

test('missing quote, hard veto, and unpromoted economics in promoted tier produce zero broker mutation',async()=>{
  const noQuote=setup(null);assert.equal((await noQuote.handoff.execute(plan(),now,true)).state,'NO_QUOTE');
  assert.equal(noQuote.broker.submitCalls,0);
  const veto=setup();const vetoed=await veto.handoff.execute(plan({aegisState:'HARD_VETO'}),now,true);
  assert.equal(vetoed.state,'BLOCKED');assert.equal(veto.broker.submitCalls,0);
  const unknown=setup();const blocked=await unknown.handoff.execute(plan({expectedAfterCostEv:null,empiricalEconomicsReady:false}),now,true);
  assert.equal(blocked.state,'BLOCKED');assert.ok(blocked.blockers.includes('POSITIVE_AFTER_COST_EV_NOT_EMPIRICALLY_READY'));
  assert.equal(unknown.broker.submitCalls,0);
});

test('new-risk handoff blocks a missing or uncleared entry safety policy',async()=>{
  const missing=setup();const missingResult=await missing.handoff.execute(plan({entrySafetyPolicy:undefined}),now,true);
  assert.equal(missingResult.state,'BLOCKED');assert.ok(missingResult.blockers.includes('ENTRY_SAFETY_POLICY_NOT_CLEARED'));
  assert.equal(missing.broker.submitCalls,0);
  const blocked=setup();const blockedPolicy=buildPaperEntrySafetyPolicyReceipt({decisionAsOf:entrySafetyPolicy.decisionAsOf,
    companyEvent:{...entrySafetyPolicy.companyEvent,action:'BLOCK',state:'COVERAGE_UNKNOWN_BLOCK'},
    corporateAction:entrySafetyPolicy.corporateAction});
  const blockedResult=await blocked.handoff.execute(plan({entrySafetyPolicy:blockedPolicy}),now,true);
  assert.equal(blockedResult.state,'BLOCKED');assert.equal(blocked.broker.submitCalls,0);
});

test('new-risk handoff rejects a tampered AEGIS assessment identity before broker mutation',async()=>{
  const {broker,handoff}=setup();
  const identity=testAegisAssessmentIdentity();
  const result=await handoff.execute(plan({aegisAssessmentIdentity:{...identity,identityHash:'0'.repeat(64)}}),now,true);
  assert.equal(result.state,'BLOCKED');
  assert.ok(result.blockers.includes('AEGIS_ASSESSMENT_LINEAGE_INVALID'));
  assert.equal(broker.submitCalls,0);
});

test('Optionomics research quotes cannot become executable Paper quote authority',async()=>{
  const optionomics={...quote,provider:'OPTIONOMICS',sourceSemantics:'TRUSTED_TWO_SIDED_ORDER_PRICING'} as const;
  const {broker,handoff}=setup(optionomics);const result=await handoff.execute(plan(),now,true);
  assert.equal(result.state,'QUOTE_REJECTED');
  assert.ok(result.blockers.includes('EXECUTION_QUOTE_PROVIDER_NOT_APPROVED'));
  assert.equal(broker.submitCalls,0);
});

test('read-only preparation proves the exact pre-submit boundary without a broker or coordinator',async()=>{
  const result=await prepareMasterPaperAction(plan({executionTier:'PAPER_EVIDENCE',expectedAfterCostEv:null,
    empiricalEconomicsReady:false}),new QuoteSource(quote),now,true);
  assert.equal(result.state,'READY_TO_SUBMIT');
  assert.equal(result.blockers.length,0);
  assert.equal(result.command?.request.symbol,plan().symbol);
  assert.equal(result.command?.request.limit_price,'1.30');
  assert.equal(result.quote?.sourceSemantics,'CONSOLIDATED_NBBO');
  assert.equal(result.quoteAgeMs,0);
});

test('Paper evidence tier reaches coordinator while empirical EV stays explicitly UNKNOWN',async()=>{
  const {broker,handoff}=setup();
  const result=await handoff.execute(plan({executionTier:'PAPER_EVIDENCE',expectedAfterCostEv:null,
    empiricalEconomicsReady:false}),now,true);
  assert.equal(result.state,'EXECUTED');assert.equal(broker.submitCalls,1);
  assert.equal(result.execution?.brokerOrder?.status,'accepted');
});

test('bootstrap management can open a fully covered call in bounded Paper evidence without claiming empirical EV',async()=>{
  const callQuote={...quote,contractId:'AAPL261016C00200000',providerContractId:'AAPL261016C00200000'};
  const {broker,handoff}=setup(callQuote);
  const result=await handoff.execute(plan({decisionAuthority:'MANAGEMENT',
    managementInputSnapshotId:'88888888-8888-4888-8888-888888888888',
    managementActionFrontierId:'99999999-9999-4999-8999-999999999999',
    strategyVersion:'theta-recovery-v1',action:'OPEN_CC',optionType:'CALL',symbol:'AAPL261016C00200000',
    confirmedCoveredShares:100,executionTier:'PAPER_EVIDENCE',expectedAfterCostEv:null,empiricalEconomicsReady:false}),now,true);
  assert.equal(result.state,'EXECUTED');
  assert.equal(result.execution?.submittedNow,true);
  assert.equal(broker.submitCalls,1);
});

test('Paper evidence cap can only reduce canonical quantity and quantity zero never submits',async()=>{
  assert.deepEqual(applyPaperEvidenceRiskCap(3,1),{canonicalQuantity:3,paperEvidenceQuantity:1,paperEvidenceRiskCap:1,
    paperEvidenceCapReason:'PAPER_EVIDENCE_RISK_CAP'});
  assert.deepEqual(applyPaperEvidenceRiskCap(0,4),{canonicalQuantity:0,paperEvidenceQuantity:0,paperEvidenceRiskCap:4,
    paperEvidenceCapReason:'QUANTITY_ZERO'});
  const {broker,handoff}=setup();
  const result=await handoff.execute(plan({executionTier:'PAPER_EVIDENCE',quantity:0,canonicalQuantity:0,
    paperEvidenceQuantity:0,paperEvidenceRiskCap:1,paperEvidenceCapReason:'QUANTITY_ZERO',
    expectedAfterCostEv:null,empiricalEconomicsReady:false}),now,true);
  assert.equal(result.state,'BLOCKED');assert.ok(result.blockers.includes('QUANTITY_ZERO'));assert.equal(broker.submitCalls,0);
});

test('live tiers and stale or wrong contract evidence never reach broker submission',async()=>{
  for(const executionTier of ['LIVE_ELIGIBLE','LIVE_AUTHORIZED'] as const){
    const candidate=setup();const result=await candidate.handoff.execute(plan({executionTier}),now,true);
    assert.equal(result.state,'BLOCKED');assert.ok(result.blockers.includes('LIVE_EXECUTION_NOT_AUTHORIZED'));
    assert.equal(candidate.broker.submitCalls,0);
  }
  const stale=setup({...quote,providerTimestamp:'2026-09-14T13:58:00.000Z'});
  assert.equal((await stale.handoff.execute(plan({executionTier:'PAPER_EVIDENCE'}),now,true)).state,'QUOTE_REJECTED');
  assert.equal(stale.broker.submitCalls,0);
  const wrong=setup({...quote,contractId:'MSFT261016P00300000',providerContractId:'MSFT261016P00300000'});
  assert.equal((await wrong.handoff.execute(plan({executionTier:'PAPER_EVIDENCE'}),now,true)).state,'QUOTE_REJECTED');
  assert.equal(wrong.broker.submitCalls,0);
});

test('a risk-reducing stock exit reaches the coordinator through a qualified Alpaca IEX quote',async()=>{
  const stockQuote={...quote,contractId:'AAPL',providerContractId:'AAPL',sourceSemantics:'TRUSTED_TWO_SIDED_ORDER_PRICING',
    provenance:{...quote.provenance,feed:'iex'}} as const;
  const {broker,handoff}=setup(stockQuote);const result=await handoff.execute(plan({decisionAuthority:'MANAGEMENT',
    managementInputSnapshotId:'88888888-8888-4888-8888-888888888888',
    managementActionFrontierId:'99999999-9999-4999-8999-999999999999',action:'SELL_STOCK',symbol:'AAPL',
    optionContractId:null,optionType:null,multiplier:1,expectedAfterCostEv:null,empiricalEconomicsReady:false,aegisState:'HOLD_ONLY'}),now,true);
  assert.equal(result.state,'EXECUTED');assert.equal(broker.submitCalls,1);
});

test('an unresolved or merely persisted intent waits for reconciliation instead of marking the action submitted',()=>{
  const base={orderIntentId:'intent-1',brokerOrder:null,submittedNow:false} as const;
  assert.equal(classifyMasterPaperActionExecution({...base,state:'BLOCKED_UNRESOLVED_ORDER'}),'WAIT_RECONCILIATION');
  assert.equal(classifyMasterPaperActionExecution({...base,state:'PERSISTED'}),'WAIT_RECONCILIATION');
  assert.equal(classifyMasterPaperActionExecution({...base,state:'WORKING'}),'SUBMITTED');
  assert.equal(classifyMasterPaperActionExecution({...base,state:'TERMINAL'}),'TERMINAL');
});

test('new-risk authority is always a single independent leg',()=>{
  assert.throws(()=>masterPaperActionPlanSchema.parse(plan({legSequence:2,
    dependsOnActionPlanId:'99999999-9999-4999-8999-999999999999'})),/NEW_RISK_PLAN_MUST_BE_SINGLE_LEG/);
  assert.throws(()=>masterPaperActionPlanSchema.parse(plan({actionGroupId:'99999999-9999-4999-8999-999999999999'})),
    /NEW_RISK_PLAN_MUST_BE_SINGLE_LEG/);
});
