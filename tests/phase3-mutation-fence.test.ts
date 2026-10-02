// Phase 3: last-moment mutation fence. A stalled/abandoned invocation must not START a broker mutation it no longer owns.
// The refusal happens BEFORE any state change and before any broker contact (the intent stays READY, zero POSTs).
import assert from 'node:assert/strict';
import test from 'node:test';
import { allFences, requestMutationWindowMs, requestWindowFence } from '../src/execution/mutation-fence.js';
import { MutationFenceLostError, PaperOrderCoordinator, type MutationFence } from '../src/execution/paper-order-coordinator.js';
import { control, makeRig, optionGate, optionIntent, replacementOf } from './phase3-exec-fixtures.js';

const POST = 'POST /v2/orders';

function rigWithFence(fence: MutationFence | null) {
  const rig = makeRig();
  const coordinator = new PaperOrderCoordinator(rig.adapter, rig.store, control(), fence);
  return { ...rig, coordinator };
}

test('an open fence changes nothing: the order is submitted exactly once', async () => {
  const calls: string[] = [];
  const rig = rigWithFence(async (operation, id) => { calls.push(`${operation}:${id}`); });
  const intent = await rig.coordinator.prepare(optionIntent());
  const result = await rig.coordinator.submit(intent.orderIntentId, optionGate);
  assert.ok(result);
  assert.equal(rig.server.count(POST), 1);
  assert.deepEqual(calls, [`SUBMIT:${intent.orderIntentId}`]);
});

test('a refusing fence: no state change, no broker POST, intent stays READY, and a later owner can still submit it', async () => {
  let open = false;
  const rig = rigWithFence(async () => { if (!open) throw new MutationFenceLostError('PLAN_CLAIM_NOT_HELD'); });
  const intent = await rig.coordinator.prepare(optionIntent());
  await assert.rejects(rig.coordinator.submit(intent.orderIntentId, optionGate), (error: unknown) => error instanceof MutationFenceLostError && error.reason === 'PLAN_CLAIM_NOT_HELD');
  assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'READY');
  assert.equal(rig.server.count(POST), 0);
  assert.equal(rig.server.created, 0);
  open = true;
  const result = await rig.coordinator.submit(intent.orderIntentId, optionGate);
  assert.ok(result);
  assert.equal(rig.server.count(POST), 1);
});

test('a refusing fence also stops a REPLACE before any further broker mutation', async () => {
  let open = true;
  const rig = rigWithFence(async (operation) => { if (!open && operation === 'REPLACE') throw new MutationFenceLostError('REQUEST_MUTATION_WINDOW_EXPIRED'); });
  const original = optionIntent();
  const intent = await rig.coordinator.prepare(original);
  await rig.coordinator.submit(intent.orderIntentId, optionGate);
  const postsBefore = rig.server.count(POST);
  const createdBefore = rig.server.created;
  open = false;
  await assert.rejects(rig.coordinator.replace(intent.orderIntentId, replacementOf(original, { limit: '0.90' }), optionGate), MutationFenceLostError);
  assert.equal(rig.server.count(POST), postsBefore);
  assert.equal(rig.server.created, createdBefore);
  assert.equal(rig.server.orders.size, 1);
});

test('the request window: allowed early and at the boundary, refused after it, refused on a backwards or non-finite clock', async () => {
  let now = 1_000_000;
  const fence = requestWindowFence(1_000_000, () => now);
  await fence('SUBMIT', 'x');
  now = 1_000_000 + requestMutationWindowMs;
  await fence('SUBMIT', 'x');
  now += 1;
  await assert.rejects(fence('SUBMIT', 'x'), (error: unknown) => error instanceof MutationFenceLostError && error.reason === 'REQUEST_MUTATION_WINDOW_EXPIRED');
  now = 999_999;
  await assert.rejects(fence('SUBMIT', 'x'), MutationFenceLostError);
  now = Number.NaN;
  await assert.rejects(fence('SUBMIT', 'x'), MutationFenceLostError);
  assert.throws(() => requestWindowFence(Number.NaN), /MUTATION_WINDOW_POLICY_INVALID/);
  assert.throws(() => requestWindowFence(0, Date.now, 0), /MUTATION_WINDOW_POLICY_INVALID/);
});

