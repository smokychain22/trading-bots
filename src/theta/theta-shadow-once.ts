import { assertProviderConfiguration, loadEnvironment, loadEnvironmentFile } from '../config/environment.js';
import { runThetaShadowCycle, type ThetaShadowCycleConfig } from './theta-shadow-cycle.js';
import type { AlpacaProviderConfig } from './alpaca-provider.js';
import type { PythonBridgeConfig } from './python-bridge.js';
import type { UnderlyingCandidateInput } from './universe-policy.js';

// Safe one-shot entrypoint for runThetaShadowCycle(). Designed to be run
// later by Codex in a protected environment holding the real Vercel
// Sensitive secrets, or locally in development against a gitignored env
// file -- credentials are read ONLY from the process environment (via
// this repo's existing src/config/environment.ts loader, following the
// same convention as src/providers/provider-readiness.ts), never printed,
// never logged, and no header/credential value ever reaches stdout.
//
// NO ORDER ENDPOINT IS EVER CALLED. runThetaShadowCycle() has no order-
// submission code path (verified: the only /v2/orders reference in the
// whole provider layer is fetchOpenOrders, a read-only GET) -- this
// wrapper adds nothing that could submit one.
//
// Output is deliberately minimal and owner-safe: run ID, timestamps,
// selected underlying, the universe funnel, the final action + reasons,
// and blockers -- never a raw provider response body, never a header.
// This is the same shape a future Codex /ops "run shadow cycle" control
// can display directly.
//
// Usage: `npm run theta:shadow:once` (reads process env) or pass
// `--env-file=path/to/.env` to load a specific gitignored env file
// instead (development convenience only -- never a committed file).

const envFileArg = process.argv.find((arg) => arg.startsWith('--env-file='));
const environment = envFileArg !== undefined
  ? loadEnvironmentFile(envFileArg.slice('--env-file='.length))
  : loadEnvironment();

function requireAlpacaConfig(): AlpacaProviderConfig {
  assertProviderConfiguration(environment, 'ALPACA');
  return {
    tradingApiBase: environment.ALPACA_BASE_URL as string,
    marketDataApiBase: 'https://data.alpaca.markets',
    apiKey: environment.ALPACA_API_KEY as string,
    apiSecret: environment.ALPACA_SECRET_KEY as string,
  };
}

// Research/placeholder versioned policies -- explicitly NOT asserted
// production-optimal (same discipline as every other policy default in
// this repo). A real deployment should supply its own versioned policy
// records; these exist so this entrypoint is runnable at all.
function defaultShadowCycleConfig(alpaca: AlpacaProviderConfig, bridge: PythonBridgeConfig, universeCandidates: readonly UnderlyingCandidateInput[]): ThetaShadowCycleConfig {
  const now = new Date().toISOString();
  const historyStart = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const optionExpirationGte = new Date(Date.now() + 25 * 86_400_000).toISOString().slice(0, 10);
  const optionExpirationLte = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);

  return {
    alpaca, bridge, universeCandidates,
    universePolicy: { policyVersion: 'universe-v1-shadow-once', minAvgDollarVolume: 10_000_000, minCurrentPrice: 5 },
    optionExpirationDateGte: optionExpirationGte, optionExpirationDateLte: optionExpirationLte, optionType: 'put', maxOptionPages: 10,
    historyStart, historyEnd: now, historyMaxPages: 5,
    ownershipPolicy: { policyVersion: 'ownership-v1-shadow-once', minStockAvgVolume: 1_000_000, minOptionOpenInterest: 1, minOptionVolume: 1, maxSpreadPct: 0.5, rvNormalizationCeiling: 0.6, downsideSemivarNormalizationCeiling: 0.3, gapFrequencyNormalizationCeiling: 0.5, eventDecayWindowDays: 10 },
    regimePolicy: { policyVersion: 'regime-v1-shadow-once', bullMaSlopeFloor: 0.001, bearMaSlopeCeiling: -0.001, rvLowCeiling: 0.1, rvHighFloor: 0.25, rvShockFloor: 0.4, maxAdverseGapShockThreshold: 0.08, liquidityThinSpreadPctFloor: 0.03, liquidityDislocatedSpreadPctFloor: 0.08, correctionDrawdownCeiling: -0.1, crisisDrawdownCeiling: -0.2 },
    routerPolicy: { policyVersion: 'router-v1-shadow-once', thetaQMinOwnershipAcceptability: 0.3, thetaHMinOwnershipAcceptability: 0.75, thetaDGateSatisfied: false },
    routerPortfolio: { lifecycleState: 'CASH_AVAILABLE', stockSharesHeld: 0, openOptionExists: false, assignmentImminent: false },
    latticeConfig: { configVersion: 'lattice-v1-shadow-once', minDte: 25, maxDte: 60, deltaBands: [[0.0, 0.25], [0.25, 0.5]], minOpenInterest: 50, minVolume: 10, maxSpreadPct: 0.15, earningsExclusionDays: 5 },
    thetaQSizingPolicy: { riskLimitVersion: 'risk-v1-shadow-once', maxSpreadPct: 0.15, maxQuoteAgeSeconds: 30, minOpenInterest: 50, minVolume: 10, earningsExclusionDays: 5, ownershipAcceptabilityFloor: 0.3, exceptionalUtilityThreshold: 0.9, strongUtilityThreshold: 0.7, minimumPositiveEdge: 0.05, riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 2 },
    costAssumptions: { commissionPerContract: 0.65, feesPerContract: 0.05, estimatedSlippagePerContract: 1.0, costModelVersion: 'cost-v1-shadow-once' },
    aegisPolicy: { policyVersion: 'aegis-v1-shadow-once', maxTickerConcentrationPct: 0.15, maxSectorConcentrationPct: 0.3, maxCorrelationClusterPct: 0.3, maxPortfolioCapitalAtRiskPct: 0.5, maxInventoryCapacityPct: 0.5, maxAssignmentCapacityPct: 0.5, maxRecoveryCapacityPct: 0.3, providerRequiredStates: ['OK'] },
    aegisInputs: { tickerConcentrationPct: 0, sectorConcentrationPct: 0, correlationClusterExposurePct: 0, portfolioCapitalAtRiskPct: 0, inventoryCapacityUsedPct: 0, assignmentCapacityUsedPct: 0, recoveryCapacityUsedPct: 0, liquidityAcceptable: true, executionQualityAcceptable: true, providerState: 'OK', stressGapDetected: false, stressIvShockDetected: false, stressSpreadWideningDetected: false },
    opportunityFrontierPolicy: { policyVersion: 'opp-frontier-v1-shadow-once', reducedSizeUncertaintyThreshold: 0.5 },
    maxAcceptableSpreadPct: 0.15,
    sizingPolicy: { policyVersion: 'sizing-v1-shadow-once', riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 5, assignmentCapacityQtyCap: 6, reducedStateMultiplier: 0.5 },
    executionQualityPolicy: { policyVersion: 'execq-v1-shadow-once', maxAcceptableSpreadPct: 0.15, minQuoteSizeForFullConfidence: 20, maxQuoteAgeSeconds: 30, minAfterCostUtilityToCross: 0 },
    optionQuoteFreshnessPolicy: { policyVersion: 'freshness-v1-shadow-once', goodMaxAgeSeconds: 10, staleMinAgeSeconds: 60 },
    policyVersion: 'theta-shadow-once-v1', modelVersions: {}, requiredModelVersions: {},
    now: () => new Date().toISOString(),
  };
}

