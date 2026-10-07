export const gammaScalpingSimulationVersion = 'theta-gamma-scalping-simulation-v1' as const;

export type GammaHedgeAlgorithm = 'TIME_BASED' | 'DELTA_THRESHOLD' | 'PRICE_MOVE_THRESHOLD' | 'GAMMA_BAND' | 'VOLATILITY_ADAPTIVE';

export interface GammaHedgePolicy {
  readonly version: string;
  readonly algorithm: GammaHedgeAlgorithm;
  readonly timeIntervalMinutes: number | null;
  readonly deltaThresholdShares: number | null;
  readonly priceMoveThresholdPct: number | null;
  readonly gammaBandSpotMove: number | null;
  readonly volatilityAdaptiveBaseDeltaShares: number | null;
  readonly underlyingCostPerShareTraded: number;
}

export interface GammaScalpObservation {
  readonly observedAt: string;
  readonly providerKnownAt: string;
  readonly spot: number;
  /** Executable liquidation value of the complete long-gamma option structure, per share. */
  readonly optionLiquidationValuePerShare: number;
  readonly netDeltaPerShare: number;
  readonly gammaPerSharePerDollar: number;
  readonly thetaPerSharePerDay: number;
  readonly vegaPerSharePerVolPoint: number;
  readonly impliedVolatility: number;
}

export interface GammaHedgeTrade {
  readonly observedAt: string;
  readonly reason: GammaHedgeAlgorithm | 'FINAL_LIQUIDATION';
  readonly sharesBefore: number;
  readonly sharesAfter: number;
  readonly sharesTraded: number;
  readonly spot: number;
  readonly transactionCostUsd: number;
}

export interface GammaScalpingSimulationReceipt {
  readonly version: typeof gammaScalpingSimulationVersion;
  readonly policyVersion: string;
  readonly algorithm: GammaHedgeAlgorithm;
  readonly sourceClaim: 'OWNER_CURATED_SOURCE_CLAIM';
  readonly authority: 'RESEARCH_ONLY';
  readonly executionAuthorized: false;
  readonly state: 'COMPLETE' | 'INVALID' | 'PIT_UNSAFE' | 'BLOCKED_MISSING_POLICY';
  readonly reasons: readonly string[];
  readonly observationCount: number;
  readonly hedgeCount: number;
  readonly hedgeTrades: readonly GammaHedgeTrade[];
  readonly impliedVolatilityPaid: number | null;
  readonly realizedVolatility: number | null;
  readonly realizedToImpliedRatio: number | null;
  readonly pnl: {
    readonly optionMarkPnlUsd: number | null;
    readonly hedgePnlBeforeCostsUsd: number | null;
    readonly gammaContributionUsd: number | null;
    readonly thetaContributionUsd: number | null;
    readonly vegaContributionUsd: number | null;
    readonly attributionResidualUsd: number | null;
    readonly transactionCostsUsd: number | null;
    readonly netPnlUsd: number | null;
  };
  readonly profitabilityStatus: 'EMPIRICALLY_UNPROVEN';
}

const finite = (value: number): boolean => Number.isFinite(value);
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

function missingPolicy(policy: GammaHedgePolicy): string[] {
  const required = policy.algorithm === 'TIME_BASED' ? [['TIME_INTERVAL_MINUTES', policy.timeIntervalMinutes]]
    : policy.algorithm === 'DELTA_THRESHOLD' ? [['DELTA_THRESHOLD_SHARES', policy.deltaThresholdShares]]
      : policy.algorithm === 'PRICE_MOVE_THRESHOLD' ? [['PRICE_MOVE_THRESHOLD_PCT', policy.priceMoveThresholdPct]]
        : policy.algorithm === 'GAMMA_BAND' ? [['GAMMA_BAND_SPOT_MOVE', policy.gammaBandSpotMove]]
          : [['VOLATILITY_ADAPTIVE_BASE_DELTA_SHARES', policy.volatilityAdaptiveBaseDeltaShares]];
  return required.filter(([, value]) => value === null || !finite(value as number) || (value as number) <= 0)
    .map(([name]) => `MISSING_POLICY:${name as string}`);
}

