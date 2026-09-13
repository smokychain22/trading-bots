import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptiveLimitPolicyVersion } from '../src/execution/adaptive-limit-policy.js';
import { executionOptionQuoteContractVersion } from '../src/execution/execution-option-quote.js';
import { PostgresExecutionEvidenceStore } from '../src/execution/postgres-execution-evidence-store.js';
import { transactionCostAnalysisVersion } from '../src/execution/transaction-cost-analysis.js';

test('execution price evidence is replay-idempotent by deterministic content hash',async()=>{
  const calls:Array<{text:string;values:unknown[]}>=[]; const pool={query:async(text:string,values:unknown[])=>{calls.push({text,values});return {}}};
  const store=new PostgresExecutionEvidenceStore(pool as never);
  const input={orderIntentId:'11111111-1111-4111-8111-111111111111',eventType:'INITIAL_LIMIT' as const,
    eventTime:'2026-09-14T14:00:00Z',quote:{contractVersion:executionOptionQuoteContractVersion,contractId:'c',
      providerContractId:'p',bid:1,ask:1.2,bidSize:null,askSize:null,providerTimestamp:null,
      receivedAtUtc:'2026-09-14T14:00:00Z',receivedAtMonotonic:1,sequence:null,provider:'TEST',
      sourceSemantics:'TRUSTED_TWO_SIDED_ORDER_PRICING' as const,connectionState:'CONNECTED' as const,
      subscriptionState:'ACTIVE' as const,provenance:{}},quoteAgeMs:0,
    pricing:{policyVersion:adaptiveLimitPolicyVersion,action:'PLACE' as const,limitPrice:1.2,mid:1.1,spread:.2,
      spreadPct:.2/1.1,microprice:null,reason:'INITIAL_FAVORABLE_LIMIT'},fillPrice:null,filledQuantity:null,
    attemptNo:1,reasonCode:'INITIAL_FAVORABLE_LIMIT'};
  const first=await store.recordPriceEvent(input),second=await store.recordPriceEvent(input);
  assert.equal(first,second); assert.match(first,/^[0-9a-f]{64}$/);
  assert.ok(calls[0]?.text.includes('ON CONFLICT(content_hash) DO NOTHING'));
});

test('TCA persistence preserves null fees and explicit unknown reasons',async()=>{
  let values:unknown[]=[]; const pool={query:async(_text:string,input:unknown[])=>{values=input;return {}}};
  const store=new PostgresExecutionEvidenceStore(pool as never);
  await store.recordTca('11111111-1111-4111-8111-111111111111','2026-09-14T14:01:00Z',{
    contractVersion:transactionCostAnalysisVersion,decisionMid:1.1,arrivalMid:1.1,fillPrice:null,
    spreadAtDecision:.2,spreadAtArrival:.2,spreadAtFill:null,limitAttempts:1,latencyMs:null,
    slippageDollars:null,slippageBps:null,spreadCapture:null,fees:null,estimatedMarketImpact:null,
    postFillMove:{'5s':null},quoteProvider:'TEST',quoteSemantics:'TRUSTED_TWO_SIDED_ORDER_PRICING',
    providerTimestamp:null,receivedAt:'2026-09-14T14:00:00Z',quoteAgeMs:0,
    unknownReasons:['FEES_UNKNOWN','NO_FILL']});
  assert.equal(values[14],null); assert.equal(values[22],JSON.stringify(['FEES_UNKNOWN','NO_FILL']));
});
