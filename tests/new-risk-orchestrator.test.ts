import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runNewRiskOrchestration, type RawCandidateInput, type NewRiskOrchestrationRequest } from '../src/theta/new-risk-orchestrator.js';
import type { PythonBridgeConfig } from '../src/theta/python-bridge.js';
import type { NormalizedOptionContract } from '../src/theta/option-contract.js';

// Real end-to-end integration test: spawns the ACTUAL Python runtime
// adapters (not a mock) through the real python-bridge.ts, so a pass here
// proves genuine IPC across the language boundary for the whole new-risk
// pipeline -- ownership -> regime -> strategy-router -> THETA-Q candidate
// lattice -> pareto-frontier -> aegis -> opportunity-frontier -> sizing ->
// execution-quality -> decision assembly -- not just that each stage's
// Python function or TS schema is independently correct. Synthetic data
// only; no market/broker I/O.

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

const NOW = new Date().toISOString();

const contract = (overrides: Partial<NormalizedOptionContract> = {}): NormalizedOptionContract => ({
  contractVersion: 'theta-option-contract-v1', underlying: 'SYN', optionSymbol: 'SYN260116P00050000', occSymbol: null,
  optionType: 'PUT', strike: 50, expiration: '2026-01-16', dte: 45, multiplier: 100,
  underlyingBid: null, underlyingAsk: null, underlyingLast: 52, underlyingReferencePrice: 52, underlyingTimestamp: NOW,
  bid: 0.95, ask: 1.05, bidSize: 50, askSize: 50, lastTradePrice: null, lastTradeSize: null,
  quoteTimestamp: NOW, tradeTimestamp: null,
  midpointReference: 1.0, spread: 0.1, spreadPct: 0.1, moneyness: 0.04, distanceToStrikePct: 0.04, breakEven: 49.05,
  volume: 100, volumeSource: 'ALPACA', openInterest: 500, openInterestSource: 'ALPACA',
  iv: 0.25, delta: -0.22, gamma: null, theta: null, vega: null, rho: null, greeksTimestamp: NOW, greeksSource: 'ALPACA',
  source: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD', receivedAt: NOW, dataAgeSeconds: 1,
  executable: true, nonExecutableReason: null,
  ...overrides,
});

const candidate = (id: string, overrides: Partial<RawCandidateInput> = {}): RawCandidateInput => ({
  candidateId: id, contract: contract({ optionSymbol: id }), entryPremiumPerShare: 1.0,
  severeDrawdownProbability: 0.05, ivRank: 0.4, brokerAllowedQty: 5, contractIsStandard: true,
  hasAlternateContract: false, hasAlternateExpiry: false, hasAlternateStructure: false,
  ivCompensationSufficient: true, quoteSize: 50, preSlippageExpectedUtility: 50,
  ...overrides,
});

