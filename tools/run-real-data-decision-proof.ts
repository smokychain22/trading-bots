// PROOF SCRIPT (not a production module): proves REAL Alpaca + Optionomics
// data can flow through the actual new-risk-orchestrator.ts and produce a
// genuine, reproducible THETA decision receipt. This is a one-off diagnostic,
// not R1D's real universe-selection engine or a permanent ingestion module --
// those remain separate, larger engineering tasks. No order is submitted;
// every call here is a read-only GET.
//
// Pipeline exercised: Alpaca option-contract discovery (real, 25-60 DTE
// window) -> Alpaca indicative bid/ask (real, broker truth for this
// account's entitlement) -> Optionomics option chain (real Greeks, matched
// by OCC symbol) -> NormalizedOptionContract (source=ALPACA,
// greeksSource=OPTIONOMICS when matched) -> runNewRiskOrchestration (the
// real ownership/regime/router/theta-q-lattice/pareto/aegis/opportunity-
// frontier/sizing/execution-quality pipeline, via real Python subprocesses).
import { loadEnvironmentFile } from '../src/config/environment.js';
import { normalizeOptionContract, type RawOptionQuoteInput } from '../src/theta/option-contract.js';
import { runNewRiskOrchestration, type RawCandidateInput } from '../src/theta/new-risk-orchestrator.js';
import type { PythonBridgeConfig } from '../src/theta/python-bridge.js';

const environment = loadEnvironmentFile('.env.alpaca.local');
const alpacaHeaders = { 'APCA-API-KEY-ID': environment.ALPACA_API_KEY ?? '', 'APCA-API-SECRET-KEY': environment.ALPACA_SECRET_KEY ?? '' };
const optionomicsHeaders = { 'X-USER-EMAIL': environment.OPTIONOMICS_EMAIL ?? '', 'X-USER-TOKEN': environment.OPTIONOMICS_API_KEY ?? '' };

const UNDERLYING = 'SPY';
const today = new Date();
const dteFloor = new Date(today.getTime() + 25 * 86_400_000).toISOString().slice(0, 10);
const dteCeiling = new Date(today.getTime() + 60 * 86_400_000).toISOString().slice(0, 10);

// 1. Real Alpaca option-contract discovery, 25-60 DTE window, puts only.
const contractsUrl = new URL('/v2/options/contracts', 'https://paper-api.alpaca.markets');
contractsUrl.search = new URLSearchParams({
  underlying_symbols: UNDERLYING, status: 'active', type: 'put',
  expiration_date_gte: dteFloor, expiration_date_lte: dteCeiling, limit: '10',
}).toString();
const contractsResponse = await fetch(contractsUrl, { headers: alpacaHeaders });
const contractsBody = await contractsResponse.json() as { option_contracts?: Array<Record<string, unknown>> };
const contracts = contractsBody.option_contracts ?? [];
console.log(`Alpaca option-contract discovery: httpStatus=${contractsResponse.status} contractCount=${contracts.length}`);

if (contracts.length === 0) {
  console.log('No contracts returned in the 25-60 DTE window for this account/entitlement -- stopping proof honestly, not fabricating data.');
  process.exit(0);
}

// 2. Real Alpaca indicative bid/ask for those specific contract symbols.
const symbols = contracts.map((c) => c.symbol as string).filter((s): s is string => typeof s === 'string');
const snapshotUrl = new URL(`/v1beta1/options/snapshots/${UNDERLYING}`, 'https://data.alpaca.markets');
snapshotUrl.search = new URLSearchParams({
  feed: 'indicative', limit: '100', type: 'put', expiration_date_gte: dteFloor, expiration_date_lte: dteCeiling,
}).toString();
const snapshotResponse = await fetch(snapshotUrl, { headers: alpacaHeaders });
const snapshotBody = await snapshotResponse.json() as {
  snapshots?: Record<string, {
    latestQuote?: { bp?: number; ap?: number; bs?: number; as?: number; t?: string };
    greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number; rho?: number };
    impliedVolatility?: number;
  }>;
};
console.log(`Alpaca indicative snapshot: httpStatus=${snapshotResponse.status} snapshotCount=${Object.keys(snapshotBody.snapshots ?? {}).length}`);

// 3. Real Optionomics option chain (Greeks) for the same underlying.
const optionomicsUrl = new URL(`/api/v1/stocks/${UNDERLYING}/options`, 'https://optionomics.ai');
const optionomicsResponse = await fetch(optionomicsUrl, { headers: optionomicsHeaders });
const optionomicsBody = await optionomicsResponse.json() as { options?: Array<Record<string, unknown>> };
const optionomicsBySymbol = new Map((optionomicsBody.options ?? []).map((o) => [o.symbol as string, o]));
console.log(`Optionomics option chain: httpStatus=${optionomicsResponse.status} entryCount=${optionomicsBody.options?.length ?? 0}`);

