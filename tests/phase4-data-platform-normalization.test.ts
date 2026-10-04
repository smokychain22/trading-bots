// Normalization: shared decision context stored once, candidate information-value tiers with a verifiable complete-list hash, content-addressed payloads with
// separate payload and observation identity. All exact and deterministic.
import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson } from '../src/storage/data-platform/archive-manifest.js';
import { candidateListHash, classifyCandidates, defaultTieringPolicy, reasonCode, splitHotCandidates, type BranchTieringContext, type TierableCandidate } from '../src/storage/data-platform/candidate-tiering.js';
import { denormalizeDecision, normalizeDecision, verifyNormalization } from '../src/storage/data-platform/decision-context.js';
import { payloadIdentity, PayloadLedger } from '../src/storage/data-platform/payload-store.js';
import { mulberry32 } from './helpers/data-platform-model.js';

const big = (seed: string, bytes: number): Record<string, unknown> => ({ seed, text: seed.repeat(Math.ceil(bytes / seed.length)).slice(0, bytes), nested: { list: [1, 2, 3], flag: true } });

function candidateRows(count: number): Record<string, unknown>[] {
  const event = big('event', 4000), portfolio = big('portfolio', 1500), provenance = big('provenance', 3000), account = big('account', 600);
  return Array.from({ length: count }, (_, index) => ({
    candidate_id: `c-${index}`, strike: 400 + index, rank: index % 7,
    event_json: event, portfolio_json: portfolio, provider_provenance_json: provenance, account_json: account,
    volatility_json: big(`vol-${index % 4}`, 2500),          // varies but repeats (4 distinct values)
    execution_json: big(`exec-${index}`, 900),               // unique per candidate
    small_json: { a: index },                               // below the reference threshold
  }));
}

test('decision context: shared large JSON is stored once, varying-but-repeating values go to a dictionary, unique and small values stay inline; reconstruction is exact', () => {
  const rows = candidateRows(120);
  const normalized = normalizeDecision(rows);
  assert.deepEqual([...normalized.stats.sharedFields], ['account_json', 'event_json', 'portfolio_json', 'provider_provenance_json']);
  assert.equal(normalized.stats.dictionaryEntries, 4, 'four distinct volatility values stored once each');
  assert.equal(Object.keys(normalized.context).length, 4);
  assert.ok(normalized.stats.normalizedBytes < 0.4 * normalized.stats.originalBytes, `${normalized.stats.normalizedBytes}/${normalized.stats.originalBytes}`);
  assert.equal(verifyNormalization(rows, normalized), true);
  assert.ok(normalized.rows.every((row) => 'execution_json' in row.inline && 'small_json' in row.inline && !('event_json' in row.inline)));
  assert.match(normalized.contextHash, /^[0-9a-f]{64}$/);
  // the context hash is a function of the shared content only
  assert.equal(normalizeDecision(candidateRows(40)).contextHash, normalized.contextHash);
  const changed = candidateRows(120).map((row) => ({ ...row, event_json: big('event-2', 4000) }));
  assert.notEqual(normalizeDecision(changed).contextHash, normalized.contextHash);
});

test('PROPERTY: normalization is lossless for random rows (random subsets of shared, repeated, unique, missing and nested fields)', () => {
  const rng = mulberry32(8201);
  for (let round = 0; round < 150; round += 1) {
    const shared = big(`s${round}`, 200 + Math.floor(rng() * 800));
    const pool = Array.from({ length: 1 + Math.floor(rng() * 4) }, (_, index) => big(`p${round}-${index}`, 150 + Math.floor(rng() * 400)));
    const rows = Array.from({ length: 1 + Math.floor(rng() * 30) }, (_, index) => {
      const row: Record<string, unknown> = { id: `r${index}`, n: Math.floor(rng() * 1000), maybe: rng() < 0.3 ? null : rng() < 0.5 ? 'x' : [1, { z: 2 }] };
      if (rng() < 0.9) row.shared = shared;
      if (rng() < 0.8) row.pooled = pool[Math.floor(rng() * pool.length)];
      if (rng() < 0.5) row.unique = big(`u${round}-${index}`, 180 + Math.floor(rng() * 200));
      return row;
    });
    const normalized = normalizeDecision(rows);
    assert.equal(verifyNormalization(rows, normalized), true, `round ${round}`);
    assert.deepEqual(denormalizeDecision(normalized).map((row) => canonicalJson(row)), rows.map((row) => canonicalJson(row)));
  }
});