const baseRequest = (overrides: Partial<NewRiskOrchestrationRequest> = {}): NewRiskOrchestrationRequest => ({
  snapshotId: 'snap-1', fusionSnapshotHash: 'a'.repeat(64), timestamp: NOW, underlying: 'SYN',
  earningsDistanceDays: 40, optionQuoteFreshnessPolicy: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 10, staleMinAgeSeconds: 60 },
  providerCapabilities: { ALPACA_ACCOUNT: 'GOOD', ALPACA_OPTION_CONTRACTS: 'GOOD', ALPACA_OPTION_CHAIN: 'GOOD' },
  policyVersion: 'v1', modelVersions: {}, requiredModelVersions: {},
  ownershipPolicy: {
    policyVersion: 'ownership-v1', minStockAvgVolume: 1_000_000, minOptionOpenInterest: 100, minOptionVolume: 10,
    maxSpreadPct: 0.15, rvNormalizationCeiling: 0.6, downsideSemivarNormalizationCeiling: 0.3,
    gapFrequencyNormalizationCeiling: 0.5, eventDecayWindowDays: 10,
  },
  ownershipInputs: {
    stockAvgVolume: 5_000_000, optionOpenInterest: 500, optionVolume: 100, spreadPct: 0.02,
    ret1d: 0.001, ret5d: 0.01, ret20d: 0.02, ret60d: 0.05, ma20Rel: 0.02, ma50Rel: 0.03, ma200Rel: 0.05,
    maSlope: 0.01, relativeStrength: 0.2, rv10: 0.15, rv20: 0.18, rv60: 0.2, drawdown: -0.05, maxAdverseGap: 0.02,
    gapFrequency: 0.1, downsideSemivariance: 0.05, historicalRecoveryMedianDays: 20, historicalRecoveryP95Days: 60,
    severeDrawdownEpisodeCount: 1, earningsDistanceDays: 40, exDividendDistanceDays: 90, knownEventDistanceDays: null,
  },
  regimePolicy: {
    policyVersion: 'regime-v1', bullMaSlopeFloor: 0.01, bearMaSlopeCeiling: -0.01, rvLowCeiling: 0.1, rvHighFloor: 0.25,
    rvShockFloor: 0.4, maxAdverseGapShockThreshold: 0.08, liquidityThinSpreadPctFloor: 0.03,
    liquidityDislocatedSpreadPctFloor: 0.08, correctionDrawdownCeiling: -0.1, crisisDrawdownCeiling: -0.2,
  },
  regimeInputs: {
    maSlope: 0.02, rv20: 0.15, maxAdverseGap: 0.01, earningsDistanceDays: 40, corporateActionPending: false,
    macroRiskFlag: false, spreadPct: 0.01, portfolioOrMarketDrawdown: -0.02,
  },
  routerPolicy: { policyVersion: 'router-v1', thetaQMinOwnershipAcceptability: 0.3, thetaHMinOwnershipAcceptability: 0.75, thetaDGateSatisfied: false },
  routerPortfolio: { lifecycleState: 'CASH_AVAILABLE', stockSharesHeld: 0, openOptionExists: false, assignmentImminent: false },
  latticeConfig: {
    configVersion: 'lattice-v1', minDte: 25, maxDte: 60, deltaBands: [[0.10, 0.20], [0.20, 0.30]],
    minOpenInterest: 50, minVolume: 10, maxSpreadPct: 0.15, earningsExclusionDays: 5,
  },
  thetaQSizingPolicy: {
    riskLimitVersion: 'risk-v1', maxSpreadPct: 0.15, maxQuoteAgeSeconds: 5, minOpenInterest: 50, minVolume: 10,
    earningsExclusionDays: 5, ownershipAcceptabilityFloor: 0.3, exceptionalUtilityThreshold: 0.9,
    strongUtilityThreshold: 0.7, minimumPositiveEdge: 0.05, riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 2,
  },
  costAssumptions: { commissionPerContract: 0.65, feesPerContract: 0.05, estimatedSlippagePerContract: 1.0, costModelVersion: 'cost-v1' },
  aegisPolicy: {
    policyVersion: 'aegis-v1', maxTickerConcentrationPct: 0.15, maxSectorConcentrationPct: 0.3, maxCorrelationClusterPct: 0.3,
    maxPortfolioCapitalAtRiskPct: 0.5, maxInventoryCapacityPct: 0.5, maxAssignmentCapacityPct: 0.5,
    maxRecoveryCapacityPct: 0.3, providerRequiredStates: ['OK'],
  },
  aegisInputs: {
    tickerConcentrationPct: 0.05, sectorConcentrationPct: 0.1, correlationClusterExposurePct: 0.1,
    portfolioCapitalAtRiskPct: 0.2, inventoryCapacityUsedPct: 0.1, assignmentCapacityUsedPct: 0.1,
    recoveryCapacityUsedPct: 0, liquidityAcceptable: true, executionQualityAcceptable: true, providerState: 'OK',
    stressGapDetected: false, stressIvShockDetected: false, stressSpreadWideningDetected: false,
  },
  opportunityFrontierPolicy: { policyVersion: 'opp-frontier-v1', reducedSizeUncertaintyThreshold: 0.5 },
  maxAcceptableSpreadPct: 0.15,
  candidates: [candidate('C1')],
  sizingPolicy: { policyVersion: 'sizing-v1', riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 5, assignmentCapacityQtyCap: 6, reducedStateMultiplier: 0.5 },
  sizingAccount: { equity: 100_000, cash: 50_000, buyingPower: 40_000, brokerAllowedQty: 10 },
  executionQualityPolicy: { policyVersion: 'execq-v1', maxAcceptableSpreadPct: 0.15, minQuoteSizeForFullConfidence: 20, maxQuoteAgeSeconds: 5, minAfterCostUtilityToCross: 0 },
  ...overrides,
});

const itMockedProviderRealCodePath = pythonExecutablePath === undefined ? test.skip : test;