function invalidObservations(observations: readonly GammaScalpObservation[]): string[] {
  const reasons: string[] = [];
  if (observations.length < 2) reasons.push('INSUFFICIENT_OBSERVATIONS');
  for (let index = 0; index < observations.length; index += 1) {
    const row = observations[index] as GammaScalpObservation;
    const observed = Date.parse(row.observedAt); const known = Date.parse(row.providerKnownAt);
    if (!finite(observed) || !finite(known)) reasons.push('INVALID_TIMESTAMP');
    if (finite(observed) && finite(known) && known > observed) reasons.push('PROVIDER_EVIDENCE_KNOWN_AFTER_OBSERVATION');
    if (index > 0 && row.observedAt <= (observations[index - 1] as GammaScalpObservation).observedAt) reasons.push('OBSERVATIONS_NOT_STRICTLY_CHRONOLOGICAL');
    if (![row.spot, row.optionLiquidationValuePerShare, row.netDeltaPerShare, row.gammaPerSharePerDollar,
      row.thetaPerSharePerDay, row.vegaPerSharePerVolPoint, row.impliedVolatility].every(finite)
      || row.spot <= 0 || row.optionLiquidationValuePerShare < 0 || row.impliedVolatility <= 0
      || row.gammaPerSharePerDollar < 0) reasons.push('INVALID_MARKET_EVIDENCE');
  }
  return [...new Set(reasons)].sort();
}

function annualizedRealizedVolatility(observations: readonly GammaScalpObservation[]): number | null {
  if (observations.length < 3) return null;
  const returns = observations.slice(1).map((row, index) => Math.log(row.spot / (observations[index] as GammaScalpObservation).spot));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  const elapsedDays = (Date.parse((observations.at(-1) as GammaScalpObservation).observedAt)
    - Date.parse((observations[0] as GammaScalpObservation).observedAt)) / 86_400_000;
  const periodsPerYear = elapsedDays > 0 ? returns.length / elapsedDays * 365 : null;
  return periodsPerYear === null ? null : Math.sqrt(variance * periodsPerYear);
}

function shouldHedge(policy: GammaHedgePolicy, current: GammaScalpObservation, priorHedge: GammaScalpObservation,
  currentShares: number, targetShares: number, multiplier: number, contracts: number): boolean {
  const elapsedMinutes = (Date.parse(current.observedAt) - Date.parse(priorHedge.observedAt)) / 60_000;
  const priceMovePct = Math.abs(current.spot / priorHedge.spot - 1);
  const deltaGapShares = Math.abs(targetShares - currentShares);
  if (policy.algorithm === 'TIME_BASED') return elapsedMinutes >= (policy.timeIntervalMinutes as number);
  if (policy.algorithm === 'DELTA_THRESHOLD') return deltaGapShares >= (policy.deltaThresholdShares as number);
  if (policy.algorithm === 'PRICE_MOVE_THRESHOLD') return priceMovePct >= (policy.priceMoveThresholdPct as number);
  if (policy.algorithm === 'GAMMA_BAND') return Math.abs(current.spot - priorHedge.spot) >= (policy.gammaBandSpotMove as number);
  const adaptiveThreshold = (policy.volatilityAdaptiveBaseDeltaShares as number)
    * Math.max(0.5, Math.min(2, current.impliedVolatility / (observationsSafeIv(priorHedge))));
  return deltaGapShares >= adaptiveThreshold && multiplier * contracts > 0;
}

const observationsSafeIv = (row: GammaScalpObservation): number => Math.max(row.impliedVolatility, Number.EPSILON);

