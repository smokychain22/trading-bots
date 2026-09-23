import assert from 'node:assert/strict';
import test from 'node:test';
import { assessAlpacaContractIvStress, compareIvStressSignals, parseAlpacaContractIvHistoryRow,
  paperBootstrapAlpacaContractIvPolicy, verifyPersistedAlpacaContractIvAssessment,
  type AlpacaContractIvHistoryRow } from '../src/theta/aegis-alpaca-iv-stress.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';

const decisionAsOf = '2026-09-23T14:00:03.000Z';
function current(overrides: Partial<NormalizedOptionContract> = {}): NormalizedOptionContract {
  const contract = normalizeOptionContract({
    source: 'ALPACA', underlying: 'SPY', optionSymbol: 'SPY261016P00520000', occSymbol: 'SPY261016P00520000',
    optionType: 'PUT', strike: 520, expiration: '2026-10-16', asOfDate: '2026-09-23', multiplier: 100,
    underlyingBid: 550, underlyingAsk: 550.02, underlyingLast: 550.01,
    underlyingTimestamp: '2026-09-23T13:59:50.000Z', bid: 0.95, ask: 1.05,
    underlyingQuoteReceivedAt: '2026-09-23T14:00:01.000Z', underlyingQuoteSource: 'ALPACA_IEX',
    bidSize: 10, askSize: 10, lastTradePrice: null, lastTradeSize: null,
    quoteTimestamp: '2026-09-23T13:59:55.000Z', tradeTimestamp: null,
    volume: null, volumeSource: null, openInterest: null, openInterestSource: null,
    iv: 0.25, delta: -0.2, gamma: 0.01, theta: -0.02, vega: 0.05, rho: null,
    greeksTimestamp: '2026-09-23T14:00:00.000Z', greeksSource: 'ALPACA',
    feed: 'INDICATIVE', dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 30,
    maxSpreadPctForExecutable: 0.5,
  }, '2026-09-23T14:00:00.000Z');
  return { ...contract, ...overrides };
}
function history(sessions = 20): AlpacaContractIvHistoryRow[] {
  return Array.from({ length: sessions }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return {
      evidenceId: `candidate-${index}`, sourceHash: index.toString(16).padStart(64, '0'),
      underlying: 'SPY', optionType: 'PUT', optionSymbol: 'SPY261016P00520000',
      dte: 30, moneyness: 0.057, iv: 0.18 + (index % 5) * 0.01,
      feed: 'INDICATIVE', quoteTimestamp: `2026-09-${day}T13:59:55.000Z`,
      ivAvailableAt: `2026-09-${day}T14:00:00.000Z`, decisionTime: `2026-09-${day}T14:00:03.000Z`,
    };
  });
}
function assess(contract = current(), rows: AlpacaContractIvHistoryRow[] = history()) {
  return assessAlpacaContractIvStress({ current: contract, history: rows, decisionAsOf,
    policy: paperBootstrapAlpacaContractIvPolicy });
}

