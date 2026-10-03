// Phase 4: deterministic identity. The same economic intent always gets the same ids (also after a restart), and two different economic
// intents never share one, even when a field contains the separator character.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { economicIdentitySeed, generateClientOrderId } from '../src/theta/order-intent-state.js';
import { assembleMasterPaperExecutionCommand } from '../src/execution/master-paper-command-assembly.js';

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('the old colon-joined aliasing is closed: shifting the boundary between fields changes the identity', () => {
  assert.notEqual(generateClientOrderId('a:b', 'c', 1), generateClientOrderId('a', 'b:c', 1));
  const first = economicIdentitySeed({ candidateId: 'X:Y', strategyVersion: 'Z', action: 'OPEN_CSP', chainId: 'c1' });
  const second = economicIdentitySeed({ candidateId: 'X', strategyVersion: 'Y:Z', action: 'OPEN_CSP', chainId: 'c1' });
  assert.notEqual(first, second);
  assert.notEqual(generateClientOrderId('d', first, 1), generateClientOrderId('d', second, 1));
});

test('no collisions across 20,000 random tuples whose fields freely contain the separator', () => {
  const next = prng(20261004);
  const alphabet = ['a', 'b', 'c', ':', '"', '\\', '[', ',', '0', '1'];
  const text = (): string => Array.from({ length: 1 + Math.floor(next() * 6) }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
  const tuples = new Map<string, string>();
  for (let index = 0; index < 20_000; index += 1) {
    const decisionId = text(), candidateId = text(), attempt = 1 + Math.floor(next() * 5);
    const key = JSON.stringify([decisionId, candidateId, attempt]);
    const id = generateClientOrderId(decisionId, candidateId, attempt);
    const prior = tuples.get(id);
    assert.ok(prior === undefined || prior === key, `collision: ${prior} vs ${key}`);
    tuples.set(id, key);
  }
});

test('the id is stable (a restart recomputes exactly the same id) and sensitive to every identifying field', () => {
  const base = { candidateId: 'THETA_CONVENTIONAL:SPY261016P00680000', strategyVersion: 'theta-q-v1', action: 'OPEN_CSP', chainId: 'chain-1' };
  const id = (parts: typeof base, decision = 'decision-1', attempt = 1) => generateClientOrderId(decision, economicIdentitySeed(parts), attempt);
  assert.equal(id(base), id({ ...base }));
  const variants = [id({ ...base, candidateId: 'THETA_CONVENTIONAL:SPY261016P00679000' }), id({ ...base, strategyVersion: 'theta-q-v2' }),
    id({ ...base, action: 'OPEN_CC' }), id({ ...base, chainId: 'chain-2' }), id(base, 'decision-2'), id(base, 'decision-1', 2)];
  assert.equal(new Set([id(base), ...variants]).size, variants.length + 1);
  assert.match(id(base), /^theta-[0-9a-f]{32}$/);
});

test('attempt must be an explicit positive integer', () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => generateClientOrderId('d', 'c', bad), /attempt must be a positive integer/);
});

test('every site that mints or re-verifies a client order id uses the one shared seed derivation', () => {
  for (const file of ['src/execution/master-paper-command-assembly.ts', 'src/execution/postgres-first-canary-acceptance.ts']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /economicIdentitySeed\(/, file);
    assert.equal(/\$\{[^}]*candidateId[^}]*\}:\$\{[^}]*strategyVersion/.test(source), false, `${file} still builds the seed by string concatenation`);
  }
  assert.equal(typeof assembleMasterPaperExecutionCommand, 'function');
});
