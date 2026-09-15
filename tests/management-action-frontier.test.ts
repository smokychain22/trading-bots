import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementActionFrontier, managementPolicyEvidenceVersion,
  type ManagementActionExecutionEvidence, type ManagementFrontierAction, type ManagementPolicyEvidence,
} from '../src/theta/management-action-frontier.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';

test('prospective close and stock sale never present marked PnL as certain proceeds', () => {
  for (const lifecycle of ['CSP_OPEN', 'CC_OPEN', 'RECOVERY_WAIT']) {
    const input = state(lifecycle);
    assert.notEqual(input.economics.wholeChainPnl, null);
    const frontier = buildManagementActionFrontier(input);
    assert.ok(frontier.actions.every((action) => action.certainEconomicPnl === null));
  }
});

const state = (lifecycleState: string, observedAt='2026-09-12T14:00:00.000Z', expiration='2026-10-16') => assembleManagementInput({
  chain_id: 'chain', lifecycle_state: lifecycleState, underlying_id:'underlying', underlying: 'AAPL',
  option_leg_id: 'leg', option_contract_id:'contract', quantity: '1',
  entry_credit_debit: '200', contract_symbol: 'AAPL261016P00200000', option_type: 'PUT', strike: '200',
  expiration_date: expiration, multiplier: '100', bid: '1', ask: '1.1', quote_as_of: observedAt,
  feed: 'OPRA', quote_quality: 'GOOD', realized_option_pnl: '0', open_stock_shares: lifecycleState === 'RECOVERY_WAIT' ? '100' : '0',
  stock_basis_per_share: lifecycleState === 'RECOVERY_WAIT' ? '195' : null, realized_stock_pnl: '0', dividends: '0', fees: '0',
  buying_power: '50000', options_buying_power: '40000', account_as_of:observedAt, fusion_snapshot_id: 'fusion',
  snapshot_json: { underlyingState:{last:205},marketSession:{isOpen:false},riskState: { assignmentCapacity: 1, newRiskState:'ALLOW_FULL' }, eventState: { state: 'CLEAR' } },
  broker_position: lifecycleState === 'RECOVERY_WAIT' ? { currentPrice: 190 } : null,
}, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt });

const execution=(overrides:Partial<ManagementActionExecutionEvidence>={}):ManagementActionExecutionEvidence=>({
  closeEconomicBoundary:1.2,openEconomicBoundary:null,stockEconomicBoundary:null,economicsRemainPositive:true,
  expectedAfterCostEv:null,empiricalEconomicsReady:false,targetContract:null,...overrides,
});

const policy=(input:ReturnType<typeof state>,selectedAction:ManagementFrontierAction,
  selectedExecution:ManagementActionExecutionEvidence|null):ManagementPolicyEvidence=>{
  const base=buildManagementActionFrontier(input);
  return {contractVersion:managementPolicyEvidenceVersion,inputContentHash:input.contentHash,decidedAt:input.observedAt,
    policyVersion:'management-comparison-fixture-v1',comparisonComplete:true,selectedAction,reasonCodes:[`SELECT_${selectedAction}`],
    actionValues:base.actions.filter((candidate)=>candidate.feasibility==='FEASIBLE'||candidate.action===selectedAction).map((candidate)=>({action:candidate.action,
      expectedFutureValue:candidate.action===selectedAction?10:5,downsideTailEstimate:1,incrementalCapitalDays:1,
      executionCostRisk:0.1,opportunityCost:0,uncertainty:0.1,utility:candidate.action===selectedAction?10:5,
      executionEvidence:candidate.action===selectedAction?selectedExecution:null,reasons:['SAME_SNAPSHOT_COMPARISON']}))};
};

test('CSP management enumerates the full required action surface', () => {
  const frontier = buildManagementActionFrontier(state('CSP_OPEN'));
  assert.deepEqual(frontier.actions.map((action) => action.action),
    ['HOLD', 'CLOSE_FULL', 'ROLL', 'LET_EXPIRE', 'ACCEPT_ASSIGNMENT', 'REDEPLOY']);
  assert.equal(frontier.selectedAction, 'HOLD');
  assert.equal(frontier.secondBestAction, null);
  assert.ok(frontier.actions.find((action) => action.action === 'ROLL')?.blockers.includes('EMPIRICAL_ACTION_EV_UNKNOWN'));
  assert.deepEqual(frontier.actions.find((action) => action.action === 'ROLL')?.requiredOptionPositionIntents,
    ['BUY_TO_CLOSE', 'SELL_TO_OPEN']);
});

test('assigned stock compares recovery wait, stock sale, and covered call without forcing a CC', () => {
  const frontier = buildManagementActionFrontier(state('RECOVERY_WAIT'));
  assert.deepEqual(frontier.actions.map((action) => action.action), ['RECOVERY_WAIT', 'SELL_STOCK', 'SELL_CC']);
  assert.equal(frontier.selectedAction, 'RECOVERY_WAIT');
  assert.equal(frontier.actions.find((action) => action.action === 'SELL_CC')?.utility, null);
});