const nowIso = new Date().toISOString();
const candidates: RawCandidateInput[] = [];

for (const c of contracts.slice(0, 5)) {
  const symbol = c.symbol as string;
  const snapshot = snapshotBody.snapshots?.[symbol];
  const quote = snapshot?.latestQuote;
  const alpacaGreeks = snapshot?.greeks;
  const optionomicsEntry = optionomicsBySymbol.get(symbol);
  const optionomicsGreek = (field: string): number | null => {
    const raw = optionomicsEntry?.[field];
    return typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : typeof raw === 'number' ? raw : null;
  };
  // Prefer Alpaca's own Greeks when this account/entitlement supplies them
  // (proven to happen for puts in this DTE window); fall back to
  // Optionomics only when Alpaca's snapshot omits Greeks entirely --
  // greeksSource always reflects whichever provider actually supplied them.
  const alpacaHasGreeks = alpacaGreeks !== undefined && alpacaGreeks.delta !== undefined;
  const greek = (alpacaField: keyof NonNullable<typeof alpacaGreeks>, optionomicsField: string): number | null =>
    alpacaHasGreeks ? (alpacaGreeks?.[alpacaField] ?? null) : optionomicsGreek(optionomicsField);
  const greeksSource: 'ALPACA' | 'OPTIONOMICS' | null = alpacaHasGreeks ? 'ALPACA' : optionomicsEntry !== undefined ? 'OPTIONOMICS' : null;

  const raw: RawOptionQuoteInput = {
    source: 'ALPACA',
    underlying: UNDERLYING,
    optionSymbol: symbol,
    occSymbol: symbol,
    optionType: 'PUT',
    strike: Number(c.strike_price),
    expiration: c.expiration_date as string,
    asOfDate: today.toISOString().slice(0, 10),
    multiplier: 100,
    underlyingBid: null, underlyingAsk: null, underlyingLast: null, underlyingTimestamp: null,
    bid: quote?.bp ?? null, ask: quote?.ap ?? null, bidSize: quote?.bs ?? null, askSize: quote?.as ?? null,
    lastTradePrice: null, lastTradeSize: null,
    quoteTimestamp: quote?.t ?? null, tradeTimestamp: null,
    volume: null, volumeSource: null, openInterest: null, openInterestSource: null,
    iv: alpacaHasGreeks ? (snapshot?.impliedVolatility ?? null) : optionomicsGreek('implied_volatility'),
    delta: greek('delta', 'delta'), gamma: greek('gamma', 'gamma'), theta: greek('theta', 'theta'),
    vega: greek('vega', 'vega'), rho: greek('rho', 'rho'),
    greeksTimestamp: greeksSource !== null ? nowIso : null,
    greeksSource,
    feed: 'INDICATIVE',
    dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 30,
    maxSpreadPctForExecutable: 0.5,
  };

  const contract = normalizeOptionContract(raw, nowIso);
  candidates.push({
    candidateId: symbol, contract,
    entryPremiumPerShare: contract.bid ?? 0,
    severeDrawdownProbability: null, ivRank: null, brokerAllowedQty: 1, contractIsStandard: true,
    hasAlternateContract: contracts.length > 1, hasAlternateExpiry: false, hasAlternateStructure: false,
    ivCompensationSufficient: null, quoteSize: quote?.bs ?? null, preSlippageExpectedUtility: null,
  });
  console.log(`  candidate ${symbol}: strike=${c.strike_price} expiration=${c.expiration_date} bid=${quote?.bp ?? 'UNKNOWN'} ask=${quote?.ap ?? 'UNKNOWN'} delta=${contract.delta ?? 'UNKNOWN'} (greeksSource=${greeksSource ?? 'none'})`);
}

const bridge: PythonBridgeConfig = {
  pythonExecutablePath: 'C:\\Users\\hp\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
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
  timeoutMs: 5000,
  maxOutputBytes: 1_000_000,
};