test('twenty independent same-cohort sessions yield a contract-IV shock with receipt-time authority', () => {
  const result = assess();
  assert.equal(result.maturity.state, 'DETECTOR_READY');
  assert.equal(result.maturity.evidence.rawN, 20);
  assert.equal(result.maturity.evidence.sessionN, 20);
  assert.equal(result.maturity.evidence.effectiveN, 20);
  assert.equal(result.currentTimingAuthority, 'ALPACA_SNAPSHOT_IV_AVAILABLE_AT_RECEIPT');
  assert.equal(result.currentIvProviderTimestamp, null);
  assert.equal(result.stressIvShockDetected, true);
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
});
test('many contracts in one session do not manufacture twenty independent sessions', () => {
  const rows = history(1).flatMap((row, index) => Array.from({ length: 40 }, (_, ordinal) => ({
    ...row, evidenceId: `candidate-${index}-${ordinal}`, sourceHash: ordinal.toString(16).padStart(64, '0'),
    optionSymbol: `SPY261016P${String((520 + ordinal) * 1000).padStart(8, '0')}`,
  })));
  const result = assess(current(), rows);
  assert.equal(result.maturity.evidence.rawN, 40);
  assert.equal(result.maturity.evidence.sessionN, 1);
  assert.equal(result.sessionReferences[0]?.lineageSampleTruncated, true);
  assert.equal(result.sessionReferences[0]?.sourceHashes.length, 8);
  assert.match(String(result.sessionReferences[0]?.sourceHashSetHash), /^[a-f0-9]{64}$/);
  assert.equal(result.maturity.state, 'BASELINE_ACCUMULATING');
  assert.equal(result.stressIvShockDetected, null);
});
test('repeat scans of one contract contribute only one IV to a session median', () => {
  const rows = history(1).flatMap((row) => [row, { ...row, evidenceId: 'later-revision',
    sourceHash: 'f'.repeat(64), iv: 0.5, ivAvailableAt: '2026-09-01T14:00:02.000Z',
    decisionTime: '2026-09-01T14:00:04.000Z' }]);
  const result = assess(current(), rows);
  assert.equal(result.sessionReferences[0]?.rawContractN, 1);
  assert.equal(result.sessionReferences[0]?.sessionMedianIv, 0.5);
});
test('same session, other feed, DTE, and moneyness cannot enter the baseline', () => {
  const rows = history();
  const altered = [rows[0] && { ...rows[0], feed: 'OPRA' as const },
    rows[1] && { ...rows[1], dte: 5 }, rows[2] && { ...rows[2], moneyness: 0.2 },
    rows[3] && { ...rows[3], quoteTimestamp: '2026-09-23T13:59:00.000Z' }]
    .filter((row): row is AlpacaContractIvHistoryRow => row !== undefined);
  const result = assess(current(), [...rows.slice(4), ...altered]);
  assert.equal(result.maturity.evidence.sessionN, 16);
  assert.equal(result.maturity.state, 'BASELINE_ACCUMULATING');
  assert.equal(assess(current({ feed: 'OPRA' }), rows).maturity.state, 'BASELINE_NOT_STARTED');
});
test('stale/future BBO and fallback Optionomics IV cannot qualify current authority', () => {
  for (const contract of [current({ quoteTimestamp: '2026-09-23T13:00:00.000Z' }),
    current({ receivedAt: '2026-09-23T14:00:04.000Z' }),
    current({ underlyingQuoteSource: null }), current({ underlyingQuoteReceivedAt: null }),
    current({ underlyingTimestamp: '2026-09-23T13:00:00.000Z' }),
    current({ greeksSource: 'OPTIONOMICS' }), current({ iv: null }), current({ iv: Number.NaN })]) {
    const result = assess(contract);
    assert.notEqual(result.currentState, 'QUALIFIED');
    assert.equal(result.stressIvShockDetected, null);
  }
});
test('explicit flat baseline uses versioned zero-MAD absolute/relative fallback', () => {
  const result = assess(current(), history().map((row) => ({ ...row, iv: 0.18 })));
  assert.equal(result.maturity.state, 'DETECTOR_READY');
  assert.equal(result.dispersionState, 'MAD_ZERO');
  assert.equal(result.robustZ, null);
  assert.equal(result.stressIvShockDetected, true);
});
test('provider RFC3339 nanosecond timestamps remain valid without claiming IV-specific provider as-of', () => {
  const result = assess(current({ quoteTimestamp: '2026-09-23T13:59:55.123456789Z' }));
  assert.equal(result.currentState, 'QUALIFIED');
  assert.equal(result.currentIvProviderTimestamp, null);
});
test('legacy IV without explicit Alpaca source is excluded, never inferred from quote source', () => {
  const raw = { candidate_id: 'candidate-id', decision_time: '2026-09-01T14:00:03.000Z',
    content_hash: 'a'.repeat(64), contract_json: { underlying: 'SPY', contractSymbol: 'SPY261016P00520000',
      optionType: 'PUT', strike: 520, expiration: '2026-10-16', dte: 30, moneyness: 0.057 },
    market_json: { feed: 'INDICATIVE', dataQuality: 'GOOD', quoteSource: 'ALPACA',
      quoteTimestamp: '2026-09-01T13:59:55.000Z', quoteReceivedAt: '2026-09-01T14:00:00.000Z',
      underlyingQuoteSource: 'ALPACA_IEX', underlyingQuoteTimestamp: '2026-09-01T13:59:50.000Z',
      underlyingQuoteReceivedAt: '2026-09-01T14:00:01.000Z', underlyingReferencePrice: 549.64 },
    volatility_json: { iv: 0.2 } };
  assert.equal(parseAlpacaContractIvHistoryRow(raw), null);
  assert.equal(parseAlpacaContractIvHistoryRow({ ...raw, volatility_json: {
    iv: 0.2, ivSource: 'ALPACA', ivEvidenceAuthority: 'ALPACA_OPTION_SNAPSHOT_CONTRACT_IV',
    ivFeed: 'INDICATIVE', ivAvailableAt: '2026-09-01T14:00:00.000Z', ivProviderTimestamp: null,
  } })?.iv, 0.2);
});
test('Paper authority requires the committed exact-contract assessment and intact hash', async () => {
  const assessment = assess();
  let persisted: unknown = assessment;
  const pool = { query: async () => ({ rows: [{ assessment: persisted }] }) };
  const input = { pool: pool as never, fusionSnapshotId: '00000000-0000-4000-8000-000000000001',
    optionSymbol: current().optionSymbol, underlying: 'SPY', decisionAsOf };
  assert.equal((await verifyPersistedAlpacaContractIvAssessment(input)).ready, true);
  assert.equal((await verifyPersistedAlpacaContractIvAssessment({ ...input, optionSymbol: 'SPY261016P00510000' })).ready, false);
  persisted = { ...assessment, currentIv: 0.01 };
  assert.equal((await verifyPersistedAlpacaContractIvAssessment(input)).reason, 'PERSISTED_ALPACA_IV_HASH_MISMATCH');
  persisted = null;
  assert.equal((await verifyPersistedAlpacaContractIvAssessment(input)).ready, false);
});

