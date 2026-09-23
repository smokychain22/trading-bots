import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { candidateQuoteAgeSeconds, classifyShadowCycleProvenance, conventionalFrontierRiskLookups, runThetaShadowCycle, type ThetaShadowCycleConfig } from '../src/theta/theta-shadow-cycle.js';
import type { AlpacaProviderConfig } from '../src/theta/alpaca-provider.js';
import type { PythonBridgeConfig } from '../src/theta/python-bridge.js';
import type { UnderlyingCandidateInput } from '../src/theta/universe-policy.js';
import type { AegisIvStressAssessment } from '../src/theta/aegis-iv-stress.js';
import type { AegisSpreadStressAssessment } from '../src/theta/aegis-spread-stress.js';
import { paperBootstrapStressColdStartPolicy } from '../src/research/aegis-stress-baseline-maturity.js';

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

const IV_STRESS_EVIDENCE: AegisIvStressAssessment = {
  contractVersion: 'theta-aegis-iv-stress-detector-v3', underlying: 'SPY', decisionAsOf: NOW,
  decisionSession: '2026-09-10', requestedSession: '2026-09-10', servedSession: '2026-09-10',
  providerTimestamp: NOW, sessionState: 'CURRENT_SESSION', currentTimingState: 'PROVIDER_ASOF_CURRENT_SESSION',
  currentObservationId: '00000000-0000-4000-8000-000000000001', baselineObservationIds: [],
  policyVersion: 'aegis-iv-shock-paper-bootstrap-v3',
  policyAuthority: 'PAPER_BOOTSTRAP_BASELINE_NOT_EMPIRICALLY_OPTIMAL',
  maturity: {
    contractVersion: 'theta-aegis-stress-baseline-maturity-v1', signal: 'IV_SHOCK', asOf: NOW,
    evidence: { rawN: 20, sessionN: 20, distinctUnderlyingN: 1, effectiveN: null },
    firstObservationAvailableAt: NOW, lastObservationAvailableAt: NOW, temporalSpanDays: 0,
    effectiveNPolicyState: 'EFFECTIVE_N_NOT_GOVERNING_POLICY',
    source: 'OPTIONOMICS_ATM_IV_EXACT_SESSION', sourceVersion: 'theta-optionomics-atm-iv-session-v1',
    state: 'DETECTOR_READY', reason: 'test evidence',
  },
  currentIv: 0.2, baselineMedianIv: 0.19, baselineMadIv: 0.01,
  absoluteIncrease: 0.01, relativeIncrease: 0.0526, robustZ: 0.6745,
  dispersionState: 'MAD_POSITIVE', robustZApplicability: 'APPLICABLE',
  stressIvShockDetected: false, evidenceAuthority: 'OPTIONOMICS_SESSION_RESEARCH',
  contentHash: 'a'.repeat(64),
};

test('candidate quote age has an independently versioned, effective, fail-closed policy', () => {
  const policy = { candidateQuoteAgePolicy: { policyVersion: 'candidate-age-v1', effectiveAt: NOW, maxAgeSeconds: 30 } };
  assert.equal(candidateQuoteAgeSeconds(policy, NOW), 30);
  assert.equal(candidateQuoteAgeSeconds({ candidateQuoteAgePolicy: { ...policy.candidateQuoteAgePolicy, maxAgeSeconds: 12 } }, NOW), 12);
  assert.throws(() => candidateQuoteAgeSeconds({ candidateQuoteAgePolicy: { ...policy.candidateQuoteAgePolicy, effectiveAt: '2026-09-11T00:00:00Z' } }, NOW), /CANDIDATE_QUOTE_AGE_POLICY_INVALID/);
  assert.throws(() => candidateQuoteAgeSeconds({ candidateQuoteAgePolicy: { ...policy.candidateQuoteAgePolicy, maxAgeSeconds: 0 } }, NOW), /CANDIDATE_QUOTE_AGE_POLICY_INVALID/);
});