async function main(): Promise<number> {
  let alpaca: AlpacaProviderConfig;
  try {
    alpaca = requireAlpacaConfig();
  } catch (error) {
    console.info(JSON.stringify({ status: 'CONFIGURATION_INCOMPLETE', detail: error instanceof Error ? error.message : 'unknown error' }));
    return 1;
  }

  const bridge: PythonBridgeConfig = {
    pythonExecutablePath: process.env.PYTHON_EXECUTABLE ?? 'python3',
    scriptAllowlist: new Map([
      ['ownership', 'bots/theta/quant/runtime/ownership_contract.py'],
      ['regime', 'bots/theta/quant/runtime/regime_contract.py'],
      ['strategyRouter', 'bots/theta/quant/runtime/strategy_router_contract.py'],
      ['thetaQ', 'bots/theta/quant/runtime/theta_q_contract.py'],
      ['paretoFrontier', 'bots/theta/quant/runtime/pareto_frontier_contract.py'],
      ['opportunityFrontier', 'bots/theta/quant/runtime/opportunity_frontier_contract.py'],
      ['aegis', 'bots/theta/quant/runtime/aegis_contract.py'],
      ['sizing', 'bots/theta/quant/runtime/sizing_contract.py'],
      ['executionQuality', 'bots/theta/quant/runtime/execution_quality_contract.py'],
    ]),
    timeoutMs: 10_000,
    maxOutputBytes: 2_000_000,
  };

  // A single, hardcoded, liquid universe candidate for this first
  // production-capable run -- real universe asset discovery (Alpaca's
  // full tradable/optionable asset list) is not built yet (see
  // docs/quant/phase6_router/DATA_GAP_REGISTER.md); this is an honest,
  // narrow starting point, not a claim of full autonomy.
  const universeCandidates: readonly UnderlyingCandidateInput[] = [{
    symbol: 'SPY', tradable: true, optionEnabled: true, assetDataValid: true,
    avgDollarVolume: 50_000_000_000, currentPrice: 500, hasUsableOptionChain: true,
    accountCollateralFeasible: true, ownershipAcceptable: true,
    unsupportedCorporateActionPending: false, eventNear: false,
  }];

  const config = defaultShadowCycleConfig(alpaca, bridge, universeCandidates);
  const result = await runThetaShadowCycle(config);

  console.info(JSON.stringify({
    runId: result.runId,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    selectedUnderlying: result.selectedUnderlying,
    universeFunnel: result.universeFunnel,
    optionContractsComplete: result.optionContractsComplete,
    optionChainComplete: result.optionChainComplete,
    finalAction: result.orchestration?.receipt.winningAction ?? null,
    plainEnglishExplanation: result.orchestration?.receipt.plainEnglishExplanation ?? null,
    quantity: result.orchestration?.receipt.quantity ?? null,
    provenance: result.provenance,
    provenanceDetail: result.provenanceDetail,
    blockers: result.blockers,
    persistenceStatus: 'NOT_PERSISTED -- R1G (PostgreSQL) not yet built this engagement',
  }, null, 2));

  return result.blockers.length > 0 ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  console.info(JSON.stringify({ status: 'UNCAUGHT_ERROR', detail: error instanceof Error ? error.message : 'unknown error' }));
  process.exitCode = 1;
});
