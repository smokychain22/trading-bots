import { assertProviderConfiguration, loadEnvironment, loadEnvironmentFile } from '../config/environment.js';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runThetaShadowCycle, type ProvenanceOrigin, type ThetaShadowCycleConfig } from './theta-shadow-cycle.js';
import type { AlpacaProviderConfig } from './alpaca-provider.js';
import type { OptionomicsProviderConfig } from './optionomics-provider.js';
import type { PythonBridgeConfig } from './python-bridge.js';
import { discoverRealUniverse, type UniverseDiscoveryConfig } from './universe-discovery.js';
import type { UnderlyingCandidateInput } from './universe-policy.js';
import { buildFirstPaperRuntimeTelemetry } from './first-paper-runtime-telemetry.js';
import { paperBootstrapRuntimePolicy } from './paper-bootstrap-runtime-policy.js';
import { deriveRealCurrentWorkerEvidence } from './profitability-brain-reality.js';
import {
  buildProfitabilityBrainRealityFromManifest, profitabilityBrainEvidenceManifestVersion,
  type ProfitabilityBrainEvidenceManifest, type ProfitabilityRuntimeEvidence,
} from './profitability-brain-evidence-manifest.js';
import { canonicalJson } from '../research/point-in-time-evidence.js';

// Phase 1 Zero-Unknown Reclosure Pass 2: reuses the existing, already-tested
// canonical source/worker identity mechanism
// (profitability-brain-evidence-manifest.ts) rather than a second identity
// system. `sourceSha`/`workerSha` here are deliberately the SAME value --
// this command proves "this exact checked-out source, run once, produces
// this real evidence" (REAL_HISTORICAL_REPLAY_VERIFIED in spirit), which is
// a genuinely different, narrower claim than "the currently DEPLOYED remote
// Vercel worker just executed this" (that would require the deployed
// worker's own reported buildSha, a separate fact this offline command has
// no way to observe). The immutable-source guard below (git HEAD + a
// tracked-content clean check) is the same principle as
// tools/theta-no-submit-probe.ts's guard, deliberately scoped tighter:
// `git diff --quiet HEAD --` only fails on TRACKED file changes (staged or
// unstaged) against HEAD, so an untracked, structurally-unrelated local
// tooling artifact (this machine has a persistent `.agents/`/
// `skills-lock.json` pair from the coding environment, never part of this
// repository's real source, never staged, never committed across this
// entire multi-session engagement) cannot block an otherwise genuinely
// immutable source checkout from proving its own SHA.
export function currentImmutableSourceSha(): string {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('SHADOW_ONCE_IMMUTABLE_SOURCE_REQUIRED');
  try {
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--'], { stdio: 'ignore' });
  } catch {
    throw new Error('SHADOW_ONCE_IMMUTABLE_SOURCE_REQUIRED');
  }
  return sha;
}

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
// Development-only usage: `npm run theta:shadow:once --
// --allow-manual-inputs` (reads process env), or add
// `--env-file=path/to/.env` to load a specific gitignored env file. The
// command rejects production and rejects omission of the explicit manual
// input acknowledgement until real input assembly replaces the fixtures.

function requireAlpacaConfig(environment: ReturnType<typeof loadEnvironment>): AlpacaProviderConfig {
  assertProviderConfiguration(environment, 'ALPACA');
  return {
    tradingApiBase: environment.ALPACA_BASE_URL as string,
    marketDataApiBase: 'https://data.alpaca.markets',
    apiKey: environment.ALPACA_API_KEY as string,
    apiSecret: environment.ALPACA_SECRET_KEY as string,
  };
}

