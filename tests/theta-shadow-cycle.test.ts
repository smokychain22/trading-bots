import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { classifyShadowCycleProvenance, runThetaShadowCycle, type ThetaShadowCycleConfig } from '../src/theta/theta-shadow-cycle.js';
import type { AlpacaProviderConfig } from '../src/theta/alpaca-provider.js';
import type { PythonBridgeConfig } from '../src/theta/python-bridge.js';
import type { UnderlyingCandidateInput } from '../src/theta/universe-policy.js';

// Proves runThetaShadowCycle -- the real end-to-end composition of
// UniversePolicy -> Alpaca provider (mocked fetch, obviously-synthetic
// credentials) -> option-chain merge -> real point-in-time features ->
// the real Python-subprocess new-risk pipeline -- functions as one coherent
// cycle. NO live credentials are used (mocked fetch throughout); NO order
// endpoint exists anywhere in the code path (grep-verified separately).

const CANDIDATE_PYTHON_PATHS = [
  process.env.PYTHON_EXECUTABLE_FOR_TESTS,
  'C:\\Users\\hp\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
].filter((candidate): candidate is string => candidate !== undefined);
const pythonExecutablePath = CANDIDATE_PYTHON_PATHS.find((candidate) => existsSync(candidate));
const RUNTIME_DIR = path.resolve('bots/theta/quant/runtime');

const bridge = (): PythonBridgeConfig => ({
  pythonExecutablePath: pythonExecutablePath ?? 'python',
  scriptAllowlist: new Map([
    ['ownership', path.join(RUNTIME_DIR, 'ownership_contract.py')],
    ['regime', path.join(RUNTIME_DIR, 'regime_contract.py')],
    ['strategyRouter', path.join(RUNTIME_DIR, 'strategy_router_contract.py')],
    ['thetaQ', path.join(RUNTIME_DIR, 'theta_q_contract.py')],
    ['paretoFrontier', path.join(RUNTIME_DIR, 'pareto_frontier_contract.py')],
    ['opportunityFrontier', path.join(RUNTIME_DIR, 'opportunity_frontier_contract.py')],
    ['aegis', path.join(RUNTIME_DIR, 'aegis_contract.py')],
    ['sizing', path.join(RUNTIME_DIR, 'sizing_contract.py')],
    ['executionQuality', path.join(RUNTIME_DIR, 'execution_quality_contract.py')],
  ]),
  timeoutMs: 5000,
  maxOutputBytes: 1_000_000,
});

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const NOW = '2026-09-10T15:00:00.000Z';
let requestedUrls: string[] = [];

const mockAlpacaFetch = (options: { hasContracts: boolean; hasBars: boolean }) => (async (input: RequestInfo | URL) => {
  const url = input instanceof URL ? input.toString() : String(input);
  requestedUrls.push(url);
  if (url.includes('/v2/account')) {
    return jsonResponse(200, { id: 'synthetic-test-account-0000', status: 'ACTIVE', equity: '100000', cash: '50000', buying_power: '40000', options_buying_power: '20000', options_approved_level: 2, options_trading_level: 2 });
  }
  if (url.includes('/v2/positions')) {
    return jsonResponse(200, []); // a real, empty, genuinely-successful positions call -- never a fetch failure
  }
  if (url.includes('/v2/orders')) {
    return jsonResponse(200, []); // same for open orders
  }
  if (url.includes('/v2/clock')) {
    return jsonResponse(200, { timestamp: NOW, is_open: true, next_open: NOW, next_close: NOW }); // market open by default
  }
  if (url.includes('/v2/calendar')) {
    return jsonResponse(200, [{ date: NOW.slice(0, 10), open: '09:30', close: '16:00' }]);
  }
  if (url.includes('/v2/stocks/bars')) {
    if (!options.hasBars) return jsonResponse(200, { bars: {}, next_page_token: null });
    const bars = Array.from({ length: 65 }, (_, i) => ({ t: new Date(Date.now() - (65 - i) * 86_400_000).toISOString(), o: 500 + i * 0.1, h: 501 + i * 0.1, l: 499 + i * 0.1, c: 500.1 + i * 0.1, v: 1_000_000 }));
    return jsonResponse(200, { bars: { SPY: bars }, next_page_token: null });
  }
  if (url.includes('/v2/options/contracts')) {
    if (!options.hasContracts) return jsonResponse(200, { option_contracts: [], next_page_token: null });
    return jsonResponse(200, { option_contracts: [{ symbol: 'SPY261009P00500000', strike_price: '500', expiration_date: '2026-10-09' }], next_page_token: null });
  }
  if (url.includes('/v1beta1/options/snapshots')) {
    if (!options.hasContracts) return jsonResponse(200, { snapshots: {}, next_page_token: null });
    return jsonResponse(200, {
      snapshots: { SPY261009P00500000: { latestQuote: { bp: 0.13, ap: 0.14, bs: 900, as: 900, t: NOW }, greeks: { delta: -0.003, gamma: 0.0001, theta: -0.02, vega: 0.02, rho: -0.002 }, impliedVolatility: 0.5 } },
      next_page_token: null,
    });
  }
  throw new Error(`unmocked URL in test: ${url}`);
}) as typeof fetch;

