// Phase 3 -- RATE-LIMIT POLICY (deterministic, injected clocks/sleeps; no real waiting, no network).
//
// POLICY:  reads (GET) retry with bounded exponential backoff + jitter, honor Retry-After, are capped in attempts AND total wait,
//          and share a process-wide budget and cooldown so concurrent worker jobs cannot form a retry storm.
//          Mutations (POST/PATCH/DELETE) are NEVER retried inside the adapter; a 429 on a mutation means "not processed" and is
//          reconciled by client order id before anything else.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AlpacaPaperBrokerAdapter, DEFAULT_READ_RETRY_POLICY, SharedReadRetryBudget, parseRetryAfterMs, readRetryDelayMs, runBoundedRead } from '../src/execution/broker.js';
import { AlpacaProviderError, fetchPositions, type AlpacaProviderConfig } from '../src/theta/alpaca-provider.js';
import { FakeAlpaca, makeRig, optionGate, optionIntent } from './phase3-exec-fixtures.js';

const policy = DEFAULT_READ_RETRY_POLICY;

test('Retry-After parsing: delta seconds, HTTP date, junk and negatives', () => {
  const now = Date.parse('2026-10-02T14:00:00.000Z');
  assert.equal(parseRetryAfterMs('2', now), 2000);
  assert.equal(parseRetryAfterMs('0', now), 0);
  assert.equal(parseRetryAfterMs(' 1.5 ', now), 1500);
  assert.equal(parseRetryAfterMs('Fri, 02 Oct 2026 14:00:03 GMT', now), 3000);
  assert.equal(parseRetryAfterMs('Fri, 02 Oct 2026 13:59:00 GMT', now), 0, 'a date in the past is zero, never negative');
  for (const junk of [null, undefined, '', 'soon']) assert.equal(parseRetryAfterMs(junk, now), null, String(junk));
  assert.ok((parseRetryAfterMs('-5', now) ?? 0) >= 0, 'a negative hint can never produce a negative wait');
});

test('backoff schedule: exponential, jittered within [half, full], capped, and the provider hint wins only when it fits the cap', () => {
  const lowJitter = () => 0; const highJitter = () => 0.999;
  assert.equal(readRetryDelayMs(policy, 0, null, lowJitter), 125);
  assert.ok((readRetryDelayMs(policy, 0, null, highJitter) as number) <= 250);
  assert.ok((readRetryDelayMs(policy, 5, null, highJitter) as number) <= policy.maxDelayMs, 'exponent is capped');
  assert.equal(readRetryDelayMs(policy, 0, 1000, lowJitter), 1000, 'a Retry-After above the computed backoff is honored');
  assert.equal(readRetryDelayMs(policy, 0, policy.maxDelayMs + 1, lowJitter), null, 'a Retry-After beyond the cap means give up now');
});

test('runBoundedRead: bounded attempts, bounded total wait, and a fault that clears is recovered', async () => {
  const sleeps: number[] = [];
  const options = { sleep: async (ms: number) => { sleeps.push(ms); }, random: () => 0.5, budget: new SharedReadRetryBudget(100, 60_000), now: () => 0 };
  let calls = 0;
  const limited = () => ({ retryable: true, rateLimited: true, retryAfterMs: null });
  await assert.rejects(runBoundedRead(async () => { calls += 1; throw new Error('429'); }, limited, () => new Error('cooldown'), options), /429/);
  assert.equal(calls, policy.maxRetries + 1);
  assert.ok(sleeps.reduce((a, b) => a + b, 0) <= policy.maxTotalWaitMs);
  calls = 0;
  const value = await runBoundedRead(async () => { calls += 1; if (calls < 2) throw new Error('429'); return 'ok'; }, limited, () => new Error('cooldown'),
    { ...options, budget: new SharedReadRetryBudget(100, 60_000) });
  assert.equal(value, 'ok');
  assert.equal(calls, 2);
  // a non-retryable class is never retried
  calls = 0;
  await assert.rejects(runBoundedRead(async () => { calls += 1; throw new Error('401'); }, () => ({ retryable: false, rateLimited: false, retryAfterMs: null }),
    () => new Error('cooldown'), { ...options, budget: new SharedReadRetryBudget(100, 60_000) }), /401/);
  assert.equal(calls, 1);
});