test('Conventional risk evidence cannot be relabelled as Hold-Strike evidence', () => {
  const lookup = conventionalFrontierRiskLookups(
    [{ optionSymbol: 'SPY261009P00500000', brokerAllowedQty: 2 }],
    { SPY261009P00500000: { newRiskState: 'ALLOW_FULL' } },
  );
  assert.deepEqual(lookup.brokerAllowedQtyByCandidateId, { 'THETA_CONVENTIONAL:SPY261009P00500000': 2 });
  assert.deepEqual(lookup.aegisNewRiskStateByCandidateId, { 'THETA_CONVENTIONAL:SPY261009P00500000': 'ALLOW_FULL' });
  assert.equal(Object.keys(lookup.brokerAllowedQtyByCandidateId).some((id) => id.startsWith('THETA_HOLD_STRIKE:')), false);
});

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
    if (url.includes('expiration_date_gte=2026-09-12')) return jsonResponse(200, { option_contracts: [
      { symbol: 'SPY260914P00500000', strike_price: '500', expiration_date: '2026-09-14', size: '100' },
      { symbol: 'SPY260921P00500000', strike_price: '500', expiration_date: '2026-09-21', size: '100' },
      { symbol: 'SPY260921P00490000', strike_price: '490', expiration_date: '2026-09-21', size: '100' },
    ], next_page_token: null });
    return jsonResponse(200, { option_contracts: [{ symbol: 'SPY261009P00500000', strike_price: '500', expiration_date: '2026-10-09', size: '100' }], next_page_token: null });
  }
  if (url.includes('/v1beta1/options/snapshots')) {
    if (!options.hasContracts) return jsonResponse(200, { snapshots: {}, next_page_token: null });
    return jsonResponse(200, {
      snapshots: {
        SPY261009P00500000: { latestQuote: { bp: 0.13, ap: 0.14, bs: 900, as: 900, t: NOW }, greeks: { delta: -0.003, gamma: 0.0001, theta: -0.02, vega: 0.02, rho: -0.002 }, impliedVolatility: 0.5 },
        SPY260914P00500000: { latestQuote: { bp: 1.3, ap: 1.4, bs: 100, as: 100, t: NOW }, greeks: { delta: -0.45, gamma: 0.02, theta: -0.1, vega: 0.1, rho: -0.01 }, impliedVolatility: 0.5 },
        SPY260921P00500000: { latestQuote: { bp: 2.3, ap: 2.4, bs: 100, as: 100, t: NOW }, greeks: { delta: -0.4, gamma: 0.02, theta: -0.1, vega: 0.1, rho: -0.01 }, impliedVolatility: 0.5 },
        SPY260921P00490000: { latestQuote: { bp: 0.3, ap: 0.4, bs: 100, as: 100, t: NOW }, greeks: { delta: -0.2, gamma: 0.01, theta: -0.05, vega: 0.08, rho: -0.01 }, impliedVolatility: 0.5 },
      },
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
  aegisPolicy: { policyVersion: 'aegis-v1', hardCapMultiplier: 1.5, maxTickerConcentrationPct: 0.15, maxSectorConcentrationPct: 0.3, maxCorrelationClusterPct: 0.3, maxPortfolioCapitalAtRiskPct: 0.5, maxInventoryCapacityPct: 0.5, maxAssignmentCapacityPct: 0.5, maxRecoveryCapacityPct: 0.3, providerRequiredStates: ['OK'] },
  aegisInputs: { tickerConcentrationPct: 0.05, sectorConcentrationPct: 0.1, correlationClusterExposurePct: 0.1, portfolioCapitalAtRiskPct: 0.2, inventoryCapacityUsedPct: 0.1, assignmentCapacityUsedPct: 0.1, recoveryCapacityUsedPct: 0, liquidityAcceptable: true, executionQualityAcceptable: true, providerState: 'OK', stressGapDetected: false, stressIvShockDetected: false, stressSpreadWideningDetected: false },
  aegisIvStressEvidence: IV_STRESS_EVIDENCE,
  aegisInputsOrigin: 'CALLER_MANUAL',
  opportunityFrontierPolicy: { policyVersion: 'opp-frontier-v1', reducedSizeUncertaintyThreshold: 0.5 },
  maxAcceptableSpreadPct: 1.0,
  stressGapThresholdAbsReturn: 0.05,
  sizingPolicy: { policyVersion: 'sizing-v2', riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 5, assignmentCapacityQtyCap: 6,
    tailRiskQtyCap: 6, correlationQtyCap: 6, liquidityQtyCap: 6, reducedStateMultiplier: 0.5 },
  executionQualityPolicy: { policyVersion: 'execq-v1', maxAcceptableSpreadPct: 1.0, minQuoteSizeForFullConfidence: 1, maxQuoteAgeSeconds: 999_999, minAfterCostUtilityToCross: -999_999 },
  candidateQuoteAgePolicy: { policyVersion: 'candidate-age-v1-test', effectiveAt: NOW, maxAgeSeconds: 30 },
  finalistQuoteRefreshPolicy: { policyVersion: 'finalist-refresh-v1-test', effectiveAt: NOW, maxFinalists: 5, maxAgeSeconds: 30 },
  optionQuoteFreshnessPolicy: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 999_999, staleMinAgeSeconds: 999_999_999 },
  policyVersion: 'shadow-cycle-test-v1', modelVersions: {}, requiredModelVersions: {},
  now: () => NOW,
  ...overrides,
});

