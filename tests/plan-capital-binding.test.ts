import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { assertCapitalIntentMatchesPlan, CapitalPlanAdmissionError, capitalReservationRequired, proposalForPlan } from '../src/execution/plan-capital-binding.js';
import { safeRuntimeFailure } from '../src/theta/autonomous-runtime.js';
import { capitalInput } from './fixtures/qualified-account-capital.js';
import { capitalPlanFixture } from './helpers/capital-plan-fixture.js';
import { mlegIntent, type DefinedRiskWorld } from './helpers/defined-risk-db-fixture.js';

const world:DefinedRiskWorld={underlyingId:randomUUID(),botInstanceId:randomUUID(),shortContract:randomUUID(),longContract:randomUUID(),
  shortSymbol:'SPY261016P00650000',longSymbol:'SPY261016P00645000'};
const intent=mlegIntent(world,randomUUID(),false),plan=capitalPlanFixture(intent);
const evidence=intent.multiLegEvidence,pkg=plan.definedRisk,legs=intent.request.legs;
assert.ok(evidence&&pkg&&legs);

test('schema capability failure cannot silently select legacy no-reservation behavior',async()=>{
  for(const value of [undefined,null,0,'false'])await assert.rejects(capitalReservationRequired({query:async()=>({rows:[{capital_required:value}]})} as never),/UNKNOWN/);
  for(const value of [true,false])assert.equal(await capitalReservationRequired({query:async()=>({rows:[{capital_required:value}]})} as never),value);
  await assert.rejects(capitalReservationRequired({query:async()=>{throw Error('DATABASE_OUTAGE');}} as never),/DATABASE_OUTAGE/);
});

test('capital admission retains exact reasons and emits a sanitized typed primary failure, never generic runtime failure',()=>{
  const reasons=['CAPITAL_EXHAUSTED:SECTOR:private-group','CAPITAL_EXHAUSTED:BROKER'];
  const error=new CapitalPlanAdmissionError(reasons);
  assert.deepEqual(error.reasons,reasons);
  assert.equal(safeRuntimeFailure(error).code,'CAPITAL_PLAN_BLOCKED:CAPITAL_EXHAUSTED');
  assert.ok(!safeRuntimeFailure(error).detail.includes('private-group'));
  assert.equal(safeRuntimeFailure(new CapitalPlanAdmissionError(['CAPITAL_REQUIRED_EVIDENCE_INVALID','account.optionsBuyingPower'])).code,
    'CAPITAL_PLAN_BLOCKED:CAPITAL_REQUIRED_EVIDENCE_INVALID');
  assert.equal(safeRuntimeFailure(new CapitalPlanAdmissionError(['unsafe data'])).code,'CAPITAL_PLAN_BLOCKED:MISSING_ADMISSION');
});

test('native reservation binds exact two-leg package, quantity, limit floor, contract and authority',()=>{
  assert.equal(assertCapitalIntentMatchesPlan(intent,plan).actionPlanId,plan.actionPlanId);
  for(const altered of [
    {...intent,executionAccountId:randomUUID()}, {...intent,decisionId:randomUUID()}, {...intent,chainId:randomUUID()},
    {...intent,request:{...intent.request,qty:2}}, {...intent,request:{...intent.request,limit_price:'0.20'}},
    {...intent,request:{...intent.request,limit_price:'-0.001'}},
    {...intent,request:{...intent.request,legs:legs.toReversed()}},
    {...intent,multiLegEvidence:{...evidence,legs:evidence.legs.map(l=>({...l,multiplier:10}))}},
  ])assert.throws(()=>assertCapitalIntentMatchesPlan(altered,plan),/CAPITAL_/);
});

test('D footprint uses minimum permitted credit, real multiplier and modeled cost, without CSP assignment collateral',()=>{
  const base=capitalInput();
  const input={...base,executionAccountId:plan.executionAccountId,underlyings:['SPY'],contracts:pkg.legs.map(l=>({symbol:l.occSymbol,
    strike:String(l.strike),multiplier:l.multiplier,deliverable:'STANDARD' as const,evidenceHash:'a'.repeat(64)}))};
  const proposal=proposalForPlan({...plan,economicBoundary:0.90},input,'1.40');
  assert.equal(proposal.perUnit.BROKER,'412.80000000');assert.equal(proposal.perUnit.ASSIGNMENT,'0');
  assert.equal(proposal.reservationId,plan.actionPlanId);assert.equal(proposal.quantity,1);
  assert.throws(()=>proposalForPlan(plan,{...input,contracts:[]},'1.40'),/CONTRACT_EVIDENCE/);
  assert.throws(()=>proposalForPlan({...plan,quantity:2,canonicalQuantity:1},input,'1.40'));
});

test('Q and H use the same secured-capital and exact-intent binding, without changing strategy authority',()=>{
  const single = {...intent,action:'OPEN_CSP' as const,optionContractId:world.shortContract,multiLegEvidence:undefined,
    request:{symbol:world.shortSymbol,qty:1,side:'sell' as const,type:'limit' as const,time_in_force:'day' as const,
      limit_price:'1.10',position_intent:'sell_to_open' as const,client_order_id:intent.request.client_order_id}};
  for(const strategyBranch of ['THETA_CONVENTIONAL','THETA_HOLD_STRIKE'] as const){
    const securedPlan={...capitalPlanFixture(single),strategyBranch,
      ...(strategyBranch==='THETA_HOLD_STRIKE'?{strategyPaperAuthorityReceiptHash:'a'.repeat(64)}:{})};
    const input={...capitalInput(),executionAccountId:securedPlan.executionAccountId,underlyings:['SPY'],contracts:[{
      symbol:world.shortSymbol,strike:'650',multiplier:100,deliverable:'STANDARD' as const,evidenceHash:'a'.repeat(64)}]};
    assert.equal(assertCapitalIntentMatchesPlan(single,securedPlan).strategyBranch,strategyBranch);
    const proposal=proposalForPlan(securedPlan,input,'1.40');
    assert.equal(proposal.perUnit.BROKER,'65001.40000000');
    assert.equal(proposal.perUnit.ASSIGNMENT,'65000.00000000');
    assert.equal(proposal.strategy,strategyBranch);
    assert.throws(()=>assertCapitalIntentMatchesPlan({...single,request:{...single.request,symbol:world.longSymbol}},securedPlan),/CAPITAL_/);
    assert.throws(()=>assertCapitalIntentMatchesPlan({...single,request:{...single.request,qty:2}},securedPlan),/CAPITAL_/);
  }
});
