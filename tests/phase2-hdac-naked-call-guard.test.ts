import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { buildAlpacaLimitOrder, type ThetaOrderAction } from '../src/execution/order-construction.js';
import { InMemoryPaperOrderStore, PaperOrderCoordinator } from '../src/execution/paper-order-coordinator.js';
import type { BrokerOrderRequest, PaperBrokerAdapter } from '../src/execution/broker.js';

// Phase 2 permanent guard: no code path may emit a short call without covering shares.
// Synthetic data only. No network, no broker.

const CALL = 'AAPL261016C00150000';
const PUT = 'AAPL261016P00150000';
const order = (action: ThetaOrderAction, symbol: string, extra: Partial<Parameters<typeof buildAlpacaLimitOrder>[0]> = {}) =>
  buildAlpacaLimitOrder({ action, symbol, quantity: 1, limitPrice: 1.2, clientOrderId: 'c1', ...extra });

test('NAKED_CALL: CSP actions can never carry a call contract (would skip the coverage check)', () => {
  for (const action of ['OPEN_CSP', 'ROLL_CSP_OPEN', 'CLOSE_CSP', 'ROLL_CSP_CLOSE'] as const) {
    assert.throws(() => order(action, CALL), /CSP actions require an OCC put/, action);
    assert.throws(() => order(action, CALL, { confirmedCoveredShares: 10_000, optionMultiplier: 100 }), /CSP actions require an OCC put/, action);
    assert.equal(order(action, PUT).symbol, PUT);
  }
});

test('NAKED_CALL: covered-call actions require a call contract and confirmed whole-lot share coverage', () => {
  for (const action of ['OPEN_CC', 'ROLL_CC_OPEN'] as const) {
    assert.throws(() => order(action, PUT, { confirmedCoveredShares: 100, optionMultiplier: 100 }), /call contract/, action);
    assert.throws(() => order(action, CALL), /coverage/, `${action} without coverage`);
    assert.throws(() => order(action, CALL, { confirmedCoveredShares: 100 }), /multiplier/, `${action} without explicit multiplier`);
    for (const shares of [0, 1, 99]) {
      assert.throws(() => order(action, CALL, { confirmedCoveredShares: shares, optionMultiplier: 100 }), /coverage/, `${action} shares=${shares}`);
    }
    for (const [quantity, shares, ok] of [[1, 100, true], [1, 101, true], [1, 199, true], [2, 199, false], [2, 200, true], [2, 250, true], [3, 250, false]] as const) {
      const attempt = () => order(action, CALL, { quantity, confirmedCoveredShares: shares, optionMultiplier: 100, committedShortCallContracts: 0 });
      if (ok) assert.equal(attempt().side, 'sell');
      else assert.throws(attempt, /coverage/, `${action} qty=${quantity} shares=${shares}`);
    }
  }
});

test('NAKED_CALL: buy-to-close of a call needs no share cover but must still be a call; stock sales cannot name an option', () => {
  for (const action of ['CLOSE_CC', 'ROLL_CC_CLOSE'] as const) {
    assert.equal(order(action, CALL).side, 'buy');
    assert.throws(() => order(action, PUT), /call contract/);
  }
  assert.throws(() => order('SELL_STOCK', CALL), /equity symbol/);
  assert.throws(() => order('SELL_STOCK', PUT), /equity symbol/);
  assert.equal(order('SELL_STOCK', 'AAPL').symbol, 'AAPL');
});

test('NAKED_CALL: every sell order on a call in the builder is a covered-call open', () => {
  const actions: ThetaOrderAction[] = ['OPEN_CSP', 'CLOSE_CSP', 'ROLL_CSP_CLOSE', 'ROLL_CSP_OPEN', 'OPEN_CC', 'CLOSE_CC', 'ROLL_CC_CLOSE', 'ROLL_CC_OPEN', 'SELL_STOCK'];
  for (const action of actions) {
    let built: BrokerOrderRequest | null = null;
    try { built = order(action, CALL, { confirmedCoveredShares: 100, optionMultiplier: 100, committedShortCallContracts: 0 }); } catch { built = null; }
    if (built !== null && built.side === 'sell') assert.ok(action === 'OPEN_CC' || action === 'ROLL_CC_OPEN', `${action} produced a short call`);
  }
});