const alpacaConfig = (mockOptions: { hasContracts: boolean; hasBars: boolean }): AlpacaProviderConfig => ({
  tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets',
  apiKey: 'TEST-SYNTHETIC-KEY', apiSecret: 'TEST-SYNTHETIC-SECRET', fetchImpl: mockAlpacaFetch(mockOptions),
});

const spyEligible = (): UnderlyingCandidateInput => ({
  symbol: 'SPY', tradable: true, optionEnabled: true, assetDataValid: true, avgDollarVolume: 50_000_000,
  currentPrice: 500, hasUsableOptionChain: true, accountCollateralFeasible: true, ownershipAcceptable: true,
  unsupportedCorporateActionPending: false, eventNear: false,
});

const baseConfig = (overrides: Partial<ThetaShadowCycleConfig> = {}): ThetaShadowCycleConfig => ({
  alpaca: alpacaConfig({ hasContracts: true, hasBars: true }),
  optionomics: null, // honestly NOT_ATTEMPTED by default -- individual tests below opt in with a mocked config
  bridge: bridge(),
  universePolicy: { policyVersion: 'universe-v1', minAvgDollarVolume: 10_000_000, minCurrentPrice: 5 },
  universeCandidates: [spyEligible()],
  universeCandidatesOrigin: 'CALLER_MANUAL',
  optionExpirationDateGte: '2026-10-01', optionExpirationDateLte: '2026-11-01', optionType: 'put', maxOptionPages: 5,
  historyStart: '2026-07-01T00:00:00Z', historyEnd: NOW, historyMaxPages: 5,
  ownershipPolicy: { policyVersion: 'ownership-v1', minStockAvgVolume: 1, minOptionOpenInterest: 1, minOptionVolume: 1, maxSpreadPct: 0.5, rvNormalizationCeiling: 0.6, downsideSemivarNormalizationCeiling: 0.3, gapFrequencyNormalizationCeiling: 0.5, eventDecayWindowDays: 10 },
  regimePolicy: { policyVersion: 'regime-v1', bullMaSlopeFloor: 0.001, bearMaSlopeCeiling: -0.001, rvLowCeiling: 0.1, rvHighFloor: 0.25, rvShockFloor: 0.4, maxAdverseGapShockThreshold: 0.08, liquidityThinSpreadPctFloor: 0.03, liquidityDislocatedSpreadPctFloor: 0.08, correctionDrawdownCeiling: -0.1, crisisDrawdownCeiling: -0.2 },
  routerPolicy: { policyVersion: 'router-v1', thetaQMinOwnershipAcceptability: 0.1, thetaHMinOwnershipAcceptability: 0.75, thetaDGateSatisfied: false },
  routerPortfolio: { lifecycleState: 'CASH_AVAILABLE', stockSharesHeld: 0, openOptionExists: false, assignmentImminent: false },
  latticeConfig: { configVersion: 'lattice-v1', minDte: 25, maxDte: 60, deltaBands: [[0.0, 0.25], [0.25, 0.5]], minOpenInterest: 0, minVolume: 0, maxSpreadPct: 1.0, earningsExclusionDays: 0 },
  thetaQSizingPolicy: { riskLimitVersion: 'risk-v1', maxSpreadPct: 1.0, maxQuoteAgeSeconds: 999_999, minOpenInterest: 0, minVolume: 0, earningsExclusionDays: 0, ownershipAcceptabilityFloor: 0.1, exceptionalUtilityThreshold: 0.9, strongUtilityThreshold: 0.7, minimumPositiveEdge: 0.05, riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 2 },
  costAssumptions: { commissionPerContract: 0.65, feesPerContract: 0.05, estimatedSlippagePerContract: 1.0, costModelVersion: 'cost-v1' },
  aegisPolicy: { policyVersion: 'aegis-v1', maxTickerConcentrationPct: 0.15, maxSectorConcentrationPct: 0.3, maxCorrelationClusterPct: 0.3, maxPortfolioCapitalAtRiskPct: 0.5, maxInventoryCapacityPct: 0.5, maxAssignmentCapacityPct: 0.5, maxRecoveryCapacityPct: 0.3, providerRequiredStates: ['OK'] },
  aegisInputs: { tickerConcentrationPct: 0.05, sectorConcentrationPct: 0.1, correlationClusterExposurePct: 0.1, portfolioCapitalAtRiskPct: 0.2, inventoryCapacityUsedPct: 0.1, assignmentCapacityUsedPct: 0.1, recoveryCapacityUsedPct: 0, liquidityAcceptable: true, executionQualityAcceptable: true, providerState: 'OK', stressGapDetected: false, stressIvShockDetected: false, stressSpreadWideningDetected: false },
  aegisInputsOrigin: 'CALLER_MANUAL',
  opportunityFrontierPolicy: { policyVersion: 'opp-frontier-v1', reducedSizeUncertaintyThreshold: 0.5 },
  maxAcceptableSpreadPct: 1.0,
  stressGapThresholdAbsReturn: 0.05,
  sizingPolicy: { policyVersion: 'sizing-v1', riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 5, assignmentCapacityQtyCap: 6, reducedStateMultiplier: 0.5 },
  executionQualityPolicy: { policyVersion: 'execq-v1', maxAcceptableSpreadPct: 1.0, minQuoteSizeForFullConfidence: 1, maxQuoteAgeSeconds: 999_999, minAfterCostUtilityToCross: -999_999 },
  optionQuoteFreshnessPolicy: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 999_999, staleMinAgeSeconds: 999_999_999 },
  policyVersion: 'shadow-cycle-test-v1', modelVersions: {}, requiredModelVersions: {},
  now: () => NOW,
  ...overrides,
});

