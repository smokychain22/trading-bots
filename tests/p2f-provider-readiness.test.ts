import assert from 'node:assert/strict';
import test from 'node:test';
import {qualifyOptionomicsProvider,optionomicsFamilyContracts} from '../src/providers/optionomics-qualification.js';
import {aggregateCompatibleExecutionQuotes,executionOptionQuoteContractVersion,type ExecutionOptionQuote} from '../src/execution/execution-option-quote.js';
import {buildR8Readiness} from '../src/theta/r8-readiness.js';
import {assembleDecisionExplanation} from '../src/theta/decision-explainability.js';
import {classifyPathCheckpoint,type PositionPathCheckpoint} from '../src/theta/position-path-state.js';
import {mergeAlert} from '../src/ops/theta-alerts.js';
import {qualifyQuoteProvider} from '../src/execution/quote-provider-qualification.js';

test('synthetic Optionomics qualification cannot manufacture provider health',async()=>{
  const receipt=await qualifyOptionomicsProvider({mode:'SYNTHETIC',at:'2026-09-15T15:00:00Z',symbol:'SPY',config:null});
  assert.equal(receipt.secretState,'NOT_CONFIGURED');assert.equal(receipt.executionAuthorized,false);
  assert.equal(receipt.families.length,optionomicsFamilyContracts.length);
  assert.ok(receipt.families.every((family)=>family.state==='BLOCKED'&&family.executionQuoteQualified===false));
});
test('authenticated Optionomics evidence stays family-scoped and non-executable',async()=>{
  const fetchImpl=(async()=>new Response(JSON.stringify([{symbol:'SPY261016P00500000',underlying:'SPY',expiration:'2026-10-16',option_type:'PUT',strike:500,as_of:'2026-09-15T15:00:00Z'}]),{status:200,headers:{'content-type':'application/json'}})) as typeof fetch;
  const receipt=await qualifyOptionomicsProvider({mode:'REAL_AUTHENTICATED',at:'2026-09-15T15:00:01Z',symbol:'SPY',
    config:{apiBase:'https://optionomics.ai',email:'synthetic@example.com',apiToken:'SYNTHETIC-NOT-SECRET',fetchImpl,now:()=> '2026-09-15T15:00:01Z'}});
  assert.equal(receipt.secretState,'AUTH_VALID');assert.equal(receipt.realPayloadCount,1);
  assert.equal(receipt.families.find((family)=>family.family==='CHAIN')?.executionQuoteQualified,false);
});

const quote=(provider:string,bid:number,ask:number,semantics:ExecutionOptionQuote['sourceSemantics']='TRUSTED_TWO_SIDED_ORDER_PRICING'):ExecutionOptionQuote=>({
  contractVersion:executionOptionQuoteContractVersion,contractId:'AAPL261016P00200000',providerContractId:'AAPL261016P00200000',
  bid,ask,bidSize:10,askSize:10,providerTimestamp:'2026-09-15T14:30:09Z',receivedAtUtc:'2026-09-15T14:30:09Z',
  receivedAtMonotonic:1,sequence:1,provider,sourceSemantics:semantics,connectionState:'CONNECTED',subscriptionState:'ACTIVE',
  provenance:{authenticated:true,exactContractMapping:true,documentedForOrderPricing:true}});
