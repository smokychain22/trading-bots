import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { mergeOptionChain, type AlpacaOptionContractListing, type AlpacaOptionSnapshot, type OptionomicsChainEntry } from '../src/theta/option-chain-ingestion.js';
import { runNewRiskOrchestration, type RawCandidateInput } from '../src/theta/new-risk-orchestrator.js';
import type { PythonBridgeConfig } from '../src/theta/python-bridge.js';

// Proves the item-7 requirement: separate "rejected because OI/volume is
// genuinely below the frozen TRD-section-18 floor" from "rejected because
// OI/volume is UNKNOWN." Uses REALISTIC-but-SYNTHETIC values -- no live
// credentials are present in this environment this session, so this is
// NOT a live-data proof. The specific open-interest/volume magnitudes used
// below mirror real values this engagement previously observed from a real
// Optionomics API response for real SPY put contracts (documented, without
// reproducing any credential, in docs/quant/phase6_router/DATA_GAP_REGISTER.md).

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
const MIN_OI = 50; // theta_q_contract's request-level sizingPolicy.minOpenInterest floor
const MIN_VOLUME = 10;

// Five realistic SPY put contracts, 25-60 DTE, mirroring real strikes/deltas
// this engagement previously observed. Open interest values (10, 21, null,
// 60, null) mirror the real range previously observed from Optionomics
// (single- and double-digit OI for far-OTM strikes is realistic and was
// directly observed) plus deliberately-included UNKNOWN cases.
const CONTRACTS: readonly AlpacaOptionContractListing[] = [
  { symbol: 'SPY261009P00500000', strikePrice: 500, expirationDate: '2026-10-09', optionType: 'PUT' },
  { symbol: 'SPY261009P00505000', strikePrice: 505, expirationDate: '2026-10-09', optionType: 'PUT' },
  { symbol: 'SPY261009P00510000', strikePrice: 510, expirationDate: '2026-10-09', optionType: 'PUT' },
  { symbol: 'SPY261009P00515000', strikePrice: 515, expirationDate: '2026-10-09', optionType: 'PUT' },
  { symbol: 'SPY261009P00520000', strikePrice: 520, expirationDate: '2026-10-09', optionType: 'PUT' },
];

const alpacaSnapshot = (bid: number, ask: number, delta: number): AlpacaOptionSnapshot => ({
  bid, ask, bidSize: 900, askSize: 900, quoteTimestamp: NOW,
  greeks: { delta, gamma: 0.0001, theta: -0.02, vega: 0.02, rho: -0.002 },
  impliedVolatility: 0.5, dailyVolume: null, // Alpaca's own snapshot did not supply volume in this session's real observations
});

const SNAPSHOTS = new Map<string, AlpacaOptionSnapshot>([
  ['SPY261009P00500000', alpacaSnapshot(0.13, 0.14, -0.0035)],
  ['SPY261009P00505000', alpacaSnapshot(0.13, 0.14, -0.0035)],
  ['SPY261009P00510000', alpacaSnapshot(0.14, 0.15, -0.0038)],
  ['SPY261009P00515000', alpacaSnapshot(0.11, 0.12, -0.0032)],
  ['SPY261009P00520000', alpacaSnapshot(0.16, 0.17, -0.0044)],
]);

// Real-observed-range OI: two below floor (10, 21), one genuinely UNKNOWN
// (no Optionomics entry at all), one sufficient (60), one at-floor-boundary
// missing (also UNKNOWN, to further exercise the distinction).
const OPTIONOMICS = new Map<string, OptionomicsChainEntry>([
  ['SPY261009P00500000', { symbol: 'SPY261009P00500000', delta: null, gamma: null, theta: null, vega: null, rho: null, impliedVolatility: null, volume: 6, openInterest: 10 }],
  ['SPY261009P00505000', { symbol: 'SPY261009P00505000', delta: null, gamma: null, theta: null, vega: null, rho: null, impliedVolatility: null, volume: 10, openInterest: 21 }],
  ['SPY261009P00510000', { symbol: 'SPY261009P00510000', delta: null, gamma: null, theta: null, vega: null, rho: null, impliedVolatility: null, volume: 40, openInterest: 60 }],
  // SPY261009P00515000: deliberately absent from Optionomics -- OI/volume UNKNOWN
  ['SPY261009P00520000', { symbol: 'SPY261009P00520000', delta: null, gamma: null, theta: null, vega: null, rho: null, impliedVolatility: null, volume: 3, openInterest: 5 }],
]);

const itMockedProviderRealCodePath = pythonExecutablePath === undefined ? test.skip : test;

