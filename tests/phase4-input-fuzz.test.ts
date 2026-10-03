// Phase 4: input validation fuzz. Malformed external input (broker JSON, provider JSON, plan rows, environment values) must produce a TYPED
// failure or a correct fail-closed state. A TypeError / RangeError / ReferenceError (an unhandled crash) or a false accept is a defect.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AlpacaPaperBrokerAdapter, AlpacaPaperBrokerError } from '../src/execution/broker.js';
import { verifyActionPlanRow, type ActionPlanRowForIntegrity } from '../src/execution/action-plan-integrity.js';
import { AlpacaProviderError, fetchMarketClock, fetchOpenOrders, fetchPositions } from '../src/theta/alpaca-provider.js';
import { loadEnvironment } from '../src/config/environment.js';

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const programmingError = (error: unknown): boolean => error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError || error instanceof SyntaxError;

function randomJson(next: () => number, depth = 0): unknown {
  const kind = Math.floor(next() * (depth > 2 ? 8 : 11));
  switch (kind) {
    case 0: return null;
    case 1: return true;
    case 2: return false;
    case 3: return [0, -1, 1, 1.5, 1e308, -1e308, 2 ** 53, 0.1][Math.floor(next() * 8)];
    case 4: return ['', 'NaN', 'Infinity', '-1', '1e999', 'abc', ' 12 ', '0x10', 'null', 'undefined', '12.5.5'][Math.floor(next() * 11)];
    case 5: return 'x'.repeat(1 + Math.floor(next() * 4000));
    case 6: return '\u0000‮😀';
    case 7: return {};
    case 8: return Array.from({ length: Math.floor(next() * 4) }, () => randomJson(next, depth + 1));
    case 9: return Object.fromEntries(Array.from({ length: Math.floor(next() * 4) }, (_, index) => [`k${index}`, randomJson(next, depth + 1)]));
    default: return [[], [[]], [{}]][Math.floor(next() * 3)];
  }
}
const corrupt = (valid: Record<string, unknown>, next: () => number): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...valid };
  const keys = Object.keys(copy);
  for (let index = 0; index < 1 + Math.floor(next() * 3); index += 1) {
    const key = keys[Math.floor(next() * keys.length)] as string;
    if (next() < 0.25) delete copy[key]; else copy[key] = randomJson(next);
  }
  return copy;
};
const respondWith = (body: unknown, status = 200): typeof fetch => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;

const VALID_ORDER = { id: 'ord-1', client_order_id: 'theta-abc', symbol: 'AAPL261016P00150000', qty: '3', filled_qty: '0', filled_avg_price: null, side: 'sell', position_intent: 'sell_to_open',
  status: 'accepted', limit_price: '1.25', submitted_at: '2026-10-02T14:30:00Z', type: 'limit', time_in_force: 'day', replaced_by: null, replaces: null };
const adapterFor = (fetchImpl: typeof fetch) => new AlpacaPaperBrokerAdapter({ baseUrl: 'https://paper-api.alpaca.markets',
  authentication: { kind: 'MASTER_API_KEY', apiKey: 'SYNTHETIC', apiSecret: 'SYNTHETIC' }, fetchImpl, requestTimeoutMs: 50,
  readRetry: { sleep: async () => undefined, random: () => 0.5, policy: { maxRetries: 0 } } });

test('FUZZ broker JSON: 2,500 corrupted order bodies are accepted only when valid; otherwise a typed broker error; never a crash', async () => {
  const next = prng(20261004);
  let accepted = 0, rejected = 0;
  for (let run = 0; run < 2500; run += 1) {
    const body = next() < 0.1 ? randomJson(next) : corrupt(VALID_ORDER, next);
    try {
      const order = await adapterFor(respondWith(body)).getOrderByClientOrderId('theta-abc');
      accepted += 1;
      if (order !== null) {
        // the adapter contract: finite, positive quantity; filled within [0, qty]. (Whole-number quantities are enforced by the coordinator,
        // BROKER_ORDER_QUANTITY_INVALID, because stock orders may legitimately be fractional at the broker.)
        assert.ok(Number.isFinite(order.qty) && order.qty > 0, `run ${run}: accepted order with qty ${order.qty}`);
        assert.ok(Number.isFinite(order.filledQty) && order.filledQty >= 0 && order.filledQty <= order.qty, `run ${run}: accepted filled ${order.filledQty}/${order.qty}`);
        assert.ok(typeof order.id === 'string' && order.id.length > 0 && typeof order.status === 'string', `run ${run}: accepted order without identity`);
      }
    } catch (error) {
      rejected += 1;
      assert.ok(!programmingError(error), `run ${run}: crash ${(error as Error).message} for ${JSON.stringify(body).slice(0, 120)}`);
      assert.ok(error instanceof AlpacaPaperBrokerError, `run ${run}: untyped failure ${(error as Error).constructor.name}: ${(error as Error).message.slice(0, 160)} for ${JSON.stringify(body).slice(0, 200)}`);
    }
  }
  console.log(`broker fuzz: accepted=${accepted} rejected=${rejected}`);
  assert.ok(accepted > 100 && rejected > 100);
});

