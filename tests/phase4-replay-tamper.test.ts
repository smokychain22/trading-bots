// Phase 4: replay determinism and tamper resistance.
//  DETERMINISM: identical persisted inputs replay to an identical frontier (candidates, rejection reasons, AEGIS, sizing, final action, plan hash)
//  every time, regardless of object key order, process, locale or timezone.
//  TAMPER: every single leaf of a persisted T0 bundle is mutated one at a time. A mutation must either be REJECTED loudly (schema, input hash or
//  frontier hash) or be a field that provably does not influence the decision; the second set is a reviewed allowlist with a reason, so a new
//  silently-accepted field fails this test until someone classifies it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { buildT0ReplayBundle, replayFromT0Bundle, type T0ReplayBundle } from '../src/theta/t0-replay-bundle.js';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { decision, input } from './phase4-replay-tamper.helper.js';

const permuteKeys = (value: unknown, seed: number): unknown => {
  if (Array.isArray(value)) return value.map((item) => permuteKeys(item, seed));
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const rotated = [...entries.slice(seed % Math.max(1, entries.length)), ...entries.slice(0, seed % Math.max(1, entries.length))].reverse();
    return Object.fromEntries(rotated.map(([key, child]) => [key, permuteKeys(child, seed + 1)]));
  }
  return value;
};

test('DETERMINISM: 30 repeated builds and replays give a byte-identical decision (candidates, reasons, AEGIS, sizing, final action, hash)', () => {
  const first = decision(buildCanonicalStrategyFrontier(input));
  for (let run = 0; run < 30; run += 1) assert.equal(decision(buildCanonicalStrategyFrontier(input)), first, `build run ${run}`);
  const bundle = buildT0ReplayBundle(input);
  for (let run = 0; run < 30; run += 1) assert.equal(decision(replayFromT0Bundle(bundle)), first, `replay run ${run}`);
});

test('DETERMINISM: object key order of the persisted bundle does not change the replay (a database round trip may reorder keys)', () => {
  const bundle = buildT0ReplayBundle(input);
  const baseline = decision(replayFromT0Bundle(bundle));
  for (let seed = 1; seed <= 12; seed += 1) {
    const reordered = JSON.parse(JSON.stringify(permuteKeys(bundle, seed))) as T0ReplayBundle;
    assert.equal(decision(replayFromT0Bundle(reordered)), baseline, `key order seed ${seed}`);
  }
});

test('DETERMINISM: fresh processes under different locales and timezones replay to the same hash', () => {
  const script = `
    import('./tests/phase4-replay-tamper.helper.ts').then((m) => process.stdout.write(m.fingerprint()));`;
  const outputs = new Set<string>();
  for (const env of [{ TZ: 'UTC', LANG: 'en_US.UTF-8' }, { TZ: 'Asia/Karachi', LANG: 'de_DE.UTF-8' }, { TZ: 'America/Los_Angeles', LC_ALL: 'tr_TR.UTF-8' }]) {
    outputs.add(execFileSync(process.execPath, ['--import', 'tsx', '-e', script], { env: { ...process.env, ...env }, encoding: 'utf8', cwd: process.cwd() }).trim());
  }
  assert.equal(outputs.size, 1, `fingerprints differ across environments: ${[...outputs].join(' | ')}`);
});

/** every leaf path of a JSON value */
function leaves(value: unknown, path: (string | number)[] = [], out: (string | number)[][] = []): (string | number)[][] {
  if (Array.isArray(value)) value.forEach((item, index) => leaves(item, [...path, index], out));
  else if (value !== null && typeof value === 'object') for (const [key, child] of Object.entries(value as Record<string, unknown>)) leaves(child, [...path, key], out);
  else out.push(path);
  return out;
}
const read = (root: unknown, path: (string | number)[]): unknown => path.reduce<unknown>((node, key) => (node as Record<string | number, unknown>)[key], root);
const write = (root: unknown, path: (string | number)[], value: unknown): void => {
  const parent = path.slice(0, -1).reduce<unknown>((node, key) => (node as Record<string | number, unknown>)[key], root) as Record<string | number, unknown>;
  parent[path[path.length - 1] as string | number] = value;
};
const mutate = (value: unknown): unknown[] => {
  if (typeof value === 'number') return [value + 1, -value - 1];
  if (typeof value === 'string') return [`${value}x`, ''];
  if (typeof value === 'boolean') return [!value];
  return [0, 'tampered'];
};

test('TAMPER: every single persisted leaf is either rejected loudly when changed, or is a reviewed non-decision field', () => {
  const bundle = JSON.parse(JSON.stringify(buildT0ReplayBundle(input))) as T0ReplayBundle;
  const baseline = decision(replayFromT0Bundle(bundle));
  const silent = new Map<string, string>();
  let rejected = 0, mutations = 0;
  for (const path of leaves(bundle)) {
    const original = read(bundle, path);
    for (const candidate of mutate(original)) {
      const copy = JSON.parse(JSON.stringify(bundle)) as T0ReplayBundle;
      write(copy, path, candidate);
      mutations += 1;
      try {
        if (decision(replayFromT0Bundle(copy)) === baseline) silent.set(path.join('.'), `${JSON.stringify(original)} -> ${JSON.stringify(candidate)}`);
        else silent.set(`DIFFERENT_DECISION_ACCEPTED:${path.join('.')}`, `${JSON.stringify(original)} -> ${JSON.stringify(candidate)}`);
      } catch { rejected += 1; }
    }
  }
  assert.ok(mutations > 300 && rejected > 0.5 * mutations, `the sweep must be substantial: ${mutations} mutations, ${rejected} rejected`);
  // No mutation may produce a DIFFERENT decision without being rejected: that would be tampering that changes behavior silently.
  assert.deepEqual([...silent.keys()].filter((key) => key.startsWith('DIFFERENT_DECISION_ACCEPTED:')), [], 'tampering changed the decision without being rejected');
  // Leaves that are accepted with an IDENTICAL decision do not influence the frontier. Each family is reviewed here; a new family fails the test.
  const families = new Set([...silent.keys()].map((key) => key.replace(/\.\d+\./g, '.*.').replace(/\.[^.]*$/, (tail) => (/^\.(\d+)$/.test(tail) ? '.*' : tail))));
  console.log(`tamper sweep: ${mutations} mutations, ${rejected} rejected, ${silent.size} accepted-with-identical-decision leaves in ${families.size} families:\n  ${[...families].sort().join('\n  ')}`);
  const reviewed = new Set<string>(REVIEWED_NON_DECISION_FAMILIES);
  const unreviewed = [...families].filter((family) => !reviewed.has(family));
  assert.deepEqual(unreviewed, [], `silently accepted persisted fields that are not in the reviewed list: ${unreviewed.join(', ')}`);
});

/** persisted fields whose change (alone) does not alter the frontier decision; reviewed 2026-10-03 */
const REVIEWED_NON_DECISION_FAMILIES: readonly string[] = [];
