export const heroZeroLadderVersion = 'theta-hero-zero-precommitted-ladder-v1' as const;

export type HeroZeroLadderStyle = 'EQUAL_SIZE' | 'RISK_WEIGHTED' | 'SUPPORT_BASED';
export type HeroZeroExitStyle = 'ALL_AT_BREAKEVEN' | 'STAGED' | 'MOMENTUM_SCALE_OUT' | 'TRAILING_RUNNER';

export interface HeroZeroLadderStep {
  readonly triggerPremium: number;
  readonly quantity: number;
  readonly supportEvidenceId: string | null;
}

export interface HeroZeroScaleOutStep { readonly targetPremium: number; readonly quantity: number }

export interface HeroZeroPolicy {
  readonly version: string;
  readonly ladderStyle: HeroZeroLadderStyle;
  readonly exitStyle: HeroZeroExitStyle;
  readonly maximumDollarsAtRisk: number;
  readonly maximumQuantity: number;
  readonly ladder: readonly HeroZeroLadderStep[];
  readonly stopPremium: number;
  readonly scaleOuts: readonly HeroZeroScaleOutStep[];
  readonly trailingRunnerQuantity: number;
  readonly trailingStopPct: number | null;
  readonly perContractRoundTripCostUsd: number;
  readonly multiplier: number;
}

export interface HeroZeroObservation {
  readonly observedAt: string;
  readonly providerKnownAt: string;
  readonly bid: number;
  readonly ask: number;
}

export interface HeroZeroFill {
  readonly observedAt: string;
  readonly action: 'BUY' | 'SELL';
  readonly reason: 'INITIAL_ENTRY' | 'LADDER_ADD' | 'BREAKEVEN_EXIT' | 'SCALE_OUT' | 'TRAILING_STOP' | 'FINAL_MARK';
  readonly quantity: number;
  readonly premium: number;
}

export interface HeroZeroPathResult {
  readonly plan: 'PRECOMMITTED_LADDER' | 'NO_AVERAGE' | 'FIXED_SIZE';
  readonly state: 'COMPLETE' | 'NOT_TRIGGERED';
  readonly fills: readonly HeroZeroFill[];
  readonly maximumOpenQuantity: number;
  readonly weightedAverageEntryPremium: number | null;
  readonly grossPnlUsd: number | null;
  readonly costsUsd: number | null;
  readonly netPnlUsd: number | null;
  readonly stopped: boolean;
}

export interface HeroZeroLadderReceipt {
  readonly contractVersion: typeof heroZeroLadderVersion;
  readonly policyVersion: string;
  readonly authority: 'RESEARCH_ONLY';
  readonly executionAuthorized: false;
  readonly state: 'COMPLETE' | 'INVALID' | 'PIT_UNSAFE' | 'BLOCKED_MISSING_POLICY' | 'INFEASIBLE_PRECOMMITTED_RISK';
  readonly reasons: readonly string[];
  readonly plannedLadder: readonly HeroZeroLadderStep[];
  readonly maximumTotalQuantity: number;
  readonly maximumPrecommittedLossUsd: number | null;
  readonly stopPremium: number;
  readonly scaleOuts: readonly HeroZeroScaleOutStep[];
  readonly runnerQuantity: number;
  readonly primary: HeroZeroPathResult | null;
  readonly counterfactualNoAverage: HeroZeroPathResult | null;
  readonly counterfactualFixedSize: HeroZeroPathResult | null;
  readonly profitabilityStatus: 'EMPIRICALLY_UNPROVEN';
}

const finite = (value: number): boolean => Number.isFinite(value);
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

