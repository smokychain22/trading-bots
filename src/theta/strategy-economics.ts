// THETA strategy economics: "is the reward worth the capital and the risk?"
//
// This is a separate authority from AEGIS ("is the risk acceptable?"), the
// router ("which strategies apply?"), the allocator ("how much capacity
// exists?") and the frontier ("which feasible proposal wins?"). It computes a
// per-contract StrategyEconomicsReceipt from contract evidence only, evaluates
// optional owner-configured hurdles, and supplies a deterministic economic
// ranking order. It never sizes, never mutates a quantity, never submits.
//
// Honesty rules:
//  - A missing input is a typed UNKNOWN with a reason, never a zero.
//  - Expected value is UNKNOWN until an empirically calibrated EV model exists
//    (EV_MODEL_NOT_EMPIRICALLY_READY); it is never inferred from delta.
//  - |delta| is reported only as a labelled risk-neutral ITM-at-expiry PROXY,
//    never as a probability of profit.
//  - No Production hurdle values live here. Every hurdle is null (NOT
//    CONFIGURED) unless a policy supplies it, and the default mode is SHADOW.

export const strategyEconomicsContractVersion = 'theta-strategy-economics-v1' as const;

export type EconomicsStructure = 'CASH_SECURED_PUT' | 'PUT_CREDIT_SPREAD';
export type EconomicsStrategyClass = 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK';

export type EconomicValue =
  | { readonly state: 'KNOWN'; readonly value: number; readonly provenance: string }
  | { readonly state: 'UNKNOWN'; readonly reason: string };

const known = (value: number, provenance: string): EconomicValue => Number.isFinite(value)
  ? { state: 'KNOWN', value, provenance } : { state: 'UNKNOWN', reason: 'NON_FINITE_RESULT' };
const unknown = (reason: string): EconomicValue => ({ state: 'UNKNOWN', reason });
const valueOf = (item: EconomicValue): number | null => item.state === 'KNOWN' ? item.value : null;
const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const round = (value: number, places = 6): number => Number(value.toFixed(places));

export interface EconomicsLegQuote {
  readonly optionSymbol: string;
  readonly strike: number;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly delta: number | null;
  readonly iv: number | null;
  readonly volume: number | null;
  readonly openInterest: number | null;
}

export interface StrategyEconomicsInput {
  readonly candidateId: string;
  readonly strategyClass: EconomicsStrategyClass;
  readonly structure: EconomicsStructure;
  readonly underlying: string;
  readonly expiration: string;
  readonly dte: number;
  readonly multiplier: number;
  /** The short put (both structures). */
  readonly shortLeg: EconomicsLegQuote;
  /** The protective long put (PUT_CREDIT_SPREAD only). */
  readonly longLeg?: EconomicsLegQuote | null;
  readonly spot: number | null;
  /**
   * Per-share credit the receipt is computed at. Pre-trade this must be an
   * executable assumption (the short bid, or for a spread short bid - long
   * ask); post-trade it is the confirmed fill. The basis is recorded.
   */
  readonly creditPerShare: number | null;
  readonly creditBasis: 'EXECUTABLE_BID' | 'CONFIRMED_FILL' | 'LIMIT_PRICE';
  /** Modeled opening costs for the whole package, USD; null = UNKNOWN. */
  readonly openingCostsUsd: number | null;
  readonly openingCostProvenance?: string;
  /** Annualized realized volatility of the underlying (decimal); null = UNKNOWN. */
  readonly realizedVolatility: number | null;
  readonly realizedVolatilityProvenance?: string;
  readonly ivRank: number | null;
  /** True when a known event (e.g. earnings) falls inside the holding window; null = UNKNOWN. */
  readonly eventInWindow: boolean | null;
  /** Adverse underlying gap applied for the stress loss (decimal, e.g. 0.05). */
  readonly stressGapPct: number;
  /**
   * Underlying-level annualized volatility for the -2 sigma scenario and cushion-in-sigmas, shared by every candidate on
   * the underlying (so skew-rich OTM legs are not stressed harder than nearer strikes). Null falls back to the short leg's
   * own IV, and the provenance says so.
   */
  readonly scenarioVolatility?: number | null;
  readonly scenarioVolatilityProvenance?: string;
  /** Annual opportunity-cost rate on committed capital (decimal); null = NOT CONFIGURED. */
  readonly opportunityCostAnnualRate: number | null;
}

export interface StrategyEconomicsReceipt {
  readonly contractVersion: typeof strategyEconomicsContractVersion;
  readonly candidateId: string;
  readonly strategyClass: EconomicsStrategyClass;
  readonly structure: EconomicsStructure;
  readonly underlying: string;
  readonly expiration: string;
  readonly dte: number;
  readonly creditBasis: StrategyEconomicsInput['creditBasis'];
  readonly grossCreditUsd: EconomicValue;
  readonly netCreditUsd: EconomicValue;
  readonly spreadWidthUsd: EconomicValue;
  readonly capitalRequiredUsd: EconomicValue;
  readonly maxProfitUsd: EconomicValue;
  readonly maxLossUsd: EconomicValue;
  readonly breakeven: EconomicValue;
  readonly distanceToStrikePct: EconomicValue;
  readonly distanceToBreakevenPct: EconomicValue;
  /** ln(spot / breakeven) in units of the short leg's implied move to expiry (IV x sqrt(DTE/365)). */
  readonly breakevenCushionSigmas: EconomicValue;
  readonly returnOnCapital: EconomicValue;
  readonly annualizedReturnOnCapital: EconomicValue;
  readonly returnPerCapitalDay: EconomicValue;
  readonly rewardToMaxLoss: EconomicValue;
  readonly bidAskSpreadPct: EconomicValue;
  readonly ivMinusRealizedVol: EconomicValue;
  readonly ivRank: EconomicValue;
  /** Risk-neutral ITM-at-expiry proxy from |delta|. NOT a probability of profit. */
  readonly assignmentProbabilityProxy: EconomicValue;
  readonly stressLossUsd: EconomicValue;
  readonly impliedTwoSigmaMoveLossUsd: EconomicValue;
  readonly rewardToStressRisk: EconomicValue;
  readonly opportunityCostUsd: EconomicValue;
  readonly excessOverOpportunityCostUsd: EconomicValue;
  readonly expectedValueUsd: EconomicValue;
  readonly eventRisk: 'EVENT_IN_WINDOW' | 'NO_KNOWN_EVENT_IN_WINDOW' | 'UNKNOWN';
  readonly liquidity: { readonly minVolume: number | null; readonly minOpenInterest: number | null };
}

