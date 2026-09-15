import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRuntimeManagementFrontiers } from '../src/theta/autonomous-runtime.js';
import {
  managementPolicyEvidenceVersion,
  type ManagementPolicyEvidence,
} from '../src/theta/management-action-frontier.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';

const observedAt='2026-09-15T14:00:00.000Z';
const state=()=>assembleManagementInput({
  chain_id:'chain',lifecycle_state:'CSP_OPEN',underlying_id:'underlying',underlying:'AAPL',
  option_leg_id:'leg',option_contract_id:'contract',quantity:'1',entry_credit_debit:'200',
  contract_symbol:'AAPL261016P00200000',option_type:'PUT',strike:'200',expiration_date:'2026-10-16',
  multiplier:'100',bid:'1',ask:'1.1',quote_as_of:observedAt,feed:'OPRA',quote_quality:'GOOD',
  realized_option_pnl:'0',open_stock_shares:'0',stock_basis_per_share:null,realized_stock_pnl:'0',
  dividends:'0',fees:'0',buying_power:'50000',options_buying_power:'40000',account_as_of:observedAt,
  fusion_snapshot_id:'fusion',snapshot_json:{underlyingState:{last:205},marketSession:{isOpen:true},
    riskState:{assignmentCapacity:1,newRiskState:'ALLOW_FULL'},eventState:{state:'CLEAR'}},broker_position:null,
},{managementInputSnapshotId:'input',reconciliationSnapshotId:'recon',observedAt});

const closeEvidence=(input:ReturnType<typeof state>):ManagementPolicyEvidence=>{
  const actionValues=[
    {action:'HOLD' as const,expectedFutureValue:5,downsideTailEstimate:2,incrementalCapitalDays:1,
      executionCostRisk:0,opportunityCost:1,uncertainty:1,utility:1,executionEvidence:null,reasons:['HOLD_VALUED']},
    {action:'CLOSE_FULL' as const,expectedFutureValue:10,downsideTailEstimate:0,incrementalCapitalDays:0,
      executionCostRisk:1,opportunityCost:0,uncertainty:0,utility:9,executionEvidence:{closeEconomicBoundary:1.2,
        openEconomicBoundary:null,stockEconomicBoundary:null,economicsRemainPositive:true,expectedAfterCostEv:null,
        empiricalEconomicsReady:false,targetContract:null},reasons:['CLOSE_DOMINATES_HOLD']},
  ];
  return {contractVersion:managementPolicyEvidenceVersion,inputContentHash:input.contentHash,
    decidedAt:input.observedAt,policyVersion:'validated-management-test-v1',comparisonComplete:true,
    selectedAction:'CLOSE_FULL',actionValues,reasonCodes:['SAME_SNAPSHOT_ACTION_COMPARISON']};
};

test('runtime accepts a same-snapshot management provider and selects its validated close',async()=>{
  const input=state();
  const calls:string[]=[];
  const frontiers=await buildRuntimeManagementFrontiers([input],{evaluate:async(current)=>{
    calls.push(current.contentHash);
    return closeEvidence(current);
  }});
  assert.deepEqual(calls,[input.contentHash]);
  assert.equal(frontiers[0]?.selectedAction,'CLOSE_FULL');
  assert.equal(frontiers[0]?.policyVersion,'validated-management-test-v1');
});

test('runtime stays passive when no empirical policy provider is configured',async()=>{
  const frontiers=await buildRuntimeManagementFrontiers([state()]);
  assert.equal(frontiers[0]?.selectedAction,'HOLD');
  assert.equal(frontiers[0]?.decisionState,'SYSTEM_HOLD_MISSING_EVIDENCE');
});

test('runtime rejects stale provider evidence and returns to passive management',async()=>{
  const input=state();
  const frontiers=await buildRuntimeManagementFrontiers([input],{evaluate:async(current)=>({
    ...closeEvidence(current),inputContentHash:'0'.repeat(64),
  })});
  assert.equal(frontiers[0]?.selectedAction,'HOLD');
  assert.ok(frontiers[0]?.reasonCodes.includes('MANAGEMENT_POLICY_INPUT_HASH_MISMATCH'));
});