test('same-contract trusted sources aggregate without claiming NBBO',()=>{
  const result=aggregateCompatibleExecutionQuotes([quote('A',2.1,2.3),quote('B',2.2,2.25)],{expectedContractId:'AAPL261016P00200000',
    nowUtc:'2026-09-15T14:30:10Z',maximumAgeMs:2000,marketOpen:true});
  assert.deepEqual(result,{contractId:'AAPL261016P00200000',bid:2.2,ask:2.25,bidProvider:'B',askProvider:'B',sourceCount:2,semantics:'TRUSTED_TWO_SIDED_ORDER_PRICING'});
});
test('indicative evidence is excluded rather than aggregated with a trusted source',()=>{
  const result=aggregateCompatibleExecutionQuotes([quote('A',2.1,2.3),quote('B',2.2,2.25,'INDICATIVE')],{
    expectedContractId:'AAPL261016P00200000',nowUtc:'2026-09-15T14:30:10Z',maximumAgeMs:2000,marketOpen:true});
  assert.equal(result?.sourceCount,1);assert.equal(result?.bidProvider,'A');assert.equal(result?.askProvider,'A');
});
test('quote qualification receipt blocks session-recorded research',()=>{
  const receipt=qualifyQuoteProvider({quote:quote('OPTIONOMICS',2.1,2.3,'SESSION_RECORDED_RESEARCH'),expectedContractId:'AAPL261016P00200000',
    attemptedAt:'2026-09-15T14:30:10Z',maximumAgeMs:2000,marketOpen:true});
  assert.equal(receipt.qualified,false);assert.equal(receipt.executionAuthorized,false);
  assert.ok(receipt.blockers.includes('ORDER_PRICING_SEMANTICS_NOT_PROVEN'));
});
test('R8 readiness cannot be forced through an unqualified quote source',()=>{
  const receipt=buildR8Readiness({r7EngineeringComplete:true,brokerTruthReady:true,sessionStateReady:true,positionLifecycleReady:true,
    strategyRouterReady:true,actionFrontierReady:true,operatorSafetyReady:true,optionomicsTransportReady:true,optionomicsRealAuthReady:false,
    executionQuoteProviderReady:false,operationalFirstPaperReady:true,empiricalPolicyReady:false,managementPolicyPromoted:false,
    labelPipelineReady:true,wholeChainAccountingReady:true,trainingReady:false});
  assert.equal(receipt.paperActivationGate,'BLOCKED');assert.equal(receipt.executionAuthorized,false);
  assert.equal(receipt.empiricalValidationGate,'BLOCKED');
  assert.equal(receipt.managementPolicyPromotion,'NOT_PROMOTED_UNAVAILABLE');
});
test('explanations distinguish WAIT and preserve missing evidence',()=>{
  const x=assembleDecisionExplanation({action:'WAIT',feasibleAlternatives:[],infeasibleAlternatives:[{action:'OPEN_CSP',reason:'QUOTE_MISSING'}],
    reasonCodes:['QUOTE_MISSING'],requiredMissingFields:['bid','ask'],optionalMissingFields:['flow'],sessionState:'OPEN',timeState:'STANDARD',
    positionPath:null,strategyApplicability:'APPLICABLE',providerEvidence:'DEGRADED',riskOfAction:'UNKNOWN',riskOfInaction:'OPPORTUNITY_COST_UNKNOWN',
    quoteAuthorityStatus:'BLOCKED',policyStatus:'NOT_PROMOTED'});
  assert.equal(x.classification,'WHY_WAIT');assert.deepEqual(x.requiredMissingFields,['ask','bid']);
});
test('alert dedup increments occurrence count without changing first seen',()=>{
  const a=mergeAlert(null,{identity:'worker:offline',type:'WORKER_OFFLINE',severity:'CRITICAL',source:'worker',lastSeenAt:'2026-09-15T10:00:00Z',state:'ACTIVE',relatedRef:null,evidence:{}});
  const b=mergeAlert(a,{identity:'worker:offline',type:'WORKER_OFFLINE',severity:'CRITICAL',source:'worker',lastSeenAt:'2026-09-15T10:01:00Z',state:'ACTIVE',relatedRef:null,evidence:{}});
  const resolved=mergeAlert(b,{identity:'worker:offline',type:'WORKER_OFFLINE',severity:'INFO',source:'worker',lastSeenAt:'2026-09-15T10:02:00Z',state:'RESOLVED',relatedRef:null,evidence:{}});
  const reopened=mergeAlert(resolved,{identity:'worker:offline',type:'WORKER_OFFLINE',severity:'CRITICAL',source:'worker',lastSeenAt:'2026-09-15T10:03:00Z',state:'ACTIVE',relatedRef:null,evidence:{}});
  assert.equal(b.occurrenceCount,2);assert.equal(b.firstSeenAt,a.firstSeenAt);
  assert.equal(a.lifecycleTransition,'OPENED');assert.equal(b.lifecycleTransition,'REPEATED');
  assert.equal(resolved.lifecycleTransition,'RESOLVED');assert.equal(reopened.lifecycleTransition,'REOPENED');
});

const checkpoint=(classification:PositionPathCheckpoint['classification'],pnl:number):PositionPathCheckpoint=>({version:'theta-position-path-v1',checkpointIdentity:'x',chainId:'c',managementInputSnapshotId:'m',observedAt:'2026-09-15T10:00:00Z',classification,
  currentWholeChainPnl:pnl,currentOptionPnl:pnl,peakWholeChainPnl:pnl,troughWholeChainPnl:pnl,profitGiveback:0,drawdownFromPeak:0,pnlVelocityPerHour:null,spotVelocityPerHour:null,
  greekVelocityPerHour:{delta:null,gamma:null,theta:null,vega:null},dte:30,capitalDaysObserved:null,markQuality:null,
  evidence:{spot:null,strike:null,breakeven:null,optionBid:null,optionAsk:null,quoteTimestamp:null,delta:null,gamma:null,theta:null,vega:null,iv:null,eventState:null,recoveryState:null,regimeState:null},unknownFields:[],executionAuthorized:false});
test('path evidence distinguishes semantic transitions from raw cycles',()=>{
  const prior=checkpoint('MATURE_WINNER',10),same=checkpoint('MATURE_WINNER',10),changed=checkpoint('WINNER_GIVEBACK',8);
  assert.equal(classifyPathCheckpoint(same,prior).evidenceKind,'RAW_CYCLE_SNAPSHOT');
  assert.equal(classifyPathCheckpoint(changed,prior).checkpointReason,'PATH_CLASSIFICATION_CHANGED');
});