function legSpreadPct(leg: EconomicsLegQuote): number | null {
  if (!finite(leg.bid) || !finite(leg.ask) || leg.ask < leg.bid || leg.ask <= 0) return null;
  const mid = (leg.bid + leg.ask) / 2;
  return mid > 0 ? (leg.ask - leg.bid) / mid : null;
}

const minKnown = (values: readonly (number | null)[]): number | null => {
  const present = values.filter(finite);
  return present.length === values.length && present.length > 0 ? Math.min(...present) : null;
};

export function buildStrategyEconomicsReceipt(input: StrategyEconomicsInput): StrategyEconomicsReceipt {
  const { multiplier, dte, shortLeg } = input;
  if (!(multiplier > 0) || !Number.isInteger(dte)) throw new Error('STRATEGY_ECONOMICS_INPUT_INVALID');
  const spread = input.structure === 'PUT_CREDIT_SPREAD';
  const longLeg = input.longLeg ?? null;
  if (spread && (longLeg === null || !(longLeg.strike < shortLeg.strike))) throw new Error('STRATEGY_ECONOMICS_SPREAD_LEGS_INVALID');
  if (!spread && longLeg !== null) throw new Error('STRATEGY_ECONOMICS_CSP_HAS_LONG_LEG');

  const credit = finite(input.creditPerShare) && input.creditPerShare > 0 ? input.creditPerShare : null;
  const creditProvenance = `CREDIT_${input.creditBasis}`;
  const grossCredit = credit === null ? unknown('CREDIT_UNKNOWN_OR_NON_POSITIVE') : known(round(credit * multiplier, 4), creditProvenance);
  const netCredit = credit === null ? unknown('CREDIT_UNKNOWN_OR_NON_POSITIVE')
    : finite(input.openingCostsUsd) ? known(round(credit * multiplier - input.openingCostsUsd, 4),
      `${creditProvenance}_MINUS_${input.openingCostProvenance ?? 'MODELED_OPENING_COSTS'}`)
      : unknown('OPENING_COSTS_UNKNOWN');
  // Profit figures use net credit when costs are known, gross otherwise (and say so).
  const profitBasis = valueOf(netCredit) ?? valueOf(grossCredit);
  const profitProvenance = netCredit.state === 'KNOWN' ? 'NET_CREDIT_AFTER_MODELED_COSTS' : 'GROSS_CREDIT_COSTS_UNKNOWN';

  const width = spread && longLeg !== null ? (shortLeg.strike - longLeg.strike) * multiplier : null;
  const spreadWidth = spread ? known(round(width as number, 4), 'STRIKE_DIFFERENCE_X_MULTIPLIER')
    : unknown('NOT_APPLICABLE_SINGLE_LEG');
  // CSP: cash secured = strike x multiplier (credit is not netted; Alpaca reserves the full strike).
  // Credit spread: capital at risk = width - credit (the max loss).
  const maxLossValue = credit === null ? null : spread ? (width as number) - credit * multiplier
    : (shortLeg.strike - credit) * multiplier;
  const maxLoss = maxLossValue === null ? unknown('CREDIT_UNKNOWN_OR_NON_POSITIVE')
    : known(round(maxLossValue + (finite(input.openingCostsUsd) ? input.openingCostsUsd : 0), 4),
      finite(input.openingCostsUsd) ? 'TO_ZERO_OR_WIDTH_PLUS_MODELED_COSTS' : 'TO_ZERO_OR_WIDTH_COSTS_UNKNOWN');
  const capitalValue = spread ? maxLossValue : shortLeg.strike * multiplier;
  const capital = capitalValue === null || !(capitalValue > 0) ? unknown(spread ? 'MAX_LOSS_UNKNOWN_OR_NON_POSITIVE' : 'STRIKE_INVALID')
    : known(round(capitalValue, 4), spread ? 'DEFINED_RISK_MAX_LOSS' : 'CASH_SECURED_STRIKE_X_MULTIPLIER');
  const maxProfit = profitBasis === null ? unknown('CREDIT_UNKNOWN_OR_NON_POSITIVE') : known(round(profitBasis, 4), profitProvenance);

  const breakevenValue = credit === null ? null : shortLeg.strike - credit;
  const breakeven = breakevenValue === null ? unknown('CREDIT_UNKNOWN_OR_NON_POSITIVE') : known(round(breakevenValue, 4), 'SHORT_STRIKE_MINUS_CREDIT');
  const spot = finite(input.spot) && input.spot > 0 ? input.spot : null;
  const distanceToStrike = spot === null ? unknown('SPOT_UNKNOWN') : known(round((spot - shortLeg.strike) / spot), 'SPOT_MINUS_SHORT_STRIKE_OVER_SPOT');
  const distanceToBreakeven = spot === null || breakevenValue === null ? unknown(spot === null ? 'SPOT_UNKNOWN' : 'CREDIT_UNKNOWN_OR_NON_POSITIVE')
    : known(round((spot - breakevenValue) / spot), 'SPOT_MINUS_BREAKEVEN_OVER_SPOT');

  const sharedScenarioVol = finite(input.scenarioVolatility) && input.scenarioVolatility > 0 ? input.scenarioVolatility : null;
  const ivForSigma = sharedScenarioVol ?? (finite(shortLeg.iv) && shortLeg.iv > 0 ? shortLeg.iv : null);
  const scenarioProvenance = sharedScenarioVol !== null ? (input.scenarioVolatilityProvenance ?? 'UNDERLYING_SCENARIO_VOL') : 'SHORT_LEG_IV_FALLBACK';
  const cushionSigmas = spot === null || breakevenValue === null || breakevenValue <= 0 ? unknown(spot === null ? 'SPOT_UNKNOWN' : 'CREDIT_UNKNOWN_OR_NON_POSITIVE')
    : ivForSigma === null ? unknown('SCENARIO_VOLATILITY_UNKNOWN') : dte <= 0 ? unknown('DTE_NOT_POSITIVE')
      : known(round(Math.log(spot / breakevenValue) / (ivForSigma * Math.sqrt(dte / 365)), 6), `LN_SPOT_OVER_BREAKEVEN_OVER_SIGMA_TO_EXPIRY:${scenarioProvenance}`);
  const capitalKnown = valueOf(capital);
  const roc = profitBasis === null || capitalKnown === null ? unknown('PROFIT_OR_CAPITAL_UNKNOWN')
    : known(round(profitBasis / capitalKnown, 8), `${profitProvenance}_OVER_CAPITAL`);
  const rocValue = valueOf(roc);
  const annualized = rocValue === null ? unknown('RETURN_ON_CAPITAL_UNKNOWN') : dte <= 0 ? unknown('DTE_NOT_POSITIVE')
    : known(round(rocValue * 365 / dte, 8), 'SIMPLE_ANNUALIZATION_365_OVER_DTE');
  const perDay = rocValue === null ? unknown('RETURN_ON_CAPITAL_UNKNOWN') : dte <= 0 ? unknown('DTE_NOT_POSITIVE')
    : known(round(rocValue / dte, 10), 'RETURN_ON_CAPITAL_OVER_DTE');
  const maxLossKnown = valueOf(maxLoss);
  const rewardToMaxLoss = profitBasis === null || maxLossKnown === null || maxLossKnown <= 0 ? unknown('PROFIT_OR_MAX_LOSS_UNKNOWN')
    : known(round(profitBasis / maxLossKnown, 8), 'MAX_PROFIT_OVER_MAX_LOSS');

  const legSpreads = [shortLeg, ...(longLeg === null ? [] : [longLeg])].map(legSpreadPct);
  const worstSpread = legSpreads.every(finite) ? Math.max(...(legSpreads as number[])) : null;
  const bidAskSpreadPct = worstSpread === null ? unknown('LEG_QUOTE_INCOMPLETE') : known(round(worstSpread, 8), spread ? 'WORST_LEG_SPREAD_OVER_MID' : 'SPREAD_OVER_MID');

  const iv = finite(shortLeg.iv) && shortLeg.iv > 0 ? shortLeg.iv : null;
  const rv = finite(input.realizedVolatility) && input.realizedVolatility > 0 ? input.realizedVolatility : null;
  const ivMinusRv = iv === null ? unknown('SHORT_LEG_IV_UNKNOWN') : rv === null ? unknown('REALIZED_VOLATILITY_UNKNOWN')
    : known(round(iv - rv, 8), `SHORT_LEG_IV_MINUS_${input.realizedVolatilityProvenance ?? 'REALIZED_VOL'}`);
  const ivRank = finite(input.ivRank) ? known(input.ivRank, 'PROVIDER_IV_RANK') : unknown('IV_RANK_UNAVAILABLE');
  const assignmentProxy = finite(shortLeg.delta) ? known(round(Math.abs(shortLeg.delta), 6), 'ABS_DELTA_RISK_NEUTRAL_ITM_PROXY_NOT_PROBABILITY_OF_PROFIT')
    : unknown('SHORT_LEG_DELTA_UNKNOWN');

  // Expiry-intrinsic loss of the package after an adverse move, net of credit, capped at max loss.
  const packageLossAt = (price: number): number | null => {
    if (credit === null) return null;
    const shortIntrinsic = Math.max(0, shortLeg.strike - price);
    const longIntrinsic = longLeg === null ? 0 : Math.max(0, longLeg.strike - price);
    const loss = (shortIntrinsic - longIntrinsic - credit) * multiplier + (finite(input.openingCostsUsd) ? input.openingCostsUsd : 0);
    return Math.max(0, loss);
  };
  const stressValue = spot === null ? null : packageLossAt(spot * (1 - input.stressGapPct));
  const stressLoss = stressValue === null ? unknown(spot === null ? 'SPOT_UNKNOWN' : 'CREDIT_UNKNOWN_OR_NON_POSITIVE')
    : known(round(stressValue, 4), `EXPIRY_INTRINSIC_AFTER_${input.stressGapPct}_GAP`);
  const twoSigmaValue = spot === null || ivForSigma === null || dte <= 0 ? null
    : packageLossAt(spot * Math.exp(-2 * ivForSigma * Math.sqrt(dte / 365)));
  const twoSigma = twoSigmaValue === null ? unknown(spot === null ? 'SPOT_UNKNOWN' : ivForSigma === null ? 'SCENARIO_VOLATILITY_UNKNOWN' : 'DTE_OR_CREDIT_INVALID')
    : known(round(twoSigmaValue, 4), `EXPIRY_INTRINSIC_AT_MINUS_TWO_SIGMA:${scenarioProvenance}`);
  // Reward-to-stress uses the larger of the two adverse scenarios as the denominator, and needs BOTH: dropping an
  // unknown scenario would silently flatter exactly the candidates with missing IV.
  const worstStress = finite(stressValue) && finite(twoSigmaValue) ? Math.max(stressValue, twoSigmaValue) : null;
  const rewardToStress = profitBasis === null || worstStress === null ? unknown('PROFIT_OR_A_STRESS_SCENARIO_UNKNOWN')
    : worstStress <= 0 ? unknown('NO_STRESS_LOSS_IN_MODELED_SCENARIOS')
      : known(round(profitBasis / worstStress, 8), 'MAX_PROFIT_OVER_WORST_MODELED_STRESS_LOSS');

  const opportunityCost = input.opportunityCostAnnualRate === null ? unknown('OPPORTUNITY_COST_RATE_NOT_CONFIGURED')
    : capitalKnown === null || dte <= 0 ? unknown('CAPITAL_OR_DTE_UNKNOWN')
      : known(round(capitalKnown * input.opportunityCostAnnualRate * dte / 365, 4), 'CAPITAL_X_CONFIGURED_RATE_X_DTE_OVER_365');
  const excess = profitBasis === null || opportunityCost.state !== 'KNOWN' ? unknown(opportunityCost.state === 'KNOWN' ? 'PROFIT_UNKNOWN' : opportunityCost.reason)
    : known(round(profitBasis - opportunityCost.value, 4), 'MAX_PROFIT_MINUS_OPPORTUNITY_COST');

  const legs = [shortLeg, ...(longLeg === null ? [] : [longLeg])];
  return {
    contractVersion: strategyEconomicsContractVersion,
    candidateId: input.candidateId, strategyClass: input.strategyClass, structure: input.structure,
    underlying: input.underlying, expiration: input.expiration, dte, creditBasis: input.creditBasis,
    grossCreditUsd: grossCredit, netCreditUsd: netCredit, spreadWidthUsd: spreadWidth,
    capitalRequiredUsd: capital, maxProfitUsd: maxProfit, maxLossUsd: maxLoss, breakeven,
    distanceToStrikePct: distanceToStrike, distanceToBreakevenPct: distanceToBreakeven, breakevenCushionSigmas: cushionSigmas,
    returnOnCapital: roc, annualizedReturnOnCapital: annualized, returnPerCapitalDay: perDay,
    rewardToMaxLoss, bidAskSpreadPct, ivMinusRealizedVol: ivMinusRv, ivRank,
    assignmentProbabilityProxy: assignmentProxy, stressLossUsd: stressLoss, impliedTwoSigmaMoveLossUsd: twoSigma,
    rewardToStressRisk: rewardToStress, opportunityCostUsd: opportunityCost, excessOverOpportunityCostUsd: excess,
    expectedValueUsd: unknown('EV_MODEL_NOT_EMPIRICALLY_READY'),
    eventRisk: input.eventInWindow === null ? 'UNKNOWN' : input.eventInWindow ? 'EVENT_IN_WINDOW' : 'NO_KNOWN_EVENT_IN_WINDOW',
    liquidity: { minVolume: minKnown(legs.map((leg) => leg.volume)), minOpenInterest: minKnown(legs.map((leg) => leg.openInterest)) },
  };
}

