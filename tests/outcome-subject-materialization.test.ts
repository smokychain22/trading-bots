import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { PostgresOutcomeResolver } from '../src/research/outcome-resolver.js';

const at='2026-09-15T14:00:00.000Z',hash='a'.repeat(64);

test('all P2D subject families have reachable, frozen online materializers',async()=>{
  const inserts:{sql:string;values:readonly unknown[]}[]=[];
  const pool={query:async(sql:string,values:readonly unknown[]=[])=>{
    if(sql.includes('INSERT INTO research.theta_outcome_subject')){inserts.push({sql,values});return {rows:[],rowCount:1};}
    if(sql.includes('FROM trade.economic_chain ec JOIN core.bot_instance'))return {rowCount:1,rows:[{
      chain_id:'chain',opened_at:'2026-09-14T14:00:00.000Z',closed_at:at,lifecycle_state:'CLOSED',
      account_id:'account',decision_id:'decision',fusion_snapshot_id:'fusion',feature_hash:hash,strategy_version:'strategy-v1'}]};
    if(sql.includes('FROM trade.canonical_strategy_frontier f JOIN trade.fusion_snapshot'))return {rowCount:1,rows:[{
      frontier_id:'frontier',observed_at:at,content_hash:hash,strategy_version:'strategy-v1',
      selected_branch:'THETA_CONVENTIONAL',global_wait_earned:true,frontier_json:{},feature_hash:hash,
      branches:[{branch:'THETA_CONVENTIONAL',applicable:true,evaluated:true},{branch:'THETA_DEFINED_RISK',applicable:true,evaluated:true}]}]};
    if(sql.includes('FROM trade.global_wait_evidence'))return {rowCount:1,rows:[{
      decision_id:'wait-decision',decision_time:at,wait_reason:'NO_POSITIVE_AFTER_COST_EDGE',underlyings_evaluated:2,
      contracts_evaluated:10,branches_considered_json:['THETA_CONVENTIONAL','THETA_DEFINED_RISK'],
      best_rejected_candidate_id:null,best_feasible_action:null,blockers_json:[],data_missing_json:[],
      search_proof_json:{complete:true},earned:true,validation_violations_json:[],feature_hash:hash,universe_hash:hash,
      strategy_version:'strategy-v1'}]};
    if(sql.includes('FROM trade.management_action_frontier maf'))return {rowCount:1,rows:[{
      management_action_frontier_id:'management-frontier',management_input_snapshot_id:'management-input',observed_at:at,
      actions_json:[{action:'HOLD',feasibility:'FEASIBLE'},{action:'CLOSE_FULL',feasibility:'FEASIBLE'}],
      selected_action:'HOLD',content_hash:hash,policy_version:'UNPROMOTED',feature_hash:hash,chain_id:'chain',
      input_json:{context:{portfolioState:{}}},profit_state_json:{currentUnrealizedPnl:20,securedCapital:10000},
      action_comparisons_json:[],strategy_switch_json:{}}]};
    if(sql.includes('FROM research.theta_option_chain_decision_evidence'))return {rowCount:1,rows:[{
      chain_decision_evidence_id:'chain-decision',observed_at:at,contract_version:'theta-options-chain-decision-v1',
      content_hash:hash,chain_snapshot_json:{contracts:[
        {optionSymbol:'SPY261016P00500000',expiration:'2026-10-16'},
        {optionSymbol:'SPY261016P00495000',expiration:'2026-10-16'}]},
      counterfactual_label_contract_json:{subjects:[
        {subjectType:'SELECTED_STRIKE',subjectId:'SPY261016P00500000',state:'BLOCKED_ON_FUTURE_OUTCOME'},
        {subjectType:'NEIGHBOR_STRIKE',subjectId:'SPY261016P00495000',state:'BLOCKED_ON_FUTURE_OUTCOME'}]}}]};
    throw new Error(`UNEXPECTED_SQL:${sql.slice(0,80)}`);
  }} as unknown as Pool;
  const report=await new PostgresOutcomeResolver(pool).materializeEligibleSubjects();
  assert.deepEqual(report,{wholeChain:1,strategy:3,actionRegret:1,contractRegret:1,strategyRegret:1,wait:1,management:2,contract:10});
  assert.equal(inserts.every((insert)=>insert.sql.includes('execution_authorized')),true);
  assert.equal(inserts.every((insert)=>insert.values.includes(false)===false),true,'execution lock is a SQL literal and cannot be supplied by caller');
  assert.ok(inserts.some((insert)=>insert.values.some((value)=>typeof value==='string'&&value.includes('profitPreservation'))));
});
