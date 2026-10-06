import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { InMemoryPaperOrderStore, PaperOrderCoordinator, type PersistedPaperOrderIntent } from '../src/execution/paper-order-coordinator.js';
import { control } from './phase3-exec-fixtures.js';
import type { BrokerMutationAuthorization } from '../src/execution/execution-control.js';
import type { BrokerOrderRequest, BrokerOrderSnapshot, PaperBrokerAdapter } from '../src/execution/broker.js';
import { assessHoldStrikeLifecycle } from '../src/theta/hold-strike-lifecycle.js';
import { reconcileManagedOptionLifecycle } from '../src/execution/broker-lifecycle-evidence.js';
import { buildDefinedRiskClosePlan, classifyDefinedRiskExpiry, computeDefinedRiskWholeChainAccounting } from '../src/execution/defined-risk-lifecycle.js';
import type { ManagementInputState } from '../src/theta/management-input-state.js';

const NOW='2026-10-06T15:00:00.000Z';
class DTestBroker implements PaperBrokerAdapter{
  readonly accountKind='MASTER_API_KEY' as const;readonly environment='PAPER' as const;
  lookupResult:BrokerOrderSnapshot|null=null;submitCalls=0;
  async submitOrder(request:BrokerOrderRequest,authorization:BrokerMutationAuthorization){void request;void authorization;this.submitCalls++;throw new Error('NOT_USED');}
  async getOrderByClientOrderId(){return this.lookupResult;}
  async getOrder(){return this.lookupResult;}
  async listOrders(){return this.lookupResult===null?[]:[this.lookupResult];}
  async listPositions(){return[];}
  async cancelOrder(){throw new Error('NOT_USED');}
  async replaceOrder(){throw new Error('NOT_USED');}
}
const durable={orderClass:'mleg' as const,creditDebitDirection:'CREDIT' as const,
  packageIdentity:'MLEG:SPY261016P00650000:sell:1:sell_to_open|SPY261016P00645000:buy:1:buy_to_open',legs:[
    {legIndex:1,optionContractId:'10000000-0000-4000-8000-000000000001',providerContractId:'short-contract',
      occSymbol:'SPY261016P00650000',optionType:'PUT' as const,positionIntent:'sell_to_open' as const,ratioQuantity:1,
      expiration:'2026-10-16',strike:650,multiplier:100,deliverableIdentity:'STANDARD:SPY:100'},
    {legIndex:2,optionContractId:'10000000-0000-4000-8000-000000000002',providerContractId:'long-contract',
      occSymbol:'SPY261016P00645000',optionType:'PUT' as const,positionIntent:'buy_to_open' as const,ratioQuantity:1,
      expiration:'2026-10-16',strike:645,multiplier:100,deliverableIdentity:'STANDARD:SPY:100'}]};

const hState=(over:Partial<ManagementInputState>={}):ManagementInputState=>({
  contractVersion:'theta-management-input-v3',managementInputSnapshotId:'m',chainId:'chain-h',lifecycleState:'CSP_OPEN',
  strategyOrigin:'THETA_HOLD_STRIKE',underlying:'SPY',underlyingId:'u',observedAt:NOW,reconciliationSnapshotId:'r',fusionSnapshotId:'f',
  evidenceBundle:{decisionAsOf:NOW,reconciliationObservedAt:NOW,accountStateAsOf:NOW,accountReceivedAt:NOW,positionStateAsOf:NOW,
    fusionSnapshotAsOf:NOW,currentLegQuoteObservedAt:NOW,currentLegQuoteReceivedAt:NOW,timingState:'VALID'},
  contract:{optionLegId:'leg-h',optionContractId:'contract-h',symbol:'SPY261009P00650000',optionType:'PUT',strike:650,
    expiration:'2026-10-09',multiplier:100,contracts:1},
  economics:{entryCreditDebit:200,realizedOptionPnl:0,unrealizedOptionPnl:0,openStockShares:0,stockBasisPerShare:null,
    stockMarkPerShare:null,unrealizedStockPnl:null,realizedStockPnl:0,dividends:0,fees:0,wholeChainPnl:0},
  market:{spot:660,optionBid:0.5,optionAsk:0.6,quoteTimestamp:NOW,quoteFeed:'OPRA',quoteQuality:'GOOD',marketOpen:true,
    clockTimestamp:NOW,nextOpen:null,nextClose:null,calendarSessions:[],dte:1,moneyness:0.98,delta:-0.2,gamma:0.02,
    theta:-0.1,vega:0.1,iv:0.25,ivState:null},
  account:{buyingPower:10000,optionsBuyingPower:10000,availableCapital:10000},
  context:{eventState:'CLEAR',dividendExDateState:'CLEAR',ownershipQuality:'KNOWN',assignmentCapacity:1,
    assignmentCapacityEvidence:{state:'KNOWN',quantity:1,unit:'STANDARD_CONTRACTS',source:'ALPACA_ACCOUNT_BUYING_POWER',
      observedAt:NOW,validThrough:null,contentHash:'a'.repeat(64),reason:null},recoveryState:null,concentration:null,
    sectorCorrelation:null,aegisState:'ALLOW_FULL',executionState:'GOOD',regimeState:null,opportunityAlternatives:null,strategyVersions:null},
  unknownFields:[],hardBlockers:[],economicModelState:'EV_MODEL_NOT_EMPIRICALLY_READY',...over});

