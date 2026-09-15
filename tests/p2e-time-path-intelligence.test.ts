import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveMarketSessionState,deriveOptionTimeState,evaluateDecisionFreshness } from '../src/theta/time-aware-state.js';
import { buildActionInactionFrontier,calculateInactionDiagnostics } from '../src/theta/action-inaction-frontier.js';
import { routeStrategyTiming } from '../src/theta/strategy-timing-router.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';
import { buildPositionPathCheckpoint } from '../src/theta/position-path-state.js';
import { buildManagementActionFrontier } from '../src/theta/management-action-frontier.js';
import { mapManagementFrontierActions } from '../src/theta/p2e-evidence-store.js';

test('session state respects broker calendar early close and expiration context',()=>{
  const session=deriveMarketSessionState({observedAt:'2026-11-27T17:45:00Z',clock:{timestamp:'2026-11-27T17:45:00Z',
    isOpen:true,nextOpen:'2026-11-30T14:30:00Z',nextClose:'2026-11-27T18:00:00Z'},
    calendar:[{date:'2026-11-27',open:'2026-11-27T14:30:00Z',close:'2026-11-27T18:00:00Z'}],
    expirationDate:'2026-11-27'});
  assert.equal(session.earlyClose,true);
  assert.ok(session.states.includes('EARLY_CLOSE_SESSION'));
  assert.ok(session.states.includes('EXPIRY_FINAL_WINDOW'));
  assert.equal(session.brokerAgreement,'AGREE');
});

test('weekends and invalid decision times fail closed without guessed freshness',()=>{
  assert.ok(deriveMarketSessionState({observedAt:'2026-09-19T15:00:00Z',clock:null,calendar:[]}).states.includes('WEEKEND_NON_TRADING'));
  assert.equal(evaluateDecisionFreshness({decisionAt:'bad',observedAt:'2026-09-15T14:00:00Z',expiresAt:null,
    changedFacts:[],requiredFactsUnknown:[]}).state,'UNKNOWN');
});

test('Pareto frontier keeps unknown economics out of forced rankings',()=>{
  const result=buildActionInactionFrontier({subjectId:'x',observedAt:'2026-09-15T14:00:00Z',actions:[
    {action:'HOLD',feasible:true,infeasibleReason:null,afterCostEv:null,tailBurden:5,capitalDays:10,executionCost:0,
      assignmentBurden:null,opportunityCost:null,empiricalState:'UNKNOWN'},
    {action:'CLOSE_FULL',feasible:true,infeasibleReason:null,afterCostEv:4,tailBurden:2,capitalDays:0,executionCost:1,
      assignmentBurden:0,opportunityCost:0,empiricalState:'KNOWN'}]});
  assert.equal(result.holdEvidence,'HOLD_UNKNOWN');
  assert.equal(result.executionAuthorized,false);
  assert.deepEqual(result.paretoActions,['CLOSE_FULL','HOLD']);
});

test('WAIT diagnostics distinguish false rejects, correct rejects, and unresolved evidence',()=>{
  const result=calculateInactionDiagnostics([{action:'WAIT',selected:false,resolvedOutcome:'POSITIVE'},
    {action:'WAIT',selected:false,resolvedOutcome:'NEGATIVE'},{action:'HOLD',selected:true,resolvedOutcome:'UNRESOLVED'}]);
  assert.equal(result.waitRate,2/3);assert.equal(result.rejectedCandidatePositiveOutcomeRate,0.5);assert.equal(result.correctRejectRate,0.5);
});