test('the window is shorter than the supervisor client timeout (180 s) so an abandoned invocation cannot begin new mutations', () => {
  assert.ok(requestMutationWindowMs < 180_000);
});

test('allFences runs in order and the first refusal wins', async () => {
  const seen: string[] = [];
  const a: MutationFence = async () => { seen.push('a'); };
  const b: MutationFence = async () => { seen.push('b'); throw new MutationFenceLostError('B'); };
  const c: MutationFence = async () => { seen.push('c'); };
  await assert.rejects(allFences(a, b, c)('SUBMIT', 'x'), (error: unknown) => error instanceof MutationFenceLostError && error.reason === 'B');
  assert.deepEqual(seen, ['a', 'b']);
});

test('every production coordinator in the runtime is constructed with a mutation fence', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/theta/autonomous-runtime.ts', import.meta.url), 'utf8');
  const constructions = source.split('new PaperOrderCoordinator(').slice(1);
  assert.ok(constructions.length >= 2);
  for (const rest of constructions) {
    const window = rest.slice(0, 400);
    assert.match(window, /windowFence|allFences\(/, `a PaperOrderCoordinator is built without a mutation fence: ${window.slice(0, 120)}`);
  }
});

test('the claim fence refuses a lost plan claim and the runtime releases the plan instead of quarantining it', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/theta/autonomous-runtime.ts', import.meta.url), 'utf8');
  assert.match(source, /claimFence[\s\S]{0,200}verifyBeforeSubmit[\s\S]{0,800}MutationFenceLostError/);
  assert.match(source, /error instanceof MutationFenceLostError[\s\S]{0,300}planStore\.releaseOwnClaim\(/);
});

test('the orchestrator fences BEFORE persisting anything: a refusal leaves no intent, no broker call, and a later owner can run the same command', async () => {
  const { MasterPaperExecutionOrchestrator } = await import('../src/execution/master-paper-execution-orchestrator.js');
  let open = false;
  const rig = rigWithFence(async () => { if (!open) throw new MutationFenceLostError('REQUEST_MUTATION_WINDOW_EXPIRED'); });
  const orchestrator = new MasterPaperExecutionOrchestrator(rig.coordinator);
  const command = { ...optionIntent(), gate: optionGate };
  await assert.rejects(orchestrator.execute(command), MutationFenceLostError);
  assert.equal(await rig.store.getIntent(command.orderIntentId), null, 'no READY intent may be left behind by a refused fence');
  assert.equal(rig.server.count(POST), 0);
  open = true;
  const result = await orchestrator.execute(command);
  assert.equal(result.submittedNow, true);
  assert.equal(rig.server.count(POST), 1);
});

test('only a lost plan CLAIM is a lost fence; an integrity or currency failure inside the claim fence is not released for retry', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/theta/autonomous-runtime.ts', import.meta.url), 'utf8');
  assert.match(source, /PLAN_CLAIM_NOT_HELD'\|\|item==='PLAN_NOT_CLAIMED'[\s\S]{0,200}MutationFenceLostError/);
  assert.match(source, /throw new Error\(held\.mismatches\.length===1&&held\.mismatches\[0\]===planNoLongerCurrent\?planNoLongerCurrent:'PLAN_INTEGRITY_MISMATCH'\)/);
  assert.match(source, /planStore\.releaseOwnClaim\(plan\.actionPlanId,workerInstance/);
  assert.equal(/error instanceof MutationFenceLostError[\s\S]{0,200}planStore\.wait\(/.test(source), false, 'a refused fence must release only its own claim, never call the unconditional wait()');
});