test('H has a bounded review deadline, forces a two-sided close near expiry, and never rolls',()=>{
  const assessment=assessHoldStrikeLifecycle(hState());
  assert.equal(assessment?.action,'CLOSE_FULL');
  assert.equal(assessment?.mandatory,true);
  assert.equal(assessment?.rollAllowed,false);
  assert.ok(Date.parse(assessment?.reviewDeadline??'')>Date.parse(NOW));
});

test('H assignment is decided only by the single broker-confirmed lifecycle authority: a vanished contract or ITM mark is never assignment',()=>{
  // H shares the one assignment authority with Q (reconcileManagedOptionLifecycle); there is deliberately no H-specific copy of it
  const base={chainId:'chain-h',currentState:'CSP_OPEN' as const,legKind:'SHORT_PUT' as const,optionSymbol:'SPY261009P00650000',
    underlyingSymbol:'SPY',contracts:1,multiplier:100,observedAt:NOW,previousPositions:[{symbol:'SPY261009P00650000',quantity:-1}]};
  const vanished=reconcileManagedOptionLifecycle({...base,currentPositions:[],activities:[]});
  assert.equal(vanished.state,'UNKNOWN');
  const confirmed=reconcileManagedOptionLifecycle({...base,currentPositions:[{symbol:'SPY',quantity:100}],
    activities:[{id:'activity-1',activityType:'OPASN',symbol:'SPY261009P00650000',quantity:1,price:null,date:NOW,orderId:null}]});
  assert.equal(confirmed.state,'CONFIRMED');
  assert.deepEqual(confirmed.transitionPath,['ASSIGNED','STOCK_HELD','RECOVERY_WAIT']);
  // a late replay of the same broker activity yields the same identity, so the idempotent evidence key downstream is stable across restart
  const replay=reconcileManagedOptionLifecycle({...base,currentPositions:[{symbol:'SPY',quantity:100}],
    activities:[{id:'activity-1',activityType:'OPASN',symbol:'SPY261009P00650000',quantity:1,price:null,date:NOW,orderId:null}]});
  assert.equal(replay.brokerActivityId,confirmed.brokerActivityId);
});

test('D close always refreshes and references both exact legs',()=>{
  const close=buildDefinedRiskClosePlan({parentIntentId:'p',evidence:durable,quantity:1,now:NOW,maximumQuoteAgeSeconds:30,
    shortQuote:{symbol:durable.legs[0].occSymbol,bid:1.9,ask:2,observedAt:NOW},
    longQuote:{symbol:durable.legs[1].occSymbol,bid:0.8,ask:0.9,observedAt:NOW}});
  assert.deepEqual(close.legs.map(leg=>leg.positionIntent),['buy_to_close','sell_to_close']);
  assert.equal(close.netDebitPerShare,1.2);
  assert.throws(()=>buildDefinedRiskClosePlan({parentIntentId:'p',evidence:durable,quantity:1,now:NOW,maximumQuoteAgeSeconds:30,
    shortQuote:{symbol:durable.legs[0].occSymbol,bid:1.9,ask:2,observedAt:NOW},
    longQuote:{symbol:'WRONG',bid:0.8,ask:0.9,observedAt:NOW}}),/IDENTITY_MISMATCH/);
});

test('D expiry distinguishes safe, pin, assignment, exercise, and unknown states',()=>{
  const base={shortStrike:650,longStrike:645,dte:1,marketOpen:true,pinBandPct:0.002,
    shortAssignmentConfirmed:false,longExerciseConfirmed:false};
  assert.equal(classifyDefinedRiskExpiry({...base,spot:660}),'CLOSE_REQUIRED');
  assert.equal(classifyDefinedRiskExpiry({...base,spot:650.5}),'PIN_RISK');
  assert.equal(classifyDefinedRiskExpiry({...base,spot:647}),'ASSIGNMENT_RISK');
  assert.equal(classifyDefinedRiskExpiry({...base,spot:640}),'EXERCISE_RELEVANT');
  assert.equal(classifyDefinedRiskExpiry({...base,spot:null}),'UNKNOWN');
});

test('D whole-chain accounting uses net parent economics once and preserves open exposure',()=>{
  const closed=computeDefinedRiskWholeChainAccounting({quantity:1,multiplier:100,openingNetCreditPerShare:1.1,
    openingFees:1,closingNetDebitPerShare:0.4,closingFees:1,assignmentExerciseCashFlow:0,lifecycle:'CLOSED'});
  assert.equal(closed.realizedPnl,68);
  assert.equal(closed.remainingUnrealizedExposure,'NONE');
  const open=computeDefinedRiskWholeChainAccounting({quantity:1,multiplier:100,openingNetCreditPerShare:1.1,
    openingFees:1,closingNetDebitPerShare:null,closingFees:0,assignmentExerciseCashFlow:0,lifecycle:'OPEN'});
  assert.equal(open.realizedPnl,null);
  assert.equal(open.remainingUnrealizedExposure,'OPEN_SPREAD');
});

