// Storage pressure semantics seen by writers: unknown is conservative, P0 operational truth is never gated.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BULK_WRITER_PRIORITIES, P0_OPERATIONAL_SCOPES, PostgresPressureProvider, StaticPressureProvider, gateWrite, interpretPressureRow, newRiskGateFor, unknownPressure } from '../src/storage/data-platform/pressure-state.js';

const GIB = 1024 ** 3;
const now = new Date('2026-10-05T14:00:00Z');
const row = (band: string, usedFraction: number, extra: Record<string, unknown> = {}) => ({ band, database_bytes: Math.round(usedFraction * 8 * GIB), plan_bytes: 8 * GIB, archive_queue_bytes: 0, archive_lag_sessions: 0, archive_backend_healthy: true, projected_sessions_to_critical: 50, evaluated_at: new Date(now.getTime() - 3_600_000).toISOString(), ...extra });

test('missing, stale and malformed rows are STORAGE_PRESSURE_UNKNOWN: research throttled, new risk restricted, management allowed', () => {
  const missing = interpretPressureRow(null, now);
  assert.deepEqual([missing.kind, (missing as { reason: string }).reason, missing.researchGate, missing.newRiskGate], ['UNKNOWN', 'MISSING', 'THROTTLE', 'RESTRICTED']);
  const stale = interpretPressureRow(row('NORMAL', 0.2, { evaluated_at: new Date(now.getTime() - 40 * 3_600_000).toISOString() }), now);
  assert.equal(stale.kind, 'UNKNOWN'); assert.equal(stale.newRiskGate, 'RESTRICTED');
  const veryStale = interpretPressureRow(row('NORMAL', 0.2, { evaluated_at: new Date(now.getTime() - 80 * 3_600_000).toISOString() }), now);
  assert.equal(veryStale.newRiskGate, 'LOCKED', 'unknown for days locks new risk');
  for (const bad of [row('WEIRD', 0.2), row('NORMAL', 0.2, { plan_bytes: 0 }), row('NORMAL', 0.2, { database_bytes: 'abc' }), row('NORMAL', 0.2, { evaluated_at: 'not a date' }), row('NORMAL', 0.2, { archive_backend_healthy: 'yes' }), row('NORMAL', 0.9)]) {
    const parsed = interpretPressureRow(bad, now);
    assert.equal(parsed.kind, 'UNKNOWN', JSON.stringify(bad));
    assert.equal((parsed as { reason: string }).reason, 'MALFORMED');
  }
  assert.equal(interpretPressureRow(row('NORMAL', 0.2, { evaluated_at: new Date(now.getTime() + 3_600_000).toISOString() }), now).kind, 'UNKNOWN', 'a future timestamp is not trusted');
});

test('each healthy band maps to the documented research and new-risk gates', () => {
  const cases: Array<[string, number, string, string]> = [['NORMAL', 0.2, 'ALLOW', 'OPEN'], ['ARCHIVE_PRESSURE', 0.45, 'ALLOW', 'OPEN'], ['RESEARCH_THROTTLED', 0.6, 'THROTTLE', 'OPEN'], ['NEW_RISK_RESTRICTED', 0.75, 'SKIP_LOW_PRIORITY', 'RESTRICTED'], ['STORAGE_CRITICAL', 0.9, 'SKIP_LOW_PRIORITY', 'LOCKED']];
  for (const [band, used, research, risk] of cases) {
    const snapshot = interpretPressureRow(row(band, used), now);
    assert.equal(snapshot.kind, 'KNOWN'); assert.equal(snapshot.researchGate, research, band); assert.equal(snapshot.newRiskGate, risk, band);
  }
});

test('archive backpressure degrades research even in NORMAL, and an unhealthy backend under pressure restricts new risk', () => {
  assert.equal(interpretPressureRow(row('NORMAL', 0.2, { archive_queue_bytes: 4 * GIB }), now).researchGate, 'THROTTLE');
  assert.equal(interpretPressureRow(row('NORMAL', 0.2, { archive_lag_sessions: 9 }), now).researchGate, 'THROTTLE');
  assert.equal(interpretPressureRow(row('NORMAL', 0.2, { projected_sessions_to_critical: 1 }), now).researchGate, 'THROTTLE');
  assert.equal(interpretPressureRow(row('RESEARCH_THROTTLED', 0.6, { archive_backend_healthy: false }), now).newRiskGate, 'RESTRICTED');
  assert.equal(interpretPressureRow(row('RESEARCH_THROTTLED', 0.6, { archive_lag_sessions: 9 }), now).researchGate, 'SKIP_LOW_PRIORITY');
});

test('P0 operational scopes are written in every state, including a dead governor, and never read the pressure state', async () => {
  let reads = 0;
  const counting = { read: async () => { reads += 1; return unknownPressure('READ_ERROR', null); } };
  const critical = new StaticPressureProvider(interpretPressureRow(row('STORAGE_CRITICAL', 0.95), now));
  for (const provider of [critical, counting, new StaticPressureProvider(unknownPressure('MISSING', null))]) {
    for (const scope of P0_OPERATIONAL_SCOPES) {
      // a caller can not demote an operational scope by claiming a research priority
      const gated = await gateWrite(provider, scope, 'P3_RAW_PROVIDER_PAYLOAD', now);
      assert.equal(gated.decision.allow, true, scope); assert.equal(gated.decision.disposition, 'WRITE'); assert.equal(gated.priority, 'P0_OPERATIONAL');
    }
  }
  assert.equal(reads, 0, 'P0 never touches the pressure state');
});

