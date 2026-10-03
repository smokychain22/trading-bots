// Phase 4: overlap / concurrency chaos. Two to four invocations race for one approved plan under a deterministic scheduler with a simulated
// clock: stalls (a descheduled invocation while the others run), plan-claim expiry and reclaim, a worker that timed out while its server side
// continues, late retries, and broker faults on the submit. The real PaperOrderCoordinator, orchestrator, mutation fence and a fake Alpaca are used.
//
// Invariants:
//   1. never more than ONE broker POST and ONE non-replacement broker order for the economic intent (no duplicate exposure), whatever the interleaving
//   2. with the fence, an invocation NEVER takes an intent out of READY (the point a mutation starts) unless it holds an unexpired claim on the plan
//   3. the CONTROL (the same seeds without a fence) does produce stale mutation starts, proving the test is sensitive to the protection
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import test from 'node:test';
import { allFences, requestMutationWindowMs, requestWindowFence } from '../src/execution/mutation-fence.js';
import { MasterPaperExecutionOrchestrator } from '../src/execution/master-paper-execution-orchestrator.js';
import { AlpacaPaperBrokerAdapter } from '../src/execution/broker.js';
import { InMemoryPaperOrderStore, MutationFenceLostError, PaperOrderCoordinator, type MutationFence, type PaperOrderStore } from '../src/execution/paper-order-coordinator.js';
import { FakeAlpaca, control, optionGate, optionIntent, type FaultSpec } from './phase3-exec-fixtures.js';

const CLAIM_TTL_MS = 120_000;
const POST = 'POST /v2/orders';

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

class Sim {
  now = 1_000_000;
  private readonly waiting: Array<() => void> = [];
  private running = 0;
  private live = 0;
  constructor(readonly next: () => number) {}
  /** a descheduling point: other invocations (and the clock) advance before this one resumes */
  async step(): Promise<void> {
    this.running -= 1;
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }
  async stall(maxSteps: number): Promise<void> { for (let index = 0, count = Math.floor(this.next() * (maxSteps + 1)); index < count; index += 1) await this.step(); }
  spawn(body: () => Promise<void>): Promise<void> {
    this.live += 1; this.running += 1;
    return body().finally(() => { this.live -= 1; this.running -= 1; });
  }
  async run(): Promise<void> {
    while (this.live > 0) {
      await new Promise((resolve) => setImmediate(resolve));
      if (this.running > 0 || this.waiting.length === 0) continue;
      const index = Math.floor(this.next() * this.waiting.length);
      const resume = this.waiting.splice(index, 1)[0] as () => void;
      this.now += Math.floor(this.next() * 25_000);   // real time passes while the others run
      this.running += 1;
      resume();
    }
  }
}

class PlanState {
  status: 'READY' | 'CLAIMED' | 'SUBMITTED' | 'WAITING_GATE' = 'READY';
  claimedBy: string | null = null;
  expiresAt = 0;
  constructor(private readonly sim: Sim) {}
  claim(worker: string): boolean {
    const reclaimable = this.status === 'READY' || this.status === 'WAITING_GATE' || (this.status === 'CLAIMED' && this.expiresAt <= this.sim.now);
    if (!reclaimable) return false;
    this.status = 'CLAIMED'; this.claimedBy = worker; this.expiresAt = this.sim.now + CLAIM_TTL_MS;
    return true;
  }
  held(worker: string): boolean { return this.status === 'CLAIMED' && this.claimedBy === worker && this.expiresAt > this.sim.now; }
  releaseOwn(worker: string): boolean {
    if (this.status !== 'CLAIMED' || this.claimedBy !== worker) return false;
    this.status = 'WAITING_GATE'; this.claimedBy = null; return true;
  }
  submitted(): void { if (this.status === 'CLAIMED') { this.status = 'SUBMITTED'; this.claimedBy = null; } }
}

interface Outcome { readonly posts: number; readonly roots: number; readonly liveOrders: number; readonly staleStarts: number; readonly starts: number; readonly fenceRefusals: number }