test('decision context edge cases: a single candidate has no shared context, an empty decision is valid, a missing dictionary entry fails loudly', () => {
  assert.equal(normalizeDecision([{ a: big('a', 500) }]).stats.sharedFields.length, 0);
  assert.deepEqual(normalizeDecision([]).rows, []);
  const normalized = normalizeDecision(candidateRows(5));
  assert.throws(() => denormalizeDecision({ ...normalized, dictionary: {} }), /DECISION_CONTEXT_DICTIONARY_MISSING/);
});

// ---- tiering ----------------------------------------------------------------------------------------------------------------------------------------

function chain(count: number, rng: () => number): { candidates: TierableCandidate[]; context: BranchTieringContext[]; selected: string } {
  const candidates: TierableCandidate[] = Array.from({ length: count }, (_, index) => {
    const blockers: string[] = [];
    const roll = rng();
    if (roll < 0.55) blockers.push('QUOTE_STALE: quote older than 30s');
    if (roll < 0.35) blockers.push('SPREAD_TOO_WIDE: 0.31 > 0.10');
    if (roll < 0.2) blockers.push('DELTA_OUT_OF_BAND: -0.41');
    if (roll > 0.995) blockers.push('CONTRACT_IDENTITY_INVALID: strike disagrees with OCC symbol');
    return { candidateId: `THETA_CONVENTIONAL:SPY261120P${String(index).padStart(8, '0')}`, branch: 'THETA_CONVENTIONAL', hardBlockers: blockers, paretoRank: blockers.length === 0 ? 1 + Math.floor(rng() * 6) : null,
      legs: [{ strike: 400 + index, bid: 1, ask: 1.1 }], economics: { pad: 'e'.repeat(400) } };
  });
  const feasible = candidates.filter((candidate) => candidate.hardBlockers.length === 0);
  const best = feasible[0]?.candidateId ?? null;
  return { candidates, context: [{ branch: 'THETA_CONVENTIONAL', bestCandidateId: best, secondBestCandidateId: feasible[1]?.candidateId ?? null, bestRejectedCandidateId: candidates.find((candidate) => candidate.hardBlockers.length > 0)?.candidateId ?? null }], selected: best ?? '' };
}

test('tiering: a 2,619-contract chain keeps a handful of hot candidates; counts are exact, the selected candidate is always hot, anomalies are always hot, nothing is dropped from the complete list hash', () => {
  const { candidates, context, selected } = chain(2619, mulberry32(8202));
  const tiers = classifyCandidates(candidates, context, selected);
  const counts: Record<string, number> = {};
  for (const tier of tiers.values()) counts[tier] = (counts[tier] ?? 0) + 1;
  assert.equal(tiers.size, 2619);
  assert.equal(counts.SELECTED, 1);
  assert.ok((counts.FINALIST ?? 0) <= defaultTieringPolicy.maxFinalistsPerBranch);
  assert.ok((counts.NEAR_BOUNDARY ?? 0) <= defaultTieringPolicy.nearBoundaryPerBranch);
  const anomalies = candidates.filter((candidate) => candidate.hardBlockers.some((blocker) => /INVALID/.test(blocker))).length;
  assert.equal(counts.ANOMALY ?? 0, anomalies);
  assert.ok(anomalies > 0, 'the fixture contains anomalies');
  assert.equal(tiers.get(selected), 'SELECTED');
  const split = splitHotCandidates(candidates, context, selected);
  assert.equal(split.histogram.totalCandidates, 2619);
  assert.equal(Object.values(split.histogram.tierCounts).reduce((a, b) => a + b, 0), 2619);
  assert.equal(split.hot.length, 2619 - (counts.ORDINARY_REJECTED ?? 0));
  assert.ok(split.hotBytes < 0.1 * split.fullBytes, `hot ${split.hotBytes} of ${split.fullBytes}`);
  assert.equal(split.histogram.candidateListHash, candidateListHash(candidates), 'the complete list verifies against its hash');
  assert.equal(split.histogram.reasonCounts.QUOTE_STALE, candidates.filter((candidate) => candidate.hardBlockers.some((blocker) => blocker.startsWith('QUOTE_STALE'))).length);
  // altering ANY single candidate changes the list hash, so the archive rows are verifiable against the hot histogram
  const mutated = candidates.map((candidate, index) => (index === 1700 ? { ...candidate, economics: { pad: 'x' } } : candidate));
  assert.notEqual(candidateListHash(mutated), split.histogram.candidateListHash);
  assert.notEqual(candidateListHash(candidates.slice(0, -1)), split.histogram.candidateListHash);
});