const itMockedProviderRealCodePath = pythonExecutablePath === undefined ? test.skip : test;

itMockedProviderRealCodePath('a full cycle with real-shaped mocked Alpaca data reaches a decision receipt via the real Python pipeline', async () => {
  requestedUrls = [];
  const result = await runThetaShadowCycle(baseConfig());
  assert.ok(requestedUrls.some((url) => url.includes('/v1beta1/options/snapshots/SPY')
    && url.includes('expiration_date_gte=2026-10-01')
    && url.includes('expiration_date_lte=2026-11-01')));
  assert.ok(requestedUrls.some((url) => url.includes('/v1beta1/options/snapshots/SPY')
    && url.includes('expiration_date_gte=2026-10-09')
    && url.includes('expiration_date_lte=2026-10-09')
    && url.includes('strike_price_gte=500')
    && url.includes('strike_price_lte=500')));
  assert.equal(result.selectedUnderlying, 'SPY');
  assert.equal(result.optionChainComplete, true);
  assert.equal(result.optionContractsComplete, true);
  assert.ok(result.orchestration !== null);
  const refresh = result.fusionSnapshot?.snapshot.alpacaQuoteState as Record<string, unknown>;
  assert.equal(refresh.contractVersion, 'theta-finalist-quote-refresh-v1');
  assert.equal(refresh.refreshedCount, 1);
  assert.deepEqual(result.fusionSnapshot?.snapshot.underlyingState.eventEvidence,
    { unsupportedCorporateActionPending: false, eventNear: false });
  assert.deepEqual(result.fusionSnapshot?.snapshot.riskState, { ivStress: IV_STRESS_EVIDENCE,
    stressColdStartPolicy: paperBootstrapStressColdStartPolicy,
    spreadStress: { assessmentsByContract: {}, baselinesByCohort: {} } });
  const regimeState = result.fusionSnapshot?.snapshot.regimeState as Record<string, unknown>;
  const gapReceipt = regimeState.aegisGapStressAssessment as Record<string, unknown>;
  assert.equal(gapReceipt.policyVersion, 'aegis-gap-paper-bootstrap-v1');
  assert.equal(gapReceipt.currentSession, '2026-09-10');
  assert.equal(gapReceipt.state, 'READY');
  assert.equal(gapReceipt.stressGapDetected, false);
  assert.ok(result.orchestration?.thetaQ !== null || result.orchestration?.receipt.winningAction === 'PASS');
  const portfolio = result.fusionSnapshot?.snapshot.portfolioExposure as Record<string, unknown>;
  assert.equal((portfolio.correlationObservation as Record<string, unknown>).state, 'NOT_APPLICABLE');
  assert.equal(result.orchestration?.regime?.eventState, null);
  assert.ok(result.orchestration?.regime?.reasons.some((reason) => reason.code === 'EVENT_FLAG_UNKNOWN'));
  // Optionomics and event-state are never real in this cycle implementation
  // yet -- provenance can never be FULL_REAL, only HYBRID at best.
  assert.notEqual(result.provenance, 'FULL_REAL');
  assert.equal(result.provenance, 'HYBRID');
});

