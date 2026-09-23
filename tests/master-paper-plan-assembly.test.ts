import assert from 'node:assert/strict';
import test from 'node:test';
import type { CanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { assembleMasterPaperEvidencePlan, type MasterPaperPlanAssemblyInput } from '../src/execution/master-paper-plan-assembly.js';

const decisionId='10000000-0000-4000-8000-000000000001';
const executionAccountId='10000000-0000-4000-8000-000000000002';
const persistedCandidateId='10000000-0000-4000-8000-000000000003';
const optionContractId='10000000-0000-4000-8000-000000000004';
const underlyingId='10000000-0000-4000-8000-000000000005';

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
  entryEventEvidence:{unsupportedCorporateActionPending:false,eventNear:false},
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

test('plan assembly independently blocks unknown and positive event or corporate-action evidence',()=>{
  for(const [entryEventEvidence,code] of [
    [{unsupportedCorporateActionPending:null,eventNear:false},'ENTRY_EVENT_EVIDENCE_CORPORATE_ACTION_COVERAGE_UNKNOWN'],
    [{unsupportedCorporateActionPending:true,eventNear:false},'ENTRY_EVENT_EVIDENCE_UNSUPPORTED_CORPORATE_ACTION'],
    [{unsupportedCorporateActionPending:false,eventNear:null},'ENTRY_EVENT_EVIDENCE_EVENT_PROXIMITY_UNKNOWN'],
    [{unsupportedCorporateActionPending:false,eventNear:true},'ENTRY_EVENT_EVIDENCE_EVENT_PROXIMITY'],
  ] as const){
    const result=assembleMasterPaperEvidencePlan(input({entryEventEvidence}));
    assert.equal(result.state,'BLOCKED');
    assert.ok(result.blockers.includes(code));
  }
});

test('a plan cannot use an AEGIS state from a different candidate',()=>{
  const result=assembleMasterPaperEvidencePlan(input({aegisState:'ALLOW_REDUCED'}));
  assert.equal(result.state,'BLOCKED');
  assert.ok(result.blockers.includes('AEGIS_SELECTION_LINEAGE_MISMATCH'));
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