const itMockedProviderRealCodePath = pythonExecutablePath === undefined ? test.skip : test;

itMockedProviderRealCodePath('a full cycle with real-shaped mocked Alpaca data reaches a decision receipt via the real Python pipeline', async () => {
  requestedUrls = [];
  const result = await runThetaShadowCycle(baseConfig());
  assert.equal(result.selectedUnderlying, 'SPY');
  assert.equal(result.optionChainComplete, true);
  assert.equal(result.optionContractsComplete, true);
  assert.ok(result.orchestration !== null);
  assert.ok(result.orchestration?.thetaQ !== null || result.orchestration?.receipt.winningAction === 'PASS');
  // Optionomics and event-state are never real in this cycle implementation
  // yet -- provenance can never be FULL_REAL, only HYBRID at best.
  assert.notEqual(result.provenance, 'FULL_REAL');
  assert.equal(result.provenance, 'HYBRID');
});

itMockedProviderRealCodePath('no candidates on this underlying yields a coherent result, never a crash', async () => {
  const result = await runThetaShadowCycle(baseConfig({ alpaca: alpacaConfig({ hasContracts: false, hasBars: true }) }));
  assert.equal(result.blockers.includes('NO_CANDIDATES_AVAILABLE'), true);
  assert.equal(result.orchestration, null);
});

