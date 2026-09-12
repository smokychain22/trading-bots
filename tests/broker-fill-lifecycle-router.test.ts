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
