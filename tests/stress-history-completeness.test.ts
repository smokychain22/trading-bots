import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { assessAegisSpreadStress, loadAegisSpreadHistoryWithCompleteness, paperBootstrapAegisSpreadStressPolicy } from '../src/theta/aegis-spread-stress.js';
import { loadAlpacaContractIvHistory } from '../src/theta/aegis-alpaca-iv-stress.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import { boundStressHistory, stressHistoryNotSupplied, stressHistoryRowLimit } from '../src/theta/stress-history-completeness.js';
import { candidateStressAegisOverrides } from '../src/theta/theta-shadow-cycle.js';

const iso = (index: number): string => new Date(Date.UTC(2026, 8, 1) + index * 60_000).toISOString();
const rowsOf = (count: number) => Array.from({ length: count }, (_, i) => ({ at: iso(count - i) })); // newest first

test('history bound: 0, 1, 4999, 5000 are complete within the query contract; 5001 is detected as truncated and capped at the limit', () => {
  assert.equal(stressHistoryRowLimit, 5000);
  for (const count of [0, 1, 4999, 5000]) {
    const bounded = boundStressHistory(rowsOf(count), (row) => row.at);
    assert.equal(bounded.completeness.state, 'COMPLETE_WITHIN_QUERY_CONTRACT', String(count));
    assert.equal(bounded.completeness.rowCountUsed, count);
    assert.equal(bounded.rows.length, count);
  }
  const truncated = boundStressHistory(rowsOf(5001), (row) => row.at);
  assert.equal(truncated.completeness.state, 'TRUNCATED_BOUNDED_HISTORY');
  assert.equal(truncated.completeness.rowCountUsed, 5000, 'the probe row is never used');
  assert.equal(truncated.rows.length, 5000);
  assert.equal(truncated.completeness.rowLimit, 5000);
  const empty = boundStressHistory(rowsOf(0), (row) => row.at);
  assert.equal(empty.completeness.oldestObservationAt, null);
  assert.equal(empty.completeness.newestObservationAt, null);
  assert.ok(Date.parse(truncated.completeness.oldestObservationAt as string) < Date.parse(truncated.completeness.newestObservationAt as string));
  assert.throws(() => boundStressHistory([], (row: { at: string }) => row.at, 0), /STRESS_HISTORY_ROW_LIMIT_INVALID/);
});

test('caller-supplied history without a completeness record is UNKNOWN completeness, never "complete"', () => {
  assert.equal(stressHistoryNotSupplied.state, 'NOT_SUPPLIED_BY_CALLER');
  assert.equal(stressHistoryNotSupplied.rowCountUsed, null);
});

const fakePool = (rows: readonly Record<string, unknown>[]) => {
  const queries: string[] = [];
  const pool = { query: async (sql: string) => { queries.push(sql); return { rows, rowCount: rows.length }; } } as unknown as Pool;
  return { pool, queries };
};

test('both loaders probe with LIMIT 5001 and report truncation exactly at the boundary', async () => {
  for (const [count, expected] of [[5000, 'COMPLETE_WITHIN_QUERY_CONTRACT'], [5001, 'TRUNCATED_BOUNDED_HISTORY']] as const) {
    const spreadRows = Array.from({ length: count }, (_, i) => ({ candidate_id: String(i), contract_symbol: 'SPY261120P00600000', dte: 30, moneyness: 0.9,
      relative_spread: 0.05, provider_timestamp: iso(count - i), ingestion_timestamp: iso(count - i), decision_time: iso(count - i),
      source: 'ALPACA', feed: 'OPRA', data_quality: 'GOOD', quote_content_hash: `h${i}` }));
    const spread = fakePool(spreadRows);
    const loadedSpread = await loadAegisSpreadHistoryWithCompleteness({ pool: spread.pool, underlying: 'SPY', optionType: 'PUT',
      decisionAsOf: '2026-10-01T15:00:00.000Z', lookbackDays: 120 });
    assert.match(spread.queries[0] as string, /LIMIT 5001/);
    assert.equal(loadedSpread.completeness.state, expected);
    assert.equal(loadedSpread.rows.length, Math.min(count, 5000));

    const ivRows = Array.from({ length: count }, (_, i) => ({ candidate_id: String(i), decision_time: iso(count - i), content_hash: 'x', contract_json: {}, market_json: {}, volatility_json: {} }));
    const iv = fakePool(ivRows);
    const loadedIv = await loadAlpacaContractIvHistory({ pool: iv.pool, underlying: 'SPY', decisionAsOf: '2026-10-01T15:00:00.000Z', lookbackDays: 30 });
    assert.match(iv.queries[0] as string, /LIMIT 5001/);
    assert.equal(loadedIv.historyCompleteness.state, expected);
    assert.equal(loadedIv.scannedN, Math.min(count, 5000));
  }
});