async function scenario(seed: number, withFence: boolean): Promise<Outcome> {
  const next = prng(seed);
  const sim = new Sim(next);
  const plan = new PlanState(sim);
  const actor = new AsyncLocalStorage<string>();
  const server = new FakeAlpaca();
  const inner = server.fetch;
  (server as unknown as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'POST') await sim.step();    // the request is in flight while others run (a late ACK window)
    return inner(input, init);
  }) as typeof fetch;
  const adapter = new AlpacaPaperBrokerAdapter({ baseUrl: 'https://paper-api.alpaca.markets', authentication: { kind: 'MASTER_API_KEY', apiKey: 'SYNTHETIC', apiSecret: 'SYNTHETIC' },
    fetchImpl: server.fetch, requestTimeoutMs: 25, readRetry: { sleep: async () => undefined, random: () => 0.5, policy: { maxRetries: 1 } } });
  const base = new InMemoryPaperOrderStore();
  let staleStarts = 0, starts = 0, fenceRefusals = 0;
  const store: PaperOrderStore = {
    insertIntent: (intent) => base.insertIntent(intent),
    getIntent: async (id) => { await sim.step(); return base.getIntent(id); },
    transitionIntent: async (id, from, to, brokerOrderId) => {
      if (from === 'READY' && to === 'SUBMITTING') {
        starts += 1;
        if (!plan.held(actor.getStore() as string)) staleStarts += 1;   // measured at the instant the mutation starts
      }
      await sim.step();
      return base.transitionIntent(id, from, to, brokerOrderId);
    },
    recordAttempt: async (attempt) => { await sim.step(); return base.recordAttempt(attempt); },
    updateAttempt: (id, no, result) => base.updateAttempt(id, no, result),
    unresolvedIntents: () => base.unresolvedIntents(),
  };
  const intent = optionIntent();

  if (next() < 0.35) {
    const respond = ([{ kind: 'timeout' }, { kind: 'status', status: 503 }, { kind: 'network', code: 'ECONNRESET' }] as const)[Math.floor(next() * 3)] as FaultSpec['respond'];
    server.inject({ op: POST, applied: next() < 0.6, respond });
  }

  const invocation = async (worker: string): Promise<void> => actor.run(worker, async () => {
    const startedAt = sim.now;
    await sim.stall(3);
    if (!plan.claim(worker)) return;
    await sim.stall(withFence ? 12 : 12);              // a stall long enough to outlive the claim sometimes
    const claimFence: MutationFence = async () => { if (!plan.held(worker)) throw new MutationFenceLostError('PLAN_CLAIM_NOT_HELD'); };
    const fence = withFence ? allFences(requestWindowFence(startedAt, () => sim.now), claimFence) : null;
    const coordinator = new PaperOrderCoordinator(adapter, store, control(), fence);
    try {
      const result = await new MasterPaperExecutionOrchestrator(coordinator).execute({ ...intent, gate: optionGate });
      if (result.state !== 'BLOCKED_UNRESOLVED_ORDER') plan.submitted();
    } catch (error) {
      if (error instanceof MutationFenceLostError) { fenceRefusals += 1; plan.releaseOwn(worker); }
      // any other failure leaves the plan to the next owner; it must never be a programming error
      else assert.ok(!(error instanceof TypeError) && !(error instanceof RangeError) && !(error instanceof ReferenceError), `seed ${seed}: ${(error as Error).message}`);
    }
  });

  const workers = 2 + Math.floor(next() * 3);
  const running = Array.from({ length: workers }, (_, index) => sim.spawn(() => invocation(`worker-${index}`)));
  // a late retry of the same cycle after the others finished or stalled
  running.push(sim.spawn(async () => { await sim.stall(25); await invocation('worker-late'); }));
  await Promise.all([sim.run(), ...running]);

  const roots = [...server.orders.values()].filter((order) => order.replaces === null || order.replaces === undefined);
  return { posts: server.count(POST), roots: roots.length, liveOrders: [...server.orders.values()].filter((order) => !['filled', 'canceled', 'expired', 'rejected', 'replaced'].includes(String(order.status))).length,
    staleStarts, starts, fenceRefusals };
}

test('OVERLAP: 400 seeded interleavings never create a duplicate economic order, and no invocation starts a mutation without holding its claim (with the fence)', async () => {
  let starts = 0, refusals = 0, ordered = 0;
  for (let seed = 1; seed <= 400; seed += 1) {
    const outcome = await scenario(seed, true);
    assert.ok(outcome.posts <= 1, `seed ${seed}: ${outcome.posts} POSTs`);
    assert.ok(outcome.roots <= 1, `seed ${seed}: ${outcome.roots} broker orders for one intent`);
    assert.ok(outcome.liveOrders <= 1, `seed ${seed}: ${outcome.liveOrders} live orders`);
    assert.equal(outcome.staleStarts, 0, `seed ${seed}: an invocation started a mutation without holding its claim`);
    starts += outcome.starts; refusals += outcome.fenceRefusals; ordered += outcome.roots;
  }
  console.log(`overlap (fenced): starts=${starts} fenceRefusals=${refusals} ordersPlaced=${ordered}`);
  assert.ok(starts > 100 && refusals > 20, 'the interleavings must exercise both the allowed path and the refusals');
});

test('CONTROL: the same seeds WITHOUT the fence do start mutations from invocations that lost their claim (the test is sensitive to the protection), yet still never duplicate the order', async () => {
  let stale = 0;
  for (let seed = 1; seed <= 400; seed += 1) {
    const outcome = await scenario(seed, false);
    assert.ok(outcome.posts <= 1 && outcome.roots <= 1, `seed ${seed}: the intent compare-and-swap and the unique client order id must stop a duplicate even without the fence`);
    stale += outcome.staleStarts;
  }
  console.log(`overlap (control, no fence): stale mutation starts=${stale}`);
  assert.ok(stale > 0, 'without the fence some invocation must start a mutation after losing its claim');
});

test('the request window is shorter than the supervisor timeout and the claim TTL is the only other bound the fence relies on', () => {
  assert.ok(requestMutationWindowMs < 180_000);
  assert.ok(CLAIM_TTL_MS >= 60_000);
});