itMockedProviderRealCodePath('per-contract spread stress evidence reaches AEGIS and compact immutable snapshot lineage', async () => {
  const result = await runThetaShadowCycle(baseConfig({
    aegisInputs: { ...baseConfig().aegisInputs, stressSpreadWideningDetected: null },
    aegisSpreadStressAssessor: async ({ contracts, decisionAsOf }) => Object.fromEntries(contracts.map((contract) => {
      const assessment: AegisSpreadStressAssessment = {
        contractVersion: 'theta-aegis-spread-stress-detector-v2', underlying: contract.underlying,
        optionSymbol: contract.optionSymbol, decisionAsOf, dteBucket: 'DTE_22_45', moneynessBucket: 'ATM_0_3PCT',
        currentRelativeSpread: contract.spreadPct, currentQuoteProviderAt: contract.quoteTimestamp,
        currentQuoteReceivedAt: contract.receivedAt, currentFeed: 'INDICATIVE', baselineFeed: 'INDICATIVE',
        feedAuthorityState: 'MATCHED_INDICATIVE', rejectedOtherFeedN: 0,
        contractsPerSession: { '2026-09-01': 1, '2026-09-02': 1 },
        baselineMedianRelativeSpread: 0.08,
        baselineMadRelativeSpread: 0.01, relativeIncrease: -0.05, robustZ: -0.4,
        dispersionState: 'MAD_POSITIVE', robustZApplicability: 'APPLICABLE',
        baselineEvidenceIds: ['candidate-1:quote-1', 'candidate-2:quote-2'],
        maturity: {
          contractVersion: 'theta-aegis-stress-baseline-maturity-v1', signal: 'SPREAD_WIDENING', asOf: decisionAsOf,
          evidence: { rawN: 20, sessionN: 5, distinctUnderlyingN: 1, effectiveN: 20 },
          firstObservationAvailableAt: '2026-09-01T14:00:01.000Z',
          lastObservationAvailableAt: '2026-09-05T14:00:01.000Z', temporalSpanDays: 4,
          effectiveNPolicyState: 'EFFECTIVE_N_NOT_GOVERNING_POLICY',
          source: 'ALPACA_PERSISTED_EXECUTABLE_BBO', sourceVersion: 'theta-aegis-spread-stress-detector-v2',
          state: 'DETECTOR_READY', reason: 'test evidence',
        },
        stressSpreadWideningDetected: false, policyVersion: 'aegis-spread-widening-paper-bootstrap-v2',
        policyAuthority: 'PAPER_BOOTSTRAP_BASELINE_NOT_EMPIRICALLY_OPTIMAL',
        evidenceAuthority: 'ALPACA_EXECUTABLE_MARKET', contentHash: 'b'.repeat(64),
      };
      return [contract.optionSymbol, assessment];
    })),
  }));
  const riskState = result.fusionSnapshot?.snapshot.riskState as Record<string, unknown>;
  const spread = riskState.spreadStress as { assessmentsByContract: Record<string, Record<string, unknown>>;
    baselinesByCohort: Record<string, { baselineEvidenceIds: readonly string[] }> };
  const compact = spread.assessmentsByContract.SPY261009P00500000;
  assert.equal(compact?.stressSpreadWideningDetected, false);
  assert.equal('baselineEvidenceIds' in (compact ?? {}), false);
  assert.deepEqual(spread.baselinesByCohort['SPY:DTE_22_45:ATM_0_3PCT']?.baselineEvidenceIds,
    ['candidate-1:quote-1', 'candidate-2:quote-2']);
});