// ---------------------------------------------------------------------------
// Hurdles: owner policy, per strategy class. Every floor is optional; a null
// floor is NOT_CONFIGURED. No Production values are defined in source.
// ---------------------------------------------------------------------------

export type EconomicsGateMode = 'OFF' | 'SHADOW' | 'ENFORCED';
export const parseEconomicsGateMode = (raw: string | null | undefined): EconomicsGateMode =>
  raw === 'SHADOW' || raw === 'ENFORCED' || raw === 'OFF' ? raw : 'SHADOW';

export interface EconomicHurdlePolicy {
  readonly policyVersion: string;
  readonly minNetCreditUsd?: number | null;
  readonly minMaxProfitUsd?: number | null;
  readonly minReturnOnCapital?: number | null;
  readonly minAnnualizedReturnOnCapital?: number | null;
  readonly minExpectedReturnUsd?: number | null;
  readonly minExpectedReturnPerCapitalDay?: number | null;
  readonly minIvRvEdge?: number | null;
  readonly minBreakevenCushionPct?: number | null;
  readonly maxBidAskSpreadPct?: number | null;
  readonly maxEventRisk?: 'NO_EVENT_IN_WINDOW' | null;
  readonly maxStressLossUsd?: number | null;
  readonly minRewardToStressRisk?: number | null;
}

