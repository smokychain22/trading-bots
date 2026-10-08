import assert from 'node:assert/strict';
import test from 'node:test';
import { executionOptionQuoteContractVersion, qualifyExecutionOptionQuote, type ExecutionOptionQuote } from '../src/execution/execution-option-quote.js';

const quote = (overrides: Partial<ExecutionOptionQuote> = {}): ExecutionOptionQuote => ({
  contractVersion: executionOptionQuoteContractVersion,
  contractId: 'AAPL261016P00200000', providerContractId: 'provider-contract',
  optionIdentity: { underlying:'AAPL', optionSymbol:'provider-contract', expiration:'2026-10-16', strike:200,
    optionType:'PUT', multiplier:100, contractTradable:true, exerciseStyle:'american', deliverableClassification:'STANDARD_EQUITY' },
  bid: 2.1, ask: 2.2, bidSize: 10, askSize: 20,
  providerTimestamp: '2026-09-14T14:30:08Z', receivedAtUtc: '2026-09-14T14:30:09Z',
  receivedAtMonotonic: 1000, sequence: 2, provider: 'SYNTHETIC_TEST',
  sourceSemantics: 'TRUSTED_TWO_SIDED_ORDER_PRICING', connectionState:'CONNECTED',
  subscriptionState:'ACTIVE', provenance: { authenticated:true,exactContractMapping:true,documentedForOrderPricing:true }, ...overrides,
});

test('provider-neutral quote qualifies only with fresh order-pricing semantics', () => {
  const result = qualifyExecutionOptionQuote({ quote: quote(), expectedContractId: 'AAPL261016P00200000',
    nowUtc: '2026-09-14T14:30:10Z', maximumAgeMs: 3000, previousSequence: 1, marketOpen: true });
  assert.equal(result.qualified, true);
  assert.equal(result.quoteAgeMs, 2000);
});

test('recorded, stale, closed, mismatched and out-of-order evidence fails closed', () => {
  const result = qualifyExecutionOptionQuote({ quote: quote({ contractId: 'WRONG', sequence: 1,
    sourceSemantics: 'SESSION_RECORDED_RESEARCH', providerTimestamp: '2026-09-14T14:00:00Z' }),
    expectedContractId: 'AAPL261016P00200000', nowUtc: '2026-09-14T14:30:10Z',
    maximumAgeMs: 3000, previousSequence: 1, marketOpen: false });
  for (const blocker of ['CONTRACT_IDENTITY_MISMATCH','QUOTE_STALE','MARKET_CLOSED',
    'ORDER_PRICING_SEMANTICS_NOT_PROVEN','QUOTE_OUT_OF_ORDER']) assert.ok(result.blockers.includes(blocker));
});

test('receipt time never substitutes for the provider observation timestamp', () => {
  const result = qualifyExecutionOptionQuote({ quote: quote({ providerTimestamp: null }),
    expectedContractId: 'AAPL261016P00200000', nowUtc: '2026-09-14T14:30:10Z',
    maximumAgeMs: 1500, marketOpen: true });
  assert.equal(result.qualified, false);
  assert.equal(result.quoteAgeMs, null);
  assert.ok(result.blockers.includes('PROVIDER_TIMESTAMP_REQUIRED'));
});

test('reconnect, subscription restore, or unproven provenance cannot qualify',()=>{
  const result=qualifyExecutionOptionQuote({quote:quote({connectionState:'RECONNECTING',subscriptionState:'RESTORING',
    provenance:{authenticated:true}}),expectedContractId:'AAPL261016P00200000',
    nowUtc:'2026-09-14T14:30:10Z',maximumAgeMs:3000,marketOpen:true});
  assert.ok(result.blockers.includes('QUOTE_CONNECTION_NOT_STABLE'));
  assert.ok(result.blockers.includes('QUOTE_SUBSCRIPTION_NOT_ACTIVE'));
  assert.ok(result.blockers.includes('QUOTE_PROVENANCE_NOT_PROVEN'));
});

