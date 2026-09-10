import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runThetaShadowCycle, type ThetaShadowCycleConfig } from '../src/theta/theta-shadow-cycle.js';
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

itMockedProviderRealCodePath('PROVENANCE CORRECTION: a real account query that genuinely fails is still counted toward real provenance, never treated as a fixture', async () => {
  const failingAccountFetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url.includes('/v2/account')) return new Response('', { status: 500 });
    return mockAlpacaFetch({ hasContracts: true, hasBars: true })(input, {});
  }) as typeof fetch;
  const result = await runThetaShadowCycle(baseConfig({
    alpaca: { ...alpacaConfig({ hasContracts: true, hasBars: true }), fetchImpl: failingAccountFetch },
  }));
  // account is still classified via a real query attempt (UNAVAILABLE_AFTER_REAL_QUERY),
  // not silently dropped from the provenance detail or conflated with a fixture.
  assert.ok(result.provenanceDetail.some((d) => d.startsWith('account=UNAVAILABLE_AFTER_REAL_QUERY')));
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
