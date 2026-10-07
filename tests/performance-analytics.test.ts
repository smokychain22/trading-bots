import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPerformanceDashboard, profitabilityStatus, type PerformanceEpisode } from '../src/research/performance-analytics-dashboard.js';
import { loadPerformanceEpisodes, performanceEpisodeFromRow, performanceEpisodeSql } from '../src/research/postgres-performance-source.js';

const ep = (i: number, pnl: number | null, over: Partial<PerformanceEpisode> = {}): PerformanceEpisode => ({
  episodeId: `e${i}`, strategy: 'THETA_CONVENTIONAL', strategyVersion: 'v1', regime: 'MODERATE_UP', openedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
  closedAt: new Date(Date.UTC(2026, 0, 11 + i)).toISOString(), netPnlUsd: pnl, grossPnlUsd: pnl === null ? null : pnl + 1, feesUsd: 1, slippageUsd: 2,
  capitalRequiredUsd: 5000, capitalDays: 50_000, assigned: false, calledAway: null, evidenceSource: 'BROKER_CONFIRMED_FILLS', ...over,
});

test('dashboard row: win rate, avg win/loss, expectancy, PF, drawdown, ES, ROC, capital-day return, hold, slippage', () => {
  const d = buildPerformanceDashboard([ep(1, 50), ep(2, 40), ep(3, -200), ep(4, 60)]);
  const row = d.rows[0];
  assert.equal(row?.n, 4);
  assert.deepEqual([row?.wins, row?.losses, row?.winRate], [3, 1, 0.75]);
  assert.equal(row?.averageWin, 50);
  assert.equal(row?.averageLoss, -200);
  assert.equal(row?.expectancy, -12.5, 'a 75% win rate with one large loss has negative expectancy');
  assert.equal(row?.profitFactor, 150 / 200);
  assert.equal(row?.maxDrawdown, -200);
  assert.equal(row?.returnOnCapital, -50 / 20000);
  assert.equal(row?.averageHoldDays, 10);
  assert.equal(row?.slippageUsd, 8);
  assert.equal(row?.profitabilityStatus, 'NOT_YET_PROVEN');
});

test('profitability is NOT_YET_PROVEN below the evidence threshold; replay evidence never proves it', () => {
  const many = Array.from({ length: 60 }, (_, i) => ep(i, 20 + (i % 3)));
  assert.equal(profitabilityStatus(many.slice(0, 49)).status, 'NOT_YET_PROVEN');
  assert.equal(profitabilityStatus(many).status, 'PROVEN_POSITIVE_EXPECTANCY');
  assert.equal(profitabilityStatus(many.map((e) => ({ ...e, evidenceSource: 'HISTORICAL_REPLAY_MODELED' as const }))).status, 'RESEARCH_EVIDENCE_ONLY');
  assert.equal(profitabilityStatus(Array.from({ length: 60 }, (_, i) => ep(i, i % 2 === 0 ? 100 : -100))).status, 'NOT_YET_PROVEN');
});

test('groups by strategy, version and regime; unknown regime is kept, open episodes are not counted as resolved', () => {
  const d = buildPerformanceDashboard([ep(1, 10), ep(2, 10, { regime: null }), ep(3, null, { closedAt: null }), ep(4, 5, { strategy: 'THETA_HOLD_STRIKE' })]);
  assert.deepEqual(d.rows.map((r) => [r.strategy, r.regime, r.n, r.resolved]), [
    ['THETA_CONVENTIONAL', 'MODERATE_UP', 2, 1], ['THETA_CONVENTIONAL', 'UNKNOWN_REGIME', 1, 1], ['THETA_HOLD_STRIKE', 'MODERATE_UP', 1, 1]]);
});

test('ledger row mapping never fabricates P&L for unresolved or fee-unknown chains; loader is read-only', async () => {
  const base = { episode_id: 'c1', chain_kind: 'WHEEL', opened_at: '2026-10-01T14:00:00Z', closed_at: '2026-10-11T14:00:00Z', strategy: 'THETA_CONVENTIONAL',
    strategy_version: 'v', option_pnl: '28', stock_pnl: '0', dividends: '0', fees: '0', fees_known: true, legs_resolved: true, lots_resolved: true,
    assigned: false, collateral: '5700' };
  const ok = performanceEpisodeFromRow(base);
  assert.deepEqual([ok.netPnlUsd, ok.capitalDays, ok.evidenceSource], [28, 57_000, 'BROKER_CONFIRMED_FILLS']);
  assert.equal(performanceEpisodeFromRow({ ...base, fees_known: false }).netPnlUsd, null);
  assert.equal(performanceEpisodeFromRow({ ...base, legs_resolved: false }).closedAt, null);
  assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i.test(performanceEpisodeSql));
  const statements: string[] = [];
  const pool = { connect: async () => ({ query: async (sql: string) => { statements.push(sql.trim().split(/\s+/).slice(0, 3).join(' ')); return { rows: [base] }; },
    release: () => undefined }) } as unknown as import('pg').Pool;
  const rows = await loadPerformanceEpisodes(pool, '2026-09-01T00:00:00Z');
  assert.equal(rows.length, 1);
  assert.deepEqual(statements, ['BEGIN TRANSACTION READ', 'SELECT ec.chain_id::text AS', 'COMMIT']);
});
