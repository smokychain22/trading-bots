import assert from 'node:assert/strict';
import test from 'node:test';
import { executionOptionQuoteContractVersion, qualifyExecutionOptionQuote, type ExecutionOptionQuote } from '../src/execution/execution-option-quote.js';

const quote = (overrides: Partial<ExecutionOptionQuote> = {}): ExecutionOptionQuote => ({
  contractVersion: executionOptionQuoteContractVersion,
  contractId: 'AAPL261016P00200000', providerContractId: 'provider-contract',
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

test('receipt time is an explicit fallback only when provider timestamp is absent', () => {
  const result = qualifyExecutionOptionQuote({ quote: quote({ providerTimestamp: null }),
    expectedContractId: 'AAPL261016P00200000', nowUtc: '2026-09-14T14:30:10Z',
    maximumAgeMs: 1500, marketOpen: true });
  assert.equal(result.qualified, true);
  assert.equal(result.quoteAgeMs, 1000);
});

test('reconnect, subscription restore, or unproven provenance cannot qualify',()=>{
  const result=qualifyExecutionOptionQuote({quote:quote({connectionState:'RECONNECTING',subscriptionState:'RESTORING',
    provenance:{authenticated:true}}),expectedContractId:'AAPL261016P00200000',
    nowUtc:'2026-09-14T14:30:10Z',maximumAgeMs:3000,marketOpen:true});
  assert.ok(result.blockers.includes('QUOTE_CONNECTION_NOT_STABLE'));
  assert.ok(result.blockers.includes('QUOTE_SUBSCRIPTION_NOT_ACTIVE'));
  assert.ok(result.blockers.includes('QUOTE_PROVENANCE_NOT_PROVEN'));
});
