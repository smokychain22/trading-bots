import assert from 'node:assert/strict';
import test from 'node:test';
import { routeConfirmedFillLifecycle, routeConfirmedRollPair, type FillLifecycleContext } from '../src/execution/broker-fill-lifecycle-router.js';

const hash='a'.repeat(64);
const base=():FillLifecycleContext=>({action:'OPEN_CSP',orderStatus:'FILLED',orderQuantity:2,chainId:'chain',decisionId:'decision',
  optionLegId:'leg',optionContractId:'contract',stockLotId:null,multiplier:100,entryCreditDebit:null,economicBasisPerShare:null,
  nextState:null,fills:[{providerFillId:'one',providerActivityRefHash:hash,quantity:1,pricePerShare:2,occurredAt:'2026-09-14T14:30:00Z',fees:null},
    {providerFillId:'two',providerActivityRefHash:'b'.repeat(64),quantity:1,pricePerShare:2.2,occurredAt:'2026-09-14T14:30:01Z',fees:null}]});

test('confirmed CSP fills produce multiplier-correct immutable opening economics',()=>{
  const result=routeConfirmedFillLifecycle(base());
  assert.equal(result.state,'CONFIRMED');
  assert.equal(result.application?.eventKind,'SHORT_PUT_OPEN');
  if(result.application?.eventKind==='SHORT_PUT_OPEN'){
    assert.equal(result.application.entryPricePerShare,2.1);
    assert.equal(result.application.entryCreditDebit,420);
  }
});

test('partial fills never advance lifecycle state',()=>{
  const value=base();
  const result=routeConfirmedFillLifecycle({...value,orderStatus:'PARTIAL',fills:value.fills.slice(0,1)});
  assert.deepEqual(result,{state:'PARTIAL',reasonCode:'ORDER_NOT_FULLY_FILLED',application:null});
});

test('terminal partial close records cumulative actual-fill economics and leaves the remainder open',()=>{
  const value=base();
  const first=value.fills[0],second=value.fills[1];
  assert.ok(first); assert.ok(second);
  const result=routeConfirmedFillLifecycle({...value,action:'CLOSE_CSP',orderStatus:'CANCELED',orderQuantity:3,
    orderIntentId:'intent',originalLegQuantity:3,priorPartialClosedQuantity:0,priorPartialRealizedOptionPnl:0,
    entryCreditDebit:600,nextState:'REDEPLOY',fills:[
      {...first,pricePerShare:2.4,fees:0.5},
      {...second,pricePerShare:2.6,fees:0.5},
    ]});
  assert.equal(result.state,'PARTIAL');
  assert.equal(result.reasonCode,'TERMINAL_PARTIAL_CLOSE_RECORDED');
  assert.equal(result.application?.eventKind,'OPTION_PARTIAL_CLOSE');
  if(result.application?.eventKind==='OPTION_PARTIAL_CLOSE'){
    assert.equal(result.application.closedQuantity,2);
    assert.equal(result.application.remainingQuantityAfter,1);
    assert.equal(result.application.allocatedOpeningCredit,400);
    assert.equal(result.application.closingDebit,500);
    assert.equal(result.application.realizedPnlBeforeFees,-100);
    assert.equal(result.application.realizedPnlAfterFees,-101);
  }
});

test('a later close of the remaining quantity includes prior partial realized economics exactly once',()=>{
  const value=base();
  const first=value.fills[0]; assert.ok(first);
  const result=routeConfirmedFillLifecycle({...value,action:'CLOSE_CSP',orderStatus:'FILLED',orderQuantity:1,
    originalLegQuantity:3,priorPartialClosedQuantity:2,priorPartialRealizedOptionPnl:-100,
    entryCreditDebit:600,nextState:'REDEPLOY',fills:[{...first,quantity:1,pricePerShare:1.5}]});
  assert.equal(result.application?.eventKind,'OPTION_CLOSE');
  if(result.application?.eventKind==='OPTION_CLOSE'){
    assert.equal(result.application.closedQuantity,1);
    assert.equal(result.application.realizedOptionPnl,-50);
  }
});

test('terminal partial roll close never authorizes a successor leg',()=>{
  const value=base();
  const close=routeConfirmedFillLifecycle({...value,action:'ROLL_CSP_CLOSE',orderStatus:'EXPIRED',orderQuantity:2,
    orderIntentId:'roll-close',originalLegQuantity:2,entryCreditDebit:400,nextState:'ROLL_DECISION',fills:value.fills.slice(0,1)});
  assert.equal(close.application?.eventKind,'OPTION_PARTIAL_CLOSE');
  const successor=routeConfirmedRollPair({legKind:'SHORT_PUT',chainId:'chain',decisionId:'decision',oldOptionLegId:'old',
    newOptionLegId:'new',newOptionContractId:'new-contract',multiplier:100,oldEntryCreditDebit:400,
    close:{orderStatus:'EXPIRED',orderQuantity:2,fills:value.fills.slice(0,1)},
    open:{orderStatus:'FILLED',orderQuantity:2,fills:value.fills}});
  assert.equal(successor.application,null);
  assert.equal(successor.state,'PARTIAL');
});

test('a confirmed roll close records the old loss without requiring an opening fill',()=>{
  const value=base();
  const result=routeConfirmedFillLifecycle({...value,action:'ROLL_CSP_CLOSE',entryCreditDebit:200,nextState:'ROLL_DECISION'});
  assert.equal(result.application?.eventKind,'OPTION_CLOSE');
  if(result.application?.eventKind==='OPTION_CLOSE'){
    assert.equal(result.application.realizedOptionPnl,-220);
    assert.equal(result.application.nextState,'ROLL_DECISION');
    assert.equal(result.application.occurredAt,value.fills[1]?.occurredAt);
  }
});

test('manual or unlinked activity stays unknown instead of receiving THETA attribution',()=>{
  const result=routeConfirmedFillLifecycle({...base(),optionLegId:null,optionContractId:null});
  assert.deepEqual(result,{state:'UNKNOWN',reasonCode:'LIFECYCLE_LINKAGE_INCOMPLETE',application:null});
});

test('roll is one atomic close-old plus open-new application and preserves the old loss',()=>{
  const closeFill={providerFillId:'close',providerActivityRefHash:'c'.repeat(64),quantity:1,pricePerShare:3,
    occurredAt:'2026-09-14T14:31:00Z',fees:null};
  const openFill={providerFillId:'open',providerActivityRefHash:'d'.repeat(64),quantity:1,pricePerShare:3.5,
    occurredAt:'2026-09-14T14:31:01Z',fees:null};
  const result=routeConfirmedRollPair({legKind:'SHORT_PUT',chainId:'chain',decisionId:'decision',oldOptionLegId:'old',
    newOptionLegId:'new',newOptionContractId:'new-contract',multiplier:100,oldEntryCreditDebit:200,
    close:{orderStatus:'FILLED',orderQuantity:1,fills:[closeFill]},open:{orderStatus:'FILLED',orderQuantity:1,fills:[openFill]}});
  assert.equal(result.application?.eventKind,'OPTION_ROLL');
  if(result.application?.eventKind==='OPTION_ROLL'){
    assert.equal(result.application.oldRealizedPnl,-100);
    assert.equal(result.application.newEntryCreditDebit,350);
  }
});