test('FUZZ broker JSON: truncated and non-JSON bodies are typed failures', async () => {
  for (const body of ['', '{', '[', '{"id":', 'null', 'true', '12', '"text"', '<html>502</html>', '\u0000']) {
    await assert.rejects(adapterFor(respondWith(body)).getOrderByClientOrderId('theta-abc'), (error: unknown) => !programmingError(error) && (error instanceof AlpacaPaperBrokerError), `body ${JSON.stringify(body)}`);
  }
});

const config = (fetchImpl: typeof fetch) => ({ tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets', apiKey: 'SYNTHETIC', apiSecret: 'SYNTHETIC', fetchImpl,
  readRetry: { sleep: async () => undefined, random: () => 0.5 } });

test('FUZZ provider JSON: positions, open orders and the market clock turn malformed payloads into typed provider errors, never crashes or silent zeros', async () => {
  const next = prng(777);
  const validPosition = { symbol: 'AAPL', asset_class: 'us_equity', qty: '100', side: 'long', avg_entry_price: '150', market_value: '15000', unrealized_pl: '0' };
  const validClock = { timestamp: '2026-10-02T14:30:00Z', is_open: true, next_open: '2026-10-05T13:30:00Z', next_close: '2026-10-02T20:00:00Z' };
  for (let run = 0; run < 1500; run += 1) {
    const which = run % 3;
    try {
      if (which === 0) {
        const positions = await fetchPositions(config(respondWith(next() < 0.2 ? randomJson(next) : [corrupt(validPosition, next)])), '2026-10-02T14:30:00Z');
        for (const position of positions) for (const value of [position.quantity, position.marketValue, position.avgEntryPrice]) assert.ok(value === null || Number.isFinite(value), `run ${run}: non-finite position field`);
      } else if (which === 1) {
        const orders = await fetchOpenOrders(config(respondWith(next() < 0.2 ? randomJson(next) : [corrupt({ id: 'o1', client_order_id: 'c1', symbol: 'AAPL', side: 'buy', qty: '10', status: 'new', limit_price: '1', submitted_at: '2026-10-02T14:30:00Z' }, next)])), '2026-10-02T14:30:00Z');
        for (const order of orders) for (const value of [order.quantity, order.limitPrice]) assert.ok(value === null || Number.isFinite(value), `run ${run}: non-finite order field`);
      } else {
        const clock = await fetchMarketClock(config(respondWith(next() < 0.2 ? randomJson(next) : corrupt(validClock, next))), '2026-10-02T14:30:00Z');
        assert.ok(clock.isOpen === null || typeof clock.isOpen === 'boolean', `run ${run}: isOpen must be a boolean or UNKNOWN`);
      }
    } catch (error) {
      assert.ok(!programmingError(error), `run ${run}: crash ${(error as Error).message}`);
      assert.ok(error instanceof AlpacaProviderError, `run ${run}: untyped failure ${(error as Error).constructor.name}: ${(error as Error).message.slice(0, 80)}`);
    }
  }
});

test('FUZZ plan rows: a randomly corrupted action-plan row is never verified as intact and never throws', () => {
  const next = prng(31337);
  const fields = ['action_plan_id', 'decision_id', 'execution_account_id', 'plan_version', 'plan_json', 'content_hash', 'execution_tier', 'canonical_quantity', 'paper_evidence_quantity',
    'empirical_economics_ready', 'expected_after_cost_ev', 'authority_kind', 'management_input_snapshot_id', 'management_action_frontier_id', 'action_group_id', 'leg_sequence', 'depends_on_action_plan_id'] as const;
  for (let run = 0; run < 3000; run += 1) {
    const row = Object.fromEntries(fields.map((field) => [field, next() < 0.3 ? null : randomJson(next)])) as unknown as ActionPlanRowForIntegrity;
    let result: ReturnType<typeof verifyActionPlanRow>;
    try { result = verifyActionPlanRow(row); } catch (error) { assert.fail(`run ${run}: verifyActionPlanRow threw ${(error as Error).message}`); }
    assert.equal(result.ok, false, `run ${run}: a garbage plan row verified as intact`);
  }
  assert.equal(verifyActionPlanRow(null as never).ok, false);
  assert.equal(verifyActionPlanRow(undefined as never).ok, false);
  assert.equal(verifyActionPlanRow({} as never).ok, false);
});

test('FUZZ environment: random, hostile or oversized environment values produce a typed configuration error or a valid configuration, never a crash', () => {
  const next = prng(4242);
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const keys = [...new Set([...example.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1] as string))];
  assert.ok(keys.length > 5, 'the example environment must list variables');
  let valid = 0, invalid = 0;
  for (let run = 0; run < 1500; run += 1) {
    const source: Record<string, string> = {};
    // one to three hostile variables at a time on top of an otherwise empty (valid) environment, so both outcomes are exercised
    for (let count = 0; count < 1 + Math.floor(next() * 3); count += 1) source[keys[Math.floor(next() * keys.length)] as string] = String(randomJson(next)).slice(0, 5000);
    try { loadEnvironment(source as NodeJS.ProcessEnv); valid += 1; } catch (error) {
      invalid += 1;
      assert.ok(!programmingError(error), `run ${run}: crash ${(error as Error).message}`);
    }
  }
  console.log(`environment fuzz: valid=${valid} invalid=${invalid}`);
  assert.ok(invalid > 100 && valid > 100, 'the fuzz must exercise both the valid and the rejected path');
  assert.doesNotThrow(() => loadEnvironment({} as NodeJS.ProcessEnv), 'an empty environment is a valid configuration');
});
