import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runCrossSymbolEconomicFrontier } from '../src/theta/cross-symbol-economic-frontier.js';
import type { RawCandidateInput, NewRiskOrchestrationRequest } from '../src/theta/new-risk-orchestrator.js';
import type { PythonBridgeConfig } from '../src/theta/python-bridge.js';
import type { NormalizedOptionContract } from '../src/theta/option-contract.js';

// Real end-to-end integration test: runs the FULL new-risk pipeline (via
// the real Python subprocesses) for multiple underlyings and combines
// them into one cross-symbol Pareto-dominance comparison -- proving item
// H Stage 2 actually selects across symbols using real economics, not
// just the cheap Stage-1 proxy.

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

const contract = (underlying: string, overrides: Partial<NormalizedOptionContract> = {}): NormalizedOptionContract => ({
  contractVersion: 'theta-option-contract-v1', underlying, optionSymbol: `${underlying}260116P00050000`, occSymbol: null,
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

const candidate = (underlying: string, overrides: Partial<RawCandidateInput> = {}): RawCandidateInput => ({
  candidateId: `${underlying}-C1`, contract: contract(underlying),
  entryPremiumPerShare: 1.0, severeDrawdownProbability: 0.05, ivRank: 0.4, brokerAllowedQty: 5, contractIsStandard: true,
  hasAlternateContract: false, hasAlternateExpiry: false, hasAlternateStructure: false,
  ivCompensationSufficient: true, quoteSize: 50, preSlippageExpectedUtility: 50,
  ...overrides,
});

const requestFor = (underlying: string, overrides: Partial<NewRiskOrchestrationRequest> = {}): NewRiskOrchestrationRequest => ({
  snapshotId: 'snap-1', fusionSnapshotHash: 'a'.repeat(64), timestamp: NOW, underlying,
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
    configVersion: 'lattice-v1', minDte: 5, maxDte: 60, deltaBands: [[0.10, 0.20], [0.20, 0.30]],
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
  candidates: [candidate(underlying)],
  sizingPolicy: { policyVersion: 'sizing-v1', riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 5, assignmentCapacityQtyCap: 6, reducedStateMultiplier: 0.5 },
  sizingAccount: { equity: 100_000, cash: 50_000, buyingPower: 40_000, brokerAllowedQty: 10 },
  executionQualityPolicy: { policyVersion: 'execq-v1', maxAcceptableSpreadPct: 0.15, minQuoteSizeForFullConfidence: 20, maxQuoteAgeSeconds: 5, minAfterCostUtilityToCross: 0 },
  ...overrides,
});

const itRealPythonCodePath = pythonExecutablePath === undefined ? test.skip : test;

itRealPythonCodePath('a strictly better capital-days candidate from one underlying dominates an otherwise-identical, slower one from another', async () => {
  const slow = requestFor('SPY', { candidates: [candidate('SPY', { contract: contract('SPY', { dte: 45 }) })] });
  const fast = requestFor('QQQ', { candidates: [candidate('QQQ', { contract: contract('QQQ', { dte: 20 }) })] });

  const result = await runCrossSymbolEconomicFrontier(bridge(), 'snap-1', NOW, [slow, fast]);
  assert.equal(result.failClosedReason, null);
  const spyCandidate = result.combinedCandidates.find((c) => c.underlying === 'SPY');
  const qqqCandidate = result.combinedCandidates.find((c) => c.underlying === 'QQQ');
  assert.equal(qqqCandidate?.survivesFrontier, true);
  assert.equal(spyCandidate?.survivesFrontier, false);
  assert.ok((spyCandidate?.dominatedBy.length ?? 0) > 0);
  assert.equal(result.selectedUnderlying, 'QQQ');
});

itRealPythonCodePath('a genuine tradeoff (lower tail risk vs. lower capital requirement) keeps both underlyings on the frontier', async () => {
  const lowerCapital = requestFor('SPY', { candidates: [candidate('SPY', { severeDrawdownProbability: 0.15, contract: contract('SPY', { strike: 20 }) })] });
  const lowerTailRisk = requestFor('QQQ', { candidates: [candidate('QQQ', { severeDrawdownProbability: 0.01, contract: contract('QQQ', { strike: 100 }) })] });

  const result = await runCrossSymbolEconomicFrontier(bridge(), 'snap-1', NOW, [lowerCapital, lowerTailRisk]);
  assert.equal(result.failClosedReason, null);
  const survivingUnderlyings = new Set(result.combinedCandidates.filter((c) => c.survivesFrontier).map((c) => c.underlying));
  assert.equal(survivingUnderlyings.has('SPY'), true);
  assert.equal(survivingUnderlyings.has('QQQ'), true);
});

itRealPythonCodePath('a non-standard multiplier changes candidate economics and can decide which underlying wins', async () => {
  const standardMultiplier = requestFor('SPY', { candidates: [candidate('SPY', { contract: contract('SPY', { multiplier: 100 }) })] });
  const largeMultiplier = requestFor('QQQ', {
    candidates: [candidate('QQQ', { contract: contract('QQQ', { multiplier: 250 }) })],
  });

  const result = await runCrossSymbolEconomicFrontier(bridge(), 'snap-1', NOW, [standardMultiplier, largeMultiplier]);
  assert.equal(result.failClosedReason, null);
  const spyCandidate = result.combinedCandidates.find((c) => c.underlying === 'SPY');
  const qqqCandidate = result.combinedCandidates.find((c) => c.underlying === 'QQQ');
  // Same strike (50) and dte for both -- QQQ's multiplier=250 vs SPY's
  // multiplier=100 means QQQ's real capital requirement is 2.5x SPY's,
  // never silently treated as if both were the standard 100.
  assert.ok((qqqCandidate?.economics.capitalRequirement ?? 0) > (spyCandidate?.economics.capitalRequirement ?? 0));
  assert.equal(spyCandidate?.survivesFrontier, true);
  assert.equal(qqqCandidate?.survivesFrontier, false);
  assert.equal(result.selectedUnderlying, 'SPY');
});

itRealPythonCodePath('one underlying producing zero feasible candidates does not break the combined frontier -- the other underlying still wins', async () => {
  const ineligible = requestFor('SPY', { routerPortfolio: { lifecycleState: 'CSP_OPEN', stockSharesHeld: 0, openOptionExists: true, assignmentImminent: false } });
  const eligible = requestFor('QQQ');

  const result = await runCrossSymbolEconomicFrontier(bridge(), 'snap-1', NOW, [ineligible, eligible]);
  assert.equal(result.failClosedReason, null);
  assert.equal(result.combinedCandidates.every((c) => c.underlying === 'QQQ'), true);
  assert.equal(result.selectedUnderlying, 'QQQ');
});

itRealPythonCodePath('every underlying producing zero feasible candidates fails closed rather than selecting arbitrarily', async () => {
  const ineligibleA = requestFor('SPY', { routerPortfolio: { lifecycleState: 'CSP_OPEN', stockSharesHeld: 0, openOptionExists: true, assignmentImminent: false } });
  const ineligibleB = requestFor('QQQ', { routerPortfolio: { lifecycleState: 'CSP_OPEN', stockSharesHeld: 0, openOptionExists: true, assignmentImminent: false } });

  const result = await runCrossSymbolEconomicFrontier(bridge(), 'snap-1', NOW, [ineligibleA, ineligibleB]);
  assert.notEqual(result.failClosedReason, null);
  assert.equal(result.selectedUnderlying, null);
  assert.equal(result.combinedCandidates.length, 0);
});

test('an unknown Python model family fails closed rather than selecting arbitrarily, without a real Python install', async () => {
  const badBridge: PythonBridgeConfig = { ...bridge(), scriptAllowlist: new Map() };
  const result = await runCrossSymbolEconomicFrontier(badBridge, 'snap-1', NOW, [requestFor('SPY'), requestFor('QQQ')]);
  assert.notEqual(result.failClosedReason, null);
  assert.equal(result.selectedUnderlying, null);
});
