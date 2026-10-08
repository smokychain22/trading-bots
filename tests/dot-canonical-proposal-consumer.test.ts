import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { canonicalThetaStrategyRegistry } from '../src/theta/strategy-package.js';
import { buildT0ReplayBundle, replayFromT0Bundle } from '../src/theta/t0-replay-bundle.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse } from '../src/theta/strategy-router-contract.js';
import { evaluateDotCanonicalProposal, persistDotCanonicalProposal } from '../src/lab/canonical-proposal-consumer.js';
import { DotLabStore } from '../src/lab/store.js';
import { DotLabGateway } from '../src/lab/gateway.js';
import { createDotLabApp } from '../src/lab/http.js';
import { once } from 'node:events';

const at = '2026-10-08T15:00:00.000Z';
const account = randomUUID();
function proposal(branch: string) {
  const baseline = [...canonicalThetaStrategyRegistry.values()].find(item => item.branch === branch);
  assert.ok(baseline);
  const { configurationHash, ...strategy } = baseline;
  return { proposalId: randomUUID(), baselineHash: configurationHash, parentProposalHash: null,
    strategy: { ...strategy, strategyVersion: 'dot-tested-challenger-v2', status: 'RESEARCH_ONLY' },
    hypothesis: 'Synthetic canonical inventory and candidate economics comparison.', researchRules: [] as unknown[],
    profitTakingChallengers: ['FIXED_10'], plannedHoldingDays: 3, experimentId: 'synthetic-canonical' };
}
function bundle(shares = 200, committedShortCallContracts: number | null = 1) {
  const routing = parseStrategyRoutingResponse({ contractVersion: 'theta-strategy-router-runtime-v1',
    snapshotId: 'synthetic-snapshot', timestamp: at, policyVersion: 'synthetic',
    results: ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'].map(strategyFamily => ({ strategyFamily, eligible: true,
      eligibilityState: 'ELIGIBLE_CHALLENGER', reasons: [], policyVersion: 'synthetic' })) });
  const contracts = [25, 35].flatMap(dte => ['PUT', 'CALL'].map(optionType => normalizeOptionContract({
    source: 'ALPACA', underlying: 'XLE', optionSymbol: `synthetic-${optionType}-${dte}`,
    occSymbol: `synthetic-${optionType}-${dte}`, optionType: optionType as 'PUT' | 'CALL', strike: optionType === 'PUT' ? 57 : 63,
    expiration: dte === 25 ? '2026-11-02' : '2026-11-12', asOfDate: '2026-10-08', multiplier: 100,
    underlyingBid: 59.9, underlyingAsk: 60.1, underlyingLast: 60, underlyingTimestamp: at,
    bid: 1, ask: 1.05, bidSize: 20, askSize: 20, quoteTimestamp: at,
    lastTradePrice: 1, lastTradeSize: 1, tradeTimestamp: at, rho: 0,
    volume: 200, volumeSource: 'ALPACA', openInterest: 1000, openInterestSource: 'OPTIONOMICS',
    iv: 0.3, delta: optionType === 'PUT' ? -0.2 : 0.2, gamma: 0.01, theta: -0.03, vega: 0.1,
    greeksTimestamp: at, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2,
  }, at)));
  return buildT0ReplayBundle({ snapshotId: 'synthetic-snapshot', timestamp: at, strategyVersion: 'synthetic',
    contracts, routing, stock: { underlying: 'XLE', shares, currentPrice: 60, brokerCostBasisPerShare: 60,
      wholeChainEconomicBasisPerShare: 60, committedShortCallContracts }, assignmentCapacityQty: 2,
    buyingPower: 100000, brokerAllowedQty: 2, aegisNewRiskState: 'ALLOW_FULL', eventState: 'CLEAR',
    unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0, optionomicsContext: null });
}
function binding(input = bundle()) {
  return { executionAccountId: account, sourceEvidenceIds: ['inventory'], inventory: {
    executionAccountId: account, snapshotId: input.snapshotId, evidenceId: 'inventory',
    observedAt: at, availableAt: at, validUntil: '2026-10-08T15:01:00.000Z', qualification: 'QUALIFIED', stock: input.stock } };
}