// Optionomics is genuinely optional for this entrypoint -- unlike Alpaca
// (whose absence blocks the whole run), a missing Optionomics credential
// just means OI/volume/IV-fallback stay UNKNOWN this cycle. `null` here is
// honestly NOT_ATTEMPTED, never a fixture standing in for a real call.
export function optionomicsConfigFromEnvironment(environment: ReturnType<typeof loadEnvironment>): OptionomicsProviderConfig | null {
  if (environment.OPTIONOMICS_EMAIL === undefined || environment.OPTIONOMICS_API_KEY === undefined) return null;
  return { apiBase: 'https://optionomics.ai', email: environment.OPTIONOMICS_EMAIL, apiToken: environment.OPTIONOMICS_API_KEY };
}

// Research/placeholder versioned policies -- explicitly NOT asserted
// production-optimal (same discipline as every other policy default in
// this repo). A real deployment should supply its own versioned policy
// records; these exist so this entrypoint is runnable at all.
export const shadowHistoryAcquisitionPolicyVersion = 'theta-history-acquisition-v2-ma200';
export const defaultOwnershipHistoryCalendarDays = 400;

export function defaultShadowCycleConfig(
  alpaca: AlpacaProviderConfig,
  optionomics: OptionomicsProviderConfig | null,
  bridge: PythonBridgeConfig,
  universeCandidates: readonly UnderlyingCandidateInput[],
  universeCandidatesOrigin: ProvenanceOrigin,
): ThetaShadowCycleConfig {
  const bootstrap = paperBootstrapRuntimePolicy;
  const now = new Date().toISOString();
  // StructuralQuality requires MA200. A 120-calendar-day request can never
  // contain 200 trading sessions, so it made the ownership assessment
  // structurally UNKNOWN even when Alpaca history was healthy. Request a
  // bounded 400-calendar-day window and record the acquisition policy in the
  // model-version lineage. This changes evidence availability only, not any
  // strategy, safety, sizing, or execution threshold.
  const historyStart = new Date(Date.now() - defaultOwnershipHistoryCalendarDays * 86_400_000).toISOString();
  // The canonical THETA_CONVENTIONAL gate remains 25-60 DTE. Fetch a
  // narrow five-day observation band on either side so research can measure
  // DTE-edge missed opportunities without granting those contracts broker
  // authority or silently widening the strategy.
  const optionExpirationGte = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const optionExpirationLte = new Date(Date.now() + 65 * 86_400_000).toISOString().slice(0, 10);
  // Separate 2-19 DTE research window makes Hold-Strike and the near-term
  // Defined Risk cohort observable without widening Conventional entry.
  const shadowResearchExpirationGte = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const shadowResearchExpirationLte = new Date(Date.now() + 19 * 86_400_000).toISOString().slice(0, 10);

  return {
    alpaca, optionomics, bridge, universeCandidates,
    optionomicsContextPolicy: {
      policyVersion: 'optionomics-context-cadence-v2',
      families: ['METRICS', 'EXPOSURE_HEATMAP', 'VANNA_EXPOSURE_HEATMAP', 'CHARM_EXPOSURE_HEATMAP', 'FLOW_AGGREGATES', 'EVENTS', 'EARNINGS_FILINGS', 'SYMBOL_NEWS'],
      maxRequestsPerCycle: 8,
      cadenceMinutesByFamily: {
        METRICS: 1,
        EVENTS: 1,
        FLOW_AGGREGATES: 5,
        EXPOSURE_HEATMAP: 15,
        VANNA_EXPOSURE_HEATMAP: 15,
        CHARM_EXPOSURE_HEATMAP: 15,
        SYMBOL_NEWS: 15,
        EARNINGS_FILINGS: 30,
      },
      eventLookaheadDays: 60,
    },
    universeCandidatesOrigin,
    universePolicy: { policyVersion: 'universe-v1-shadow-once', minAvgDollarVolume: 10_000_000, minCurrentPrice: 5 },
    optionExpirationDateGte: optionExpirationGte, optionExpirationDateLte: optionExpirationLte,
    shadowResearchExpirationDateGte: shadowResearchExpirationGte, shadowResearchExpirationDateLte: shadowResearchExpirationLte,
    optionType: 'put', maxOptionPages: 10,
    historyStart, historyEnd: now, historyMaxPages: 5,
    ownershipPolicy: { policyVersion: 'ownership-v1-shadow-once', minStockAvgVolume: 1_000_000, minOptionOpenInterest: 1, minOptionVolume: 1, maxSpreadPct: 0.5, rvNormalizationCeiling: 0.6, downsideSemivarNormalizationCeiling: 0.3, gapFrequencyNormalizationCeiling: 0.5, eventDecayWindowDays: 10 },
    regimePolicy: { policyVersion: 'regime-v1-shadow-once', bullMaSlopeFloor: 0.001, bearMaSlopeCeiling: -0.001, rvLowCeiling: 0.1, rvHighFloor: 0.25, rvShockFloor: 0.4, maxAdverseGapShockThreshold: 0.08, liquidityThinSpreadPctFloor: 0.03, liquidityDislocatedSpreadPctFloor: 0.08, correctionDrawdownCeiling: -0.1, crisisDrawdownCeiling: -0.2 },
    routerPolicy: { policyVersion: 'router-v1-shadow-once', thetaQMinOwnershipAcceptability: 0.3, thetaHMinOwnershipAcceptability: 0.75, thetaDGateSatisfied: false },
    routerPortfolio: { lifecycleState: 'CASH_AVAILABLE', stockSharesHeld: 0, openOptionExists: false, assignmentImminent: false },
    latticeConfig: { configVersion: 'lattice-v1-shadow-once', minDte: bootstrap.conventional.minimumDte, maxDte: bootstrap.conventional.maximumDte, deltaBands: bootstrap.conventional.deltaBands.map((band) => [...band] as [number, number]), minOpenInterest: bootstrap.conventional.minimumOpenInterest, minVolume: bootstrap.conventional.minimumVolume, maxSpreadPct: bootstrap.conventional.maximumSpreadPct, earningsExclusionDays: bootstrap.conventional.earningsExclusionDays },
    thetaQSizingPolicy: { riskLimitVersion: 'risk-v1-shadow-once', maxSpreadPct: bootstrap.conventional.maximumSpreadPct, maxQuoteAgeSeconds: bootstrap.quoteAge.candidateMaximumSeconds, minOpenInterest: bootstrap.conventional.minimumOpenInterest, minVolume: bootstrap.conventional.minimumVolume, earningsExclusionDays: bootstrap.conventional.earningsExclusionDays, ownershipAcceptabilityFloor: 0.3, exceptionalUtilityThreshold: 0.9, strongUtilityThreshold: 0.7, minimumPositiveEdge: 0.05, riskBudgetQtyCap: bootstrap.sizing.riskBudgetQuantityCap, collateralQtyCap: bootstrap.sizing.collateralQuantityCap, concentrationQtyCap: 2 },
    costAssumptions: { commissionPerContract: 0.65, feesPerContract: 0.05, estimatedSlippagePerContract: 1.0, costModelVersion: 'cost-v1-shadow-once' },
    aegisPolicy: { policyVersion: 'aegis-v1-shadow-once', hardCapMultiplier: bootstrap.aegis.hardCapMultiplier, compoundStressHoldCount: bootstrap.aegis.compoundStressHoldCount, maxTickerConcentrationPct: bootstrap.aegis.maximumTickerConcentrationPct, maxSectorConcentrationPct: bootstrap.aegis.maximumSectorConcentrationPct, maxCorrelationClusterPct: bootstrap.aegis.maximumCorrelationClusterPct, maxPortfolioCapitalAtRiskPct: bootstrap.aegis.maximumPortfolioCapitalAtRiskPct, maxInventoryCapacityPct: bootstrap.aegis.maximumInventoryCapacityPct, maxAssignmentCapacityPct: bootstrap.aegis.maximumAssignmentCapacityPct, maxRecoveryCapacityPct: bootstrap.aegis.maximumRecoveryCapacityPct, providerRequiredStates: ['OK'] },
    aegisInputs: { tickerConcentrationPct: 0, sectorConcentrationPct: 0, correlationClusterExposurePct: 0, portfolioCapitalAtRiskPct: 0, inventoryCapacityUsedPct: 0, assignmentCapacityUsedPct: 0, recoveryCapacityUsedPct: 0, liquidityAcceptable: true, executionQualityAcceptable: true, providerState: 'OK', stressGapDetected: false, stressIvShockDetected: false, stressSpreadWideningDetected: false },
    aegisInputsOrigin: 'CALLER_MANUAL', // honest: tickerConcentrationPct/portfolioCapitalAtRiskPct/providerState/liquidityAcceptable/executionQualityAcceptable/stressGapDetected are now real-derived when trustworthy (see account-exposure.ts and aegis-derivation.ts) -- sector/correlation/IV-shock/spread-widening remain exactly what this fixture supplies, since no real source exists for those yet
    opportunityFrontierPolicy: { policyVersion: 'opp-frontier-v1-shadow-once', reducedSizeUncertaintyThreshold: 0.5 },
    maxAcceptableSpreadPct: bootstrap.conventional.maximumSpreadPct,
    stressGapThresholdAbsReturn: bootstrap.aegis.stressGapThresholdAbsoluteReturn, // versioned Paper bootstrap gap policy, not an empirically optimal threshold
    sizingPolicy: { policyVersion: 'sizing-v2-shadow-once', riskBudgetQtyCap: bootstrap.sizing.riskBudgetQuantityCap, collateralQtyCap: bootstrap.sizing.collateralQuantityCap, concentrationQtyCap: bootstrap.sizing.concentrationQuantityCap,
      assignmentCapacityQtyCap: bootstrap.sizing.assignmentCapacityQuantityCap, tailRiskQtyCap: bootstrap.sizing.tailRiskQuantityCap, correlationQtyCap: bootstrap.sizing.correlationQuantityCap, liquidityQtyCap: bootstrap.sizing.liquidityQuantityCap, reducedStateMultiplier: bootstrap.sizing.reducedStateMultiplier },
    executionQualityPolicy: { policyVersion: 'execq-v1-shadow-once', maxAcceptableSpreadPct: bootstrap.conventional.maximumSpreadPct, minQuoteSizeForFullConfidence: 20, maxQuoteAgeSeconds: bootstrap.quoteAge.candidateMaximumSeconds, minAfterCostUtilityToCross: 0 },
    candidateQuoteAgePolicy: { policyVersion: 'candidate-quote-age-v1-paper-bootstrap', effectiveAt: now, maxAgeSeconds: bootstrap.quoteAge.candidateMaximumSeconds },
    finalistQuoteRefreshPolicy: { policyVersion: 'finalist-quote-refresh-v1-paper-bootstrap', effectiveAt: now, maxFinalists: 5, maxAgeSeconds: bootstrap.quoteAge.finalistMaximumSeconds },
    optionQuoteFreshnessPolicy: { policyVersion: 'freshness-v1-shadow-once', goodMaxAgeSeconds: bootstrap.quoteAge.goodMaximumSeconds, staleMinAgeSeconds: bootstrap.quoteAge.staleMinimumSeconds },
    policyVersion: 'theta-shadow-once-v1',
    modelVersions: { historyAcquisition: shadowHistoryAcquisitionPolicyVersion },
    requiredModelVersions: {},
    now: () => new Date().toISOString(),
  };
}