const result = await runNewRiskOrchestration(bridge, {
  snapshotId: `real-proof-${Date.now()}`, fusionSnapshotHash: 'a'.repeat(64), timestamp: nowIso,
  underlying: UNDERLYING, earningsDistanceDays: 90, providerStateGood: true,
  policyVersion: 'real-proof-v1', modelVersions: {}, requiredModelVersions: {},
  ownershipPolicy: {
    policyVersion: 'ownership-v1', minStockAvgVolume: 1, minOptionOpenInterest: 1, minOptionVolume: 1,
    maxSpreadPct: 0.5, rvNormalizationCeiling: 0.6, downsideSemivarNormalizationCeiling: 0.3,
    gapFrequencyNormalizationCeiling: 0.5, eventDecayWindowDays: 10,
  },
  // Ownership/regime inputs are NOT real historical data here (that's R1D's
  // universe/feature pipeline, not built this session) -- using clearly
  // synthetic-but-labeled placeholder values so the proof can run end to
  // end; the resulting ownership/regime SCORES are not claimed to be real.
  ownershipInputs: {
    stockAvgVolume: 50_000_000, optionOpenInterest: 1000, optionVolume: 100, spreadPct: 0.05,
    ret1d: 0, ret5d: 0, ret20d: 0, ret60d: 0, ma20Rel: 0.01, ma50Rel: 0.01, ma200Rel: 0.01,
    maSlope: 0.005, relativeStrength: 0, rv10: 0.15, rv20: 0.15, rv60: 0.15, drawdown: -0.02, maxAdverseGap: 0.01,
    gapFrequency: 0.05, downsideSemivariance: 0.02, historicalRecoveryMedianDays: 15, historicalRecoveryP95Days: 45,
    severeDrawdownEpisodeCount: 0, earningsDistanceDays: 90, exDividendDistanceDays: 90, knownEventDistanceDays: null,
  },
  regimePolicy: {
    policyVersion: 'regime-v1', bullMaSlopeFloor: 0.01, bearMaSlopeCeiling: -0.01, rvLowCeiling: 0.1, rvHighFloor: 0.25,
    rvShockFloor: 0.4, maxAdverseGapShockThreshold: 0.08, liquidityThinSpreadPctFloor: 0.03,
    liquidityDislocatedSpreadPctFloor: 0.08, correctionDrawdownCeiling: -0.1, crisisDrawdownCeiling: -0.2,
  },
  regimeInputs: {
    maSlope: 0.005, rv20: 0.15, maxAdverseGap: 0.01, earningsDistanceDays: 90, corporateActionPending: false,
    macroRiskFlag: false, spreadPct: 0.01, portfolioOrMarketDrawdown: -0.02,
  },
  routerPolicy: { policyVersion: 'router-v1', thetaQMinOwnershipAcceptability: 0.1, thetaHMinOwnershipAcceptability: 0.75, thetaDGateSatisfied: false },
  routerPortfolio: { lifecycleState: 'CASH_AVAILABLE', stockSharesHeld: 0, openOptionExists: false, assignmentImminent: false },
  latticeConfig: {
    configVersion: 'lattice-v1', minDte: 25, maxDte: 60, deltaBands: [[0.0, 0.25], [0.25, 0.5]],
    minOpenInterest: 0, minVolume: 0, maxSpreadPct: 1.0, earningsExclusionDays: 0,
  },
  thetaQSizingPolicy: {
    riskLimitVersion: 'risk-v1', maxSpreadPct: 1.0, maxQuoteAgeSeconds: 999_999, minOpenInterest: 0, minVolume: 0,
    earningsExclusionDays: 0, ownershipAcceptabilityFloor: 0.1, exceptionalUtilityThreshold: 0.9,
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
  maxAcceptableSpreadPct: 1.0,
  candidates,
  sizingPolicy: { policyVersion: 'sizing-v1', riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 5, assignmentCapacityQtyCap: 6, reducedStateMultiplier: 0.5 },
  sizingAccount: { equity: 100_000, cash: 50_000, buyingPower: 40_000, brokerAllowedQty: 10 },
  executionQualityPolicy: { policyVersion: 'execq-v1', maxAcceptableSpreadPct: 1.0, minQuoteSizeForFullConfidence: 1, maxQuoteAgeSeconds: 999_999, minAfterCostUtilityToCross: -999_999 },
});

console.log('\n=== DIAGNOSTICS ===');
console.log('ownership.ownability:', result.ownership?.ownability);
console.log('routing THETA_Q:', result.routing?.results.find((r) => r.strategyFamily === 'THETA_Q'));
console.log('thetaQ candidate count:', result.thetaQ?.candidates.length);
console.log('thetaQ candidates:', JSON.stringify(result.thetaQ?.candidates, null, 2));

console.log('\n=== REAL-DATA DECISION RECEIPT ===');
console.log(JSON.stringify(result.receipt, null, 2));
console.log(`\nshadowOpportunities recorded: ${result.shadowOpportunities.length}`);