itMockedProviderRealCodePath('a real THETA-Q lattice candidate flows end to end to a decision receipt with sizing and execution quality', async () => {
  const result = await runNewRiskOrchestration(bridge(), baseRequest());
  assert.equal(result.receipt.failClosedReason, null);
  assert.ok(result.ownership !== null);
  assert.ok(result.regime !== null);
  assert.ok(result.routing !== null);
  assert.ok(result.thetaQ !== null);
  assert.ok(result.aegis !== null);
  assert.ok(result.opportunityBook !== null);
  assert.equal(result.thetaQ?.candidates.length, 1);
  // THETA-Q's own baseline has no calibrated entry-outcome model yet, so
  // ev_net is honestly null -- this correctly routes to PASS, never a
  // fabricated OPEN.
  assert.equal(result.receipt.selectedCandidateId, null);
  assert.ok(result.shadowOpportunities.length >= 1);
});

itMockedProviderRealCodePath('every evaluated candidate is recorded in the shadow opportunity book, not only the winner', async () => {
  const result = await runNewRiskOrchestration(bridge(), baseRequest({
    candidates: [candidate('C1'), candidate('C2', { contract: contract({ optionSymbol: 'C2', strike: 45 }) })],
  }));
  const recordedIds = result.shadowOpportunities.map((entry) => entry.contractSymbol);
  assert.ok(recordedIds.includes('C1'));
  assert.ok(recordedIds.includes('C2'));
});

itMockedProviderRealCodePath('a delta-UNKNOWN contract is excluded from the lattice call and recorded as PASS/UNKNOWN_DELTA', async () => {
  const result = await runNewRiskOrchestration(bridge(), baseRequest({
    candidates: [candidate('C1', { contract: contract({ optionSymbol: 'C1', delta: null }) })],
  }));
  assert.equal(result.thetaQ, null); // never sent to the lattice at all
  const entry = result.shadowOpportunities.find((e) => e.contractSymbol === 'C1');
  assert.equal(entry?.rejectionCategory, 'UNKNOWN_DELTA');
});

itMockedProviderRealCodePath('a stale option quote is excluded from the lattice call and recorded as WAIT/WAIT_LIQUIDITY, NEVER as PASS -- never sent to Python', async () => {
  const staleTimestamp = new Date(Date.now() - 3600_000).toISOString(); // 1 hour old
  const result = await runNewRiskOrchestration(bridge(), baseRequest({
    candidates: [candidate('C1', { contract: contract({ optionSymbol: 'C1', quoteTimestamp: staleTimestamp }) })],
  }));
  assert.equal(result.thetaQ, null); // excluded before the lattice ever ran
  const entry = result.shadowOpportunities.find((e) => e.contractSymbol === 'C1');
  assert.equal(entry?.outcome, 'WAIT');
  assert.equal(entry?.waitReason, 'WAIT_LIQUIDITY');
  assert.notEqual(entry?.outcome, 'PASS');
  assert.equal(entry?.rejectionCategory, 'OPTION_QUOTE_STALE');
  assert.equal(result.receipt.winningAction, 'WAIT'); // the receipt itself must never call this PASS either
  const alternative = result.receipt.alternatives.find((a) => a.candidateId === 'C1');
  assert.equal(alternative?.disposition, 'WAIT');
});

itMockedProviderRealCodePath('a quote with no observation timestamp is excluded as WAIT/WAIT_LIQUIDITY, NEVER as PASS -- freshness is never assumed', async () => {
  const result = await runNewRiskOrchestration(bridge(), baseRequest({
    candidates: [candidate('C1', { contract: contract({ optionSymbol: 'C1', quoteTimestamp: null }) })],
  }));
  assert.equal(result.thetaQ, null);
  const entry = result.shadowOpportunities.find((e) => e.contractSymbol === 'C1');
  assert.equal(entry?.outcome, 'WAIT');
  assert.equal(entry?.waitReason, 'WAIT_LIQUIDITY');
  assert.equal(entry?.rejectionCategory, 'OPTION_QUOTE_UNKNOWN');
});

itMockedProviderRealCodePath('a fresh quote still reaches the lattice -- the freshness gate never blocks a genuinely fresh candidate', async () => {
  const result = await runNewRiskOrchestration(bridge(), baseRequest({
    candidates: [candidate('C1', { contract: contract({ optionSymbol: 'C1', quoteTimestamp: NOW }) })],
  }));
  assert.ok(result.thetaQ !== null);
});

