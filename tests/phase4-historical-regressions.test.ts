// Phase 4: regressions for historical incidents that previously had no deterministic test (see docs/operations/THETA_HISTORICAL_REGRESSION_MATRIX.json).
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { PostgresWorkerRuntimeStore } from '../src/worker/postgres-worker-runtime-store.js';
import { upsertVersion } from '../src/research/master-shadow-context.js';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { mergeOptionChain } from '../src/theta/option-chain-ingestion.js';
import { input as frontierInput } from './phase4-replay-tamper.helper.js';

// ---- incident 6: worker heartbeat failure -----------------------------------------------------------------------------------------------
// A worker whose lease expired (or was taken by another worker) must LEARN it: heartbeat() reports false, never a silent success.
test('HEARTBEAT: a worker that no longer holds an unexpired lease is told so (false); a holder renews (true)', async () => {
  const statements: string[] = [];
  const makePool = (leaseRows: number): Pool => ({ query: async (sql: string) => { statements.push(sql); return { rowCount: sql.includes('runtime_worker_lease') ? leaseRows : 1, rows: [] }; } }) as unknown as Pool;
  const lost = await new PostgresWorkerRuntimeStore(makePool(0)).heartbeat('worker-a', '2026-10-03T10:00:00.000Z', '2026-10-03T10:06:00.000Z', 'MASTER_PAPER_NEW_RISK_LOCKED');
  assert.equal(lost, false, 'an expired or stolen lease must not report a successful heartbeat');
  assert.ok(!statements.some((sql) => sql.includes('runtime_worker_status')), 'a lost lease must not refresh the status row as healthy');
  statements.length = 0;
  const held = await new PostgresWorkerRuntimeStore(makePool(1)).heartbeat('worker-a', '2026-10-03T10:00:00.000Z', '2026-10-03T10:06:00.000Z', 'MASTER_PAPER_NEW_RISK_LOCKED');
  assert.equal(held, true);
  assert.ok(statements.some((sql) => /expires_at\s*>\s*\$3/.test(sql)), 'the renewal must require the lease to be unexpired at the heartbeat time');
});

test('HEARTBEAT: acquiring a lease held by another unexpired owner is HELD_BY_OTHER (no takeover)', async () => {
  const pool = { query: async (sql: string) => (sql.startsWith('SELECT') ? { rowCount: 1, rows: [{ worker_id: 'worker-b', expired: false }] } : { rowCount: 0, rows: [] }) } as unknown as Pool;
  assert.equal(await new PostgresWorkerRuntimeStore(pool).acquireLease('worker-a', '2026-10-03T10:00:00.000Z', '2026-10-03T10:06:00.000Z'), 'HELD_BY_OTHER');
});

// ---- incident 12: strategy version hash mismatch -----------------------------------------------------------------------------------------
// A persisted immutable version row whose config hash differs from the current source payload must stop the cycle with a typed code.
test('STRATEGY VERSION: a persisted config hash that differs from the source payload throws SHADOW_CONTEXT_VERSION_HASH_MISMATCH; an unresolved row throws UNRESOLVED; a match returns the id', async () => {
  const payload = { rule: 'a' };
  const client = (row: Record<string, unknown> | undefined) => ({ query: async () => ({ rows: row === undefined ? [] : [row] }) }) as never;
  const args = { table: 'strategy_version' as const, idColumn: 'strategy_version_id', semanticVersion: 'theta-conventional@9.9.9', jsonColumn: 'definition_json', payload };
  await assert.rejects(upsertVersion(client({ id: 'v1', config_hash: 'f'.repeat(64) }), args), /^Error: SHADOW_CONTEXT_VERSION_HASH_MISMATCH:theta-conventional@9\.9\.9$/);
  await assert.rejects(upsertVersion(client(undefined), args), /SHADOW_CONTEXT_VERSION_UNRESOLVED:theta-conventional@9\.9\.9/);
  let captured = '';
  const matching = { query: async (_sql: string, parameters: unknown[]) => { captured = String(parameters[3]); return { rows: [{ id: 'v1', config_hash: captured }] }; } } as never;
  assert.equal(await upsertVersion(matching, args), 'v1');
  assert.match(captured, /^[0-9a-f]{64}$/);
});