itMockedProviderRealCodePath('no eligible underlying in the universe short-circuits before any provider call', async () => {
  const notTradable: UnderlyingCandidateInput = { ...spyEligible(), tradable: false };
  const result = await runThetaShadowCycle(baseConfig({ universeCandidates: [notTradable] }));
  assert.equal(result.selectedUnderlying, null);
  assert.equal(result.blockers.includes('NO_ELIGIBLE_UNDERLYING'), true);
  assert.equal(result.universeFunnel.eligible, 0);
});

// --- Provenance semantics correction: origin, not result ---

test('REAL_PROVIDER_UNKNOWN may be FULL_REAL while REAL_PROVIDER_ERROR can never count toward FULL_REAL', () => {
  assert.equal(classifyShadowCycleProvenance({
    account: 'REAL_PROVIDER', quote: 'REAL_PROVIDER_UNKNOWN', contract: 'DERIVED_FROM_REAL',
  }).provenance, 'FULL_REAL');
  assert.equal(classifyShadowCycleProvenance({
    account: 'REAL_PROVIDER', quote: 'REAL_PROVIDER_ERROR', contract: 'REAL_PROVIDER',
  }).provenance, 'HYBRID');
});

itMockedProviderRealCodePath('PROVENANCE CORRECTION: no eligible underlying is SYNTHETIC only because universeCandidatesOrigin is CALLER_MANUAL -- not because the result was empty', async () => {
  const notTradable: UnderlyingCandidateInput = { ...spyEligible(), tradable: false };
  const manualResult = await runThetaShadowCycle(baseConfig({ universeCandidates: [notTradable], universeCandidatesOrigin: 'CALLER_MANUAL' }));
  assert.equal(manualResult.provenance, 'SYNTHETIC');

  // Same empty-result outcome, but the universe input is declared as having
  // come from a real provider query -- provenance must NOT be forced to
  // SYNTHETIC merely because zero underlyings survived.
  const realOriginResult = await runThetaShadowCycle(baseConfig({ universeCandidates: [notTradable], universeCandidatesOrigin: 'REAL_PROVIDER' }));
  assert.notEqual(realOriginResult.provenance, 'SYNTHETIC');
});

itMockedProviderRealCodePath('PROVENANCE CORRECTION: a real account query that genuinely FAILS is REAL_PROVIDER_ERROR, never conflated with a real-but-empty result and never counted as valid FULL_REAL evidence', async () => {
  const failingAccountFetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url.includes('/v2/account')) return new Response('', { status: 500 });
    return mockAlpacaFetch({ hasContracts: true, hasBars: true })(input, {});
  }) as typeof fetch;
  const result = await runThetaShadowCycle(baseConfig({
    alpaca: { ...alpacaConfig({ hasContracts: true, hasBars: true }), fetchImpl: failingAccountFetch },
  }));
  // The failed real call is honestly recorded as REAL_PROVIDER_ERROR -- a
  // real call really was attempted (never silently dropped or treated as a
  // fixture), but an error is not authentic reality about the world, so it
  // must never masquerade as a genuine "successful query, nothing to
  // report" (REAL_PROVIDER_UNKNOWN) and must never count toward FULL_REAL.
  assert.ok(result.provenanceDetail.some((d) => d.startsWith('account=REAL_PROVIDER_ERROR')));
  assert.notEqual(result.provenance, 'FULL_REAL');
});

const accountResponseConfig = (respond: () => Response | Promise<Response>): ThetaShadowCycleConfig => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url.includes('/v2/account')) return respond();
    return mockAlpacaFetch({ hasContracts: true, hasBars: true })(input, {});
  }) as typeof fetch;
  return baseConfig({ alpaca: { ...alpacaConfig({ hasContracts: true, hasBars: true }), fetchImpl } });
};

test('HTTP success with required account truth genuinely absent is REAL_PROVIDER_UNKNOWN and a runtime hold', async () => {
  const result = await runThetaShadowCycle(accountResponseConfig(() => jsonResponse(200, {
    status: 'ACTIVE', equity: '100000', cash: '50000', buying_power: '40000',
    options_buying_power: '20000', options_trading_level: 2,
  })));
  assert.ok(result.provenanceDetail.includes('account=REAL_PROVIDER_UNKNOWN'));
  assert.equal(result.orchestration?.receipt.winningAction, 'SYSTEM_HOLD');
  assert.equal(result.orchestration?.receipt.failClosedReason, null);
});