async function main(): Promise<number> {
  const manualInputsAllowed = process.argv.includes('--allow-manual-inputs');
  if (!manualInputsAllowed || process.env.NODE_ENV === 'production') {
    console.info(JSON.stringify({
      status: 'INPUT_ASSEMBLY_INCOMPLETE',
      detail: 'The one-shot runner requires explicit development-only --allow-manual-inputs until real universe, event, and account-risk assembly is complete.',
      ordersSubmitted: 0,
    }));
    return 2;
  }

  const envFileArg = process.argv.find((arg) => arg.startsWith('--env-file='));
  const environment = envFileArg !== undefined
    ? loadEnvironmentFile(envFileArg.slice('--env-file='.length))
    : loadEnvironment();
  let alpaca: AlpacaProviderConfig;
  try {
    alpaca = requireAlpacaConfig(environment);
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

  // Real, bounded, staged universe discovery -- see universe-discovery.ts.
  // No hardcoded symbol list in production: this entrypoint asks Alpaca
  // which US equities are actually tradable/optionable right now, rather
  // than assuming THETA is an SPY bot. Versioned research parameters
  // (bound sizes, lookback) are explicit here, not silently arbitrary.
  const discoveryConfig: UniverseDiscoveryConfig = {
    discoveryVersion: 'universe-discovery-v1-shadow-once',
    maxCandidateAssets: 500, allowedExchanges: ['NYSE', 'NASDAQ', 'ARCA', 'BATS'],
    barsLookbackDays: 30, barsBatchSize: 100, maxOptionabilityChecks: 30, minCurrentPrice: 5,
  };
  const discovery = await discoverRealUniverse(alpaca, discoveryConfig, () => new Date().toISOString());
  const universeCandidates: readonly UnderlyingCandidateInput[] = discovery.candidates;

  const optionomics = optionomicsConfigFromEnvironment(environment);
  const config = defaultShadowCycleConfig(alpaca, optionomics, bridge, universeCandidates, discovery.candidatesOrigin);
  // This command is a broker-mutation-free evidence probe. Discovery cannot
  // know account capacity, ownership suitability, or event coverage before
  // the cycle fetches those providers. Use the existing evidence-enrichment
  // stage so those honest UNKNOWNs do not circularly prevent the reads that
  // can resolve them. SHADOW_EVIDENCE never grants Paper authority. Final
  // entry authorization remains fail-closed in the canonical runtime.
  const result = await runThetaShadowCycle({ ...config, evaluationMode: 'SHADOW_EVIDENCE' });
  const firstPaperTelemetry = buildFirstPaperRuntimeTelemetry({
    frontier: result.strategyFrontier,
    alpacaQuoteState: result.fusionSnapshot?.snapshot.alpacaQuoteState,
  });
  // THETA-BRAIN-L7-CALLER-GAP (Phase 1 Zero-Unknown Reclosure Pass 2): the
  // real caller, now routed through the existing, already-tested
  // profitability-brain-evidence-manifest.ts identity/linkage system
  // (never a second identity system, never a bare L7 promotion with no
  // SHA proof at all). Every genuine run derives its own evidence from
  // THIS run's real strategyFrontier -- never a fixture -- and the
  // manifest's own validation (source/worker SHA match, evidence-hash
  // format, ID uniqueness) is what actually gates whether any method may
  // reach L7, exactly as it already does for every other manifest caller.
  let brainRealityManifestViolations: readonly string[] = [];
  let brainRealityLevelCounts: Record<string, number> | null = null;
  let realEvidence: readonly string[] = [];
  try {
    const sourceSha = currentImmutableSourceSha();
    const derived = deriveRealCurrentWorkerEvidence({ strategyFrontier: result.strategyFrontier });
    // Phase 1 Zero-Unknown Reclosure Pass 2 (directive items 29-33): this
    // command's own `config.aegisInputsOrigin` is honestly `CALLER_MANUAL`
    // (see defaultShadowCycleConfig's own comment -- sector/correlation/
    // IV-shock/spread-widening inputs are not yet real-derived for this
    // specific entrypoint). A method executing with partially-manual inputs
    // is real EXECUTION but not real-DATA-complete -- AEGIS_RISK_PERMISSION
    // must never claim L7 from a run whose own risk inputs were manual,
    // even though the frontier genuinely evaluated. CONSTRAINED_QUANTITY_
    // SIZING is excluded too: its structural sizing path consumes the same
    // AEGIS state, so a manual-AEGIS run cannot honestly claim full-real
    // sizing either.
    const inputRealnessExclusions = config.aegisInputsOrigin === 'CALLER_MANUAL'
      ? new Set(['AEGIS_RISK_PERMISSION', 'CONSTRAINED_QUANTITY_SIZING']) : new Set<string>();
    realEvidence = derived.filter((methodId) => !inputRealnessExclusions.has(methodId));
    const snapshotIdentity = result.snapshotContentHash ?? 'no-snapshot';
    const runtime: ProfitabilityRuntimeEvidence[] = realEvidence.map((methodId) => ({
      methodId, evidenceId: `${result.runId}:${methodId}`,
      evidenceHash: createHash('sha256').update(`${methodId}:${snapshotIdentity}`).digest('hex'),
      observedAt: result.finishedAt, sourceSha, workerSha: sourceSha,
    }));
    const manifestBody = {
      contractVersion: profitabilityBrainEvidenceManifestVersion,
      // This command's own live run really does prove today's current
      // worker/source -- CURRENT_RUNTIME, never HISTORICAL_REAL_RUNTIME.
      evidenceClass: 'CURRENT_RUNTIME' as const,
      canonicalSourceSha: sourceSha, evidenceWorkerSha: sourceSha,
      generatedAt: result.finishedAt, runtime, empirical: [], brokerAuthorization: [],
    };
    const manifest: ProfitabilityBrainEvidenceManifest = {
      ...manifestBody, manifestHash: createHash('sha256').update(canonicalJson(manifestBody)).digest('hex'),
    };
    const built = buildProfitabilityBrainRealityFromManifest(manifest);
    brainRealityManifestViolations = built.violations;
    brainRealityLevelCounts = built.receipt.levelCounts;
  } catch (error) {
    // An immutable-source violation (dirty tree / no git) must never crash
    // this command's real evidence probe -- it just means no L7 evidence
    // can honestly be claimed this run, which is itself a real, reportable
    // fact, not a reason to fail the whole no-submit cycle.
    brainRealityManifestViolations = [error instanceof Error ? error.message : 'SHADOW_ONCE_SOURCE_IDENTITY_ERROR'];
  }

  console.info(JSON.stringify({
    runId: result.runId,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    universeDiscoveryFunnel: discovery.funnel,
    universeDiscoveryBlockers: discovery.blockers,
    selectedUnderlying: result.selectedUnderlying,
    underlyingRanking: result.underlyingRanking,
    universeFunnel: result.universeFunnel,
    optionContractsComplete: result.optionContractsComplete,
    optionChainComplete: result.optionChainComplete,
    decisionAuthorityVersion: result.strategyFrontier?.decisionAuthorityVersion ?? null,
    finalAction: result.strategyFrontier?.primaryAction ?? result.orchestration?.receipt.winningAction ?? null,
    plainEnglishExplanation: result.strategyFrontier?.selectedCandidateId != null
      ? 'Canonical multi-branch structural authority selected the recorded candidate. Empirical utility is not calibrated.'
      : result.orchestration?.receipt.plainEnglishExplanation ?? null,
    quantity: result.strategyFrontier?.selectedQuantity ?? result.orchestration?.receipt.quantity ?? null,
    firstPaperTelemetry,
    provenance: result.provenance,
    provenanceDetail: result.provenanceDetail,
    blockers: result.blockers,
    persistenceStatus: 'NOT_PERSISTED -- local no-submit evidence probe',
    brainRealityEvidenceThisRun: realEvidence,
    brainRealityLevelCounts,
    brainRealityManifestViolations,
    aegisInputsOrigin: config.aegisInputsOrigin,
  }, null, 2));

  return result.blockers.length > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    console.info(JSON.stringify({ status: 'UNCAUGHT_ERROR', detail: error instanceof Error ? error.message : 'unknown error' }));
    process.exitCode = 1;
  });
}