itMockedProviderRealCodePath('provider state not good fails the whole decision closed before any bridge call', async () => {
  const result = await runNewRiskOrchestration(bridge(), baseRequest({ providerCapabilities: { ALPACA_ACCOUNT: 'UNKNOWN', ALPACA_OPTION_CONTRACTS: 'GOOD', ALPACA_OPTION_CHAIN: 'GOOD' } }));
  assert.equal(result.receipt.winningAction, 'HARD_VETO');
  assert.equal(result.ownership, null);
});

itMockedProviderRealCodePath('STRUCTURED PROVIDER STATE: each required capability is checked independently -- a single DEGRADED capability fails closed even when the other two are GOOD', async () => {
  const onlyChainDegraded = await runNewRiskOrchestration(bridge(), baseRequest({
    providerCapabilities: { ALPACA_ACCOUNT: 'GOOD', ALPACA_OPTION_CONTRACTS: 'GOOD', ALPACA_OPTION_CHAIN: 'STALE' },
  }));
  assert.equal(onlyChainDegraded.receipt.winningAction, 'HARD_VETO');
  assert.ok(onlyChainDegraded.receipt.failClosedReason?.includes('ALPACA_OPTION_CHAIN=STALE'));

  const onlyContractsUnknown = await runNewRiskOrchestration(bridge(), baseRequest({
    providerCapabilities: { ALPACA_ACCOUNT: 'GOOD', ALPACA_OPTION_CONTRACTS: 'UNKNOWN', ALPACA_OPTION_CHAIN: 'GOOD' },
  }));
  assert.equal(onlyContractsUnknown.receipt.winningAction, 'HARD_VETO');
  assert.ok(onlyContractsUnknown.receipt.failClosedReason?.includes('ALPACA_OPTION_CONTRACTS=UNKNOWN'));

  // All three GOOD (the baseRequest default) proceeds normally -- proving
  // this isn't just "any non-empty object passes."
  const allGood = await runNewRiskOrchestration(bridge(), baseRequest());
  assert.notEqual(allGood.receipt.winningAction, 'HARD_VETO');
});

itMockedProviderRealCodePath('STRUCTURED PROVIDER STATE: capabilities NOT required for new risk (positions/orders/Optionomics/event data) do not block evaluation even when UNKNOWN', async () => {
  const result = await runNewRiskOrchestration(bridge(), baseRequest({
    providerCapabilities: { ALPACA_ACCOUNT: 'GOOD', ALPACA_OPTION_CONTRACTS: 'GOOD', ALPACA_OPTION_CHAIN: 'GOOD', ALPACA_POSITIONS: 'UNKNOWN', ALPACA_OPEN_ORDERS: 'UNKNOWN', OPTIONOMICS: 'UNKNOWN', EVENT_DATA: 'UNKNOWN' },
  }));
  assert.notEqual(result.receipt.winningAction, 'HARD_VETO');
});

itMockedProviderRealCodePath('CASH_AVAILABLE + acceptable ownership routes THETA_Q eligible', async () => {
  const result = await runNewRiskOrchestration(bridge(), baseRequest());
  assert.ok(result.routing !== null);
  const thetaQ = result.routing.results.find((r) => r.strategyFamily === 'THETA_Q');
  assert.equal(thetaQ?.eligible, true);
});

itMockedProviderRealCodePath('an already-open CSP lifecycle routes THETA_Q ineligible and produces zero evaluated candidates', async () => {
  const result = await runNewRiskOrchestration(bridge(), baseRequest({
    routerPortfolio: { lifecycleState: 'CSP_OPEN', stockSharesHeld: 0, openOptionExists: true, assignmentImminent: false },
  }));
  const thetaQ = result.routing?.results.find((r) => r.strategyFamily === 'THETA_Q');
  assert.equal(thetaQ?.eligible, false);
  assert.equal(result.receipt.alternatives.length, 0);
  assert.equal(result.receipt.winningAction, 'PASS');
  assert.equal(result.shadowOpportunities.some((e) => e.rejectionCategory === 'THETA_Q_INELIGIBLE'), true);
});

itMockedProviderRealCodePath('an unknown model family in the allowlist fails the whole decision closed at that stage', async () => {
  const badBridge: PythonBridgeConfig = { ...bridge(), scriptAllowlist: new Map() };
  const result = await runNewRiskOrchestration(badBridge, baseRequest());
  assert.equal(result.receipt.winningAction, 'HARD_VETO');
  assert.ok(result.receipt.reasonCodes.some((code) => code.startsWith('PIPELINE_STAGE_FAILED:OWNERSHIP')));
});
