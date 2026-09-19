import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRecoveryHistory } from '../src/theta/recovery-history-loader.js';

test('recovery history uses label availability cutoff and preserves empty history as unknown', async () => {
  let sql = '';
  let params: readonly unknown[] = [];
  const pool = { query: async (statement:string, values:readonly unknown[]) => {
    sql = statement; params = values;
    return { rows:[{median_days:null,p95_days:null,episode_count:0}] };
  } };
  const result = await loadRecoveryHistory(pool as never, 'SPY', '2026-09-18T14:30:00.000Z');
  assert.match(sql, /label_available_at <= \$1/);
  assert.deepEqual(params, ['2026-09-18T14:30:00.000Z', 'SPY']);
  assert.equal(result.historicalRecoveryMedianDays, null);
  assert.equal(result.historicalRecoveryP95Days, null);
  assert.equal(result.resolvedRecoveryEpisodeCount, 0);
});

test('recovery history returns resolved PIT percentiles without inventing severe-drawdown labels', async () => {
  const pool = { query: async () => ({ rows:[{median_days:'11.5',p95_days:'43',episode_count:8}] }) };
  const result = await loadRecoveryHistory(pool as never, 'SPY', '2026-09-18T14:30:00.000Z');
  assert.equal(result.historicalRecoveryMedianDays, 11.5);
  assert.equal(result.historicalRecoveryP95Days, 43);
  assert.equal(result.resolvedRecoveryEpisodeCount, 8);
});
