import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildCycleQEntryFunnelSummary, maxQFunnelTerminalReasonKeys, qEntryFunnelSummaryVersion } from '../src/theta/q-entry-funnel.js';
import { isFinalistCapitalMisfit, selectFinalistContractsForRefresh } from '../src/theta/finalist-quote-refresh.js';
import { normalizeOptionContract, putDeltaSignInvalid, type RawOptionQuoteInput } from '../src/theta/option-contract.js';
import { auditPresessionConfiguration, paperBootstrapRuntimePolicy as P, presessionConfigurationRegistry } from '../src/theta/paper-bootstrap-runtime-policy.js';

const NOW = '2026-09-14T15:00:00.000Z';
const raw = (over: Partial<RawOptionQuoteInput> = {}): RawOptionQuoteInput => ({
  source: 'ALPACA', underlying: 'AAPL', optionSymbol: 'AAPL261016P00190000', occSymbol: 'AAPL261016P00190000', optionType: 'PUT', strike: 190,
  expiration: '2026-10-16', asOfDate: '2026-09-14', multiplier: 100, underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200,
  underlyingTimestamp: NOW, bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1, quoteTimestamp: NOW,
  tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200, openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22,
  gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
  maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2, ...over }) as RawOptionQuoteInput;

// ---- Q-DELTA-SIGN-001 -------------------------------------------------------------------
test('Q-DELTA-SIGN-001: a positive put delta is UNKNOWN evidence, a negative one is kept, calls are untouched', () => {
  assert.equal(normalizeOptionContract(raw({ delta: -0.22 }), NOW).delta, -0.22);
  assert.equal(normalizeOptionContract(raw({ delta: 0 }), NOW).delta, 0, 'zero is a valid put delta');
  assert.equal(normalizeOptionContract(raw({ delta: 0.22 }), NOW).delta, null);
  assert.equal(normalizeOptionContract(raw({ delta: -1.4 }), NOW).delta, null, '|delta| > 1 is a unit error');
  assert.equal(normalizeOptionContract(raw({ delta: 0.3, optionType: 'CALL', optionSymbol: 'AAPL261016C00190000', occSymbol: 'AAPL261016C00190000' }), NOW).delta, 0.3);
  assert.equal(putDeltaSignInvalid('PUT', null), false, 'null is already UNKNOWN');
  const onlyDelta = normalizeOptionContract(raw({ delta: 0.22, iv: null, gamma: null, theta: null, vega: null, rho: null }), NOW);
  assert.equal(onlyDelta.delta, null);
  assert.equal(onlyDelta.greeksSource, null, 'provenance invariant: no known Greek, no greeksSource');
});

// ---- Q-OWN-FLOOR-001 -------------------------------------------------------------------
test('Q-OWN-FLOOR-001: the ownership floor is a registered, versioned policy value with the former literal value', () => {
  assert.equal(P.ownership.thetaQAcceptabilityFloor, 0.3);
  assert.match(P.policyVersion, /-v3$/);
  const registered = presessionConfigurationRegistry.find((entry) => entry.name === 'ownership.thetaQAcceptabilityFloor');
  assert.equal(registered?.value, 0.3);
  assert.equal(registered?.policyVersion, P.policyVersion);
  assert.equal(auditPresessionConfiguration().state, 'PASS');
  const source = readFileSync('src/theta/theta-shadow-once.ts', 'utf8');
  assert.doesNotMatch(source, /(ownershipAcceptabilityFloor|thetaQMinOwnershipAcceptability)\s*:\s*[0-9.]+/);
});

// ---- Q-FINALIST-CAP-001 ------------------------------------------------------------------
const policy = { policyVersion: 'f-v1', effectiveAt: '2026-01-01T00:00:00.000Z', maxFinalists: 2, maxAgeSeconds: 30 };
const lattice = { minDte: 25, maxDte: 60, deltaBands: [[0, 0.25], [0.25, 0.5]], minOpenInterest: 50, minVolume: 10, maxSpreadPct: 0.15 };
const put = (strike: number, delta: number) => {
  const sym = `AAPL261016P${String(Math.round(strike * 1000)).padStart(8, '0')}`;
  return normalizeOptionContract(raw({ strike, optionSymbol: sym, occSymbol: sym, delta, expiration: '2026-10-19' }), NOW);
};

test('Q-FINALIST-CAP-001: capital-misfit contracts rank after capital-fitting gate-passing ones; unknown capital keeps the old order', () => {
  const misfitCentral = put(500, -0.125); // delta-central but 50,000 collateral
  const fitA = put(100, -0.2);
  const fitB = put(110, -0.3);
  const contracts = [misfitCentral, fitA, fitB];
  const blind = selectFinalistContractsForRefresh({ contracts, latticeConfig: lattice, policy, asOf: NOW });
  assert.equal(blind[0]?.strike, 500, 'capital-blind: the delta-central contract wins a slot');
  const capital = { equity: 100_000, buyingPower: 100_000, hardTickerConcentrationLimitPct: 0.225 };
  const aware = selectFinalistContractsForRefresh({ contracts, latticeConfig: lattice, policy, asOf: NOW, capital });
  assert.deepEqual(aware.map((c) => c.strike).sort(), [100, 110], 'misfit never displaces a fitting gate-passing contract');
  const unknown = selectFinalistContractsForRefresh({ contracts, latticeConfig: lattice, policy, asOf: NOW,
    capital: { equity: null, buyingPower: null, hardTickerConcentrationLimitPct: null } });
  assert.deepEqual(unknown.map((c) => c.optionSymbol), blind.map((c) => c.optionSymbol));
});