test('governed cold start requires a real prior session, fresh current IV, and durable evidence', async () => {
  let persisted: unknown = assess(current(), history(1));
  const pool = { query: async () => ({ rows: [{ assessment: persisted }] }) };
  const input = { pool: pool as never, fusionSnapshotId: '00000000-0000-4000-8000-000000000001',
    optionSymbol: current().optionSymbol, underlying: 'SPY', decisionAsOf };
  assert.equal((await verifyPersistedAlpacaContractIvAssessment(input)).reason,
    'PERSISTED_ALPACA_IV_GOVERNED_COLD_START');
  persisted = assess(current(), []);
  assert.equal((await verifyPersistedAlpacaContractIvAssessment(input)).ready, false);
  persisted = assess(current({ quoteTimestamp: '2026-09-23T13:00:00.000Z' }), history(1));
  assert.equal((await verifyPersistedAlpacaContractIvAssessment(input)).ready, false);
});

test('Optionomics ATM IV remains a separate descriptive comparator, never a fallback Paper authority', () => {
  const alpaca = assess();
  assert.equal(compareIvStressSignals({ alpacaByContract: { [alpaca.optionSymbol]: alpaca },
    optionomics: { stressIvShockDetected: false } })[alpaca.optionSymbol], 'ALPACA_ONLY');
  assert.equal(compareIvStressSignals({ alpacaByContract: { [alpaca.optionSymbol]: alpaca },
    optionomics: null })[alpaca.optionSymbol], 'ONE_UNAVAILABLE');
});
