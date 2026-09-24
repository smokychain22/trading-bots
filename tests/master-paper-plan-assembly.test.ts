import assert from 'node:assert/strict';
import test from 'node:test';
import type { CanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { assembleMasterPaperEvidencePlan, type MasterPaperPlanAssemblyInput } from '../src/execution/master-paper-plan-assembly.js';
import { PostgresMasterPaperActionPlanStore } from '../src/execution/postgres-master-paper-action-plan-store.js';
import { buildPaperEntrySafetyPolicyReceipt } from '../src/theta/paper-entry-safety-policy.js';
import { testAegisAssessmentIdentity } from './fixtures/aegis-assessment-identity.js';

const decisionId='10000000-0000-4000-8000-000000000001';
const executionAccountId='10000000-0000-4000-8000-000000000002';
const persistedCandidateId='10000000-0000-4000-8000-000000000003';
const optionContractId='10000000-0000-4000-8000-000000000004';
const underlyingId='10000000-0000-4000-8000-000000000005';
const entrySafetyPolicy=buildPaperEntrySafetyPolicyReceipt({decisionAsOf:'2026-09-14T14:00:01.000Z',
  companyEvent:{policyVersion:'theta-company-event-paper-policy-v1',authority:'PAPER_BOOTSTRAP_NOT_COMPLETE_COMPANY_COVERAGE',
    action:'CLEAR',state:'KNOWN_AFTER_EXPIRY_CLEAR',decisionAsOf:'2026-09-14T14:00:01.000Z',validThrough:'2026-10-31',
    instrument:{policyVersion:'theta-paper-instrument-classification-v1',symbol:'AAPL',state:'OPERATING_COMPANY',
      paperBootstrapApproved:true,authority:'VERSIONED_MANIFEST',evidenceIds:['manifest-aapl'],observedAt:'2026-09-01T00:00:00.000Z',reason:'TEST'},
    earningsDistanceTradingSessions:40,sessionsThroughExpiration:24,macroState:'KNOWN_FALSE',evidenceIds:['event-1'],reason:'TEST'},
  corporateAction:{policyVersion:'theta-corporate-action-paper-policy-v1',authority:'PAPER_BOOTSTRAP_NOT_COMPLETE_NEGATIVE_ASSURANCE',
    action:'CLEAR',state:'PAPER_BOOTSTRAP_LIMITED',decisionAsOf:'2026-09-14T14:00:01.000Z',queryObservedAt:'2026-09-14T14:00:00.000Z',
    queryWindow:{start:'2026-09-14',end:'2026-10-29'},paginationComplete:true,negativeCoverageQualified:false,
    positiveRelevance:'EXPIRED_NOT_RELEVANT',missingPrerequisites:[],evidenceIds:[],reason:'TEST'},
});

const frontier=():CanonicalStrategyFrontier=>({
  contractVersion:'theta-canonical-strategy-frontier-v1',snapshotId:'snapshot',timestamp:'2026-09-14T14:00:00.000Z',
  strategyVersion:'strategy-v1',decisionAuthorityVersion:'theta-canonical-decision-authority-v1',
  branches:[{branch:'THETA_CONVENTIONAL',strategyVersion:'strategy-v1',status:'SHADOW',applicable:true,evaluated:true,
    routeReasons:[],evaluationState:'EVALUATED',candidateCount:1,mechanicallyRejected:0,enumerationTruncated:false,
    hardVetoed:0,softRanked:1,dataInsufficient:1,bestCandidateId:'THETA_CONVENTIONAL:AAPL261016P00150000',
    secondBestCandidateId:null,bestRejectedCandidateId:null,empiricalEconomicsReady:false,executionAuthorized:false,
    candidates:[{candidateId:'THETA_CONVENTIONAL:AAPL261016P00150000',branch:'THETA_CONVENTIONAL',action:'OPEN_CSP',underlying:'AAPL',
      legs:[{positionIntent:'SELL_TO_OPEN',optionSymbol:'AAPL261016P00150000',optionType:'PUT',strike:150,expiration:'2026-10-16',
        multiplier:100,bid:1.25,ask:1.30,quoteTimestamp:'2026-09-14T14:00:00.000Z'}],dte:32,delta:-0.2,moneyness:-0.05,
      spreadPct:0.0392,liquidity:{volume:100,openInterest:1000},economics:{premiumPerShare:1.25,grossPremium:125,
        collateral:15000,maxProfit:125,maxLoss:null,breakEven:148.75,downsideCushion:0.07,retainedUpside:null,
        callAwayProceeds:null,wholeChainPnlAtCallAway:null,capitalDayYield:0.00026,expectedAfterCostEv:null},
      assignmentCapacityQty:3,aegisState:'ALLOW_FULL',hardBlockers:[],softEvidence:[],unknownEvidence:['EMPIRICAL_EV_UNKNOWN'],
      structurallyFeasible:true,riskFeasible:true,sizing:{quantity:3,bindingConstraint:'COLLATERAL_CAP',reasons:[]},
      paretoRank:1,dominatedBy:[],executionAuthorized:false,
      entryEligibility:{basis:'EMPIRICAL_OWNERSHIP',paperBootstrapPolicyVersion:null,
        paperBootstrapAllowedUnknownComponents:[],paperBootstrapReasonCodes:[]}}]}],
  branchesConsidered:['THETA_CONVENTIONAL'],branchesEvaluated:['THETA_CONVENTIONAL'],selectedBranch:'THETA_CONVENTIONAL',
  selectedCandidateId:'THETA_CONVENTIONAL:AAPL261016P00150000',primaryAction:'OPEN_CSP',selectedQuantity:3,
  empiricalUtilityState:'UNKNOWN_NOT_YET_CALIBRATED',secondBestCandidateId:null,nearMissCandidateId:null,bestRejectedCandidateId:null,
  globalWaitEarned:false,globalWaitReasons:[],empiricalEconomicsReady:false,executionAuthorized:false,optionomicsContext:{},contentHash:'a'.repeat(64),
});

const input=(overrides:Partial<MasterPaperPlanAssemblyInput>={}):MasterPaperPlanAssemblyInput=>({
  frontier:frontier(),executionAccountId,decisionId,persistedCandidateId,optionContractId,underlyingId,
  accountStatus:'ACTIVE',optionsApprovedLevel:3,optionsTradingLevel:3,aegisState:'ALLOW_FULL',
  aegisInputOrigin:'DERIVED_FROM_REAL',
  aegisAssessmentIdentity:testAegisAssessmentIdentity({
    fusionSnapshotId:'90000000-0000-4000-8000-000000000001',
    persistedCandidateId,
  }),
  entrySafetyPolicy,
  openPositionSymbols:[],openOrderSymbols:[],paperEvidenceRiskCap:1,modeledRoundTripCostPerContract:1.70,
  now:'2026-09-14T14:00:01.000Z',decisionExpiresAt:'2026-09-14T14:00:46.000Z',...overrides,
});

test('assembles one reducing-only Paper evidence CSP plan without inventing empirical EV',()=>{
  const result=assembleMasterPaperEvidencePlan(input());
  assert.equal(result.state,'READY');
  if(result.state!=='READY')return;
  assert.equal(result.plan.quantity,1);
  assert.equal(result.plan.canonicalQuantity,3);
  assert.equal(result.plan.paperEvidenceCapReason,'PAPER_EVIDENCE_RISK_CAP');
  assert.equal(result.plan.executionTier,'PAPER_EVIDENCE');
  assert.equal(result.plan.empiricalEconomicsReady,false);
  assert.equal(result.plan.expectedAfterCostEv,null);
  assert.equal(result.plan.economicBoundary,0.03);
  assert.equal(result.plan.multiplier,100);
});

test('global WAIT creates no action plan',()=>{
  const wait={...frontier(),primaryAction:'GLOBAL_WAIT' as const,selectedCandidateId:null,selectedBranch:null,selectedQuantity:0,
    globalWaitEarned:true};
  const result=assembleMasterPaperEvidencePlan(input({frontier:wait}));
  assert.equal(result.state,'NO_ACTION');
});

test('missing risk, costs, persistence, or conflict blocks plan assembly',()=>{
  for(const overrides of [
    {aegisState:null},{modeledRoundTripCostPerContract:null},{persistedCandidateId:null},
    {openOrderSymbols:['AAPL261016P00150000']},{accountStatus:'RESTRICTED'},
  ] satisfies Array<Partial<MasterPaperPlanAssemblyInput>>){
    const result=assembleMasterPaperEvidencePlan(input(overrides));
    assert.equal(result.state,'BLOCKED');
    assert.equal(result.plan,null);
  }
});

test('plan assembly independently blocks company-event and corporate-action policy failures',()=>{
  for(const [entrySafetyPolicyOverride,code] of [
    [buildPaperEntrySafetyPolicyReceipt({decisionAsOf:entrySafetyPolicy.decisionAsOf,
      companyEvent:{...entrySafetyPolicy.companyEvent,action:'BLOCK' as const,state:'COVERAGE_UNKNOWN_BLOCK' as const},
      corporateAction:entrySafetyPolicy.corporateAction}),'COMPANY_EVENT_POLICY_COVERAGE_UNKNOWN_BLOCK'],
    [buildPaperEntrySafetyPolicyReceipt({decisionAsOf:entrySafetyPolicy.decisionAsOf,
      companyEvent:entrySafetyPolicy.companyEvent,
      corporateAction:{...entrySafetyPolicy.corporateAction,action:'BLOCK' as const,state:'KNOWN_RELEVANT_ACTION_BLOCK' as const}}),'CORPORATE_ACTION_POLICY_KNOWN_RELEVANT_ACTION_BLOCK'],
  ] as const){
    const result=assembleMasterPaperEvidencePlan(input({entrySafetyPolicy:entrySafetyPolicyOverride}));
    assert.equal(result.state,'BLOCKED');
    assert.ok(result.blockers.includes(code));
  }
});

test('a plan cannot use an AEGIS state from a different candidate',()=>{
  const result=assembleMasterPaperEvidencePlan(input({aegisState:'ALLOW_REDUCED'}));
  assert.equal(result.state,'BLOCKED');
  assert.ok(result.blockers.includes('AEGIS_SELECTION_LINEAGE_MISMATCH'));
});

test('plan assembly rejects AEGIS evidence whose immutable identity was changed',()=>{
  const identity=testAegisAssessmentIdentity({persistedCandidateId});
  const result=assembleMasterPaperEvidencePlan(input({
    aegisAssessmentIdentity:{...identity,assessmentHash:'0'.repeat(64)},
  }));
  assert.equal(result.state,'BLOCKED');
  assert.ok(result.blockers.includes('AEGIS_ASSESSMENT_LINEAGE_INVALID'));
});

test('a manual or missing AEGIS input origin cannot assemble a new-risk Paper plan',()=>{
  for(const aegisInputOrigin of ['CALLER_MANUAL','SYNTHETIC_FIXTURE',null] as const){
    const result=assembleMasterPaperEvidencePlan(input({aegisInputOrigin}));
    assert.equal(result.state,'BLOCKED');
    assert.ok(result.blockers.includes('AEGIS_REAL_INPUT_LINEAGE_MISSING'));
  }
});

test('the new-risk persistence boundary rejects a decision without real AEGIS input lineage',async()=>{
  const result=assembleMasterPaperEvidencePlan(input());
  assert.equal(result.state,'READY');
  if(result.state!=='READY')return;
  const queries:string[]=[];
  const client={query:async(sql:string)=>{
    queries.push(sql);
    if(sql.includes('FROM trade.decision d'))return {rows:[{
      decision_id:decisionId,decision_kind:'NEW_RISK',candidate_id:persistedCandidateId,
      quantity:3,aegis_action:'ALLOW_FULL',aegis_input_origin:null,
      account_kind:'MASTER_API_KEY',account_ready:true,
    }]};
    return {rows:[],rowCount:0};
  },release:()=>undefined,on:()=>undefined,removeListener:()=>undefined};
  const store=new PostgresMasterPaperActionPlanStore({connect:async()=>client} as never);
  await assert.rejects(store.enqueue(result.plan,input().now),/ACTION_PLAN_AEGIS_REAL_INPUT_LINEAGE_MISSING/);
  assert.deepEqual(queries[0],'BEGIN');
  assert.equal(queries.at(-1),'ROLLBACK');
  assert.equal(queries.some((sql)=>sql.includes('INSERT INTO trade.master_paper_action_plan')),false);
});

test('plan assembly rejects missing, ineligible, or malformed bootstrap entry lineage',()=>{
  const baseFrontier=frontier();
  const branch=baseFrontier.branches[0];
  const candidate=branch?.candidates[0];
  assert.ok(branch&&candidate);
  const withEligibility=(entryEligibility:typeof candidate.entryEligibility)=>({
    ...baseFrontier,branches:[{...branch,candidates:[{...candidate,entryEligibility}]}],
  });
  for(const [entryEligibility,expected] of [
    [undefined,'ENTRY_ELIGIBILITY_LINEAGE_MISSING'],
    [{basis:'INELIGIBLE' as const,paperBootstrapPolicyVersion:null,paperBootstrapAllowedUnknownComponents:[],paperBootstrapReasonCodes:[]},'ENTRY_ELIGIBILITY_FAILED'],
    [{basis:'PAPER_ENTRY_BOOTSTRAP_UNCALIBRATED' as const,paperBootstrapPolicyVersion:'theta-paper-entry-bootstrap-v1',paperBootstrapAllowedUnknownComponents:['RecoveryQuality'],paperBootstrapReasonCodes:['RECOVERY_HISTORY_UNKNOWN']},'PAPER_BOOTSTRAP_ELIGIBILITY_LINEAGE_INVALID'],
  ] as const){
    const result=assembleMasterPaperEvidencePlan(input({frontier:withEligibility(entryEligibility)}));
    assert.equal(result.state,'BLOCKED');
    assert.ok(result.blockers.includes(expected));
  }
});

test('plan assembly accepts exact v3 Paper-bootstrap lineage without claiming empirical EV',()=>{
  const baseFrontier=frontier();
  const branch=baseFrontier.branches[0];
  const candidate=branch?.candidates[0];
  assert.ok(branch&&candidate);
  const bootstrapFrontier={...baseFrontier,branches:[{...branch,candidates:[{...candidate,entryEligibility:{
    basis:'PAPER_ENTRY_BOOTSTRAP_UNCALIBRATED' as const,
    paperBootstrapPolicyVersion:'theta-paper-entry-bootstrap-v3',
    paperBootstrapAllowedUnknownComponents:['EventAdjustment','RecoveryQuality'],
    paperBootstrapReasonCodes:['EVENT_DISTANCE_UNKNOWN','RECOVERY_HISTORY_UNKNOWN','SEVERE_DRAWDOWN_MODEL_NOT_PROMOTED'],
  }}]}]};
  const result=assembleMasterPaperEvidencePlan(input({frontier:bootstrapFrontier}));
  assert.equal(result.state,'READY');
  if(result.state==='READY'){
    assert.equal(result.plan.expectedAfterCostEv,null);
    assert.equal(result.plan.empiricalEconomicsReady,false);
  }
});

test('contract multiplier is used when converting modeled cost to per-share boundary',()=>{
  const changed=frontier();
  const branch=changed.branches[0];
  const candidate=branch?.candidates[0];
  const candidateLeg=candidate?.legs[0];
  assert.ok(branch&&candidate&&candidateLeg);
  const custom={...changed,branches:[{...branch,candidates:[{...candidate,
    legs:[{...candidateLeg,multiplier:50}],economics:{...candidate.economics,premiumPerShare:0.04}}]}]};
  const result=assembleMasterPaperEvidencePlan(input({frontier:custom,modeledRoundTripCostPerContract:1.70}));
  assert.equal(result.state,'BLOCKED');
  assert.ok(result.blockers.includes('FORWARD_STRUCTURAL_ECONOMICS_NOT_POSITIVE'));
});