test('D asymmetric partial fill is persisted before state transition and restart never resubmits',async()=>{
  const request={symbol:durable.packageIdentity,qty:1,side:'sell' as const,type:'limit' as const,time_in_force:'day' as const,
    limit_price:'-1.10',client_order_id:'theta-d-durable',order_class:'mleg' as const,legs:[
      {symbol:durable.legs[0].occSymbol,side:'sell' as const,ratio_qty:1,position_intent:'sell_to_open' as const},
      {symbol:durable.legs[1].occSymbol,side:'buy' as const,ratio_qty:1,position_intent:'buy_to_open' as const}]};
  const intent:Omit<PersistedPaperOrderIntent,'status'|'brokerOrderId'>={orderIntentId:'30000000-0000-4000-8000-000000000001',
    executionAccountId:'30000000-0000-4000-8000-000000000002',request,action:'OPEN_DEFINED_RISK',
    decisionId:'30000000-0000-4000-8000-000000000003',persistedAt:NOW,chainId:'30000000-0000-4000-8000-000000000004',
    optionContractId:null,underlyingId:'30000000-0000-4000-8000-000000000005',multiLegEvidence:durable,
    executionEvidence:{quoteSource:'ALPACA',quoteFeed:'OPRA',quoteSemantics:'CONSOLIDATED_NBBO',quoteAsOf:NOW,
      decisionExpiresAt:'2026-10-06T15:01:00.000Z',quoteContentHash:'a'.repeat(64),aegisState:'ALLOW_FULL'},
    authorizationEvidence:{executionTier:'PAPER_EVIDENCE',canonicalQuantity:1,paperEvidenceQuantity:1,
      empiricalEconomicsReady:false,expectedAfterCostEv:null}};
  const broker=new DTestBroker(),store=new InMemoryPaperOrderStore();
  const coordinator=new PaperOrderCoordinator(broker,store,control());
  await coordinator.prepare(intent);
  await store.transitionIntent(intent.orderIntentId,'READY','SUBMITTING');
  broker.lookupResult={id:'parent',clientOrderId:request.client_order_id,symbol:request.symbol,qty:1,filledQty:0,
    filledAvgPrice:null,side:'sell',positionIntent:null,status:'partially_filled',limitPrice:-1.1,submittedAt:NOW,
    replacedBy:null,replaces:null,orderClass:'mleg',legs:[
      {id:'short',symbol:durable.legs[0].occSymbol,side:'sell',positionIntent:'sell_to_open',ratioQty:1,qty:1,filledQty:1,filledAvgPrice:2,status:'filled'},
      {id:'long',symbol:durable.legs[1].occSymbol,side:'buy',positionIntent:'buy_to_open',ratioQty:1,qty:1,filledQty:0,filledAvgPrice:null,status:'new'}]};
  await coordinator.recoverAfterRestart();
  // one leg filled while the other is untouched is asymmetric hedge risk: the state is the typed unresolved RECONCILING, never PARTIAL/FILLED
  assert.equal((await store.getIntent(intent.orderIntentId))?.status,'RECONCILING');
  assert.equal(store.brokerSnapshots.get(intent.orderIntentId)?.legs?.[0]?.filledQty,1);
  assert.equal(store.brokerSnapshots.get(intent.orderIntentId)?.legs?.[1]?.filledQty,0);
  assert.equal((await store.unresolvedIntents()).length,1);
  // a second restart with the same asymmetric broker truth stays unresolved and still never resubmits
  await coordinator.recoverAfterRestart();
  assert.equal((await store.getIntent(intent.orderIntentId))?.status,'RECONCILING');
  // broker truth later shows both legs filled: the intent resolves from broker truth, still with zero submits
  broker.lookupResult={...broker.lookupResult,status:'filled',filledQty:1,filledAvgPrice:1.1,legs:[
    {id:'short',symbol:durable.legs[0].occSymbol,side:'sell',positionIntent:'sell_to_open',ratioQty:1,qty:1,filledQty:1,filledAvgPrice:2,status:'filled'},
    {id:'long',symbol:durable.legs[1].occSymbol,side:'buy',positionIntent:'buy_to_open',ratioQty:1,qty:1,filledQty:1,filledAvgPrice:0.9,status:'filled'}]};
  await coordinator.recoverAfterRestart();
  assert.equal((await store.getIntent(intent.orderIntentId))?.status,'FILLED');
  assert.equal(store.brokerSnapshots.get(intent.orderIntentId)?.legs?.[1]?.filledQty,1);
  assert.equal(broker.submitCalls,0);
});

test('migration 069 normalizes parent, intent legs, and broker leg state without a representative leg hack',()=>{
  const sql=readFileSync(new URL('../migrations/069_multi_leg_order_durability.sql',import.meta.url),'utf8');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS trade\.order_intent_leg/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS trade\.broker_order_leg_state/);
  assert.match(sql,/option_contract_id IS NULL/);
  assert.match(sql,/order_class='mleg'.*option_contract_id IS NULL/s);
});