const NOW = '2026-10-01T15:00:00.000Z';
const contract = normalizeOptionContract({
  source: 'ALPACA', underlying: 'SPY', optionSymbol: 'SPY261120P00600000', occSymbol: 'SPY261120P00600000', optionType: 'PUT', strike: 600,
  expiration: '2026-11-20', asOfDate: '2026-10-01', multiplier: 100, underlyingBid: 699.9, underlyingAsk: 700.1, underlyingLast: 700, underlyingTimestamp: NOW,
  bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1, quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250,
  volumeSource: 'ALPACA', openInterest: 1200, openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03,
  greeksTimestamp: NOW, greeksSource: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2,
}, NOW);
const priorRow = { evidenceId: 'prior-1', underlying: 'SPY', optionType: 'PUT' as const, contractSymbol: contract.optionSymbol, dte: contract.dte,
  moneyness: contract.moneyness, relativeSpread: 0.05, providerTimestamp: '2026-09-29T15:00:00.000Z', ingestionTimestamp: '2026-09-29T15:00:01.000Z',
  decisionTime: '2026-09-29T15:00:02.000Z', source: 'ALPACA' as const, feed: 'OPRA' as const, dataQuality: 'GOOD' as const };

test('the assessment records completeness, its hash covers it, and a truncated read withholds the Paper cold-start exception (fail closed)', () => {
  const policy = paperBootstrapAegisSpreadStressPolicy;
  const complete = assessAegisSpreadStress({ current: contract, history: [priorRow], decisionAsOf: NOW, policy,
    historyCompleteness: { state: 'COMPLETE_WITHIN_QUERY_CONTRACT', rowCountUsed: 1, rowLimit: 5000, oldestObservationAt: priorRow.decisionTime, newestObservationAt: priorRow.decisionTime } });
  const truncated = assessAegisSpreadStress({ current: contract, history: [priorRow], decisionAsOf: NOW, policy,
    historyCompleteness: { state: 'TRUNCATED_BOUNDED_HISTORY', rowCountUsed: 5000, rowLimit: 5000, oldestObservationAt: priorRow.decisionTime, newestObservationAt: priorRow.decisionTime } });
  const unsupplied = assessAegisSpreadStress({ current: contract, history: [priorRow], decisionAsOf: NOW, policy });
  assert.equal(complete.historyCompleteness.state, 'COMPLETE_WITHIN_QUERY_CONTRACT');
  assert.equal(truncated.historyCompleteness.state, 'TRUNCATED_BOUNDED_HISTORY');
  assert.equal(unsupplied.historyCompleteness.state, 'NOT_SUPPLIED_BY_CALLER');
  assert.notEqual(complete.contentHash, truncated.contentHash, 'truncation changes the immutable assessment identity');
  assert.equal(complete.maturity.state, 'BASELINE_ACCUMULATING');
  assert.equal(candidateStressAegisOverrides({ spread: complete, alpacaIv: undefined, alpacaIvProducerConfigured: false }).stressSpreadWideningApplicability,
    'PAPER_COLD_START_NOT_APPLICABLE');
  assert.equal(candidateStressAegisOverrides({ spread: truncated, alpacaIv: undefined, alpacaIvProducerConfigured: false }).stressSpreadWideningApplicability,
    'REQUIRED', 'artificial immaturity from a truncated read must not loosen AEGIS');
  assert.equal(candidateStressAegisOverrides({ spread: truncated, alpacaIv: undefined, alpacaIvProducerConfigured: false }).stressSpreadWideningDetected, null,
    'the unknown stays unknown');
});