test('tiering is deterministic under any input order and reasons are stable codes', () => {
  const { candidates, context, selected } = chain(500, mulberry32(8203));
  const base = classifyCandidates(candidates, context, selected);
  const rng = mulberry32(8204);
  for (let round = 0; round < 20; round += 1) {
    const shuffled = [...candidates].sort(() => rng() - 0.5);
    const again = classifyCandidates(shuffled, context, selected);
    for (const [id, tier] of base) assert.equal(again.get(id), tier);
    assert.equal(candidateListHash(shuffled), candidateListHash(candidates));
  }
  assert.equal(reasonCode('SPREAD_TOO_WIDE: 0.31 > 0.10'), 'SPREAD_TOO_WIDE');
  assert.equal(reasonCode('lowercase text blocker'), 'lowercase text blocker');
  assert.equal(classifyCandidates([], [], null).size, 0);
});

// ---- payload store ----------------------------------------------------------------------------------------------------------------------------------

test('payload identity versus observation identity: identical bytes observed twice are one blob and two observations with their own times; different bytes are different blobs', () => {
  const ledger = new PayloadLedger();
  const payload = Buffer.from(JSON.stringify({ chain: 'x'.repeat(5000) }));
  const base = { kind: 'OPTIONOMICS_RAW', provider: 'OPTIONOMICS', requestHash: 'r'.repeat(64), status: 'OK', latencyMs: 120 };
  const first = ledger.record({ ...base, observationId: 'o1', observedAt: '2026-10-05T14:00:00Z', sessionDate: '2026-10-05' }, payload);
  const second = ledger.record({ ...base, observationId: 'o2', observedAt: '2026-10-05T14:03:00Z', sessionDate: '2026-10-05' }, payload);
  const third = ledger.record({ ...base, observationId: 'o3', observedAt: '2026-10-05T14:06:00Z', sessionDate: '2026-10-05' }, Buffer.from('different'));
  assert.equal(first.blobStored, true); assert.equal(second.blobStored, false); assert.equal(third.blobStored, true);
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(ledger.blobs.size, 2);
  assert.equal(ledger.observations.length, 3);
  assert.deepEqual(ledger.observations.map((observation) => observation.observedAt), ['2026-10-05T14:00:00Z', '2026-10-05T14:03:00Z', '2026-10-05T14:06:00Z'], 'time is preserved per observation');
  assert.deepEqual(ledger.read('o2'), Uint8Array.from(payload));
  assert.equal(ledger.read('missing'), null);
  assert.ok(ledger.storedBytes < ledger.observedBytes, 'duplicate payload bytes are not stored twice');
  // the same bytes in a different retention partition are stored again (each partition retires independently)
  assert.equal(ledger.record({ ...base, observationId: 'o4', observedAt: '2026-10-06T14:00:00Z', sessionDate: '2026-10-06' }, payload).blobStored, true);
  assert.equal(payloadIdentity(payload), first.contentHash);
});