export function simulateGammaScalping(input: {
  readonly observations: readonly GammaScalpObservation[];
  readonly policy: GammaHedgePolicy;
  readonly contracts: number;
  readonly multiplier: number;
  /** Actual executable debit paid for the complete long-gamma structure, per share. */
  readonly entryDebitPerShare: number;
  readonly optionEntryCostsUsd: number | null;
  readonly optionExitCostsUsd: number | null;
}): GammaScalpingSimulationReceipt {
  const policyReasons = missingPolicy(input.policy);
  const validation = invalidObservations(input.observations);
  if (!Number.isInteger(input.contracts) || input.contracts <= 0 || !Number.isInteger(input.multiplier)
    || input.multiplier <= 0 || !finite(input.entryDebitPerShare) || input.entryDebitPerShare < 0
    || !finite(input.policy.underlyingCostPerShareTraded) || input.policy.underlyingCostPerShareTraded < 0) {
    validation.push('INVALID_POSITION_OR_COST_INPUT');
  }
  const pit = validation.filter((reason) => reason === 'PROVIDER_EVIDENCE_KNOWN_AFTER_OBSERVATION'
    || reason === 'OBSERVATIONS_NOT_STRICTLY_CHRONOLOGICAL');
  const state = pit.length > 0 ? 'PIT_UNSAFE' as const : validation.length > 0 ? 'INVALID' as const
    : policyReasons.length > 0 ? 'BLOCKED_MISSING_POLICY' as const : 'COMPLETE' as const;
  const reasons = state === 'PIT_UNSAFE' ? pit : state === 'INVALID' ? validation : state === 'BLOCKED_MISSING_POLICY' ? policyReasons : [];
  const empty = {
    version: gammaScalpingSimulationVersion, policyVersion: input.policy.version, algorithm: input.policy.algorithm,
    sourceClaim: 'OWNER_CURATED_SOURCE_CLAIM' as const, authority: 'RESEARCH_ONLY' as const,
    executionAuthorized: false as const, state, reasons: [...new Set(reasons)].sort(), observationCount: input.observations.length,
    hedgeCount: 0, hedgeTrades: [] as GammaHedgeTrade[], impliedVolatilityPaid: null, realizedVolatility: null,
    realizedToImpliedRatio: null, pnl: { optionMarkPnlUsd: null, hedgePnlBeforeCostsUsd: null,
      gammaContributionUsd: null, thetaContributionUsd: null, vegaContributionUsd: null,
      attributionResidualUsd: null, transactionCostsUsd: null, netPnlUsd: null },
    profitabilityStatus: 'EMPIRICALLY_UNPROVEN' as const,
  };
  if (state !== 'COMPLETE') return empty;
  const observations = input.observations;
  const first = observations[0] as GammaScalpObservation; const last = observations.at(-1) as GammaScalpObservation;
  const unit = input.contracts * input.multiplier;
  let shares = 0; let hedgePnl = 0; let costs = (input.optionEntryCostsUsd ?? 0) + (input.optionExitCostsUsd ?? 0);
  let gamma = 0; let theta = 0; let vega = 0; let priorHedge = first;
  const trades: GammaHedgeTrade[] = [];
  for (let index = 1; index < observations.length; index += 1) {
    const prior = observations[index - 1] as GammaScalpObservation; const current = observations[index] as GammaScalpObservation;
    const spotMove = current.spot - prior.spot;
    const days = (Date.parse(current.observedAt) - Date.parse(prior.observedAt)) / 86_400_000;
    hedgePnl += shares * spotMove;
    gamma += 0.5 * prior.gammaPerSharePerDollar * spotMove ** 2 * unit;
    theta += prior.thetaPerSharePerDay * days * unit;
    vega += prior.vegaPerSharePerVolPoint * (current.impliedVolatility - prior.impliedVolatility) * unit;
    const target = Math.round(-current.netDeltaPerShare * unit);
    if (shouldHedge(input.policy, current, priorHedge, shares, target, input.multiplier, input.contracts)) {
      const traded = target - shares; const transactionCost = Math.abs(traded) * input.policy.underlyingCostPerShareTraded;
      costs += transactionCost;
      trades.push({ observedAt: current.observedAt, reason: input.policy.algorithm, sharesBefore: shares,
        sharesAfter: target, sharesTraded: traded, spot: current.spot, transactionCostUsd: money(transactionCost) });
      shares = target; priorHedge = current;
    }
  }
  if (shares !== 0) {
    const transactionCost = Math.abs(shares) * input.policy.underlyingCostPerShareTraded;
    costs += transactionCost;
    trades.push({ observedAt: last.observedAt, reason: 'FINAL_LIQUIDATION', sharesBefore: shares, sharesAfter: 0,
      sharesTraded: -shares, spot: last.spot, transactionCostUsd: money(transactionCost) });
  }
  const optionPnl = (last.optionLiquidationValuePerShare - input.entryDebitPerShare) * unit;
  const net = optionPnl + hedgePnl - costs;
  const residual = optionPnl - gamma - theta - vega;
  const realizedVolatility = annualizedRealizedVolatility(observations);
  return { ...empty, state: 'COMPLETE', hedgeCount: trades.filter((trade) => trade.reason !== 'FINAL_LIQUIDATION').length,
    hedgeTrades: trades, impliedVolatilityPaid: first.impliedVolatility, realizedVolatility,
    realizedToImpliedRatio: realizedVolatility === null ? null : realizedVolatility / first.impliedVolatility,
    pnl: { optionMarkPnlUsd: money(optionPnl), hedgePnlBeforeCostsUsd: money(hedgePnl),
      gammaContributionUsd: money(gamma), thetaContributionUsd: money(theta), vegaContributionUsd: money(vega),
      attributionResidualUsd: money(residual), transactionCostsUsd: money(costs), netPnlUsd: money(net) } };
}