type HurdleKey = Exclude<keyof EconomicHurdlePolicy, 'policyVersion'>;
type HurdleState = 'PASS' | 'FAIL' | 'UNKNOWN_INPUT' | 'NOT_CONFIGURED';
export interface HurdleResult {
  readonly hurdle: HurdleKey;
  readonly state: HurdleState;
  readonly observed: number | string | null;
  readonly threshold: number | string | null;
  readonly reason: string | null;
}

const hurdleMetric: Record<Exclude<HurdleKey, 'maxEventRisk'>, { readonly metric: (r: StrategyEconomicsReceipt) => EconomicValue; readonly direction: 'MIN' | 'MAX' }> = {
  minNetCreditUsd: { metric: (r) => r.netCreditUsd, direction: 'MIN' },
  minMaxProfitUsd: { metric: (r) => r.maxProfitUsd, direction: 'MIN' },
  minReturnOnCapital: { metric: (r) => r.returnOnCapital, direction: 'MIN' },
  minAnnualizedReturnOnCapital: { metric: (r) => r.annualizedReturnOnCapital, direction: 'MIN' },
  minExpectedReturnUsd: { metric: (r) => r.expectedValueUsd, direction: 'MIN' },
  minExpectedReturnPerCapitalDay: { metric: (r) => r.expectedValueUsd.state === 'KNOWN' && r.capitalRequiredUsd.state === 'KNOWN' && r.dte > 0
    ? known(r.expectedValueUsd.value / r.capitalRequiredUsd.value / r.dte, 'EV_OVER_CAPITAL_OVER_DTE') : unknown('EV_MODEL_NOT_EMPIRICALLY_READY'), direction: 'MIN' },
  minIvRvEdge: { metric: (r) => r.ivMinusRealizedVol, direction: 'MIN' },
  minBreakevenCushionPct: { metric: (r) => r.distanceToBreakevenPct, direction: 'MIN' },
  maxBidAskSpreadPct: { metric: (r) => r.bidAskSpreadPct, direction: 'MAX' },
  maxStressLossUsd: { metric: (r) => r.stressLossUsd, direction: 'MAX' },
  minRewardToStressRisk: { metric: (r) => r.rewardToStressRisk, direction: 'MIN' },
};

