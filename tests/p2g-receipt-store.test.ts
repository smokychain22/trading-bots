import assert from 'node:assert/strict';
import test from 'node:test';
import {buildPaperOrderPreview} from '../src/execution/paper-order-preview.js';
import {assessProviderPayload} from '../src/providers/provider-family-health.js';
import {persistPaperOrderPreview,persistProviderFamilyHealth,persistSyntheticLifecycleReceipt} from '../src/research/p2g-receipt-store.js';
import {canonicalFullChainScenario,simulateLifecycle} from '../src/theta/p2g-lifecycle-simulator.js';
test('P2G persistence targets only isolated immutable research receipt tables',async()=>{
  const calls:{text:string;values:unknown[]}[]=[];const db={query:async(text:string,values:unknown[])=>{calls.push({text,values});return {rows:[],rowCount:1};}};
  const lifecycle=simulateLifecycle(canonicalFullChainScenario());
  await persistSyntheticLifecycleReceipt(db as never,lifecycle,'2026-09-16T15:00:00Z');
  const preview=buildPaperOrderPreview({previewId:'blocked',asOf:'2026-09-16T15:00:00Z',strategyBranch:'THETA_CONVENTIONAL',strategyVersion:'v1',legs:[],
    orderType:'LIMIT',limitPrice:null,quoteProvider:null,quoteSemantics:'UNKNOWN',quoteObservedAt:null,quoteAgeMs:null,maximumQuoteAgeMs:10000,
    bid:null,ask:null,creditDebit:null,maximumRisk:null,buyingPowerEffect:null,capitalRequired:null,aegisResult:'HOLD_ONLY',portfolioEffects:{},
    operatorPaused:true,emergencyLocked:false,executionQuoteQualified:false,persistenceReady:true,idempotencyReady:false,clientOrderId:null});
  await persistPaperOrderPreview(db as never,preview);
  const health=assessProviderPayload({family:'CHAIN',documented:true,endpointVerified:false,implemented:true,authBlocked:true,httpStatus:401,
    contentType:'application/json',payload:{error:'unauthorized'},requiredFields:['contracts'],providerTimestamp:null,receivedAt:'2026-09-16T15:00:00Z',maximumAgeMs:10000});
  await persistProviderFamilyHealth(db as never,health,'2026-09-16T15:00:00Z');
  assert.equal(calls.length,3);const first=calls.at(0),second=calls.at(1),third=calls.at(2);assert.ok(first);assert.ok(second);assert.ok(third);
  assert.match(first.text,/theta_synthetic_lifecycle_receipt/);
  assert.match(second.text,/theta_paper_order_preview_receipt/);assert.match(third.text,/optionomics_family_health_observation/);
  assert.ok(calls.every((call)=>!call.text.includes('trade.broker_order')&&!call.text.includes('trade.fill')));
});
