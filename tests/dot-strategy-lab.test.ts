import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { canonicalThetaStrategyRegistry } from '../src/theta/strategy-package.js';
import { DotLabStore } from '../src/lab/store.js';
import { DotLabGateway } from '../src/lab/gateway.js';
import { createDotLabApp } from '../src/lab/http.js';
import { validateDotProposal, type DotLabIdentity } from '../src/lab/contracts.js';
import { dotFeedbackSchema, buildDotPerformance } from '../src/lab/feedback.js';
import { serializePublicDotProposal } from '../src/lab/proposal-exchange.js';
import { buildT0ReplayBundle } from '../src/theta/t0-replay-bundle.js';
import { runDotBaselineReplay } from '../src/lab/experiment.js';
import { exportDotPrivateObservation, exportSyntheticDotFeedback } from '../src/lab/private-export.js';
import { dotReadToolNames } from '../src/lab/read-tools.js';
import { runDotStdio } from '../src/lab/stdio.js';

const at = '2026-10-08T15:00:00.000Z';
const identity: DotLabIdentity = { version: 'dot-strategy-lab-v1', providerAccountId: randomUUID(),
  executionAccountId: randomUUID(), workspaceId: randomUUID(), accountNumber: 'SYNTHETIC-DOT', confirmedAt: at,
  environment: 'PAPER', brokerExecutionEnabled: false, workerEnabled: false };