export type EconomicVerdict = 'PASS' | 'FAIL' | 'UNDETERMINED' | 'NOT_CONFIGURED';
export interface EconomicGateEvaluation {
  readonly contractVersion: typeof strategyEconomicsContractVersion;
  readonly candidateId: string;
  readonly mode: EconomicsGateMode;
  readonly policyVersion: string | null;
  readonly verdict: EconomicVerdict;
  readonly hurdles: readonly HurdleResult[];
  /** Observation only. In SHADOW the gate never changes eligibility; ENFORCED is not certified in this release. */
  readonly effect: 'NONE_GATE_OFF' | 'OBSERVE_ONLY' | 'ENFORCEMENT_NOT_CERTIFIED';
  readonly lowCapitalEfficiency: LowCapitalEfficiencyDiagnostic;
}

export function evaluateEconomicHurdles(receipt: StrategyEconomicsReceipt, policy: EconomicHurdlePolicy | null,
  mode: EconomicsGateMode, diagnostic: LowCapitalEfficiencyReference | null = null): EconomicGateEvaluation {
  const hurdles: HurdleResult[] = [];
  for (const key of Object.keys(hurdleMetric) as (keyof typeof hurdleMetric)[]) {
    const threshold = policy?.[key] ?? null;
    if (threshold === null || threshold === undefined) { hurdles.push({ hurdle: key, state: 'NOT_CONFIGURED', observed: null, threshold: null, reason: null }); continue; }
    const { metric, direction } = hurdleMetric[key];
    const value = metric(receipt);
    if (value.state === 'UNKNOWN') { hurdles.push({ hurdle: key, state: 'UNKNOWN_INPUT', observed: null, threshold, reason: value.reason }); continue; }
    const pass = direction === 'MIN' ? value.value >= threshold : value.value <= threshold;
    hurdles.push({ hurdle: key, state: pass ? 'PASS' : 'FAIL', observed: value.value, threshold, reason: pass ? null : `${key.toUpperCase()}_NOT_MET` });
  }
  const eventThreshold = policy?.maxEventRisk ?? null;
  hurdles.push(eventThreshold === null
    ? { hurdle: 'maxEventRisk', state: 'NOT_CONFIGURED', observed: null, threshold: null, reason: null }
    : receipt.eventRisk === 'UNKNOWN' ? { hurdle: 'maxEventRisk', state: 'UNKNOWN_INPUT', observed: 'UNKNOWN', threshold: eventThreshold, reason: 'EVENT_STATE_UNKNOWN' }
      : { hurdle: 'maxEventRisk', state: receipt.eventRisk === 'EVENT_IN_WINDOW' ? 'FAIL' : 'PASS', observed: receipt.eventRisk, threshold: eventThreshold,
        reason: receipt.eventRisk === 'EVENT_IN_WINDOW' ? 'EVENT_IN_HOLDING_WINDOW' : null });
  const configured = hurdles.filter((h) => h.state !== 'NOT_CONFIGURED');
  const verdict: EconomicVerdict = configured.length === 0 ? 'NOT_CONFIGURED'
    : configured.some((h) => h.state === 'FAIL') ? 'FAIL'
      : configured.some((h) => h.state === 'UNKNOWN_INPUT') ? 'UNDETERMINED' : 'PASS';
  return {
    contractVersion: strategyEconomicsContractVersion, candidateId: receipt.candidateId, mode,
    policyVersion: policy?.policyVersion ?? null, verdict, hurdles,
    effect: mode === 'OFF' ? 'NONE_GATE_OFF' : mode === 'SHADOW' ? 'OBSERVE_ONLY' : 'ENFORCEMENT_NOT_CERTIFIED',
    lowCapitalEfficiency: diagnoseLowCapitalEfficiency(receipt, diagnostic),
  };
}

// ---------------------------------------------------------------------------
// LOW_CAPITAL_EFFICIENCY_SUSPECTED: a diagnostic, never a rejection.
// ---------------------------------------------------------------------------

export interface LowCapitalEfficiencyReference {
  readonly referenceVersion: string;
  /** Absolute profit below which a trade is "small" relative to its capital (diagnostic only). */
  readonly smallProfitUsd: number;
  /** Capital above which a small profit is suspicious (diagnostic only). */
  readonly largeCapitalUsd: number;
  /** Annualized ROC below which capital is suspected under-paid (e.g. a cash-yield reference). */
  readonly annualizedReturnFloor: number;
  /** Reward-to-worst-stress below which tail risk dominates the reward. */
  readonly rewardToStressFloor: number;
}

export interface LowCapitalEfficiencyDiagnostic {
  readonly state: 'LOW_CAPITAL_EFFICIENCY_SUSPECTED' | 'NOT_SUSPECTED' | 'UNDETERMINED';
  readonly signals: readonly string[];
  readonly referenceVersion: string | null;
  readonly authority: 'DIAGNOSTIC_ONLY_NOT_A_REJECTION';
}

export function diagnoseLowCapitalEfficiency(receipt: StrategyEconomicsReceipt, reference: LowCapitalEfficiencyReference | null): LowCapitalEfficiencyDiagnostic {
  if (reference === null) return { state: 'UNDETERMINED', signals: ['NO_DIAGNOSTIC_REFERENCE_CONFIGURED'], referenceVersion: null, authority: 'DIAGNOSTIC_ONLY_NOT_A_REJECTION' };
  const profit = valueOf(receipt.maxProfitUsd);
  const capital = valueOf(receipt.capitalRequiredUsd);
  const annualized = valueOf(receipt.annualizedReturnOnCapital);
  const rewardToStress = valueOf(receipt.rewardToStressRisk);
  const signals: string[] = [];
  const missing: string[] = [];
  if (profit === null || capital === null) missing.push('PROFIT_OR_CAPITAL_UNKNOWN');
  else if (profit < reference.smallProfitUsd && capital >= reference.largeCapitalUsd) signals.push('SMALL_PROFIT_ON_LARGE_CAPITAL');
  if (annualized === null) missing.push('ANNUALIZED_RETURN_UNKNOWN');
  else if (annualized < reference.annualizedReturnFloor) signals.push('ANNUALIZED_RETURN_BELOW_REFERENCE');
  if (rewardToStress === null) missing.push('REWARD_TO_STRESS_UNKNOWN');
  else if (rewardToStress < reference.rewardToStressFloor) signals.push('REWARD_SMALL_RELATIVE_TO_STRESS_LOSS');
  if (receipt.excessOverOpportunityCostUsd.state === 'KNOWN' && receipt.excessOverOpportunityCostUsd.value <= 0) signals.push('PROFIT_BELOW_OPPORTUNITY_COST');
  return {
    state: signals.length > 0 ? 'LOW_CAPITAL_EFFICIENCY_SUSPECTED' : missing.length > 0 ? 'UNDETERMINED' : 'NOT_SUSPECTED',
    signals: signals.length > 0 ? signals : missing, referenceVersion: reference.referenceVersion, authority: 'DIAGNOSTIC_ONLY_NOT_A_REJECTION',
  };
}