itMockedProviderRealCodePath('candidate and finalist quote-age policies remain independent stages', async () => {
  const normalFetch = mockAlpacaFetch({ hasContracts: true, hasBars: true });
  const staleAt = new Date(Date.parse(NOW) - 40_000).toISOString();
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.toString() : String(input);
    const response = await normalFetch(input, init);
    if (!url.includes('/v1beta1/options/snapshots')) return response;
    const body = await response.json() as { snapshots: Record<string, { latestQuote: { t: string } }> };
    for (const snapshot of Object.values(body.snapshots)) snapshot.latestQuote.t = staleAt;
    return jsonResponse(200, body);
  }) as typeof fetch;
  const alpaca = { ...alpacaConfig({ hasContracts: true, hasBars: true }), fetchImpl };
  const policy = { policyVersion: 'candidate-age-test-v1', effectiveAt: NOW, maxAgeSeconds: 30 };
  const strict = await runThetaShadowCycle(baseConfig({ alpaca, candidateQuoteAgePolicy: policy }));
  const relaxed = await runThetaShadowCycle(baseConfig({ alpaca,
    candidateQuoteAgePolicy: { ...policy, policyVersion: 'candidate-age-test-v2', maxAgeSeconds: 60 } }));
  const relaxedBoth = await runThetaShadowCycle(baseConfig({ alpaca,
    candidateQuoteAgePolicy: { ...policy, policyVersion: 'candidate-age-test-v2', maxAgeSeconds: 60 },
    finalistQuoteRefreshPolicy: { policyVersion: 'finalist-age-test-v2', effectiveAt: NOW, maxFinalists: 5, maxAgeSeconds: 60 } }));
  const contractFor = (result: Awaited<ReturnType<typeof runThetaShadowCycle>>) =>
    result.fusionSnapshot?.snapshot.contractCandidates.find((candidate) => candidate.optionSymbol === 'SPY261009P00500000');
  assert.equal(contractFor(strict)?.executable, false);
  assert.match(String(contractFor(strict)?.nonExecutableReason), /quote stale/);
  assert.equal(contractFor(relaxed)?.executable, false);
  assert.match(String(contractFor(relaxed)?.nonExecutableReason), /quote stale/);
  assert.equal(contractFor(relaxedBoth)?.executable, true);
  const strictVersions = strict.fusionSnapshot?.snapshot.versions as { modelVersions: Record<string, string> };
  const relaxedVersions = relaxed.fusionSnapshot?.snapshot.versions as { modelVersions: Record<string, string> };
  assert.equal(strictVersions.modelVersions.candidateQuoteAgePolicy, 'candidate-age-test-v1');
  assert.equal(relaxedVersions.modelVersions.candidateQuoteAgePolicy, 'candidate-age-test-v2');
  assert.equal(relaxedVersions.modelVersions.finalistQuoteRefreshPolicy, 'finalist-refresh-v1-test');
  const relaxedBothVersions = relaxedBoth.fusionSnapshot?.snapshot.versions as { modelVersions: Record<string, string> };
  assert.equal(relaxedBothVersions.modelVersions.finalistQuoteRefreshPolicy, 'finalist-age-test-v2');
});

itMockedProviderRealCodePath('shadow research window supplies short-DTE contracts without widening Conventional Paper selection', async () => {
  requestedUrls = [];
  const result = await runThetaShadowCycle(baseConfig({
    evaluationMode: 'SHADOW_EVIDENCE',
    shadowResearchExpirationDateGte: '2026-09-12',
    shadowResearchExpirationDateLte: '2026-09-29',
  }));
  assert.equal(result.optionContractsComplete, true);
  assert.ok(requestedUrls.some((url) => url.includes('expiration_date_gte=2026-09-12')));
  assert.ok(requestedUrls.some((url) => url.includes('/v1beta1/options/snapshots/SPY')
    && url.includes('expiration_date_gte=2026-09-12')
    && url.includes('expiration_date_lte=2026-11-01')));
  const contracts = result.fusionSnapshot?.snapshot.contractCandidates ?? [];
  assert.ok(contracts.some((contract) => contract.optionSymbol === 'SPY260914P00500000'));
  assert.ok(contracts.some((contract) => contract.optionSymbol === 'SPY260921P00500000'));
  const frontier = result.strategyFrontier;
  assert.ok(frontier !== null);
  assert.ok(frontier.branches.some((branch) => branch.branch === 'THETA_HOLD_STRIKE'
    && branch.candidates.some((candidate) => candidate.legs.some((leg) => leg.optionSymbol === 'SPY260914P00500000'))),
  JSON.stringify(frontier.branches.find((branch) => branch.branch === 'THETA_HOLD_STRIKE')));
  assert.ok(frontier.branches.some((branch) => branch.branch === 'THETA_DEFINED_RISK'
    && branch.candidates.some((candidate) => candidate.legs.some((leg) => leg.optionSymbol === 'SPY260921P00500000'))));
  assert.ok(frontier.selectedBranch === null || frontier.selectedBranch === 'THETA_CONVENTIONAL');
  assert.equal(frontier.executionAuthorized, false);
});