// ---- incident 11: false contract UNKNOWN -----------------------------------------------------------------------------------------------------
// A contract with a complete provider snapshot must come out with KNOWN quote, Greeks and volume, never UNKNOWN or degraded by the merge.
test('FALSE UNKNOWN: 200 contracts with complete snapshots are all known, GOOD and executable; a contract with NO snapshot is fully UNKNOWN (the opposite direction)', () => {
  const NOW = '2026-09-10T15:00:00.000Z';
  const symbols = Array.from({ length: 200 }, (_, index) => `SPY261009P${String((400 + index) * 1000).padStart(8, '0')}`);
  const contracts = symbols.map((symbol, index) => ({ symbol, strikePrice: 400 + index, expirationDate: '2026-10-09', optionType: 'PUT' as const, multiplier: 100 }));
  const snapshots = new Map(symbols.map((symbol) => [symbol, { bid: 1.1, ask: 1.2, bidSize: 10, askSize: 10, quoteTimestamp: NOW,
    greeks: { delta: -0.2, gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03 }, impliedVolatility: 0.28, dailyVolume: 25 }]));
  const merged = mergeOptionChain({ underlying: 'SPY', asOfDate: '2026-09-10', contracts, snapshotsBySymbol: snapshots as never, optionomicsBySymbol: new Map(), requestedFeed: 'INDICATIVE',
    defaultMultiplierForUnknownContracts: 100, receivedAt: NOW, maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.5 });
  assert.equal(merged.length, 200);
  for (const contract of merged) {
    assert.ok(contract.bid !== null && contract.ask !== null && contract.delta !== null && contract.iv !== null && contract.volume !== null, `${contract.optionSymbol}: a known field was lost in the merge`);
    assert.equal(contract.dataQuality, 'GOOD'); assert.equal(contract.executable, true);
  }
  const [bare] = mergeOptionChain({ underlying: 'SPY', asOfDate: '2026-09-10', contracts: contracts.slice(0, 1), snapshotsBySymbol: new Map(), optionomicsBySymbol: new Map(), requestedFeed: 'INDICATIVE',
    defaultMultiplierForUnknownContracts: 100, receivedAt: NOW, maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.5 });
  assert.ok(bare !== undefined && bare.bid === null && bare.delta === null && bare.volume === null && bare.executable === false, 'no snapshot: UNKNOWN, never zero');
});

// ---- incident 19: AEGIS cross-candidate contamination -----------------------------------------------------------------------------------
// One candidate's AEGIS state must apply to that candidate only: a veto on one contract must not change any other candidate's state or size.
test('AEGIS ISOLATION: a HARD_VETO on one candidate leaves every other candidate state and quantity exactly as in the baseline, regardless of input order', () => {
  const unassessed = buildCanonicalStrategyFrontier(frontierInput);
  const allIds = unassessed.branches.flatMap((branch) => branch.candidates).map((candidate) => candidate.candidateId);
  const allowAll = Object.fromEntries(allIds.map((id) => [id, 'ALLOW_FULL' as const]));
  const baseline = buildCanonicalStrategyFrontier({ ...frontierInput, aegisNewRiskStateByCandidateId: allowAll });
  const candidates = (frontier: typeof baseline) => frontier.branches.flatMap((branch) => branch.candidates);
  const targetId = candidates(baseline).find((candidate) => candidate.candidateId.includes('00190000'))?.candidateId as string;
  assert.ok(targetId, 'the fixture must contain the 190 strike');
  const vetoed = buildCanonicalStrategyFrontier({ ...frontierInput, aegisNewRiskStateByCandidateId: { ...allowAll, [targetId]: 'HARD_VETO' } });
  const reordered = buildCanonicalStrategyFrontier({ ...frontierInput, contracts: [...frontierInput.contracts].reverse(), aegisNewRiskStateByCandidateId: { ...allowAll, [targetId]: 'HARD_VETO' } });
  const view = (frontier: typeof baseline) => new Map(candidates(frontier).map((candidate) => [candidate.candidateId, [candidate.aegisState, candidate.sizing.quantity, candidate.hardBlockers.join('|')]]));
  const before = view(baseline), after = view(vetoed), afterReordered = view(reordered);
  const target = candidates(vetoed).find((candidate) => candidate.candidateId === targetId);
  assert.equal(target?.aegisState, 'HARD_VETO', 'the targeted candidate carries the veto');
  assert.equal(target?.sizing.quantity, 0, 'a vetoed candidate is sized to zero');
  for (const [id, value] of before) if (id !== targetId) assert.deepEqual(after.get(id), value, `candidate ${id} was contaminated by another candidate's veto`);
  assert.deepEqual([...afterReordered].sort(), [...after].sort(), 'input order must not change any candidate outcome');
});