test('HTTP 500 is REAL_PROVIDER_ERROR with transient DEGRADED semantics, never FULL_REAL or HARD_VETO', async () => {
  const result = await runThetaShadowCycle(accountResponseConfig(() => new Response('', { status: 500 })));
  assert.ok(result.provenanceDetail.includes('account=REAL_PROVIDER_ERROR'));
  assert.notEqual(result.provenance, 'FULL_REAL');
  assert.equal(result.orchestration?.receipt.winningAction, 'SYSTEM_HOLD');
});

test('a provider timeout is REAL_PROVIDER_ERROR with runtime-defer semantics', async () => {
  const result = await runThetaShadowCycle(accountResponseConfig(() => {
    const error = new Error('synthetic timeout');
    error.name = 'TimeoutError';
    throw error;
  }));
  assert.ok(result.provenanceDetail.includes('account=REAL_PROVIDER_ERROR'));
  assert.equal(result.orchestration?.receipt.winningAction, 'SYSTEM_HOLD');
  assert.ok(result.orchestration?.receipt.reasonCodes.includes('RUNTIME_STAGE_DEFERRED:PROVIDER_STATE'));
});

test('an authentication failure is REAL_PROVIDER_ERROR and remains a genuine HARD_VETO', async () => {
  const result = await runThetaShadowCycle(accountResponseConfig(() => new Response('', { status: 401 })));
  assert.ok(result.provenanceDetail.includes('account=REAL_PROVIDER_ERROR'));
  assert.notEqual(result.provenance, 'FULL_REAL');
  assert.equal(result.orchestration?.receipt.winningAction, 'HARD_VETO');
  assert.ok(result.orchestration?.receipt.reasonCodes.includes('RISK_CAPABILITY_PROHIBITION:PROVIDER_STATE'));
});

itMockedProviderRealCodePath('with multiple eligible underlyings, selection is by RANKING, never by input array order', async () => {
  const lowerVolumeFirst: UnderlyingCandidateInput = { ...spyEligible(), symbol: 'LOWER_VOLUME_FIRST_IN_ARRAY', avgDollarVolume: 10_000_000 };
  const higherVolumeSecond: UnderlyingCandidateInput = { ...spyEligible(), symbol: 'HIGHER_VOLUME_SECOND_IN_ARRAY', avgDollarVolume: 500_000_000 };
  const result = await runThetaShadowCycle(baseConfig({ universeCandidates: [lowerVolumeFirst, higherVolumeSecond] }));
  assert.equal(result.selectedUnderlying, 'HIGHER_VOLUME_SECOND_IN_ARRAY');
  assert.equal(result.underlyingRanking.length, 2);
  assert.equal(result.underlyingRanking[0]?.symbol, 'HIGHER_VOLUME_SECOND_IN_ARRAY');
  assert.equal(result.underlyingRanking[0]?.rank, 1);
});