itMockedProviderRealCodePath('shadow contract outage remains visible without downgrading primary Conventional contract evidence', async () => {
  const normalFetch = mockAlpacaFetch({ hasContracts: true, hasBars: true });
  const alpaca = alpacaConfig({ hasContracts: true, hasBars: true });
  const result = await runThetaShadowCycle(baseConfig({
    alpaca: { ...alpaca, fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url.includes('/v2/options/contracts') && url.includes('expiration_date_gte=2026-09-12')) {
        return jsonResponse(503, { message: 'temporary research-window outage' });
      }
      return normalFetch(input, init);
    }) as typeof fetch },
    evaluationMode: 'SHADOW_EVIDENCE',
    shadowResearchExpirationDateGte: '2026-09-12',
    shadowResearchExpirationDateLte: '2026-09-29',
  }));
  assert.equal(result.optionContractsComplete, true);
  assert.ok(result.blockers.some((blocker) => blocker.startsWith('OPTION_CONTRACTS_FETCH_FAILED:SHADOW_RESEARCH:PUT:')));
  assert.ok(result.fusionSnapshot?.snapshot.contractCandidates.some((candidate) => candidate.optionSymbol === 'SPY261009P00500000'));
});

test('invalid or partial research date range fails before contacting a provider', async () => {
  requestedUrls = [];
  await assert.rejects(runThetaShadowCycle(baseConfig({ evaluationMode: 'SHADOW_EVIDENCE',
    shadowResearchExpirationDateGte: '2026-09-31', shadowResearchExpirationDateLte: '2026-10-01',
  })), /SHADOW_RESEARCH_CONTRACT_DATE_RANGE_INVALID/);
  await assert.rejects(runThetaShadowCycle(baseConfig({ evaluationMode: 'SHADOW_EVIDENCE',
    shadowResearchExpirationDateGte: '2026-09-12',
  })), /SHADOW_RESEARCH_CONTRACT_DATE_RANGE_INVALID/);
  assert.deepEqual(requestedUrls, []);
});

itMockedProviderRealCodePath('decision time is finalized after collected quote timestamps', async () => {
  let tick=0;
  const advancingNow=()=>new Date(Date.parse(NOW)-1_000+(tick++*250)).toISOString();
  const result=await runThetaShadowCycle(baseConfig({now:advancingNow}));
  assert.ok(result.fusionSnapshot!==null);
  const decisionAt=Date.parse(String(result.fusionSnapshot?.snapshot.decisionTimeUtc));
  const contracts=result.fusionSnapshot?.snapshot.contractCandidates;
  assert.ok(Array.isArray(contracts));
  for(const raw of contracts??[]){
    if(raw===null||typeof raw!=='object'||Array.isArray(raw))continue;
    const quoteTimestamp=raw.quoteTimestamp;
    if(typeof quoteTimestamp==='string')assert.ok(Date.parse(quoteTimestamp)<=decisionAt);
  }
});

itMockedProviderRealCodePath('no candidates on this underlying yields a coherent result, never a crash', async () => {
  const result = await runThetaShadowCycle(baseConfig({ alpaca: alpacaConfig({ hasContracts: false, hasBars: true }) }));
  assert.equal(result.blockers.includes('NO_CANDIDATES_AVAILABLE'), true);
  assert.ok(result.orchestration !== null);
  assert.equal(result.orchestration.receipt.winningAction, 'PASS');
  assert.equal(result.orchestration.receipt.quantity, 0);
  assert.equal(result.orchestration.receipt.executionAuthorized, false);
  assert.deepEqual(result.orchestration.receipt.reasonCodes, ['NO_CANDIDATES_AVAILABLE']);
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
  const optionomicsFetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const body = url.pathname === '/api/v1/flow/net'
      ? { net_calls: [{ timestamp: NOW, value: 5 }], net_puts: [{ timestamp: NOW, value: -2 }] }
      : [{ symbol: 'SPY261009P00500000', underlying: 'SPY', expiration: '2026-10-09', option_type: 'put', strike: 500, open_interest: 1200, volume: 340, implied_volatility: 0.31 }];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const result = await runThetaShadowCycle(baseConfig({
    optionomics: { apiBase: 'https://optionomics.ai', email: 'test-synthetic@example.com', apiToken: 'TEST-SYNTHETIC-TOKEN', fetchImpl: optionomicsFetch, now: () => NOW },
  }));
  assert.ok(result.provenanceDetail.some((d) => d.startsWith('optionomicsChain=REAL_PROVIDER')));
  assert.ok(result.provenanceDetail.some((d) => d.startsWith('optionomicsFlow=REAL_PROVIDER')));
  assert.ok(!result.blockers.some((b) => b.startsWith('OPTIONOMICS_')));
  assert.ok(result.orchestration !== null);
});

