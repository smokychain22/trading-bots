import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { DotCanonicalLedgerReader } from '../src/lab/ledger-import.js';
import type { DotLabIdentity } from '../src/lab/contracts.js';
import { DotLabStore } from '../src/lab/store.js';
import { DotLabGateway } from '../src/lab/gateway.js';
import { callDotReadTool } from '../src/lab/read-tools.js';

const at = '2026-10-08T15:00:00.000Z';
const identity: DotLabIdentity = { version: 'dot-strategy-lab-v1', providerAccountId: randomUUID(),
  executionAccountId: randomUUID(), workspaceId: randomUUID(), accountNumber: 'SYNTHETIC', confirmedAt: at,
  environment: 'PAPER', brokerExecutionEnabled: false, workerEnabled: false };
function fixture(options: { wrongAccount?: boolean; mixed?: boolean; unknownFees?: boolean; missingOpen?: boolean; missingClose?: boolean; stockWithoutClose?: boolean; failure?: boolean; rollbackFailure?: boolean } = {}) {
  let released = 0, destroyed = false; const calls: { sql: string; params: unknown[] }[] = [];
  const chain = randomUUID();
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql === 'ROLLBACK' && options.rollbackFailure) throw new Error('synthetic rollback failure');
    if (sql.includes('FROM trade.execution_account')) return { rows: [{ environment: 'PAPER',
      provider_account_ref_hash: createHash('sha256').update(options.wrongAccount ? 'other' : identity.providerAccountId).digest('hex') }] };
    if (sql.includes('IS DISTINCT FROM')) return { rows: options.mixed ? [{ order_intent_id: randomUUID() }] : [] };
    if (sql.includes('FROM trade.order_intent')) return { rows: [{ chain_id: chain, order_intent_id: randomUUID(), status: 'FILLED' }] };
    if (sql.includes('FROM trade.economic_chain')) return { rows: [{ chain_id: chain, closed_at: '2026-10-08 14:00:00+00' }] };
    if (sql.includes('FROM trade.fill')) return { rows: [{ chain_id: chain, provider_fill_id: 'synthetic-fill', provider_order_id: 'synthetic-order',
      option_contract_id: 'synthetic-contract', position_intent: options.missingClose ? 'SELL_TO_OPEN' : 'BUY_TO_CLOSE',
      quantity: '1', filled_at: at, fees: options.unknownFees ? null : '1' },
      ...(!options.missingOpen ? [{ chain_id: chain, provider_fill_id: 'synthetic-entry-fill', provider_order_id: 'synthetic-entry-order',
        option_contract_id: 'synthetic-contract', position_intent: 'SELL_TO_OPEN', quantity: '1', filled_at: at, fees: '0' }] : [])] };
    if (sql.includes('FROM trade.option_leg')) return { rows: [{ chain_id: chain, closed_at: at, realized_pnl: '100',
      option_contract_id: 'synthetic-contract', side: 'SHORT', quantity: '1', close_reason: 'BTC_CLOSE' }] };
    if (sql.includes('FROM trade.stock_lot')) return { rows: options.stockWithoutClose
      ? [{ chain_id: chain, shares: '100', underlying_id: 'synthetic-underlying', disposed_at: at, realized_pnl: '10' }] : [] };
    if (sql.includes('FROM trade.fee_event')) {
      if (options.failure) throw new Error('synthetic query failure');
      return { rows: [{ chain_id: chain, amount: '1', incurred_at: at }] };
    }
    if (sql.includes('clock_timestamp')) return { rows: [{ observed_at: at }] };
    return { rows: [] };
  };
  const pool = { connect: async () => ({ query, release: (destroy: boolean) => { released++; destroyed = destroy; } }) } as unknown as Pool;
  return { reader: new DotCanonicalLedgerReader(pool, identity, 'a'.repeat(40)), calls, released: () => released, destroyed: () => destroyed };
}
test('canonical account-scoped import uses one read-only snapshot and existing fee-qualified economic resolver', async () => {
  const item = fixture(); const receipt = await item.reader.read(at);
  assert.deepEqual(receipt.outcomes[0]?.resolution, { state: 'RESOLVED', wholeChainNetPnl: 99, labelAvailableAt: at });
  assert.equal(item.calls[0]?.sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(item.calls.at(-1)?.sql, 'COMMIT'); assert.equal(item.released(), 1);
  assert.equal(receipt.brokerAuthority, false);
  assert.equal(receipt.temporalQualification, 'CURRENT_LEDGER_NOT_HISTORICAL_PIT');
  assert.ok(item.calls.find(call => call.sql.includes('FROM trade.fill'))?.params.includes(identity.executionAccountId));
});
test('unknown fees remain blocked and never become fee-free actual profits', async () => {
  const receipt = await fixture({ unknownFees: true }).reader.read(at);
  assert.equal(receipt.outcomes[0]?.resolution.state, 'BLOCKED');
  if (receipt.outcomes[0]?.resolution.state === 'BLOCKED') assert.ok(receipt.outcomes[0].resolution.reasons.includes('EXECUTION_FEES_UNKNOWN'));
});

test('private performance sums only canonical fee-qualified closed chains, unknown fees remain null', async () => {
  const known = await fixture().reader.performance(at);
  assert.equal(known.afterCostPnl, 99);
  assert.equal(known.resolvedChainCount, 1);
  assert.equal(known.profitability, 'EMPIRICALLY_UNPROVEN');
  const unknown = await fixture({ unknownFees: true }).reader.performance(at);
  assert.equal(unknown.afterCostPnl, null);
  assert.equal(unknown.resolvedChainCount, 0);
  assert.equal(unknown.unresolvedChainCount, 1);
});

test('decision and management reads retain exact account/chain scope and explicitly bound rejection coverage', async () => {
  const item = fixture(); const receipt = await item.reader.read(at);
  const decision = item.calls.find(call => call.sql.includes('FROM trade.decision'));
  assert.ok(decision?.sql.includes('oi.execution_account_id=$1'));
  assert.equal(decision?.params[0], identity.executionAccountId);
  const management = item.calls.find(call => call.sql.includes('FROM trade.management_action_frontier'));
  assert.ok(management?.sql.includes('chain_id=ANY($1::uuid[])'));
  assert.ok(receipt.rejectionCoverage.includes('UNSUBMITTED_OPPORTUNITIES_REQUIRE_ACCOUNT_SCOPED_PRODUCER'));
});
test('a locally closed leg without an actual broker close fill cannot become a resolved Paper outcome', async () => {
  const receipt = await fixture({ missingClose: true }).reader.read(at);
  assert.equal(receipt.outcomes[0]?.resolution.state, 'BLOCKED');
  assert.equal(receipt.outcomes[0]?.closeEvidenceComplete, false);
});
test('a closing fill cannot certify actual performance without a matched broker opening fill', async () => {
  const receipt = await fixture({ missingOpen: true }).reader.performance(at);
  assert.equal(receipt.afterCostPnl, null);
  assert.equal(receipt.outcomes[0]?.optionEntryEvidenceComplete, false);
});
test('disposed stock without a broker-confirmed sale cannot certify whole-chain profit', async () => {
  const receipt = await fixture({ stockWithoutClose: true }).reader.read(at);
  assert.equal(receipt.outcomes[0]?.resolution.state, 'BLOCKED');
  assert.equal(receipt.outcomes[0]?.closeEvidenceComplete, false);
});
test('different account binding or mixed-account chain fails closed and releases the reader', async () => {
  for (const options of [{ wrongAccount: true }, { mixed: true }]) {
    const item = fixture(options); await assert.rejects(item.reader.read(at), /DOT_LEDGER_/);
    assert.equal(item.released(), 1); assert.equal(item.calls.at(-1)?.sql, 'ROLLBACK');
  }
});
test('query and rollback failures release exactly once and do not mask the original failure', async () => {
  for (const rollbackFailure of [false, true]) {
    const item = fixture({ failure: true, rollbackFailure });
    await assert.rejects(item.reader.read(at), /synthetic query failure/); assert.equal(item.released(), 1);
    assert.equal(item.destroyed(), rollbackFailure);
  }
});

test('private MCP ledger read checks broker pin before and after import and persists only complete receipts', async () => {
  const store = new DotLabStore(':memory:', identity);
  let requests = 0;
  const fake: typeof fetch = async (_url, init) => {
    assert.equal(init?.method ?? 'GET', 'GET'); requests++;
    return new Response(JSON.stringify({ id: identity.providerAccountId, status: 'ACTIVE', equity: '100000', cash: '100000',
      options_buying_power: '100000', buying_power: '100000', trading_blocked: false, account_blocked: false }));
  };
  const config = { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets',
    apiKey: 'synthetic', apiSecret: 'synthetic', fetchImpl: fake };
  try {
    const unavailable = new DotLabGateway(config, store, () => at);
    await assert.rejects(callDotReadTool(unavailable, 'dot_ledger', {}), /NOT_CONNECTED/);
    assert.equal(requests, 0);
    const connected = new DotLabGateway(config, store, () => at, fixture().reader);
    const receipt = await callDotReadTool(connected, 'dot_ledger', {}) as { outcomes: unknown[] };
    assert.equal(requests, 2); assert.equal(receipt.outcomes.length, 1); assert.equal(store.list('OBSERVATION').length, 1);
    const performance = await callDotReadTool(connected, 'dot_performance', {}) as { afterCostPnl: number };
    assert.equal(performance.afterCostPnl, 99); assert.equal(requests, 4);
    await assert.rejects(callDotReadTool(connected, 'dot_ledger', { accountId: 'other' }));
  } finally { store.close(); }
});