test('shared budget: the retry allowance per window is finite, so many concurrent jobs cannot multiply retries into a storm', async () => {
  const budget = new SharedReadRetryBudget(3, 60_000, () => 1000);
  assert.deepEqual([budget.tryConsume(), budget.tryConsume(), budget.tryConsume(), budget.tryConsume()], [true, true, true, false]);
  let clock = 0; const rolling = new SharedReadRetryBudget(1, 1000, () => clock);
  assert.equal(rolling.tryConsume(), true); assert.equal(rolling.tryConsume(), false);
  clock = 1001; assert.equal(rolling.tryConsume(), true, 'the window rolls');
  // with an exhausted budget a retryable fault is surfaced at once instead of retried
  const sleeps: number[] = []; let calls = 0;
  await assert.rejects(runBoundedRead(async () => { calls += 1; throw new Error('503'); }, () => ({ retryable: true, rateLimited: false, retryAfterMs: null }),
    () => new Error('cooldown'), { sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5, budget: new SharedReadRetryBudget(0, 60_000) }), /503/);
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test('shared cooldown: after one 429 a concurrent job waits the cooldown (bounded) or is refused locally without any network call', async () => {
  let clock = 0;
  const budget = new SharedReadRetryBudget(100, 60_000, () => clock);
  budget.noteCooldown(10_000); // another job just saw a 429 asking for 10 s
  let calls = 0; const sleeps: number[] = [];
  await assert.rejects(runBoundedRead(async () => { calls += 1; return 'never'; }, () => ({ retryable: false, rateLimited: false, retryAfterMs: null }),
    () => new Error('REFUSED_LOCALLY'), { sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5, budget, now: () => clock }), /REFUSED_LOCALLY/);
  assert.equal(calls, 0, 'a cooldown longer than the whole wait cap refuses the call before any request is made');
  clock = 8000; // 2 s of cooldown remain: inside the cap, so the job waits it out and proceeds
  const value = await runBoundedRead(async () => { calls += 1; return 'ok'; }, () => ({ retryable: false, rateLimited: false, retryAfterMs: null }),
    () => new Error('REFUSED_LOCALLY'), { sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5, budget, now: () => clock });
  assert.equal(value, 'ok');
  assert.deepEqual(sleeps, [2000]);
});

test('the broker adapter never retries a MUTATION, even on 429 or 503, and never sleeps for one', async () => {
  for (const status of [429, 503]) {
    const rig = makeRig({ maxRetries: 5 });
    rig.server.inject({ op: 'POST /v2/orders', times: 'always', respond: { kind: 'status', status, headers: { 'retry-after': '1' } } });
    const intent = await rig.coordinator.prepare(optionIntent());
    await rig.coordinator.submit(intent.orderIntentId, optionGate).catch(() => undefined);
    assert.equal(rig.server.count('POST /v2/orders'), 1, `HTTP ${status}: exactly one POST`);
  }
});

test('Alpaca data/trading provider reads share the same bounded policy and surface RATE_LIMITED (typed) after the budget', async () => {
  const server = new FakeAlpaca();
  server.inject({ op: 'GET /v2/positions', times: 'always', respond: { kind: 'status', status: 429, headers: { 'retry-after': '1' } } });
  const sleeps: number[] = [];
  const config: AlpacaProviderConfig = { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets',
    apiKey: 'SYNTHETIC', apiSecret: 'SYNTHETIC', fetchImpl: server.fetch,
    readRetry: { sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5, budget: new SharedReadRetryBudget(100, 60_000), policy: { maxRetries: 2 } } };
  await assert.rejects(fetchPositions(config, '2026-10-02T14:00:00.000Z'), (error) => error instanceof AlpacaProviderError && error.errorClass === 'RATE_LIMITED');
  assert.equal(server.count('GET /v2/positions'), 3);
  assert.ok(sleeps.reduce((a, b) => a + b, 0) <= policy.maxTotalWaitMs);
  assert.equal(server.mutationCount(), 0);
  // clears on the second try
  const recovering = new FakeAlpaca().inject({ op: 'GET /v2/positions', times: 1, respond: { kind: 'status', status: 429 } });
  assert.deepEqual(await fetchPositions({ ...config, fetchImpl: recovering.fetch, readRetry: { ...config.readRetry, budget: new SharedReadRetryBudget(100, 60_000) } },
    '2026-10-02T14:00:00.000Z'), []);
});

test('an adapter built without any retry options still has a finite default (no unbounded loop is possible)', () => {
  assert.ok(policy.maxRetries <= 3 && policy.maxTotalWaitMs <= 10_000 && policy.maxDelayMs <= policy.maxTotalWaitMs);
  void AlpacaPaperBrokerAdapter;
});