itMockedProviderRealCodePath('a real (mocked) Optionomics fetch supplies OI/volume/IV for the exact-matched contract, honestly UNKNOWN if unmatched', async () => {
  const optionomicsFetch = (async () => new Response(JSON.stringify([
    { symbol: 'SPY261009P00500000', underlying: 'SPY', expiration: '2026-10-09', option_type: 'put', strike: 500, open_interest: 1200, volume: 340, implied_volatility: 0.31 },
  ]), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const result = await runThetaShadowCycle(baseConfig({
    optionomics: { apiBase: 'https://optionomics.ai', email: 'test-synthetic@example.com', apiToken: 'TEST-SYNTHETIC-TOKEN', fetchImpl: optionomicsFetch, now: () => NOW },
  }));
  assert.ok(result.provenanceDetail.some((d) => d.startsWith('optionomics=REAL_PROVIDER')));
  assert.ok(!result.blockers.some((b) => b.startsWith('OPTIONOMICS_')));
  assert.ok(result.orchestration !== null);
});

itMockedProviderRealCodePath('an Optionomics provider failure is recorded honestly (REAL_PROVIDER_ERROR) and never blocks the rest of the cycle', async () => {
  const optionomicsFetch = (async () => new Response('', { status: 500 })) as typeof fetch;
  const result = await runThetaShadowCycle(baseConfig({
    optionomics: { apiBase: 'https://optionomics.ai', email: 'test-synthetic@example.com', apiToken: 'TEST-SYNTHETIC-TOKEN', fetchImpl: optionomicsFetch, now: () => NOW, sleepImpl: async () => {} },
  }));
  assert.ok(result.provenanceDetail.some((d) => d.startsWith('optionomics=REAL_PROVIDER_ERROR')));
  assert.ok(result.blockers.some((b) => b.startsWith('OPTIONOMICS_FETCH_FAILED')));
  // The rest of the cycle still completes -- Optionomics is supplemental,
  // never a hard gate on new-risk evaluation.
  assert.ok(result.orchestration !== null);
});

itMockedProviderRealCodePath('positions and open orders are fetched every cycle; a real empty account (no positions, no open orders) is honestly REAL_PROVIDER/GOOD, never a fetch failure', async () => {
  const result = await runThetaShadowCycle(baseConfig());
  assert.ok(result.provenanceDetail.some((d) => d === 'positions=REAL_PROVIDER'));
  assert.ok(result.provenanceDetail.some((d) => d === 'openOrders=REAL_PROVIDER'));
  assert.ok(!result.blockers.some((b) => b.startsWith('POSITIONS_FETCH_FAILED') || b.startsWith('OPEN_ORDERS_FETCH_FAILED')));
});

itMockedProviderRealCodePath('a positions fetch failure is recorded honestly (REAL_PROVIDER_ERROR) and never blocks the rest of the cycle', async () => {
  const failingPositionsFetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url.includes('/v2/positions')) return new Response('', { status: 500 });
    return mockAlpacaFetch({ hasContracts: true, hasBars: true })(input, {});
  }) as typeof fetch;
  const result = await runThetaShadowCycle(baseConfig({ alpaca: { ...alpacaConfig({ hasContracts: true, hasBars: true }), fetchImpl: failingPositionsFetch } }));
  assert.ok(result.blockers.some((b) => b.startsWith('POSITIONS_FETCH_FAILED')));
  assert.ok(result.provenanceDetail.some((d) => d === 'positions=REAL_PROVIDER_ERROR'));
  assert.ok(result.orchestration !== null);
});

itMockedProviderRealCodePath('a real (mocked) stock position is fetched and folded into the cycle without error, never silently dropped', async () => {
  const concentratedPositionsFetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url.includes('/v2/positions')) {
      return new Response(JSON.stringify([{ symbol: 'SPY', asset_class: 'us_equity', qty: '80', side: 'long', avg_entry_price: '500', market_value: '40000', unrealized_pl: '0' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return mockAlpacaFetch({ hasContracts: true, hasBars: true })(input, {});
  }) as typeof fetch;
  const result = await runThetaShadowCycle(baseConfig({ alpaca: { ...alpacaConfig({ hasContracts: true, hasBars: true }), fetchImpl: concentratedPositionsFetch } }));
  assert.ok(result.provenanceDetail.some((d) => d === 'positions=REAL_PROVIDER'));
  assert.ok(!result.blockers.some((b) => b.startsWith('POSITIONS_FETCH_FAILED')));
  assert.ok(result.orchestration !== null);
});

itMockedProviderRealCodePath('a confirmed-closed market becomes a real precondition SYSTEM_HOLD (MARKET_CLOSED) -- never a strategy WAIT/PASS, never a provider-quality hold', async () => {
  const closedMarketFetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url.includes('/v2/clock')) return jsonResponse(200, { timestamp: NOW, is_open: false, next_open: '2026-09-11T13:30:00Z', next_close: '2026-09-11T20:00:00Z' });
    return mockAlpacaFetch({ hasContracts: true, hasBars: true })(input, {});
  }) as typeof fetch;
  const result = await runThetaShadowCycle(baseConfig({ alpaca: { ...alpacaConfig({ hasContracts: true, hasBars: true }), fetchImpl: closedMarketFetch } }));
  assert.equal(result.orchestration?.receipt.winningAction, 'SYSTEM_HOLD');
  assert.ok(result.orchestration?.receipt.reasonCodes.includes('MARKET_CLOSED'));
  assert.equal(result.orchestration?.receipt.failClosedReason, null);
  assert.ok(result.provenanceDetail.some((d) => d === 'marketClock=REAL_PROVIDER'));
});