test('Q/A/C use exact canonical economics, sizing and blockers, never execution authority', () => {
  const input = bundle();
  for (const branch of ['THETA_CONVENTIONAL', 'THETA_RECOVERY', 'THETA_CC']) {
    const receipt = evaluateDotCanonicalProposal(proposal(branch), input, [], binding(input));
    assert.equal(receipt.state, 'EVALUATED_RESEARCH_ONLY');
    assert.deepEqual(receipt.candidates, replayFromT0Bundle(input).branches.find(item => item.branch === branch)?.candidates);
    assert.equal(receipt.brokerAuthority, false);
    assert.equal(receipt.executionReady, false);
    assert.equal(receipt.orderIntentCreated, false);
  }
});
test('Q narrowing excludes contracts without changing canonical quantities or inventing a new winner', () => {
  const raw = proposal('THETA_CONVENTIONAL'); raw.strategy.lattice = { ...raw.strategy.lattice, dteMin: 30 };
  const receipt = evaluateDotCanonicalProposal(raw, bundle(), [], binding());
  assert.equal(receipt.state, 'EVALUATED_RESEARCH_ONLY');
  assert.ok(receipt.candidates.length > 0);
  assert.ok(receipt.candidates.every(candidate => candidate.dte !== null && candidate.dte >= 30));
  assert.ok(receipt.excludedCandidateIds.length > 0);
});
test('A/C reject missing, stale, future, cross-account, mismatched and unknown commitments', () => {
  const input = bundle(), original = binding(input);
  for (const branch of ['THETA_RECOVERY', 'THETA_CC']) {
    for (const inventory of [null, { ...original.inventory, executionAccountId: randomUUID() },
      { ...original.inventory, validUntil: at }, { ...original.inventory, availableAt: '2026-10-08T15:00:01.000Z' },
      { ...original.inventory, stock: { ...input.stock, shares: 999 } }]) {
      const receipt = evaluateDotCanonicalProposal(proposal(branch), input, [], { ...original, inventory });
      assert.equal(receipt.state, 'BLOCKED'); assert.equal(receipt.candidates.length, 0);
    }
    const unknown = bundle(200, null);
    assert.equal(evaluateDotCanonicalProposal(proposal(branch), unknown, [], binding(unknown)).state, 'BLOCKED');
  }
});
test('unsupported model changes and recovery lattice changes never fall back silently', () => {
  const raw = proposal('THETA_RECOVERY'); raw.strategy.entryModelVersion = 'unknown';
  assert.equal(evaluateDotCanonicalProposal(raw, bundle(), [], binding()).state, 'BLOCKED');
  const lattice = proposal('THETA_RECOVERY'); lattice.strategy.lattice = { ...lattice.strategy.lattice, dteMin: 2 };
  assert.ok(evaluateDotCanonicalProposal(lattice, bundle(), [], binding()).blockers.length > 0);
});
test('inventory and input tampering reject replay, research receipt persistence is immutable and idempotent', () => {
  const input = bundle(), raw = proposal('THETA_CC');
  const store = new DotLabStore(':memory:', { version: 'dot-strategy-lab-v1', providerAccountId: randomUUID(),
    executionAccountId: account, workspaceId: randomUUID(), accountNumber: 'SYNTHETIC', confirmedAt: at,
    environment: 'PAPER', brokerExecutionEnabled: false, workerEnabled: false });
  try {
    const first = persistDotCanonicalProposal(store, raw, input, [], ['inventory'], binding(input).inventory);
    assert.equal(persistDotCanonicalProposal(store, raw, input, [], ['inventory'], binding(input).inventory).receiptHash, first.receiptHash);
    assert.equal(store.list('EXPERIMENT').length, 1);
    const changed = structuredClone(input); assert.ok(changed.stock); changed.stock.committedShortCallContracts = 0;
    assert.throws(() => evaluateDotCanonicalProposal(raw, changed, [], binding(input)), /HASH_MISMATCH/);
  } finally { store.close(); }
});

test('authenticated proposer route reaches canonical consumer, readers and account injection remain forbidden', async () => {
  const store = new DotLabStore(':memory:', { version: 'dot-strategy-lab-v1', providerAccountId: randomUUID(),
    executionAccountId: account, workspaceId: randomUUID(), accountNumber: 'SYNTHETIC', confirmedAt: at,
    environment: 'PAPER', brokerExecutionEnabled: false, workerEnabled: false });
  let providerCalls = 0;
  const gateway = new DotLabGateway({ tradingApiBase: 'https://paper-api.alpaca.markets',
    marketDataApiBase: 'https://data.alpaca.markets', apiKey: 'synthetic', apiSecret: 'synthetic',
    fetchImpl: async () => { providerCalls++; throw new Error('research never calls broker'); } }, store);
  const server = createDotLabApp(gateway, { reader: 'a'.repeat(64), proposer: 'b'.repeat(64) }).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/v1/research/canonical`, t0 = bundle();
    const body = JSON.stringify({ proposal: proposal('THETA_CC'), t0, features: [],
      sourceEvidenceIds: ['inventory'], inventory: binding(t0).inventory });
    const call = (token: string, payload = body) => fetch(url, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: payload });
    assert.equal((await call('a'.repeat(64))).status, 403);
    const response = await call('b'.repeat(64)); assert.equal(response.status, 200);
    const receipt = await response.json() as { state: string; brokerAuthority: boolean };
    assert.equal(receipt.state, 'EVALUATED_RESEARCH_ONLY'); assert.equal(receipt.brokerAuthority, false);
    assert.equal((await call('b'.repeat(64), JSON.stringify({ ...JSON.parse(body), executionAccountId: randomUUID() }))).status, 400);
    assert.equal(providerCalls, 0); assert.equal(store.list('EXPERIMENT').length, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); store.close(); }
});