function validate(input: { readonly observations: readonly HeroZeroObservation[]; readonly policy: HeroZeroPolicy }): {
  readonly state: HeroZeroLadderReceipt['state']; readonly reasons: readonly string[]; readonly maximumLoss: number | null;
} {
  const { policy, observations } = input;
  const missing: string[] = [];
  if (!policy.version.trim()) missing.push('MISSING_POLICY:VERSION');
  if (policy.ladder.length === 0) missing.push('MISSING_POLICY:LADDER');
  if ((policy.exitStyle === 'STAGED' || policy.exitStyle === 'MOMENTUM_SCALE_OUT') && policy.scaleOuts.length === 0) {
    missing.push('MISSING_POLICY:SCALE_OUTS');
  }
  if (policy.exitStyle === 'TRAILING_RUNNER'
    && (policy.trailingStopPct === null || !finite(policy.trailingStopPct) || policy.trailingStopPct <= 0 || policy.trailingStopPct >= 1)) {
    missing.push('MISSING_POLICY:TRAILING_STOP_PCT');
  }
  if (missing.length > 0) return { state: 'BLOCKED_MISSING_POLICY', reasons: missing.sort(), maximumLoss: null };

  const invalid: string[] = [];
  if (!Number.isInteger(policy.maximumQuantity) || policy.maximumQuantity <= 0
    || !finite(policy.maximumDollarsAtRisk) || policy.maximumDollarsAtRisk <= 0
    || !finite(policy.stopPremium) || policy.stopPremium < 0
    || !finite(policy.perContractRoundTripCostUsd) || policy.perContractRoundTripCostUsd < 0
    || !Number.isInteger(policy.multiplier) || policy.multiplier <= 0) invalid.push('INVALID_POLICY_LIMIT');
  const totalQuantity = policy.ladder.reduce((sum, step) => sum + step.quantity, 0);
  if (totalQuantity > policy.maximumQuantity) invalid.push('PLANNED_QUANTITY_EXCEEDS_MAXIMUM');
  if (policy.ladder.some((step, index) => !Number.isInteger(step.quantity) || step.quantity <= 0
    || !finite(step.triggerPremium) || step.triggerPremium <= 0
    || (index > 0 && step.triggerPremium >= (policy.ladder[index - 1] as HeroZeroLadderStep).triggerPremium))) {
    invalid.push('INVALID_OR_NON_DESCENDING_LADDER');
  }
  if (policy.ladderStyle === 'SUPPORT_BASED' && policy.ladder.some((step) => !step.supportEvidenceId?.trim())) {
    invalid.push('SUPPORT_BASED_LADDER_MISSING_EVIDENCE');
  }
  const scaleOutQuantity = policy.scaleOuts.reduce((sum, step) => sum + step.quantity, 0) + policy.trailingRunnerQuantity;
  if (policy.scaleOuts.some((step) => !Number.isInteger(step.quantity) || step.quantity <= 0
    || !finite(step.targetPremium) || step.targetPremium <= 0)
    || !Number.isInteger(policy.trailingRunnerQuantity) || policy.trailingRunnerQuantity < 0
    || scaleOutQuantity > totalQuantity) invalid.push('INVALID_EXIT_QUANTITY');
  if (observations.length === 0) invalid.push('NO_PATH_OBSERVATIONS');
  const pit: string[] = [];
  observations.forEach((row, index) => {
    const observed = Date.parse(row.observedAt); const known = Date.parse(row.providerKnownAt);
    if (!finite(observed) || !finite(known)) invalid.push('INVALID_TIMESTAMP');
    if (finite(observed) && finite(known) && known > observed) pit.push('PROVIDER_EVIDENCE_KNOWN_AFTER_OBSERVATION');
    if (index > 0 && row.observedAt <= (observations[index - 1] as HeroZeroObservation).observedAt) pit.push('OBSERVATIONS_NOT_STRICTLY_CHRONOLOGICAL');
    if (![row.bid, row.ask].every(finite) || row.bid < 0 || row.ask <= 0 || row.bid > row.ask) invalid.push('INVALID_EXECUTABLE_QUOTE');
  });
  if (pit.length > 0) return { state: 'PIT_UNSAFE', reasons: [...new Set(pit)].sort(), maximumLoss: null };
  if (invalid.length > 0) return { state: 'INVALID', reasons: [...new Set(invalid)].sort(), maximumLoss: null };
  const entryCost = policy.ladder.reduce((sum, step) => sum + step.triggerPremium * step.quantity * policy.multiplier, 0);
  const stopValue = policy.stopPremium * totalQuantity * policy.multiplier;
  const maximumLoss = money(Math.max(0, entryCost - stopValue) + totalQuantity * policy.perContractRoundTripCostUsd);
  return maximumLoss > policy.maximumDollarsAtRisk
    ? { state: 'INFEASIBLE_PRECOMMITTED_RISK', reasons: ['MAXIMUM_PRECOMMITTED_LOSS_EXCEEDS_STRATEGY_BUDGET'], maximumLoss }
    : { state: 'COMPLETE', reasons: [], maximumLoss };
}

