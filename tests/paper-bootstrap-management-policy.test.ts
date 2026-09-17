import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRuntimeManagementFrontiers } from '../src/theta/autonomous-runtime.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';
import {
  createPaperBootstrapManagementPolicyProvider,
  paperBootstrapManagementPolicyVersion,
} from '../src/theta/paper-bootstrap-management-policy.js';

const observedAt='2026-09-17T15:00:00.000Z';
const state=(lifecycleState='CSP_OPEN',aegisState='ALLOW_FULL')=>assembleManagementInput({
  chain_id:'chain',lifecycle_state:lifecycleState,underlying_id:'underlying',underlying:'AAPL',
  option_leg_id:'leg',option_contract_id:'contract',quantity:'1',entry_credit_debit:'200',
  contract_symbol:'AAPL261016P00200000',option_type:'PUT',strike:'200',expiration_date:'2026-10-16',
  multiplier:'100',bid:'1',ask:'1.1',quote_as_of:observedAt,feed:'OPRA',quote_quality:'GOOD',
  realized_option_pnl:'0',open_stock_shares:lifecycleState==='RECOVERY_WAIT'?'100':'0',
  stock_basis_per_share:lifecycleState==='RECOVERY_WAIT'?'195':null,realized_stock_pnl:'0',
  dividends:'0',fees:'0',buying_power:'50000',options_buying_power:'40000',account_as_of:observedAt,
  fusion_snapshot_id:'fusion',snapshot_json:{underlyingState:{last:205},marketSession:{isOpen:true},
    riskState:{assignmentCapacity:1,newRiskState:aegisState},eventState:{state:'CLEAR'}},
  broker_position:lifecycleState==='RECOVERY_WAIT'?{currentPrice:190}:null,
},{managementInputSnapshotId:'input',reconciliationSnapshotId:'recon',observedAt});

test('bootstrap policy holds a healthy CSP without claiming empirical profitability',async()=>{
  const provider=createPaperBootstrapManagementPolicyProvider();
  assert.equal(provider.authority,'PAPER_BOOTSTRAP_MANAGEMENT_POLICY');
  const [frontier]=await buildRuntimeManagementFrontiers([state()],provider);
  assert.equal(frontier?.selectedAction,'HOLD');
  assert.equal(frontier?.policyVersion,paperBootstrapManagementPolicyVersion);
  assert.equal(frontier?.economicModelState,'EV_MODEL_NOT_EMPIRICALLY_READY');
  assert.ok(frontier?.reasonCodes.includes('PAPER_BOOTSTRAP_MANAGEMENT_POLICY'));
});

test('bootstrap policy can fully close a CSP when AEGIS issues a hard veto and quote truth is usable',async()=>{
  const [frontier]=await buildRuntimeManagementFrontiers([state('CSP_OPEN','HARD_VETO')],
    createPaperBootstrapManagementPolicyProvider());
  assert.equal(frontier?.selectedAction,'CLOSE_FULL');
  const selected=frontier?.actions.find((action)=>action.action==='CLOSE_FULL');
  assert.equal(selected?.executionEvidence?.closeEconomicBoundary,1.1);
  assert.equal(selected?.executionEvidence?.empiricalEconomicsReady,false);
  assert.equal(selected?.executionEvidence?.expectedAfterCostEv,null);
});

test('bootstrap policy never opens new management risk and defaults assigned stock to recovery wait',async()=>{
  const [frontier]=await buildRuntimeManagementFrontiers([state('RECOVERY_WAIT')],
    createPaperBootstrapManagementPolicyProvider());
  assert.equal(frontier?.selectedAction,'RECOVERY_WAIT');
  assert.ok(frontier?.actions.find((action)=>action.action==='SELL_CC')?.blockers.includes('EMPIRICAL_ACTION_EV_UNKNOWN'));
});

test('bootstrap hard-veto stock handling can select a complete stock exit without inventing EV',async()=>{
  const [frontier]=await buildRuntimeManagementFrontiers([state('RECOVERY_WAIT','HARD_VETO')],
    createPaperBootstrapManagementPolicyProvider());
  assert.equal(frontier?.selectedAction,'SELL_STOCK');
  const selected=frontier?.actions.find((action)=>action.action==='SELL_STOCK');
  assert.equal(selected?.executionEvidence?.stockEconomicBoundary,190);
  assert.equal(selected?.expectedFutureValue,null);
});