// ---------------------------------------------------------------------------
// Economic ranking among ALREADY risk-feasible candidates.
//
// RISK_CONSTRAINED_PARETO_V1 (shadow research method, not validated):
//  1. hurdle verdict (owner policy) -- constraints first;
//  2. completeness: a candidate missing REQUIRED risk evidence ranks after every
//     complete candidate (missing risk evidence can never improve rank);
//  3. calibrated EV per capital-day, when an EV model exists (none today);
//  4. Pareto rank within the strategy class over its objective vector;
//  5. class tie-break keys (risk-adjusted first), then spread;
//  6. candidate ID only when every economic key is exactly equal.
// Annualized ROC is never a ranking key (it rewards selling risk and short DTE).
// ---------------------------------------------------------------------------

export const economicRankingMethodVersion = 'risk-constrained-pareto-v1' as const;

type Objective = { readonly name: string; readonly value: (r: StrategyEconomicsReceipt) => EconomicValue; readonly direction: 'MAX' | 'MIN' };
const objectivesByClass: Record<EconomicsStrategyClass, readonly Objective[]> = {
  // Q: income per capital-day, cushion in implied moves, reward per unit of tail loss, execution friction.
  THETA_CONVENTIONAL: [
    { name: 'returnPerCapitalDay', value: (r) => r.returnPerCapitalDay, direction: 'MAX' },
    { name: 'breakevenCushionSigmas', value: (r) => r.breakevenCushionSigmas, direction: 'MAX' },
    { name: 'rewardToStressRisk', value: (r) => r.rewardToStressRisk, direction: 'MAX' },
    { name: 'bidAskSpreadPct', value: (r) => r.bidAskSpreadPct, direction: 'MIN' },
  ],
  // H: short DTE -- distance in implied moves and tail reward dominate; yield is per day, never annualized.
  THETA_HOLD_STRIKE: [
    { name: 'breakevenCushionSigmas', value: (r) => r.breakevenCushionSigmas, direction: 'MAX' },
    { name: 'rewardToStressRisk', value: (r) => r.rewardToStressRisk, direction: 'MAX' },
    { name: 'returnPerCapitalDay', value: (r) => r.returnPerCapitalDay, direction: 'MAX' },
    { name: 'bidAskSpreadPct', value: (r) => r.bidAskSpreadPct, direction: 'MIN' },
  ],
  // D: credit per unit of defined max loss, cushion, tail reward, worst-leg friction.
  THETA_DEFINED_RISK: [
    { name: 'rewardToMaxLoss', value: (r) => r.rewardToMaxLoss, direction: 'MAX' },
    { name: 'breakevenCushionSigmas', value: (r) => r.breakevenCushionSigmas, direction: 'MAX' },
    { name: 'rewardToStressRisk', value: (r) => r.rewardToStressRisk, direction: 'MAX' },
    { name: 'bidAskSpreadPct', value: (r) => r.bidAskSpreadPct, direction: 'MIN' },
  ],
};
const tieBreakByClass: Record<EconomicsStrategyClass, readonly string[]> = {
  THETA_CONVENTIONAL: ['rewardToStressRisk', 'breakevenCushionSigmas', 'returnPerCapitalDay', 'bidAskSpreadPct'],
  THETA_HOLD_STRIKE: ['breakevenCushionSigmas', 'rewardToStressRisk', 'returnPerCapitalDay', 'bidAskSpreadPct'],
  THETA_DEFINED_RISK: ['rewardToStressRisk', 'breakevenCushionSigmas', 'rewardToMaxLoss', 'bidAskSpreadPct'],
};

/** Evidence a candidate of this class must have for its rank to mean anything. */
export function requiredEconomicUnknowns(receipt: StrategyEconomicsReceipt): readonly string[] {
  const required: [string, EconomicValue][] = [
    ['capitalRequiredUsd', receipt.capitalRequiredUsd], ['maxProfitUsd', receipt.maxProfitUsd], ['maxLossUsd', receipt.maxLossUsd],
    ['breakeven', receipt.breakeven], ['assignmentProbabilityProxy', receipt.assignmentProbabilityProxy],
    ['stressLossUsd', receipt.stressLossUsd], ['impliedTwoSigmaMoveLossUsd', receipt.impliedTwoSigmaMoveLossUsd],
    ...objectivesByClass[receipt.strategyClass].map((o): [string, EconomicValue] => [o.name, o.value(receipt)]),
  ];
  const missing = new Set(required.filter(([, v]) => v.state === 'UNKNOWN'
    && !(v.reason === 'NO_STRESS_LOSS_IN_MODELED_SCENARIOS')).map(([name]) => name));
  return [...missing].sort();
}

const verdictRank: Record<EconomicVerdict, number> = { PASS: 0, NOT_CONFIGURED: 1, UNDETERMINED: 2, FAIL: 3 };
// A candidate with no modeled stress loss has unbounded reward-to-stress: rank it as +Infinity, explicitly.
const objectiveValue = (o: Objective, r: StrategyEconomicsReceipt): number | null => {
  const v = o.value(r);
  if (v.state === 'KNOWN') return o.direction === 'MAX' ? v.value : -v.value;
  return o.name === 'rewardToStressRisk' && v.reason === 'NO_STRESS_LOSS_IN_MODELED_SCENARIOS' ? Number.POSITIVE_INFINITY : null;
};