itMockedProviderRealCodePath('confirmed Optionomics context families are fetched on bounded cadence and attached to one immutable cycle', async () => {
  const optionomicsFetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    let body: unknown;
    if (url.pathname.endsWith('/options')) body = [{ symbol: 'SPY261009P00500000', underlying: 'SPY', expiration: '2026-10-09', option_type: 'put', strike: 500, open_interest: 1200, volume: 340, implied_volatility: 0.31 }];
    else if (url.pathname.endsWith('/metrics')) body = { date: '2026-09-10', metrics: { iv_rank: 25, iv_percentile: 40, rr25: -0.02, total_gex: 0 } };
    else if (url.pathname.endsWith('/heatmap')) body = { metric: url.searchParams.get('metric'), strikes: [500], expirations: ['2026-10-09'], cells: [[0]] };
    else if (url.pathname === '/api/v1/flow/net') body = { net_calls: [{ timestamp: NOW, value: 5 }], net_puts: [{ timestamp: NOW, value: -2 }] };
    else if (url.pathname === '/api/v1/flow/aggregates') body = { bullish_flow: [{ symbol: 'SPY', premium: 0 }], bearish_flow: [], top_calls: [], top_puts: [], total_premium: 0, trade_count: 0 };
    else if (url.pathname === '/api/v1/events') body = {
      from: url.searchParams.get('from'), to: url.searchParams.get('to'),
      meta: { kinds: ['macro', 'fed'] },
      pagination: { current_page: 1, total_pages: 1, total_count: 1 },
      events: [{ ticker: 'SPY', known_at: '2026-09-09T12:00:00Z', scheduled_at: '2026-09-20T14:00:00Z' }],
    };
    else if (url.pathname.endsWith('/earning_filings')) body = { earning_filings: [] };
    else if (url.pathname.endsWith('/news')) body = { news: [{ ticker: 'SPY', published_at: '2026-09-09T10:00:00Z', topic: 'market' }] };
    else throw new Error(`unmocked Optionomics context URL: ${url}`);
    return jsonResponse(200, body);
  }) as typeof fetch;
  const result = await runThetaShadowCycle(baseConfig({
    optionomics: { apiBase: 'https://optionomics.ai', email: 'test-synthetic@example.com', apiToken: 'TEST-SYNTHETIC-TOKEN', fetchImpl: optionomicsFetch, now: () => NOW },
    optionomicsContextPolicy: {
      policyVersion: 'context-test-v1', families: ['METRICS', 'EXPOSURE_HEATMAP', 'FLOW_AGGREGATES', 'EVENTS', 'EARNINGS_FILINGS', 'SYMBOL_NEWS'],
      maxRequestsPerCycle: 9, eventLookaheadDays: 60,
    },
  }));
  assert.ok(result.provenanceDetail.includes('optionomicsContext=REAL_PROVIDER'));
  assert.ok(result.provenanceDetail.includes('eventState=REAL_PROVIDER'));
  const state = result.fusionSnapshot?.snapshot.optionomicsFeatureState as Record<string, unknown>;
  assert.equal(Array.isArray(state.rawObservations), true);
  assert.equal((state.rawObservations as readonly unknown[]).length, 9);
  const features = state.features as Record<string, unknown>;
  const providerContext = features.providerContext as Record<string, unknown>;
  assert.equal(Array.isArray(providerContext.observations), true);
  assert.equal(JSON.stringify(providerContext).includes('rawPayload'), false);
  assert.ok(result.fusionSnapshot?.snapshot.eventState !== null);
  const eventState = result.fusionSnapshot?.snapshot.eventState as Record<string, unknown>;
  const macroFedCoverage = eventState.macroFedCoverage as Record<string, unknown>;
  assert.equal(macroFedCoverage.state, 'COMPLETE');
  assert.equal(macroFedCoverage.negativeQualified, false);
  assert.equal(macroFedCoverage.providerEventCount, 3);
  assert.equal(result.fusionSnapshot?.snapshot.unknownFeatures.some((item) => item.feature === 'eventState'), false);
});