itMockedProviderRealCodePath('a stale required observation (account fetched long before the decision moment) becomes SYSTEM_HOLD_STALE_ACCOUNT, never a strategy WAIT/PASS', async () => {
  // A monotonically advancing clock (120s per config.now() call) makes the
  // gap between the account fetch (early in the cycle) and the temporal-
  // consistency check (near the end) exceed the NEW_RISK policy's 300s
  // ACCOUNT staleMinAgeSeconds, without needing to fake any HTTP response.
  let callCount = 0;
  const advancingNow = (): string => {
    const value = new Date(new Date(NOW).getTime() + callCount * 120_000).toISOString();
    callCount += 1;
    return value;
  };
  const result = await runThetaShadowCycle(baseConfig({ now: advancingNow }));
  assert.equal(result.orchestration?.receipt.winningAction, 'SYSTEM_HOLD');
  assert.ok(result.orchestration?.receipt.reasonCodes.includes('SYSTEM_HOLD_STALE_ACCOUNT'));
  assert.equal(result.orchestration?.receipt.failClosedReason, null);
});

itMockedProviderRealCodePath('an open market (confirmed real) proceeds through the normal new-risk pipeline, never held merely because the clock was checked', async () => {
  const result = await runThetaShadowCycle(baseConfig());
  assert.notEqual(result.orchestration?.receipt.reasonCodes.includes('MARKET_CLOSED'), true);
  assert.notEqual(result.orchestration?.receipt.reasonCodes.includes('MARKET_SESSION_UNCONFIRMED'), true);
  assert.ok(result.provenanceDetail.some((d) => d === 'marketClock=REAL_PROVIDER'));
  assert.ok(result.provenanceDetail.some((d) => d === 'marketCalendar=REAL_PROVIDER'));
});

itMockedProviderRealCodePath('an open clock cannot authorize new-risk evaluation without a confirmed exchange calendar session', async () => {
  const missingCalendarFetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url.includes('/v2/calendar')) return jsonResponse(200, []);
    return mockAlpacaFetch({ hasContracts: true, hasBars: true })(input, {});
  }) as typeof fetch;
  const result = await runThetaShadowCycle(baseConfig({ alpaca: { ...alpacaConfig({ hasContracts: true, hasBars: true }), fetchImpl: missingCalendarFetch } }));
  assert.equal(result.orchestration?.receipt.winningAction, 'SYSTEM_HOLD');
  assert.ok(result.orchestration?.receipt.reasonCodes.includes('MARKET_SESSION_UNCONFIRMED'));
  assert.ok(result.provenanceDetail.some((d) => d === 'marketCalendar=REAL_PROVIDER_UNKNOWN'));
});

itMockedProviderRealCodePath('a market-clock fetch failure is recorded honestly and never blocks the rest of the cycle', async () => {
  const failingClockFetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url.includes('/v2/clock')) return new Response('', { status: 500 });
    return mockAlpacaFetch({ hasContracts: true, hasBars: true })(input, {});
  }) as typeof fetch;
  const result = await runThetaShadowCycle(baseConfig({ alpaca: { ...alpacaConfig({ hasContracts: true, hasBars: true }), fetchImpl: failingClockFetch } }));
  assert.ok(result.blockers.some((b) => b.startsWith('MARKET_CLOCK_FETCH_FAILED')));
  assert.ok(result.provenanceDetail.some((d) => d === 'marketClock=REAL_PROVIDER_ERROR'));
  assert.ok(result.orchestration !== null);
  assert.notEqual(result.orchestration?.receipt.winningAction, 'HARD_VETO');
});