itMockedProviderRealCodePath('OI/volume hard-gate breakdown: UNKNOWN vs known-below-floor vs sufficient, using realistic (non-live) values', async () => {
  const contracts = mergeOptionChain({
    underlying: 'SPY', asOfDate: '2026-09-10', contracts: CONTRACTS, snapshotsBySymbol: SNAPSHOTS,
    optionomicsBySymbol: OPTIONOMICS, requestedFeed: 'INDICATIVE', multiplier: 100, receivedAt: NOW,
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.5,
  });
  assert.equal(contracts.length, 5);

  // Sanity: confirm the merge produced the expected known/unknown split
  // before even reaching THETA-Q, so the breakdown below is attributable.
  const knownOi = contracts.filter((c) => c.openInterest !== null);
  const unknownOi = contracts.filter((c) => c.openInterest === null);
  assert.equal(knownOi.length, 4);
  assert.equal(unknownOi.length, 1);
  assert.equal(unknownOi[0]?.optionSymbol, 'SPY261009P00515000');

  const candidates: RawCandidateInput[] = contracts.map((contract) => ({
    candidateId: contract.optionSymbol, contract, entryPremiumPerShare: contract.bid ?? 0,
    severeDrawdownProbability: 0.05, ivRank: 0.4, brokerAllowedQty: 5, contractIsStandard: true,
    hasAlternateContract: true, hasAlternateExpiry: false, hasAlternateStructure: false,
    ivCompensationSufficient: true, quoteSize: 900, preSlippageExpectedUtility: null,
  }));

  const result = await runNewRiskOrchestration(bridge(), {
    snapshotId: 'oi-gate-proof', fusionSnapshotHash: 'a'.repeat(64), timestamp: NOW, underlying: 'SPY',
    earningsDistanceDays: 90, optionQuoteFreshnessPolicy: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 10, staleMinAgeSeconds: 60 }, providerStateGood: true, policyVersion: 'oi-gate-proof-v1', modelVersions: {}, requiredModelVersions: {},
    ownershipPolicy: { policyVersion: 'ownership-v1', minStockAvgVolume: 1, minOptionOpenInterest: 1, minOptionVolume: 1, maxSpreadPct: 0.5, rvNormalizationCeiling: 0.6, downsideSemivarNormalizationCeiling: 0.3, gapFrequencyNormalizationCeiling: 0.5, eventDecayWindowDays: 10 },
    ownershipInputs: { stockAvgVolume: 50_000_000, optionOpenInterest: 1000, optionVolume: 100, spreadPct: 0.05, ret1d: 0, ret5d: 0, ret20d: 0, ret60d: 0, ma20Rel: 0.01, ma50Rel: 0.01, ma200Rel: 0.01, maSlope: 0.005, relativeStrength: 0, rv10: 0.15, rv20: 0.15, rv60: 0.15, drawdown: -0.02, maxAdverseGap: 0.01, gapFrequency: 0.05, downsideSemivariance: 0.02, historicalRecoveryMedianDays: 15, historicalRecoveryP95Days: 45, severeDrawdownEpisodeCount: 0, earningsDistanceDays: 90, exDividendDistanceDays: 90, knownEventDistanceDays: null },
    regimePolicy: { policyVersion: 'regime-v1', bullMaSlopeFloor: 0.01, bearMaSlopeCeiling: -0.01, rvLowCeiling: 0.1, rvHighFloor: 0.25, rvShockFloor: 0.4, maxAdverseGapShockThreshold: 0.08, liquidityThinSpreadPctFloor: 0.03, liquidityDislocatedSpreadPctFloor: 0.08, correctionDrawdownCeiling: -0.1, crisisDrawdownCeiling: -0.2 },
    regimeInputs: { maSlope: 0.005, rv20: 0.15, maxAdverseGap: 0.01, earningsDistanceDays: 90, corporateActionPending: false, macroRiskFlag: false, spreadPct: 0.01, portfolioOrMarketDrawdown: -0.02 },
    routerPolicy: { policyVersion: 'router-v1', thetaQMinOwnershipAcceptability: 0.1, thetaHMinOwnershipAcceptability: 0.75, thetaDGateSatisfied: false },
    routerPortfolio: { lifecycleState: 'CASH_AVAILABLE', stockSharesHeld: 0, openOptionExists: false, assignmentImminent: false },
    latticeConfig: { configVersion: 'lattice-v1', minDte: 25, maxDte: 60, deltaBands: [[0.0, 0.25], [0.25, 0.5]], minOpenInterest: MIN_OI, minVolume: MIN_VOLUME, maxSpreadPct: 1.0, earningsExclusionDays: 0 },
    thetaQSizingPolicy: { riskLimitVersion: 'risk-v1', maxSpreadPct: 1.0, maxQuoteAgeSeconds: 999_999, minOpenInterest: MIN_OI, minVolume: MIN_VOLUME, earningsExclusionDays: 0, ownershipAcceptabilityFloor: 0.1, exceptionalUtilityThreshold: 0.9, strongUtilityThreshold: 0.7, minimumPositiveEdge: 0.05, riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 2 },
    costAssumptions: { commissionPerContract: 0.65, feesPerContract: 0.05, estimatedSlippagePerContract: 1.0, costModelVersion: 'cost-v1' },
    aegisPolicy: { policyVersion: 'aegis-v1', maxTickerConcentrationPct: 0.15, maxSectorConcentrationPct: 0.3, maxCorrelationClusterPct: 0.3, maxPortfolioCapitalAtRiskPct: 0.5, maxInventoryCapacityPct: 0.5, maxAssignmentCapacityPct: 0.5, maxRecoveryCapacityPct: 0.3, providerRequiredStates: ['OK'] },
    aegisInputs: { tickerConcentrationPct: 0.05, sectorConcentrationPct: 0.1, correlationClusterExposurePct: 0.1, portfolioCapitalAtRiskPct: 0.2, inventoryCapacityUsedPct: 0.1, assignmentCapacityUsedPct: 0.1, recoveryCapacityUsedPct: 0, liquidityAcceptable: true, executionQualityAcceptable: true, providerState: 'OK', stressGapDetected: false, stressIvShockDetected: false, stressSpreadWideningDetected: false },
    opportunityFrontierPolicy: { policyVersion: 'opp-frontier-v1', reducedSizeUncertaintyThreshold: 0.5 },
    maxAcceptableSpreadPct: 1.0,
    candidates,
    sizingPolicy: { policyVersion: 'sizing-v1', riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 5, assignmentCapacityQtyCap: 6, reducedStateMultiplier: 0.5 },
    sizingAccount: { equity: 100_000, cash: 50_000, buyingPower: 40_000, brokerAllowedQty: 10 },
    executionQualityPolicy: { policyVersion: 'execq-v1', maxAcceptableSpreadPct: 1.0, minQuoteSizeForFullConfidence: 1, maxQuoteAgeSeconds: 999_999, minAfterCostUtilityToCross: -999_999 },
  });

  assert.ok(result.thetaQ !== null, 'theta_q_contract must have run (THETA_Q must be eligible for this to be a meaningful proof)');
  const thetaQCandidates = result.thetaQ?.candidates ?? [];
  assert.equal(thetaQCandidates.length, 5);

  const allReasonCodes = (c: typeof thetaQCandidates[number]) => c.reasons.map((r) => r.code);
  const oiUnknownFailures = thetaQCandidates.filter((c) => allReasonCodes(c).includes('OPEN_INTEREST_UNKNOWN'));
  const oiFloorFailures = thetaQCandidates.filter((c) => allReasonCodes(c).includes('OPEN_INTEREST_BELOW_FLOOR'));
  const volumeUnknownFailures = thetaQCandidates.filter((c) => allReasonCodes(c).includes('VOLUME_UNKNOWN'));
  const volumeFloorFailures = thetaQCandidates.filter((c) => allReasonCodes(c).includes('VOLUME_BELOW_FLOOR'));
  const feasible = thetaQCandidates.filter((c) => c.actionFeasible);

  // Reported breakdown (item 36's required report shape):
  console.log(JSON.stringify({
    totalContracts: thetaQCandidates.length,
    knownOpenInterestCount: knownOi.length,
    unknownOpenInterestCount: unknownOi.length,
    openInterestUnknownFailures: oiUnknownFailures.map((c) => c.candidateId),
    openInterestBelowFloorFailures: oiFloorFailures.map((c) => c.candidateId),
    volumeUnknownFailures: volumeUnknownFailures.map((c) => c.candidateId),
    volumeBelowFloorFailures: volumeFloorFailures.map((c) => c.candidateId),
    feasibleCandidates: feasible.map((c) => c.candidateId),
    note: 'SYNTHETIC realistic-magnitude proof -- no live credentials this session, not a live-data run.',
  }, null, 2));

  // 500 (OI=10<50) and 505 (OI=21<50): known, genuinely below floor.
  assert.ok(oiFloorFailures.some((c) => c.candidateId === 'SPY261009P00500000'));
  assert.ok(oiFloorFailures.some((c) => c.candidateId === 'SPY261009P00505000'));
  // 515: OI never reported by either provider -- UNKNOWN, never a floor failure.
  assert.ok(oiUnknownFailures.some((c) => c.candidateId === 'SPY261009P00515000'));
  assert.ok(!oiFloorFailures.some((c) => c.candidateId === 'SPY261009P00515000'));
  // 510 (OI=60>=50, Optionomics volume=40>=10): should not fail on liquidity at all.
  const c510 = thetaQCandidates.find((c) => c.candidateId === 'SPY261009P00510000');
  assert.ok(c510 !== undefined);
  assert.ok(!allReasonCodes(c510 as typeof thetaQCandidates[number]).includes('OPEN_INTEREST_BELOW_FLOOR'));
  assert.ok(!allReasonCodes(c510 as typeof thetaQCandidates[number]).includes('OPEN_INTEREST_UNKNOWN'));
});