export interface EconomicRankRow {
  readonly receipt: StrategyEconomicsReceipt;
  readonly verdict: EconomicVerdict;
}
export interface RankedEconomicRow extends EconomicRankRow {
  readonly rank: number;
  readonly paretoRank: number | null;
  readonly requiredUnknowns: readonly string[];
  readonly decidedBy: string;
}

/** Orders rows of ONE strategy class. Deterministic; never consults the ID before every economic key is exactly equal. */
export function rankEconomically(rows: readonly EconomicRankRow[]): readonly RankedEconomicRow[] {
  if (rows.length === 0) return [];
  const cls = rows[0]?.receipt.strategyClass as EconomicsStrategyClass;
  if (rows.some((row) => row.receipt.strategyClass !== cls)) throw new Error('ECONOMIC_RANKING_MIXED_STRATEGY_CLASSES');
  const objectives = objectivesByClass[cls];
  const enriched = rows.map((row) => {
    const requiredUnknowns = requiredEconomicUnknowns(row.receipt);
    return { ...row, requiredUnknowns, vector: objectives.map((o) => objectiveValue(o, row.receipt)) };
  });
  const complete = enriched.filter((row) => row.requiredUnknowns.length === 0);
  const dominates = (a: readonly (number | null)[], b: readonly (number | null)[]): boolean => {
    let better = false;
    for (let i = 0; i < a.length; i++) {
      const x = a[i] as number; const y = b[i] as number;
      if (x < y) return false;
      if (x > y) better = true;
    }
    return better;
  };
  const paretoRankOf = new Map<string, number>();
  for (const row of complete) {
    paretoRankOf.set(row.receipt.candidateId, 1 + complete.filter((other) => other !== row && verdictRank[other.verdict] === verdictRank[row.verdict]
      && dominates(other.vector, row.vector)).length);
  }
  const ev = (r: StrategyEconomicsReceipt): number | null => r.expectedValueUsd.state === 'KNOWN' && r.capitalRequiredUsd.state === 'KNOWN' && r.dte > 0
    ? r.expectedValueUsd.value / r.capitalRequiredUsd.value / r.dte : null;
  const keyNames = tieBreakByClass[cls];
  const keyIndex = keyNames.map((name) => objectives.findIndex((o) => o.name === name));
  type Row = typeof enriched[number];
  const reasons = new Map<string, string>();
  const compare = (a: Row, b: Row): number => {
    const steps: [string, number][] = [
      ['HURDLE_VERDICT', verdictRank[a.verdict] - verdictRank[b.verdict]],
      ['REQUIRED_EVIDENCE_COMPLETE', (a.requiredUnknowns.length === 0 ? 0 : 1) - (b.requiredUnknowns.length === 0 ? 0 : 1)],
      ['CALIBRATED_EV_PER_CAPITAL_DAY', (() => { const x = ev(a.receipt); const y = ev(b.receipt);
        return x !== null && y !== null ? y - x : x !== null ? -1 : y !== null ? 1 : 0; })()],
      ['PARETO_RANK', (paretoRankOf.get(a.receipt.candidateId) ?? Number.MAX_SAFE_INTEGER) - (paretoRankOf.get(b.receipt.candidateId) ?? Number.MAX_SAFE_INTEGER)],
      ...keyIndex.map((index, k): [string, number] => {
        const x = a.vector[index] ?? null; const y = b.vector[index] ?? null;
        return [`TIE_BREAK_${keyNames[k] as string}`, x !== null && y !== null ? (y === x ? 0 : y > x ? 1 : -1) : x !== null ? -1 : y !== null ? 1 : 0];
      }),
      ['EXACT_ECONOMIC_TIE_CANDIDATE_ID', a.receipt.candidateId.localeCompare(b.receipt.candidateId)],
    ];
    for (const [, value] of steps) if (value !== 0) return value;
    return 0;
  };
  const ordered = enriched.toSorted(compare);
  ordered.forEach((row, index) => {
    const next = ordered[index + 1];
    if (next === undefined) return;
    // Record which key separated each row from the one below it (persisted "why #1 beat #2").
    reasons.set(row.receipt.candidateId, separatingKey(row, next));
  });
  function separatingKey(a: Row, b: Row): string {
    if (verdictRank[a.verdict] !== verdictRank[b.verdict]) return 'HURDLE_VERDICT';
    if ((a.requiredUnknowns.length === 0) !== (b.requiredUnknowns.length === 0)) return 'REQUIRED_EVIDENCE_COMPLETE';
    const x = ev(a.receipt); const y = ev(b.receipt);
    if (x !== y) return 'CALIBRATED_EV_PER_CAPITAL_DAY';
    if ((paretoRankOf.get(a.receipt.candidateId) ?? -1) !== (paretoRankOf.get(b.receipt.candidateId) ?? -1)) return 'PARETO_RANK';
    for (let k = 0; k < keyIndex.length; k++) {
      const i = keyIndex[k] as number;
      if ((a.vector[i] ?? null) !== (b.vector[i] ?? null)) return `TIE_BREAK_${keyNames[k] as string}`;
    }
    return 'EXACT_ECONOMIC_TIE_CANDIDATE_ID';
  }
  return ordered.map((row, index) => ({ receipt: row.receipt, verdict: row.verdict, rank: index + 1,
    paretoRank: paretoRankOf.get(row.receipt.candidateId) ?? null, requiredUnknowns: row.requiredUnknowns,
    decidedBy: reasons.get(row.receipt.candidateId) ?? 'LAST' }));
}

export const economicRankingBasis = [
  'HURDLE_VERDICT', 'REQUIRED_EVIDENCE_COMPLETE', 'CALIBRATED_EV_PER_CAPITAL_DAY_WHEN_AVAILABLE',
  `PARETO_RANK_${economicRankingMethodVersion}`, 'CLASS_RISK_ADJUSTED_TIE_BREAK', 'CANDIDATE_ID_ONLY_ON_EXACT_ECONOMIC_TIE',
] as const;