test('every bulk writer scope is gated per state; unregistered scopes default to P2 and can not claim P0', async () => {
  const at = (band: string, used: number) => new StaticPressureProvider(interpretPressureRow(row(band, used), now));
  const unknown = new StaticPressureProvider(unknownPressure('MISSING', null));
  for (const scope of Object.keys(BULK_WRITER_PRIORITIES)) {
    const priority = BULK_WRITER_PRIORITIES[scope];
    assert.equal((await gateWrite(at('NORMAL', 0.2), scope, undefined, now)).decision.disposition, 'WRITE', scope);
    const critical = (await gateWrite(at('STORAGE_CRITICAL', 0.9), scope, undefined, now)).decision;
    assert.equal(critical.allow, false, scope);
    const throttled = (await gateWrite(at('RESEARCH_THROTTLED', 0.6), scope, undefined, now)).decision;
    assert.equal(throttled.allow, priority === 'P1_SELECTED_AND_FINALIST_EVIDENCE', scope);
    const unk = (await gateWrite(unknown, scope, undefined, now)).decision;
    assert.equal(unk.allow, priority === 'P1_SELECTED_AND_FINALIST_EVIDENCE', `${scope} under unknown`);
  }
  const novel = await gateWrite(at('RESEARCH_THROTTLED', 0.6), 'brand-new-bulk-writer', 'P0_OPERATIONAL', now);
  assert.equal(novel.priority, 'P2_FULL_RESEARCH'); assert.equal(novel.decision.allow, false);
  assert.equal((await gateWrite(at('STORAGE_CRITICAL', 0.9), 'cycle-evidence-blob', undefined, now)).decision.record?.kind, 'EVIDENCE_SKIPPED_DUE_TO_STORAGE_PRESSURE');
});

test('new-risk gate follows the state, management is always allowed, and the unknown state restricts', async () => {
  assert.equal((await newRiskGateFor(new StaticPressureProvider(interpretPressureRow(row('NORMAL', 0.2), now)), now)).gate, 'OPEN');
  assert.equal((await newRiskGateFor(new StaticPressureProvider(interpretPressureRow(row('NEW_RISK_RESTRICTED', 0.75), now)), now)).gate, 'RESTRICTED');
  const locked = await newRiskGateFor(new StaticPressureProvider(interpretPressureRow(row('STORAGE_CRITICAL', 0.9), now)), now);
  assert.equal(locked.gate, 'LOCKED'); assert.equal(locked.managementAllowed, true);
  const unknown = await newRiskGateFor(new StaticPressureProvider(unknownPressure('MALFORMED', null)), now);
  assert.equal(unknown.gate, 'RESTRICTED'); assert.match(unknown.reason, /STORAGE_PRESSURE_UNKNOWN/);
});

test('the Postgres provider turns a missing table, a missing row and a connection error into UNKNOWN, never a throw, and caches briefly', async () => {
  const failing = new PostgresPressureProvider({ query: async () => { throw new Error('relation "dp.storage_pressure_state" does not exist'); } });
  assert.equal((await failing.read(now)).kind, 'UNKNOWN');
  const empty = new PostgresPressureProvider({ query: async () => ({ rows: [] }) });
  assert.equal(((await empty.read(now)) as { reason: string }).reason, 'MISSING');
  let calls = 0;
  const healthy = new PostgresPressureProvider({ query: async () => { calls += 1; return { rows: [row('NORMAL', 0.2)] }; } }, { cacheMs: 5_000 });
  assert.equal((await healthy.read(now)).kind, 'KNOWN'); await healthy.read(new Date(now.getTime() + 1_000));
  assert.equal(calls, 1); await healthy.read(new Date(now.getTime() + 6_000));
  assert.equal(calls, 2);
});

import { datasetRegistry } from '../src/storage/data-platform/dataset-registry.js';

test('the writer scope priorities agree with the governed dataset registry (one source of truth for what yields first)', () => {
  const scopeToDataset: Record<string, string> = { 'cycle-evidence-blob': 'cycle-evidence-blob', 'shadow-research-history': 'shadow-opportunity', 'command-5a-historical-marks': 'execution-observation',
    'optionomics-research-history': 'optionomics-feature', 'raw-provider-history': 'provider-request-history', 'chain-research-evidence': 'optionomics-raw-observation', 'pit-candidate-research': 'candidate-ordinary-rejected', 'pit-selected-finalist': 'candidate-hot-detail' };
  for (const [scope, dataset] of Object.entries(scopeToDataset)) {
    const policy = datasetRegistry.find((entry) => entry.id === dataset);
    assert.ok(policy !== undefined, dataset);
    assert.equal(BULK_WRITER_PRIORITIES[scope], policy.writePriority, `${scope} vs ${dataset}`);
  }
  for (const scope of Object.keys(BULK_WRITER_PRIORITIES)) assert.ok(scope in scopeToDataset || scope === 'canonical-candidate-research', `unmapped writer scope ${scope}`);
  assert.equal(BULK_WRITER_PRIORITIES['canonical-candidate-research'], 'P2_FULL_RESEARCH');
});