const baseline = [...canonicalThetaStrategyRegistry.values()][0];
if (!baseline) throw new Error('TEST_BASELINE_MISSING');
function proposalInput() {
  const { configurationHash, ...strategy } = baseline;
  return { proposalId: randomUUID(), parentProposalHash: null, baselineHash: configurationHash,
    strategy: { ...strategy, status: 'RESEARCH_ONLY', strategyVersion: 'dot-test-v1', executionEnabled: false, promotionStatus: 'UNVALIDATED' },
    hypothesis: 'Synthetic proposal to compare early exits without broker authority.', researchRules: [],
    profitTakingChallengers: ['FIXED_10', 'FIXED_50'], plannedHoldingDays: 10, experimentId: 'synthetic-experiment' };
}
function temporaryStore(maximumRows?: number) {
  const directory = mkdtempSync(join(tmpdir(), 'dot-lab-test-'));
  const file = join(directory, 'lab.sqlite');
  const store = new DotLabStore(file, identity, maximumRows);
  return { store, file, cleanup: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}
function providerFetch(accountId = identity.providerAccountId) {
  const calls: string[] = [];
  const fake: typeof fetch = async (input, init) => {
    assert.equal(init?.method ?? 'GET', 'GET');
    assert.equal(init?.redirect, 'error');
    const path = new URL(String(input)).pathname; calls.push(path);
    const body = path === '/v2/account' ? { id: accountId, status: 'ACTIVE', equity: '100000', cash: '100000',
      buying_power: '100000', options_buying_power: '100000', trading_blocked: false, account_blocked: false }
      : path === '/v2/clock' ? { timestamp: at, is_open: true, next_open: at, next_close: '2026-10-08T20:00:00Z' } : [];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fake, calls };
}
function gateway(store: DotLabStore, fake: typeof fetch) {
  return new DotLabGateway({ tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets',
    apiKey: 'synthetic-key', apiSecret: 'synthetic-secret', fetchImpl: fake }, store, () => at);
}

test('Dot proposal validation reuses the canonical five-strategy registry', () => {
  for (const base of canonicalThetaStrategyRegistry.values()) {
    const { configurationHash, ...strategy } = base;
    const proposed = validateDotProposal({ ...proposalInput(), baselineHash: configurationHash,
      strategy: { ...strategy, strategyVersion: 'dot-new-v1', status: 'RESEARCH_ONLY', executionEnabled: false } });
    assert.equal(proposed.strategy.branch, base.branch); assert.equal(proposed.brokerAuthority, false);
  }
});
test('Dot forbids hard-rule removal, risk change, action expansion and authority promotion', () => {
  for (const mutation of [{ hardRules: ['SUPPORTED_SESSION'] }, { riskLimitVersion: 'weakened' },
    { allowedActions: ['SELL_STOCK'] }, { status: 'PAPER' }, { executionEnabled: true }, { unexpected: 'code' }]) {
    const input = proposalInput();
    assert.throws(() => validateDotProposal({ ...input, strategy: { ...input.strategy, ...mutation } }));
  }
});
test('public exchange rejects account data and credential markers', () => {
  assert.throws(() => serializePublicDotProposal({ ...proposalInput(), hypothesis: 'ALPACA_SECRET_KEY=synthetic-forbidden' }));
  const value = serializePublicDotProposal(proposalInput());
  assert.equal(validateDotProposal(JSON.parse(value)).brokerAuthority, false);
});
test('SQLite restart retains drafts, account ownership and immutable version identity', () => {
  const fixture = temporaryStore();
  try {
    const proposal = validateDotProposal(proposalInput());
    const hash = fixture.store.saveProposal(proposal, at);
    assert.equal(hash, fixture.store.saveProposal(proposal, at));
    const second = new DotLabStore(fixture.file, identity);
    try { assert.equal(second.list('PROPOSAL').length, 1);
      assert.throws(() => second.saveProposal(validateDotProposal({ ...proposalInput(), hypothesis: 'Changed duplicate version must fail.' }), at));
    } finally { second.close(); }
    assert.throws(() => new DotLabStore(fixture.file, { ...identity, providerAccountId: randomUUID() }), /ACCOUNT_MISMATCH/);
    assert.throws(() => new DotLabStore(fixture.file, { ...identity, workspaceId: randomUUID() }), /ACCOUNT_MISMATCH/);
  } finally { fixture.cleanup(); }
});
test('versioned revision links survive restart and cross-strategy parents are rejected', () => {
  const fixture = temporaryStore();
  try {
    const parent = validateDotProposal(proposalInput()); fixture.store.saveProposal(parent, at);
    const input = proposalInput(); input.strategy.strategyVersion = 'dot-test-v2';
    const child = validateDotProposal({ ...input, parentProposalHash: parent.proposalHash });
    fixture.store.saveProposal(child, at);
    assert.equal(fixture.store.list('PROPOSAL').length, 2);
    assert.throws(() => fixture.store.saveProposal(validateDotProposal({ ...input, parentProposalHash: 'f'.repeat(64) }), at), /PARENT_PROPOSAL_MISSING/);
    assert.throws(() => fixture.store.saveProposal({ ...child, brokerAuthority: true } as unknown as typeof child, at), /RECEIPT_MISMATCH/);
    const other = [...canonicalThetaStrategyRegistry.values()].find(value => value.strategyId !== parent.strategy.strategyId);
    assert.ok(other);
    const { configurationHash, ...strategy } = other;
    const wrongParent = validateDotProposal({ ...proposalInput(), baselineHash: configurationHash, parentProposalHash: parent.proposalHash,
      strategy: { ...strategy, strategyVersion: 'dot-other-v1', status: 'RESEARCH_ONLY', executionEnabled: false, promotionStatus: 'UNVALIDATED' } });
    assert.throws(() => fixture.store.saveProposal(wrongParent, at), /PARENT_STRATEGY_MISMATCH/);
  } finally { fixture.cleanup(); }
});

test('checked-in exchange examples remain valid for all five canonical strategies', () => {
  for (const base of canonicalThetaStrategyRegistry.values()) {
    const raw = JSON.parse(readFileSync(new URL(`../research/dot-proposals/examples/${base.strategyId}.json`, import.meta.url), 'utf8'));
    const proposal = validateDotProposal(raw);
    assert.equal(proposal.strategy.branch, base.branch);
    assert.equal(validateDotProposal(JSON.parse(serializePublicDotProposal(raw))).proposalHash, proposal.proposalHash);
  }
});
test('bounded store fails instead of deleting evidence or growing without limit', () => {
  const fixture = temporaryStore(1);
  try {
    assert.throws(() => fixture.store.saveProposal(validateDotProposal(proposalInput()), '1'), /ARTIFACT_TIME_INVALID/);
    fixture.store.saveProposal(validateDotProposal(proposalInput()), at);
    assert.throws(() => fixture.store.saveObservation({ providerAccountId: identity.providerAccountId, observationId: randomUUID(), receivedAt: at, data: {} }), /BUDGET/);
    assert.throws(() => fixture.store.saveObservation({ providerAccountId: randomUUID(), observationId: randomUUID(), receivedAt: at, data: {} }), /ACCOUNT_MISMATCH/);
  } finally { fixture.cleanup(); }
});
test('real gateway uses canonical GET readers and durably records observations', async () => {
  const fixture = temporaryStore(); const provider = providerFetch();
  try {
    const receipt = await gateway(fixture.store, provider.fake).observe();
    assert.deepEqual(provider.calls, ['/v2/account', '/v2/positions', '/v2/orders', '/v2/clock', '/v2/account']);
    assert.equal(receipt.data.account.optionsBuyingPower, 100000); assert.equal(receipt.data.executionEnabled, false);
    assert.equal(fixture.store.list('OBSERVATION').length, 1);
    const exported = exportDotPrivateObservation(fixture.store);
    assert.equal(exported.observations.length, 1); assert.equal(exported.sourceSha, null);
    assert.equal(exported.sourceIdentityState, 'UNVERIFIED'); assert.equal(exported.feedback.length, 0);
  } finally { fixture.cleanup(); }
});
test('account substitution fails before reading positions or persisting evidence', async () => {
  const fixture = temporaryStore(); const provider = providerFetch(randomUUID());
  try {
    await assert.rejects(gateway(fixture.store, provider.fake).observe(), /ACCOUNT_MISMATCH/);
    assert.deepEqual(provider.calls, ['/v2/account']); assert.deepEqual(fixture.store.list('OBSERVATION'), []);
  } finally { fixture.cleanup(); }
});

test('mid-observation account switch and provider failure never persist a partial success', async () => {
  const fixture = temporaryStore(); const provider = providerFetch(); let accountReads = 0;
  const changed: typeof fetch = async (input, init) => {
    if (new URL(String(input)).pathname === '/v2/account' && ++accountReads === 2) return providerFetch(randomUUID()).fake(input, init);
    return provider.fake(input, init);
  };
  try {
    await assert.rejects(gateway(fixture.store, changed).observe(), /ACCOUNT_MISMATCH/);
    assert.deepEqual(fixture.store.list('OBSERVATION'), []);
    const malformed: typeof fetch = async () => new Response('{}', { status: 200 });
    await assert.rejects(gateway(fixture.store, malformed).observe());
    assert.deepEqual(fixture.store.list('OBSERVATION'), []);
  } finally { fixture.cleanup(); }
});

test('private stdio serves the shared MCP reader without credentials, activation or protocol noise', async () => {
  const fixture = temporaryStore(); const provider = providerFetch(); let output = '';
  const sink = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'dot_account', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'submit_order', arguments: {} } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n';
  try {
    await runDotStdio(gateway(fixture.store, provider.fake), Readable.from([requests.slice(0, 25), requests.slice(25)]), sink);
    const replies = output.trim().split('\n').map(value => JSON.parse(value));
    assert.equal(replies.length, 4); assert.equal(replies[2].result.isError, false); assert.equal(replies[3].result.isError, true);
    assert.equal(output.includes('synthetic-key'), false); assert.equal(output.includes('synthetic-secret'), false);
    await assert.rejects(runDotStdio(gateway(fixture.store, provider.fake), Readable.from(['x'.repeat(17000)]), sink), /INPUT_TOO_LARGE/);
  } finally { fixture.cleanup(); }
});
test('live hosts and leaked authority controls are rejected', () => {
  const fixture = temporaryStore();
  try { assert.throws(() => new DotLabGateway({ tradingApiBase: 'https://api.alpaca.markets',
    marketDataApiBase: 'https://data.alpaca.markets', apiKey: 'fake', apiSecret: 'fake' }, fixture.store), /HOST_FORBIDDEN/);
    assert.throws(() => new DotLabStore(':memory:', { ...identity, brokerExecutionEnabled: true } as unknown as DotLabIdentity));
  } finally { fixture.cleanup(); }
});
test('HTTP bridge authenticates, separates read/proposal scope and has no order route', async () => {
  const fixture = temporaryStore(); const provider = providerFetch();
  const app = createDotLabApp(gateway(fixture.store, provider.fake), { reader: 'a'.repeat(64), proposer: 'b'.repeat(64) });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('TEST_ADDRESS');
  const url = `http://127.0.0.1:${address.port}`;
  const read = { Authorization: 'Bearer ' + 'a'.repeat(64) };
  const edit = { Authorization: 'Bearer ' + 'b'.repeat(64), 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(url + '/v1/account')).status, 401);
    assert.equal((await fetch(url + '/v1/account', { headers: read })).status, 200);
    assert.equal((await fetch(url + '/v1/proposals', { method: 'POST', headers: read })).status, 403);
    assert.equal((await fetch(url + '/v1/orders', { method: 'POST', headers: edit })).status, 403);
    const response = await fetch(url + '/v1/proposals', { method: 'POST', headers: edit, body: JSON.stringify(proposalInput()) });
    assert.equal(response.status, 201); assert.equal((await response.json()).brokerAuthority, false);
    const performance = await (await fetch(url + '/v1/performance', { headers: read })).json();
    assert.equal(performance.afterCostPnl, null);
    assert.equal((await fetch(url + '/v1/market?underlying=../account&from=2026-10-08&to=2026-10-09&type=put', { headers: read })).status, 400);
    const rpc = async (method: string, params?: object) => (await fetch(url + '/mcp', { method: 'POST',
      headers: { ...read, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
    assert.equal((await rpc('initialize')).result.serverInfo.name, 'dot-strategy-lab-read-only');
    assert.deepEqual((await rpc('tools/list')).result.tools.map((tool: { name: string }) => tool.name), dotReadToolNames);
    assert.equal((await rpc('tools/call', { name: 'dot_account', arguments: {} })).result.isError, false);
    assert.equal((await rpc('tools/call', { name: 'dot_feedback_schema', arguments: {} })).result.isError, false);
    assert.equal((await rpc('tools/call', { name: 'dot_private_export', arguments: {} })).result.isError, false);
    assert.equal((await rpc('tools/call', { name: 'submit_order', arguments: {} })).result.isError, true);
    assert.equal((await rpc('tools/call', { name: 'dot_account', arguments: { url: 'https://example.invalid' } })).result.isError, true);
  } finally { server.close(); await once(server, 'close'); fixture.cleanup(); }
});
test('feedback refuses fake resolved results, future labels and cross-account aggregation', () => {
  assert.throws(() => dotFeedbackSchema.parse({ outcomeState: 'RESOLVED', fees: null }));
  assert.equal(buildDotPerformance([], identity.providerAccountId).overallProfitabilityStatus, 'NOT_YET_PROVEN');
  const input = { version: 'dot-private-feedback-v1', providerAccountId: identity.providerAccountId, observationId: randomUUID(), asOf: at,
    sourceSha: 'a'.repeat(40), truthClass: 'MODELED_RESEARCH', strategyVersion: 'synthetic-v1', strategyBranch: baseline.branch,
    proposalHash: null, decisionId: 'synthetic-decision', candidateId: 'synthetic-candidate', rejectionCodes: [], orderId: 'synthetic-order',
    fillId: 'synthetic-fill', chainId: 'synthetic-chain', quantity: 1, multiplier: 100, entryPrice: '1.50', exitPrice: '0.75', fees: '2',
    slippage: 1, realizedNetPnl: 72, unrealizedPnl: null, wholeChainNetPnl: 72, capitalDays: 1000,
    openedAt: '2026-10-07T15:00:00Z', closedAt: at, outcomeState: 'RESOLVED', lineageState: 'CANONICAL_LEDGER_VERIFIED', brokerAuthority: false };
  const row = dotFeedbackSchema.parse(input);
  assert.equal(exportSyntheticDotFeedback(row).brokerAuthority, false);
  assert.equal(buildDotPerformance([row], identity.providerAccountId).overallProfitabilityStatus, 'RESEARCH_EVIDENCE_ONLY');
  for (const change of [{ fees: null }, { closedAt: '2026-10-09T15:00:00Z' }, { closedAt: '2026-10-06T15:00:00Z' },
    { openedAt: '2026-10-09T15:00:00Z' }, { truthClass: 'MARKET_OBSERVED' }, { quantity: 0 }]) {
    assert.throws(() => dotFeedbackSchema.parse({ ...input, ...change }));
  }
  assert.throws(() => buildDotPerformance([{ ...row, providerAccountId: randomUUID() }], identity.providerAccountId), /ACCOUNT_MISMATCH/);
  assert.throws(() => buildDotPerformance([row, row], identity.providerAccountId), /DUPLICATE_RESOLVED_CHAIN/);
  assert.throws(() => exportSyntheticDotFeedback({ ...row, truthClass: 'BROKER_ACTUAL' }), /MUST_BE_MODELED/);
  assert.throws(() => buildDotPerformance([{ ...row, truthClass: 'BROKER_ACTUAL' }], identity.providerAccountId), /CANONICAL_IMPORT_REQUIRED/);
});
test('canonical baseline replay uses existing sovereign frontier and capital arithmetic with no executor', () => {
  const fixture = temporaryStore();
  try {
    const proposal = validateDotProposal(proposalInput());
    const t0 = buildT0ReplayBundle({ snapshotId: 'synthetic', timestamp: at, strategyVersion: 'theta-strategy-package-v1',
      contracts: [], routing: null, stock: null, assignmentCapacityQty: null, aegisNewRiskState: 'HOLD_ONLY',
      eventState: null, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 1, optionomicsContext: {} });
    const envelope = { envelopeId: randomUUID(), executionAccountId: identity.executionAccountId, observedAt: at,
      expiresAt: '2026-10-08T15:01:00Z', evidenceHash: 'a'.repeat(64), available: { CASH: '100', BROKER: '100', PORTFOLIO: '100',
        ASSIGNMENT: '100', 'TICKER:TEST': '100', 'SECTOR:TEST': '100', 'CORRELATION:TEST': '100' }, reflected: {}, policyVersion: 'synthetic-policy' };
    const capitalProposal = { reservationId: randomUUID(), proposalRef: 'synthetic', decisionId: randomUUID(), candidateRef: 'synthetic',
      strategy: proposal.strategy.branch, quantity: 1, canonicalMaximumQuantity: 1, quoteExpiresAt: '2026-10-08T15:01:00Z',
      perUnit: { CASH: '10', BROKER: '10', PORTFOLIO: '10', ASSIGNMENT: '10', 'TICKER:TEST': '10', 'SECTOR:TEST': '10', 'CORRELATION:TEST': '10' }, authorityHash: 'a'.repeat(64) };
    const input = { experimentId: 'baseline-synthetic', providerAccountId: identity.providerAccountId, proposal, t0,
      envelope, capitalProposal, commitments: [], at };
    const receipt = runDotBaselineReplay(fixture.store, input);
    assert.equal(receipt.brokerAuthority, false); assert.equal(receipt.proposalRulesApplied, false);
    assert.deepEqual(receipt.capitalBlockers, []); assert.equal(fixture.store.list('EXPERIMENT').length, 1);
    assert.throws(() => runDotBaselineReplay(fixture.store, { ...input, envelope: { ...envelope, executionAccountId: randomUUID() } }), /CAPITAL_ACCOUNT_MISMATCH/);
    assert.throws(() => runDotBaselineReplay(fixture.store, { ...input, at: '2026-10-08T15:02:00Z' }), /CAPITAL_STALE/);
    assert.throws(() => runDotBaselineReplay(fixture.store, { ...input, proposal: { ...proposal, proposalHash: 'f'.repeat(64) } }), /PROPOSAL_HASH_MISMATCH/);
  } finally { fixture.cleanup(); }
});