// ---------------------------------------------------------------------------
// Adapter: single-leg CSP candidates (Q/H) -> precomputed economic order for
// decision assembly. Executable credit is the short bid (what a sell can be
// sure of), never the ask the entry limit is posted at.
// ---------------------------------------------------------------------------

export interface CspContractEvidence {
  readonly underlying: string; readonly optionSymbol: string; readonly strike: number; readonly expiration: string;
  readonly dte: number; readonly multiplier: number; readonly bid: number | null; readonly ask: number | null;
  readonly delta: number | null; readonly iv: number | null; readonly volume: number | null; readonly openInterest: number | null;
  readonly underlyingReferencePrice: number | null;
}

export interface EconomicRankingConfig {
  readonly mode: EconomicsGateMode;
  readonly strategyClass: 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE';
  readonly policy: EconomicHurdlePolicy | null;
  readonly openingCostPerContractUsd: number | null;
  readonly stressGapPct: number;
  readonly opportunityCostAnnualRate: number | null;
  /** Shared -2 sigma scenario volatility; the ranking adapter derives it from the nearest-ATM put when absent. */
  readonly scenarioVolatility?: number | null;
  /**
   * ENFORCED additionally requires recorded evidence: historical + walk-forward validation, Paper shadow evidence and
   * owner approval. Without it ENFORCED is downgraded to SHADOW.
   */
  readonly enforcementCertification?: { readonly ownerApproved: true; readonly validationEvidenceIds: readonly string[] } | null;
}

export function cspEconomicsReceipt(candidateId: string, contract: CspContractEvidence, config: Omit<EconomicRankingConfig, 'mode' | 'policy'>): StrategyEconomicsReceipt {
  return buildStrategyEconomicsReceipt({
    candidateId, strategyClass: config.strategyClass, structure: 'CASH_SECURED_PUT', underlying: contract.underlying,
    expiration: contract.expiration, dte: contract.dte, multiplier: contract.multiplier,
    shortLeg: { optionSymbol: contract.optionSymbol, strike: contract.strike, bid: contract.bid, ask: contract.ask, delta: contract.delta,
      iv: contract.iv, volume: contract.volume, openInterest: contract.openInterest },
    spot: contract.underlyingReferencePrice, creditPerShare: contract.bid, creditBasis: 'EXECUTABLE_BID',
    openingCostsUsd: config.openingCostPerContractUsd, openingCostProvenance: 'MODELED_OPENING_COST_PER_CONTRACT',
    realizedVolatility: null, ivRank: null, eventInWindow: null, stressGapPct: config.stressGapPct,
    opportunityCostAnnualRate: config.opportunityCostAnnualRate,
    scenarioVolatility: config.scenarioVolatility ?? null, scenarioVolatilityProvenance: 'NEAREST_ATM_PUT_IV_ON_UNDERLYING',
  });
}

/** IV of the put with |delta| nearest 0.50 among the evidence (ties: nearer strike to spot, then symbol); null when none. */
export function nearestAtmPutIv(contracts: readonly CspContractEvidence[]): number | null {
  const usable = contracts.filter((c) => finite(c.delta) && finite(c.iv) && (c.iv as number) > 0);
  const best = usable.toSorted((a, b) => Math.abs(Math.abs(a.delta as number) - 0.5) - Math.abs(Math.abs(b.delta as number) - 0.5)
    || Math.abs(a.strike - (a.underlyingReferencePrice ?? a.strike)) - Math.abs(b.strike - (b.underlyingReferencePrice ?? b.strike))
    || a.optionSymbol.localeCompare(b.optionSymbol))[0];
  return best?.iv ?? null;
}

export function economicRankingForCspCandidates(
  candidates: readonly { readonly candidateId: string; readonly contract: CspContractEvidence }[],
  config: EconomicRankingConfig,
): { readonly ranking: { readonly contractVersion: string; readonly mode: EconomicsGateMode; readonly orderedCandidateIds: readonly string[]; readonly basis: readonly string[] };
  readonly evaluations: readonly EconomicGateEvaluation[]; readonly ranked: readonly RankedEconomicRow[] } {
  // Without calibrated EV, return per capital-day mostly measures how much risk is sold (the 2026-10-07 live shadow scan
  // ranked the highest-|delta| CSPs and 1-3%-OTM narrow spreads first). The order may only select when the owner has
  // configured at least one risk hurdle that bounds that; otherwise ENFORCED is downgraded to SHADOW.
  const riskBounded = config.policy !== null && [config.policy.minBreakevenCushionPct, config.policy.minRewardToStressRisk,
    config.policy.maxStressLossUsd].some((value) => value !== null && value !== undefined);
  const certified = config.enforcementCertification?.ownerApproved === true
    && config.enforcementCertification.validationEvidenceIds.length > 0;
  const mode: EconomicsGateMode = config.mode === 'ENFORCED' && !(riskBounded && certified) ? 'SHADOW' : config.mode;
  const scenarioVolatility = config.scenarioVolatility ?? nearestAtmPutIv(candidates.map((c) => c.contract));
  const rows = candidates.map(({ candidateId, contract }) => {
    const receipt = cspEconomicsReceipt(candidateId, contract, { ...config, scenarioVolatility });
    const evaluation = evaluateEconomicHurdles(receipt, config.policy, mode);
    return { receipt, verdict: evaluation.verdict, evaluation };
  });
  const evaluations = new Map(rows.map((row) => [row.receipt.candidateId, row.evaluation]));
  const ordered = rankEconomically(rows.map(({ receipt, verdict }) => ({ receipt, verdict })));
  return {
    ranking: { contractVersion: strategyEconomicsContractVersion, mode,
      orderedCandidateIds: ordered.map((row) => row.receipt.candidateId),
      basis: mode === config.mode ? economicRankingBasis : [...economicRankingBasis,
        riskBounded ? 'ENFORCEMENT_DOWNGRADED_NOT_CERTIFIED' : 'ENFORCEMENT_DOWNGRADED_NO_RISK_HURDLE_CONFIGURED'] },
    evaluations: ordered.map((row) => evaluations.get(row.receipt.candidateId) as EconomicGateEvaluation),
    ranked: ordered,
  };
}
