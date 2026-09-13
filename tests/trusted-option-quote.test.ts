import assert from 'node:assert/strict';
import test from 'node:test';
import { assessTrustedOptionQuote, type TrustedOptionQuoteCandidate } from '../src/execution/trusted-option-quote.js';

const NOW = '2026-09-13T14:30:10.000Z';

const optionomicsQuote = (overrides: Partial<TrustedOptionQuoteCandidate> = {}): TrustedOptionQuoteCandidate => ({
  provider: 'OPTIONOMICS',
  operationAlias: 'documented-option-quote',
  contractSymbol: 'AAPL261016P00200000',
  expectedContractSymbol: 'AAPL261016P00200000',
  bid: 2.1,
  ask: 2.2,
  providerTimestamp: '2026-09-13T14:30:07.000Z',
  ingestionTimestamp: '2026-09-13T14:30:08.000Z',
  asOf: '2026-09-13T14:30:07.000Z',
  maximumAgeMs: 5_000,
  units: 'USD_PER_SHARE',
  schemaVersion: 'optionomics.quote.v1',
  responseHash: 'sha256:test-only',
  quality: 'GOOD',
  provenance: {
    documentedTwoSidedQuoteContract: true,
    documentedForOrderPricing: true,
    feed: 'UNKNOWN',
    consolidatedNbboClaimProven: false,
  },
  ...overrides,
});

test('qualifies a proven fresh Optionomics two-sided quote without calling it NBBO', () => {
  const result = assessTrustedOptionQuote(optionomicsQuote(), NOW);
  assert.deepEqual(result, { ready: true, authority: 'OPTIONOMICS_TRUSTED_TWO_SIDED_QUOTE', blockers: [] });
});

test('does not upgrade an undocumented Optionomics chain quote', () => {
  const candidate = optionomicsQuote({
    provenance: {
      documentedTwoSidedQuoteContract: false,
      documentedForOrderPricing: false,
      feed: 'UNKNOWN',
      consolidatedNbboClaimProven: false,
    },
  });
  const result = assessTrustedOptionQuote(candidate, NOW);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('TWO_SIDED_QUOTE_CONTRACT_NOT_DOCUMENTED'));
  assert.ok(result.blockers.includes('ORDER_PRICING_USE_NOT_DOCUMENTED'));
});

test('rejects stale, crossed, mismatched, indicative, or unknown quote evidence', () => {
  const result = assessTrustedOptionQuote(optionomicsQuote({
    contractSymbol: 'AAPL261016P00195000',
    bid: 2.3,
    ask: 2.2,
    asOf: '2026-09-13T14:29:00.000Z',
    quality: 'DEGRADED',
    provenance: {
      documentedTwoSidedQuoteContract: true,
      documentedForOrderPricing: true,
      feed: 'INDICATIVE',
      consolidatedNbboClaimProven: false,
    },
  }), NOW);
  assert.equal(result.ready, false);
  assert.equal(result.authority, null);
  assert.ok(result.blockers.includes('CONTRACT_IDENTITY_MISMATCH'));
  assert.ok(result.blockers.includes('QUOTE_CROSSED'));
  assert.ok(result.blockers.includes('QUOTE_QUALITY_DEGRADED'));
  assert.ok(result.blockers.includes('QUOTE_STALE'));
  assert.ok(result.blockers.includes('INDICATIVE_QUOTE_FORBIDDEN'));
});

test('Alpaca still requires proven OPRA consolidated evidence', () => {
  const result = assessTrustedOptionQuote(optionomicsQuote({
    provider: 'ALPACA',
    provenance: {
      documentedTwoSidedQuoteContract: true,
      documentedForOrderPricing: true,
      feed: 'INDICATIVE',
      consolidatedNbboClaimProven: false,
    },
  }), NOW);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('ALPACA_OPRA_REQUIRED'));
  assert.ok(result.blockers.includes('CONSOLIDATED_NBBO_NOT_PROVEN'));
});