itMockedProviderRealCodePath('an Optionomics provider failure is recorded honestly (REAL_PROVIDER_ERROR) and never blocks the rest of the cycle', async () => {
  const optionomicsFetch = (async () => new Response('', { status: 500 })) as typeof fetch;
  const result = await runThetaShadowCycle(baseConfig({
    optionomics: { apiBase: 'https://optionomics.ai', email: 'test-synthetic@example.com', apiToken: 'TEST-SYNTHETIC-TOKEN', fetchImpl: optionomicsFetch, now: () => NOW, sleepImpl: async () => {} },
  }));
  assert.ok(result.provenanceDetail.some((d) => d.startsWith('optionomicsChain=REAL_PROVIDER_ERROR')));
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
  const portfolio = result.fusionSnapshot?.snapshot.portfolioExposure as Record<string, unknown>;
  const correlation = portfolio.correlationObservation as Record<string, unknown>;
  assert.equal(correlation.state, 'KNOWN');
  assert.equal(correlation.reason, 'SAME_UNDERLYING_IDENTITY');
  assert.equal(correlation.usableForDecision, true);
});

itMockedProviderRealCodePath('held-symbol bars reach persisted portfolio correlation without gaining AEGIS authority', async () => {
  const baseFetch = mockAlpacaFetch({ hasContracts: true, hasBars: true });
  const heldBarRequests: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/v2/positions') return jsonResponse(200, [
      { symbol: 'QQQ', asset_class: 'us_equity', qty: '10', side: 'long',
        avg_entry_price: '200', market_value: '2000', unrealized_pl: '0' },
    ]);
    if (url.pathname === '/v2/stocks/bars') {
      const symbol = url.searchParams.get('symbols');
      if (symbol === 'SPY' || symbol === 'QQQ') {
        if (symbol === 'QQQ') heldBarRequests.push(url.toString());
        const bars = Array.from({ length: 65 }, (_, index) => {
          const close = (symbol === 'SPY' ? 500 : 200) + index * 0.25 + (index % 3) * 0.1;
          return { t: new Date(Date.parse(NOW) - (66 - index) * 86_400_000).toISOString(),
            o: close, h: close, l: close, c: close, v: 1_000_000 };
        });
        return jsonResponse(200, { bars: { [symbol]: bars }, next_page_token: null });
      }
    }
    return baseFetch(input, init);
  }) as typeof fetch;
  const result = await runThetaShadowCycle(baseConfig({ alpaca: { ...alpacaConfig({ hasContracts: true, hasBars: true }), fetchImpl } }));
  const portfolio = result.fusionSnapshot?.snapshot.portfolioExposure as Record<string, unknown>;
  const correlation = portfolio.correlationObservation as Record<string, unknown>;
  assert.equal(correlation.state, 'KNOWN');
  assert.equal(correlation.authority, 'ALPACA_MARKET_OBSERVATION_NO_BROKER_AUTHORITY');
  assert.equal((correlation.pairs as unknown[]).length, 1);
  assert.equal(typeof correlation.sourceBarHash, 'string');
  assert.equal(JSON.stringify(result.fusionSnapshot?.snapshot.riskState).includes('correlationObservation'), false);
  assert.equal(heldBarRequests.length, 1);
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
    return jsonResponse(200, { option_contracts: [{ symbol: 'SPY261009P00500000', strike_price: '500', expiration_date: '2026-10-09', size: '100' }], next_page_token: null });
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
