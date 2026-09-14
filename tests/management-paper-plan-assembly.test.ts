import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleManagementPaperPlans, type ManagementPaperPlanAssemblyInput } from '../src/execution/management-paper-plan-assembly.js';
import { PostgresMasterPaperActionPlanStore } from '../src/execution/postgres-master-paper-action-plan-store.js';
import { buildManagementActionFrontier, type ManagementActionFrontier, type ManagementFrontierAction } from '../src/theta/management-action-frontier.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';

const ids={input:'10000000-0000-4000-8000-000000000001',reconciliation:'10000000-0000-4000-8000-000000000002',
  fusion:'10000000-0000-4000-8000-000000000003',chain:'10000000-0000-4000-8000-000000000004',
  underlying:'10000000-0000-4000-8000-000000000005',contract:'10000000-0000-4000-8000-000000000006',
  leg:'10000000-0000-4000-8000-000000000007',frontier:'10000000-0000-4000-8000-000000000008',
  account:'10000000-0000-4000-8000-000000000009',target:'10000000-0000-4000-8000-000000000010'};
const now='2026-09-15T14:00:00.000Z';

const state=()=>assembleManagementInput({chain_id:ids.chain,lifecycle_state:'CSP_OPEN',underlying_id:ids.underlying,
  underlying:'AAPL',option_leg_id:ids.leg,option_contract_id:ids.contract,quantity:'2',entry_credit_debit:'400',
  contract_symbol:'AAPL261016P00200000',option_type:'PUT',strike:'200',expiration_date:'2026-10-16',multiplier:'100',
  bid:'1',ask:'1.1',quote_as_of:now,feed:'OPRA',quote_quality:'GOOD',realized_option_pnl:'0',open_stock_shares:'0',
  stock_basis_per_share:null,realized_stock_pnl:'0',dividends:'0',fees:'0',unknown_fill_fees:false,buying_power:'50000',
  options_buying_power:'40000',account_as_of:now,fusion_snapshot_id:ids.fusion,snapshot_json:{eventState:{state:'CLEAR'},
    riskState:{assignmentCapacity:2,newRiskState:'ALLOW_FULL'},portfolioExposure:{concentration:0.1,sectorCorrelation:0.1},
    expertPriorState:{state:'GOOD'},versions:{strategyVersion:'theta-conventional-v1'}},broker_position:null},
{managementInputSnapshotId:ids.input,reconciliationSnapshotId:ids.reconciliation,observedAt:now});

const selectedFrontier=(action:ManagementFrontierAction):ManagementActionFrontier=>{
  const base=buildManagementActionFrontier(state());
  return {...base,selectedAction:action,decisionState:'ACTION_SELECTED',reasonCodes:[`SELECT_${action}`],
    actions:base.actions.map((candidate)=>candidate.action===action?{...candidate,feasibility:'FEASIBLE',blockers:[]}:candidate)};
};

const input=(action:ManagementFrontierAction,overrides:Partial<ManagementPaperPlanAssemblyInput>={}):ManagementPaperPlanAssemblyInput=>({
  state:state(),frontier:selectedFrontier(action),managementActionFrontierId:ids.frontier,executionAccountId:ids.account,
  strategyVersion:'theta-conventional-v1',accountStatus:'ACTIVE',optionsCapabilityVerified:true,aegisState:'ALLOW_FULL',
  killSwitchActive:false,paperEvidenceRiskCap:1,executionLegs:[],now,decisionExpiresAt:'2026-09-15T14:00:45.000Z',...overrides,
});

test('passive management remains a recorded no-order action',()=>{
  const frontier=buildManagementActionFrontier(state());
  const result=assembleManagementPaperPlans(input('HOLD',{frontier}));
  assert.equal(result.state,'NO_BROKER_ACTION');
  assert.deepEqual(result.plans,[]);
});