test('NAKED_CALL: the persisted-intent boundary rejects a sell on a call under any non-covered-call action', async () => {
  const broker = { accountKind: 'MASTER_API_KEY', environment: 'PAPER' } as unknown as PaperBrokerAdapter;
  const coordinator = new PaperOrderCoordinator(broker, new InMemoryPaperOrderStore(),
    { masterEnabled: true, followerEnabled: false, pauseNewOrders: false });
  const request: BrokerOrderRequest = { symbol: CALL, qty: 1, side: 'sell', type: 'limit', time_in_force: 'day',
    limit_price: '1.20', client_order_id: 'forged-1', position_intent: 'sell_to_open' };
  const prepare = (action: string) => coordinator.prepare({
    orderIntentId: '11111111-1111-4111-8111-111111111111', executionAccountId: '22222222-2222-4222-8222-222222222222',
    decisionId: '33333333-3333-4333-8333-333333333333', action, request, chainId: '44444444-4444-4444-8444-444444444444',
    optionContractId: null, underlyingId: '55555555-5555-4555-8555-555555555555', persistedAt: '2026-09-14T14:00:00.000Z',
    executionEvidence: {}, authorizationEvidence: { executionTier: 'PAPER_EVIDENCE', canonicalQuantity: 1, paperEvidenceQuantity: 1,
      empiricalEconomicsReady: false, expectedAfterCostEv: null }, gate: {},
  } as never);
  // prepare() only persists; the guard runs when the intent is submitted. Persist, then submit and expect the refusal.
  await prepare('OPEN_CSP');
  await assert.rejects(() => coordinator.submit('11111111-1111-4111-8111-111111111111', {
    now: '2026-09-14T14:00:00.000Z', baseHostname: 'paper-api.alpaca.markets', accountVerified: true, marketOpen: true,
  } as never), /SHORT_CALL_REQUIRES_COVERED_CALL_ACTION/);
});

// ---------------------------------------------------------------------------------------------
// Static inventory: the only source files allowed to mention broker order-opening primitives.
// A new file appearing here forces a deliberate review of whether it can emit a short call.
// ---------------------------------------------------------------------------------------------
function walk(directory: string, files: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (path.endsWith('.ts')) files.push(path);
  }
  return files;
}

test('NAKED_CALL static inventory: order construction and broker submission live only in reviewed files', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const rel = (path: string) => relative(root, path).split('\\').join('/');
  const sources = walk(root).map((path) => ({ file: rel(path), text: readFileSync(path, 'utf8') }));
  const matching = (pattern: RegExp) => sources.filter((s) => pattern.test(s.text)).map((s) => s.file).sort();

  // Only the order builder constructs an Alpaca order body with a sell side.
  assert.deepEqual(matching(/buildAlpacaLimitOrder\s*\(/), [
    'execution/master-paper-command-assembly.ts', 'execution/order-construction.ts', 'theta/first-paper-order-preflight.ts',
  ]);
  // Only the coordinator calls the broker's mutating order methods.
  assert.deepEqual(matching(/\.submitOrder\s*\(/), ['execution/paper-order-coordinator.ts']);
  // POSTing /v2/orders happens only inside the broker adapter.
  assert.deepEqual(matching(/['"`]\/v2\/orders['"`]\s*,\s*\{\s*method:\s*'POST'/), ['execution/broker.ts']);
  // Literal sell_to_open request bodies are constructed only by the order builder (others only read/describe them).
  const stoConstructors = sources.filter((s) => /position_intent\s*:\s*['"]sell_to_open['"]|[A-Z_]+_(?:CSP|CC)(?:_OPEN)?\s*:\s*'sell_to_open'|OPEN_C[SC]P?\s*:\s*'sell_to_open'/.test(s.text)).map((s) => s.file).sort();
  assert.deepEqual(stoConstructors, ['execution/order-construction.ts']);
  // The builder itself must keep its action/instrument agreement and coverage checks.
  const builder = sources.find((s) => s.file === 'execution/order-construction.ts')?.text ?? '';
  assert.match(builder, /Covered-call actions require an OCC call contract symbol/);
  assert.match(builder, /CSP actions require an OCC put contract symbol/);
  assert.match(builder, /Covered-call order requires confirmed share coverage/);
  // The coordinator keeps its defense-in-depth refusal.
  const coordinatorText = sources.find((s) => s.file === 'execution/paper-order-coordinator.ts')?.text ?? '';
  assert.match(coordinatorText, /SHORT_CALL_REQUIRES_COVERED_CALL_ACTION/);
});