function simulatePath(observations: readonly HeroZeroObservation[], policy: HeroZeroPolicy,
  plan: HeroZeroPathResult['plan'], ladder: readonly HeroZeroLadderStep[]): HeroZeroPathResult {
  const fills: HeroZeroFill[] = [];
  let nextStep = 0; let openQuantity = 0; let entryCash = 0; let exitCash = 0; let maximumOpenQuantity = 0;
  let highestBid = 0; let stopped = false; let nextScaleOut = 0;
  for (const row of observations) {
    while (nextStep < ladder.length && row.ask <= (ladder[nextStep] as HeroZeroLadderStep).triggerPremium) {
      const step = ladder[nextStep] as HeroZeroLadderStep;
      fills.push({ observedAt: row.observedAt, action: 'BUY', reason: nextStep === 0 ? 'INITIAL_ENTRY' : 'LADDER_ADD',
        quantity: step.quantity, premium: row.ask });
      entryCash += row.ask * step.quantity * policy.multiplier; openQuantity += step.quantity;
      maximumOpenQuantity = Math.max(maximumOpenQuantity, openQuantity); nextStep += 1;
      if (plan === 'NO_AVERAGE') break;
    }
    if (openQuantity === 0) continue;
    highestBid = Math.max(highestBid, row.bid);
    if (row.bid <= policy.stopPremium) {
      fills.push({ observedAt: row.observedAt, action: 'SELL', reason: 'TRAILING_STOP', quantity: openQuantity, premium: row.bid });
      exitCash += row.bid * openQuantity * policy.multiplier; openQuantity = 0; stopped = true; break;
    }
    const average = entryCash / Math.max(1, fills.filter((fill) => fill.action === 'BUY')
      .reduce((sum, fill) => sum + fill.quantity, 0)) / policy.multiplier;
    if (policy.exitStyle === 'ALL_AT_BREAKEVEN' && row.bid >= average) {
      fills.push({ observedAt: row.observedAt, action: 'SELL', reason: 'BREAKEVEN_EXIT', quantity: openQuantity, premium: row.bid });
      exitCash += row.bid * openQuantity * policy.multiplier; openQuantity = 0; break;
    }
    while (nextScaleOut < policy.scaleOuts.length && openQuantity > 0
      && row.bid >= (policy.scaleOuts[nextScaleOut] as HeroZeroScaleOutStep).targetPremium) {
      const target = policy.scaleOuts[nextScaleOut] as HeroZeroScaleOutStep;
      const quantity = Math.min(openQuantity, target.quantity);
      fills.push({ observedAt: row.observedAt, action: 'SELL', reason: 'SCALE_OUT', quantity, premium: row.bid });
      exitCash += row.bid * quantity * policy.multiplier; openQuantity -= quantity; nextScaleOut += 1;
    }
    if (openQuantity > 0 && policy.trailingStopPct !== null && highestBid > 0
      && row.bid <= highestBid * (1 - policy.trailingStopPct)) {
      fills.push({ observedAt: row.observedAt, action: 'SELL', reason: 'TRAILING_STOP', quantity: openQuantity, premium: row.bid });
      exitCash += row.bid * openQuantity * policy.multiplier; openQuantity = 0; stopped = true; break;
    }
  }
  const bought = fills.filter((fill) => fill.action === 'BUY').reduce((sum, fill) => sum + fill.quantity, 0);
  if (bought === 0) return { plan, state: 'NOT_TRIGGERED', fills, maximumOpenQuantity: 0,
    weightedAverageEntryPremium: null, grossPnlUsd: null, costsUsd: null, netPnlUsd: null, stopped: false };
  if (openQuantity > 0) {
    const last = observations.at(-1) as HeroZeroObservation;
    fills.push({ observedAt: last.observedAt, action: 'SELL', reason: 'FINAL_MARK', quantity: openQuantity, premium: last.bid });
    exitCash += last.bid * openQuantity * policy.multiplier;
  }
  const costs = bought * policy.perContractRoundTripCostUsd;
  const gross = exitCash - entryCash;
  return { plan, state: 'COMPLETE', fills, maximumOpenQuantity,
    weightedAverageEntryPremium: money(entryCash / bought / policy.multiplier), grossPnlUsd: money(gross),
    costsUsd: money(costs), netPnlUsd: money(gross - costs), stopped };
}

export function simulateHeroZeroLadder(input: {
  readonly observations: readonly HeroZeroObservation[]; readonly policy: HeroZeroPolicy;
}): HeroZeroLadderReceipt {
  const validation = validate(input);
  const base = { contractVersion: heroZeroLadderVersion, policyVersion: input.policy.version,
    authority: 'RESEARCH_ONLY' as const, executionAuthorized: false as const, state: validation.state,
    reasons: validation.reasons, plannedLadder: input.policy.ladder, maximumTotalQuantity: input.policy.maximumQuantity,
    maximumPrecommittedLossUsd: validation.maximumLoss, stopPremium: input.policy.stopPremium,
    scaleOuts: input.policy.scaleOuts, runnerQuantity: input.policy.trailingRunnerQuantity,
    profitabilityStatus: 'EMPIRICALLY_UNPROVEN' as const };
  if (validation.state !== 'COMPLETE') return { ...base, primary: null, counterfactualNoAverage: null,
    counterfactualFixedSize: null };
  const first = input.policy.ladder[0] as HeroZeroLadderStep;
  const fixedQuantity = input.policy.ladder.reduce((sum, step) => sum + step.quantity, 0);
  return { ...base,
    primary: simulatePath(input.observations, input.policy, 'PRECOMMITTED_LADDER', input.policy.ladder),
    counterfactualNoAverage: simulatePath(input.observations, input.policy, 'NO_AVERAGE', [first]),
    counterfactualFixedSize: simulatePath(input.observations, input.policy, 'FIXED_SIZE',
      [{ ...first, quantity: fixedQuantity }]),
  };
}