test('selected CSP close becomes one authority-linked risk-reducing plan without quantity clipping',()=>{
  const result=assembleManagementPaperPlans(input('CLOSE_FULL',{executionLegs:[{action:'CLOSE_CSP',
    symbol:'AAPL261016P00200000',optionContractId:ids.contract,optionType:'PUT',multiplier:100,canonicalQuantity:2,
    economicBoundary:1.25,economicsRemainPositive:true,expectedAfterCostEv:null,empiricalEconomicsReady:false}]}));
  assert.equal(result.state,'READY');
  if(result.state!=='READY')return;
  assert.equal(result.decision.actionCode,'CLOSE_FULL');
  assert.equal(result.plans.length,1);
  assert.equal(result.plans[0]?.decisionAuthority,'MANAGEMENT');
  assert.equal(result.plans[0]?.action,'CLOSE_CSP');
  assert.equal(result.plans[0]?.quantity,2);
  assert.equal(result.plans[0]?.executionTier,'PAPER_EVIDENCE');
});

test('roll is an ordered close-old and open-new group whose new risk may only shrink',()=>{
  const result=assembleManagementPaperPlans(input('ROLL',{executionLegs:[
    {action:'ROLL_CSP_CLOSE',symbol:'AAPL261016P00200000',optionContractId:ids.contract,optionType:'PUT',multiplier:100,
      canonicalQuantity:2,economicBoundary:1.25,economicsRemainPositive:true,expectedAfterCostEv:null,empiricalEconomicsReady:false},
    {action:'ROLL_CSP_OPEN',symbol:'AAPL261120P00195000',optionContractId:ids.target,optionType:'PUT',multiplier:100,
      canonicalQuantity:2,economicBoundary:1.5,economicsRemainPositive:true,expectedAfterCostEv:25,empiricalEconomicsReady:true},
  ]}));
  assert.equal(result.state,'READY');
  if(result.state!=='READY')return;
  assert.equal(result.plans.length,2);
  assert.equal(result.plans[0]?.action,'ROLL_CSP_CLOSE');
  assert.equal(result.plans[1]?.action,'ROLL_CSP_OPEN');
  assert.equal(result.plans[1]?.dependsOnActionPlanId,result.plans[0]?.actionPlanId);
  assert.equal(result.plans[1]?.quantity,1);
  assert.equal(result.plans[1]?.executionTier,'EMPIRICALLY_PROMOTED_PAPER');
});

test('missing roll target economics and mismatched close identity fail closed',()=>{
  const badRoll=assembleManagementPaperPlans(input('ROLL',{executionLegs:[]}));
  assert.equal(badRoll.state,'BLOCKED');
  assert.ok(badRoll.blockers.includes('MANAGEMENT_EXECUTION_LEG_SEQUENCE_INVALID'));
  const badClose=assembleManagementPaperPlans(input('CLOSE_FULL',{executionLegs:[{action:'CLOSE_CSP',symbol:'MSFT',
    optionContractId:ids.target,optionType:'PUT',multiplier:100,canonicalQuantity:2,economicBoundary:1.25,
    economicsRemainPositive:true,expectedAfterCostEv:null,empiricalEconomicsReady:false}]}));
  assert.equal(badClose.state,'BLOCKED');
  assert.ok(badClose.blockers.includes('CLOSE_LEG_CONTRACT_MISMATCH:CLOSE_CSP'));
});

test('atomic management publisher rejects tampered leg order before touching PostgreSQL',async()=>{
  const assembled=assembleManagementPaperPlans(input('ROLL',{executionLegs:[
    {action:'ROLL_CSP_CLOSE',symbol:'AAPL261016P00200000',optionContractId:ids.contract,optionType:'PUT',multiplier:100,
      canonicalQuantity:2,economicBoundary:1.25,economicsRemainPositive:true,expectedAfterCostEv:null,empiricalEconomicsReady:false},
    {action:'ROLL_CSP_OPEN',symbol:'AAPL261120P00195000',optionContractId:ids.target,optionType:'PUT',multiplier:100,
      canonicalQuantity:2,economicBoundary:1.5,economicsRemainPositive:true,expectedAfterCostEv:25,empiricalEconomicsReady:true},
  ]}));
  assert.equal(assembled.state,'READY');
  if(assembled.state!=='READY')return;
  let connected=false;
  const store=new PostgresMasterPaperActionPlanStore({connect:async()=>{connected=true;throw new Error('unexpected');}} as never);
  const first=assembled.plans[0],second=assembled.plans[1];
  assert.ok(first&&second);
  const tampered=[second,first];
  await assert.rejects(store.publishManagementPlans(assembled.decision,tampered,now),/MANAGEMENT_ACTION_PLAN_GROUP_INVALID/);
  assert.equal(connected,false);
});