test('Q-FINALIST-CAP-001: misfits still fill leftover slots (nothing silently dropped) and the misfit test is exact at the boundary', () => {
  const misfit = put(500, -0.125);
  const fit = put(100, -0.2);
  const capital = { equity: 100_000, buyingPower: 100_000, hardTickerConcentrationLimitPct: 0.225 };
  const two = selectFinalistContractsForRefresh({ contracts: [misfit, fit], latticeConfig: lattice, policy, asOf: NOW, capital });
  assert.deepEqual(two.map((c) => c.strike), [100, 500]);
  assert.equal(isFinalistCapitalMisfit({ strike: 224.99, multiplier: 100 }, capital), false);
  assert.equal(isFinalistCapitalMisfit({ strike: 225, multiplier: 100 }, capital), true, 'collateral/equity >= hard limit, matching AEGIS >=');
  assert.equal(isFinalistCapitalMisfit({ strike: 1_001, multiplier: 100 }, { equity: null, buyingPower: 100_000, hardTickerConcentrationLimitPct: null }), true, 'collateral above buying power');
  assert.equal(isFinalistCapitalMisfit({ strike: 100, multiplier: 100 }, undefined), false);
});

// ---- Q-EARN-UNIT-001 (OWNER_POLICY): pin the CURRENT comparison basis so any change is deliberate -------------------
test('Q-EARN-UNIT-001: earningsExclusionDays is compared against trading-session distance in every consumer (pinned, owner unit decision open)', () => {
  const cycle = readFileSync('src/theta/theta-shadow-cycle.ts', 'utf8');
  assert.match(cycle, /earningsDistanceDays:\s*earningsEvidence\.distanceTradingSessions/);
  assert.equal(P.conventional.earningsExclusionDays, 5, 'value unchanged; unit is an owner decision');
});

// ---- Q-FUNNEL-001 ----------------------------------------------------------------------------------------
test('Q-FUNNEL-001: the cycle funnel summary is bounded, attributes every put to a stage, and never authorizes execution', () => {
  const contracts = Array.from({ length: 300 }, (_, i) => {
    const strike = 100 + i;
    const sym = `AAPL261016P${String(strike * 1000).padStart(8, '0')}`;
    return normalizeOptionContract(raw({ strike, optionSymbol: sym, occSymbol: sym, volume: i % 40, openInterest: 10 + i, delta: -0.05 - (i % 30) * 0.01,
      expiration: '2026-10-19' }), NOW);
  });
  const summary = buildCycleQEntryFunnelSummary({ contracts, account: { equity: 100_000, buyingPower: 100_000, instrumentApproval: { state: 'APPROVED', reason: null } },
    eventState: 'CLEAR', earningsDistanceSessions: 40,
    conventionalCandidates: contracts.slice(0, 5).map((c) => ({ optionSymbol: c.optionSymbol, aegisState: 'HARD_VETO' as const, aegisBindingReasons: ['UNDERLYING:UNDERLYING_SEVERELY_EXCEEDED'],
      quantity: 0, bindingConstraint: 'UNDERLYING:UNDERLYING_SEVERELY_EXCEEDED', shortlistState: 'FINALIST' as const, entryBasis: 'EMPIRICAL_OWNERSHIP' as const })) });
  assert.ok(summary !== null);
  assert.equal(summary.contractVersion, qEntryFunnelSummaryVersion);
  assert.equal(summary.totals.INPUT_CONTRACTS, 300);
  assert.equal(summary.executionAuthorized, false);
  assert.ok(Object.keys(summary.terminalReasonCounts).length <= maxQFunnelTerminalReasonKeys + 1);
  assert.equal(Object.values(summary.terminalReasonCounts).reduce((a, b) => a + b, 0), 300, 'every put is attributed exactly once');
  assert.ok(JSON.stringify(summary).length < 40_000, 'bounded size');
  assert.ok(!('candidates' in summary), 'per-candidate rows are not carried');
  assert.match(summary.fullReceiptHash, /^[0-9a-f]{64}$/);
  assert.equal(buildCycleQEntryFunnelSummary({ contracts: [], account: { equity: null, buyingPower: null, instrumentApproval: { state: 'UNKNOWN', reason: null } },
    eventState: 'UNKNOWN', earningsDistanceSessions: null, conventionalCandidates: [] }), null);
});

test('Q-FUNNEL-001: wired additively into the cycle result and the runtime diagnostic (no hashed-contract field changed)', () => {
  const cycle = readFileSync('src/theta/theta-shadow-cycle.ts', 'utf8');
  assert.match(cycle, /readonly qEntryFunnel\?: QEntryFunnelSummary \| null;/);
  assert.match(cycle, /buildCycleQEntryFunnelSummary\(/);
  const runtime = readFileSync('src/research/production-shadow-runtime.ts', 'utf8');
  assert.match(runtime, /qEntryFunnel:cycle\?\.qEntryFunnel\?\?null/);
  const bundle = readFileSync('src/theta/t0-replay-bundle.ts', 'utf8');
  assert.doesNotMatch(bundle, /qEntryFunnel/, 'the T0 replay bundle / frontier hash input is untouched');
});