test('position path detects winner-to-loser and never grants execution authority',()=>{
  const raw={chain_id:'11111111-1111-4111-8111-111111111111',lifecycle_state:'CSP_OPEN',underlying_id:'u',underlying:'AAPL',
    option_leg_id:'l',option_contract_id:'c',quantity:'1',entry_credit_debit:'200',contract_symbol:'AAPL261016P00200000',
    option_type:'PUT',strike:'200',expiration_date:'2026-10-16',multiplier:'100',bid:'2.4',ask:'2.5',quote_as_of:'2026-09-15T14:00:00Z',
    feed:'OPRA',quote_quality:'GOOD',realized_option_pnl:'-260',open_stock_shares:'0',stock_basis_per_share:null,
    realized_stock_pnl:'0',dividends:'0',fees:'0',unknown_fill_fees:false,buying_power:'50000',options_buying_power:'40000',
    account_as_of:'2026-09-15T14:00:00Z',fusion_snapshot_id:null,snapshot_json:{marketSession:{isOpen:true}},broker_position:null};
  const state=assembleManagementInput(raw,{managementInputSnapshotId:'22222222-2222-4222-8222-222222222222',
    reconciliationSnapshotId:'33333333-3333-4333-8333-333333333333',observedAt:'2026-09-15T14:00:00Z'});
  const previous={...buildPositionPathCheckpoint({...state,economics:{...state.economics,wholeChainPnl:100}},[]),observedAt:'2026-09-15T13:00:00Z'};
  const path=buildPositionPathCheckpoint(state,[previous]);
  assert.equal(path.classification,'WINNER_TO_LOSER');assert.equal(path.executionAuthorized,false);
});

test('P2E frontier mapping preserves canonical management feasibility and blockers',()=>{
  const raw={chain_id:'11111111-1111-4111-8111-111111111111',lifecycle_state:'CSP_OPEN',underlying_id:'u',underlying:'AAPL',
    option_leg_id:'l',option_contract_id:'c',quantity:'1',entry_credit_debit:'200',contract_symbol:'AAPL261016P00200000',
    option_type:'PUT',strike:'200',expiration_date:'2026-10-16',multiplier:'100',bid:null,ask:null,quote_as_of:null,
    feed:null,quote_quality:'UNKNOWN',realized_option_pnl:'0',open_stock_shares:'0',stock_basis_per_share:null,
    realized_stock_pnl:'0',dividends:'0',fees:'0',unknown_fill_fees:false,buying_power:'50000',options_buying_power:'40000',
    account_as_of:'2026-09-15T14:00:00Z',fusion_snapshot_id:null,snapshot_json:{marketSession:{isOpen:true}},broker_position:null};
  const state=assembleManagementInput(raw,{managementInputSnapshotId:'22222222-2222-4222-8222-222222222222',
    reconciliationSnapshotId:'33333333-3333-4333-8333-333333333333',observedAt:'2026-09-15T14:00:00Z'});
  const actions=mapManagementFrontierActions(buildManagementActionFrontier(state));
  assert.equal(actions.find((action)=>action.action==='HOLD')?.feasible,true);
  assert.equal(actions.find((action)=>action.action==='CLOSE_FULL')?.feasible,null);
  assert.match(actions.find((action)=>action.action==='CLOSE_FULL')?.infeasibleReason??'',/EXECUTABLE_OPTION_QUOTE_UNKNOWN/);
  assert.equal(actions.find((action)=>action.action==='SELL_CC')?.infeasibleReason,'NOT_APPLICABLE_TO_LIFECYCLE');
});

test('timing router evaluates every branch and keeps 0DTE specialist research-only',()=>{
  const session=deriveMarketSessionState({observedAt:'2026-09-15T15:00:00Z',clock:{timestamp:'2026-09-15T15:00:00Z',isOpen:true,nextOpen:null,nextClose:'2026-09-15T20:00:00Z'},calendar:[]});
  const option=deriveOptionTimeState(0,session);
  const receipt=routeStrategyTiming({observedAt:'2026-09-15T15:00:00Z',sessionStates:session.states,optionTime:option,
    lifecycleState:'CASH',requiredUnknowns:[],eventStateKnown:true,quoteFresh:true});
  assert.equal(receipt.branches.length,6);assert.equal(receipt.zeroDteState,'SPECIALIST_RESEARCH_ONLY');assert.equal(receipt.executionAuthorized,false);
});