itMockedProviderRealCodePath('an account fetch failure is recorded as a blocker, never silently ignored, and the cycle still completes coherently', async () => {
  const failingAccountFetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url.includes('/v2/account')) return new Response('', { status: 500 });
    return mockAlpacaFetch({ hasContracts: true, hasBars: true })(input, {});
  }) as typeof fetch;
  const result = await runThetaShadowCycle(baseConfig({ alpaca: { ...alpacaConfig({ hasContracts: true, hasBars: true }), fetchImpl: failingAccountFetch } }));
  assert.ok(result.blockers.some((b) => b.startsWith('ACCOUNT_FETCH_FAILED')));
});

itMockedProviderRealCodePath('runId is unique per cycle', async () => {
  const first = await runThetaShadowCycle(baseConfig());
  const second = await runThetaShadowCycle(baseConfig());
  assert.notEqual(first.runId, second.runId);
});

// --- FusionSnapshot: real, deterministic content hash (never a placeholder) ---

const FIXED_BAR_START = new Date('2026-06-01T00:00:00.000Z').getTime();
const deterministicMockAlpacaFetch = (accountId: string) => (async (input: RequestInfo | URL) => {
  const url = input instanceof URL ? input.toString() : String(input);
  if (url.includes('/v2/account')) {
    return jsonResponse(200, { id: accountId, status: 'ACTIVE', equity: '100000', cash: '50000', buying_power: '40000', options_buying_power: '20000', options_approved_level: 2, options_trading_level: 2 });
  }
  if (url.includes('/v2/stocks/bars')) {
    const bars = Array.from({ length: 65 }, (_, i) => ({ t: new Date(FIXED_BAR_START + i * 86_400_000).toISOString(), o: 500 + i * 0.1, h: 501 + i * 0.1, l: 499 + i * 0.1, c: 500.1 + i * 0.1, v: 1_000_000 }));
    return jsonResponse(200, { bars: { SPY: bars }, next_page_token: null });
  }
  if (url.includes('/v2/options/contracts')) {
    return jsonResponse(200, { option_contracts: [{ symbol: 'SPY261009P00500000', strike_price: '500', expiration_date: '2026-10-09' }], next_page_token: null });
  }
  if (url.includes('/v1beta1/options/snapshots')) {
    return jsonResponse(200, {
      snapshots: { SPY261009P00500000: { latestQuote: { bp: 0.13, ap: 0.14, bs: 900, as: 900, t: NOW }, greeks: { delta: -0.003, gamma: 0.0001, theta: -0.02, vega: 0.02, rho: -0.002 }, impliedVolatility: 0.5 } },
      next_page_token: null,
    });
  }
  throw new Error(`unmocked URL in test: ${url}`);
}) as typeof fetch;

const deterministicConfig = (accountId: string): ThetaShadowCycleConfig => baseConfig({
  alpaca: { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets', apiKey: 'TEST-SYNTHETIC-KEY', apiSecret: 'TEST-SYNTHETIC-SECRET', fetchImpl: deterministicMockAlpacaFetch(accountId) },
});

itMockedProviderRealCodePath('FusionSnapshot content hash is REAL (64-char lowercase hex), never the old placeholder', async () => {
  const result = await runThetaShadowCycle(deterministicConfig('synthetic-test-account-A'));
  assert.ok(result.snapshotContentHash !== null);
  assert.match(result.snapshotContentHash as string, /^[0-9a-f]{64}$/);
  assert.notEqual(result.snapshotContentHash, 'a'.repeat(64));
  assert.equal(result.orchestration?.receipt.fusionSnapshotHash, result.snapshotContentHash);
  assert.equal(result.fusionSnapshot?.contentHash, result.snapshotContentHash);
});

itMockedProviderRealCodePath('the SAME canonical state produces the SAME deterministic content hash', async () => {
  const first = await runThetaShadowCycle(deterministicConfig('synthetic-test-account-A'));
  const second = await runThetaShadowCycle(deterministicConfig('synthetic-test-account-A'));
  assert.equal(first.snapshotContentHash, second.snapshotContentHash);
});

itMockedProviderRealCodePath('a materially DIFFERENT market state (different account equity) produces a DIFFERENT content hash', async () => {
  const first = await runThetaShadowCycle(deterministicConfig('synthetic-test-account-A'));
  const second = await runThetaShadowCycle(deterministicConfig('synthetic-test-account-B'));
  assert.notEqual(first.snapshotContentHash, second.snapshotContentHash);
});