test('Alpaca indicative quote qualifies only for the explicit master Paper use',()=>{
  const indicative=quote({provider:'ALPACA',source:'BROKER_INDICATIVE',sourceSemantics:'PAPER_INDICATIVE_REFERENCE',
    provenance:{authenticated:true,exactContractMapping:true,documentedForOrderPricing:false,feed:'INDICATIVE',paperOnly:true}});
  assert.equal(qualifyExecutionOptionQuote({quote:indicative,expectedContractId:'AAPL261016P00200000',nowUtc:'2026-09-14T14:30:10Z',
    maximumAgeMs:10_000,marketOpen:true,usage:'MASTER_PAPER'}).qualified,true);
  const live=qualifyExecutionOptionQuote({quote:indicative,expectedContractId:'AAPL261016P00200000',nowUtc:'2026-09-14T14:30:10Z',
    maximumAgeMs:10_000,marketOpen:true,usage:'LIVE'});
  assert.equal(live.qualified,false);
  assert.ok(live.blockers.includes('ORDER_PRICING_SEMANTICS_NOT_PROVEN'));
});

test('Paper indicative buy-to-close allows a zero bid only with fresh, exact, open-session ask evidence',()=>{
  const indicative=quote({provider:'ALPACA',source:'BROKER_INDICATIVE',sourceSemantics:'PAPER_INDICATIVE_REFERENCE',
    bid:0,ask:0.02,provenance:{authenticated:true,exactContractMapping:true,documentedForOrderPricing:false,
      feed:'INDICATIVE',paperOnly:true}});
  const input={quote:indicative,expectedContractId:'AAPL261016P00200000',nowUtc:'2026-09-14T14:30:10Z',
    maximumAgeMs:3000,marketOpen:true,usage:'MASTER_PAPER' as const,allowZeroBid:true};
  assert.equal(qualifyExecutionOptionQuote(input).qualified,true);
  assert.ok(qualifyExecutionOptionQuote({...input,allowZeroBid:false}).blockers.includes('TWO_SIDED_QUOTE_INVALID'));
  assert.ok(qualifyExecutionOptionQuote({...input,marketOpen:false}).blockers.includes('MARKET_CLOSED'));
  assert.ok(qualifyExecutionOptionQuote({...input,quote:{...indicative,providerTimestamp:null}})
    .blockers.includes('PROVIDER_TIMESTAMP_REQUIRED'));
  assert.ok(qualifyExecutionOptionQuote({...input,quote:{...indicative,ask:0}})
    .blockers.includes('TWO_SIDED_QUOTE_INVALID'));
  assert.ok(qualifyExecutionOptionQuote({...input,quote:{...indicative,contractId:'WRONG'}})
    .blockers.includes('CONTRACT_IDENTITY_MISMATCH'));
  assert.ok(qualifyExecutionOptionQuote({...input,quote:{...indicative,provenance:{...indicative.provenance,feed:'OPRA'}}})
    .blockers.includes('ORDER_PRICING_SEMANTICS_NOT_PROVEN'));
  assert.ok(qualifyExecutionOptionQuote({...input,quote:{...indicative,providerTimestamp:'2026-09-14T14:30:00Z'}})
    .blockers.includes('QUOTE_STALE'));
});

test('option identity, multiplier, tradability, exercise style and deliverable are independently fail closed',()=>{
  const expected={underlying:'AAPL',optionSymbol:'provider-contract',expiration:'2026-10-16',strike:200,
    optionType:'PUT' as const,multiplier:100};
  const assess=(overrides:Partial<NonNullable<ExecutionOptionQuote['optionIdentity']>>)=>qualifyExecutionOptionQuote({
    quote:quote({optionIdentity:{...(quote().optionIdentity as NonNullable<ExecutionOptionQuote['optionIdentity']>),...overrides}}),
    expectedContractId:'AAPL261016P00200000',expectedOptionIdentity:expected,
    nowUtc:'2026-09-14T14:30:10Z',maximumAgeMs:3000,marketOpen:true,
  });
  assert.ok(qualifyExecutionOptionQuote({quote:quote({optionIdentity:null}),expectedContractId:'AAPL261016P00200000',
    expectedOptionIdentity:expected,nowUtc:'2026-09-14T14:30:10Z',maximumAgeMs:3000,marketOpen:true})
    .blockers.includes('OPTION_CONTRACT_METADATA_REQUIRED'));
  assert.ok(assess({strike:201}).blockers.includes('OPTION_CONTRACT_IDENTITY_MISMATCH'));
  assert.ok(assess({multiplier:10}).blockers.includes('OPTION_MULTIPLIER_MISMATCH'));
  assert.ok(assess({contractTradable:false}).blockers.includes('OPTION_CONTRACT_NOT_TRADABLE'));
  assert.ok(assess({exerciseStyle:''}).blockers.includes('OPTION_EXERCISE_STYLE_UNKNOWN'));
  assert.ok(assess({deliverableClassification:'UNKNOWN'}).blockers.includes('OPTION_DELIVERABLE_UNVERIFIED'));
});