test('covered call management exposes hold, close, roll, and call-away', () => {
  const frontier = buildManagementActionFrontier(state('CC_OPEN'));
  assert.deepEqual(frontier.actions.map((action) => action.action), ['HOLD_CC', 'CLOSE_CC', 'ROLL_CC', 'ALLOW_CALL_AWAY']);
  assert.equal(frontier.selectedAction, 'HOLD_CC');
});

test('stale broker state blocks quote-dependent actions but keeps passive management available',()=>{
  const input=state('CSP_OPEN');
  const stale={...input,hardBlockers:['BROKER_DATA_STALE']};
  const frontier=buildManagementActionFrontier(stale);
  assert.equal(frontier.selectedAction,'HOLD');
  assert.ok(frontier.actions.find((action)=>action.action==='CLOSE_FULL')?.blockers.includes('EXECUTION_MARKET_NOT_QUALIFIED'));
});

test('complete same-snapshot economics can select a risk-reducing CSP close',()=>{
  const input=state('CSP_OPEN');
  const frontier=buildManagementActionFrontier(input,policy(input,'CLOSE_FULL',execution()));
  assert.equal(frontier.selectedAction,'CLOSE_FULL');
  assert.equal(frontier.decisionState,'ACTION_SELECTED');
  assert.equal(frontier.secondBestAction,'HOLD');
  assert.equal(frontier.policyVersion,'management-comparison-fixture-v1');
  assert.match(frontier.policyEvidenceHash ?? '',/^[0-9a-f]{64}$/);
  assert.ok(frontier.reasonCodes.includes('MANAGEMENT_POLICY_EVIDENCE_ACCEPTED'));
});

test('incomplete or stale policy evidence cannot displace passive management',()=>{
  const input=state('CSP_OPEN');
  const evidence=policy(input,'CLOSE_FULL',execution());
  const frontier=buildManagementActionFrontier(input,{...evidence,comparisonComplete:false});
  assert.equal(frontier.selectedAction,'HOLD');
  assert.equal(frontier.decisionState,'SYSTEM_HOLD_MISSING_EVIDENCE');
  assert.equal(frontier.policyVersion,null);
  assert.equal(frontier.policyEvidenceHash,null);
  assert.ok(frontier.reasonCodes.includes('MANAGEMENT_POLICY_COMPARISON_INCOMPLETE'));
});

test('a new-risk roll stays blocked without positive empirical economics',()=>{
  const input=state('CSP_OPEN');
  const frontier=buildManagementActionFrontier(input,policy(input,'ROLL',execution({openEconomicBoundary:1,
    targetContract:{symbol:'AAPL261120P00195000',optionContractId:'target',optionType:'PUT',multiplier:100,quantity:1}})));
  assert.equal(frontier.selectedAction,'HOLD');
  assert.ok(frontier.reasonCodes.includes('MANAGEMENT_POLICY_SELECTION_NOT_ARGMAX')
    || frontier.reasonCodes.includes('MANAGEMENT_NEW_RISK_NOT_EMPIRICALLY_SUPPORTED'));
});

test('a complete positive empirical comparison can select a bounded roll target',()=>{
  const input=state('CSP_OPEN');
  const rollExecution=execution({openEconomicBoundary:1,expectedAfterCostEv:25,empiricalEconomicsReady:true,
    targetContract:{symbol:'AAPL261120P00195000',optionContractId:'target',optionType:'PUT',multiplier:100,quantity:1}});
  const frontier=buildManagementActionFrontier(input,policy(input,'ROLL',rollExecution));
  assert.equal(frontier.selectedAction,'ROLL');
  assert.equal(frontier.decisionState,'ACTION_SELECTED');
  assert.equal(frontier.actions.find((candidate)=>candidate.action==='ROLL')?.feasibility,'FEASIBLE');
});

test('expiration actions require exact moneyness rather than DTE alone',()=>{
  const input=state('CSP_OPEN','2026-10-16T20:01:00.000Z','2026-10-16');
  const frontier=buildManagementActionFrontier(input);
  assert.equal(frontier.selectedAction,'LET_EXPIRE');
  assert.equal(frontier.decisionState,'ACTION_SELECTED');
  assert.ok(frontier.reasonCodes.includes('STRUCTURAL_EXPIRATION_NO_ORDER'));
  assert.equal(frontier.policyVersion,'theta-structural-expiration-v1');
  assert.match(frontier.policyEvidenceHash ?? '',/^[0-9a-f]{64}$/);
  assert.equal(frontier.actions.find((candidate)=>candidate.action==='ACCEPT_ASSIGNMENT')?.feasibility,'INFEASIBLE');
});

test('DTE zero cannot select expiration while the broker session is still open',()=>{
  const input=state('CSP_OPEN','2026-10-16T19:00:00.000Z','2026-10-16');
  const open={...input,market:{...input.market,marketOpen:true}};
  const frontier=buildManagementActionFrontier(open);
  assert.equal(frontier.selectedAction,'HOLD');
  assert.equal(frontier.decisionState,'SYSTEM_HOLD_MISSING_EVIDENCE');
});
