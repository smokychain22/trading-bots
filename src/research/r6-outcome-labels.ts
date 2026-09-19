import type { WholeChainPnlBreakdown } from '../theta/whole-chain-economics.js';
import type { ManagedEpisodePathFeatures } from '../theta/managed-episode-path-features.js';

export const r6OutcomeLabelVersion = 'theta-r6-outcome-labels-v1' as const;

/**
 * R6 label engine. Research/shadow only -- these are DATASET labels for a
 * future model, never a live decision input, and never a broker-authority
 * signal. `brokerAuthority: false` always.
 *
 * Per the standing directive: does not make simple win/loss
 * (`resolvedPositive`) the primary economic target -- it is reported last,
 * explicitly named as secondary, alongside every other label.
 *
 * Every label is independently UNKNOWN-safe: a missing input for one label
 * never blocks any other label, and no label is ever coerced from `null`
 * to a fabricated `0`/`false`. This module performs no accounting itself --
 * `wholeChainPnl`/`wholeChainAfterCostPnl` are read from the caller's own
 * `WholeChainPnlBreakdown` (whole-chain-economics.ts), and MFE/MAE from the
 * caller's own `ManagedEpisodePathFeatures` (managed-episode-path-
 * features.ts) -- never a second, competing formula.
 */
export interface R6Label<T> {
  readonly value: T | null;
  readonly unit: string;
  readonly definition: string;
  readonly state: 'KNOWN' | 'UNKNOWN' | 'NOT_APPLICABLE';
}

function known<T>(value: T, unit: string, definition: string): R6Label<T> {
  return { value, unit, definition, state: 'KNOWN' };
}
function unknown<T>(unit: string, definition: string): R6Label<T> {
  return { value: null, unit, definition, state: 'UNKNOWN' };
}
function notApplicable<T>(unit: string, definition: string): R6Label<T> {
  return { value: null, unit, definition, state: 'NOT_APPLICABLE' };
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export interface R6LegPnlInputs {
  readonly legRealizedPnl: number | null;
  readonly positionRealizedPnl: number | null;
  readonly managedEpisodePnl: number | null;
}

export function legRealizedPnlLabel(input: R6LegPnlInputs): R6Label<number> {
  return finite(input.legRealizedPnl)
    ? known(input.legRealizedPnl, 'USD', 'Realized P&L of one specific option/stock leg, before any other leg in the chain.')
    : unknown('USD', 'Realized P&L of one specific option/stock leg, before any other leg in the chain.');
}

export function positionRealizedPnlLabel(input: R6LegPnlInputs): R6Label<number> {
  return finite(input.positionRealizedPnl)
    ? known(input.positionRealizedPnl, 'USD', 'Realized P&L of the current open position (may span multiple legs of the same instrument, e.g. after a roll).')
    : unknown('USD', 'Realized P&L of the current open position (may span multiple legs of the same instrument, e.g. after a roll).');
}

export function managedEpisodePnlLabel(input: R6LegPnlInputs): R6Label<number> {
  return finite(input.managedEpisodePnl)
    ? known(input.managedEpisodePnl, 'USD', 'Realized P&L for one management episode (entry through the next terminal management transition), distinct from the full whole-chain lifecycle.')
    : unknown('USD', 'Realized P&L for one management episode (entry through the next terminal management transition), distinct from the full whole-chain lifecycle.');
}

/**
 * `wholeChainPnl`/`wholeChainAfterCostPnl` are READ from the caller's own
 * `WholeChainPnlBreakdown` (whole-chain-economics.ts) -- this function
 * never recomputes whole-chain accounting. Per that module's own
 * `cashflowBasis` field, when `cashflowBasis === 'ACTUAL_FILL_CASHFLOW'`
 * the reported `wholeChainPnl` already reflects real broker fills (fees/
 * execution cost embedded, never double-counted against
 * `tcaExecutionShortfall`, which remains a separate benchmark-only
 * diagnostic) -- so `wholeChainAfterCostPnl` is the SAME number, relabeled
 * for dataset clarity, never a second subtraction of the same cost.
 */
export function wholeChainPnlLabels(breakdown: WholeChainPnlBreakdown): {
  readonly wholeChainPnl: R6Label<number>;
  readonly wholeChainAfterCostPnl: R6Label<number>;
} {
  const wholeChainPnl = finite(breakdown.wholeChainPnl)
    ? known(breakdown.wholeChainPnl, 'USD', 'Sum of every named whole-chain economic leg (whole-chain-economics.ts); null unless every leg is known.')
    : unknown<number>('USD', 'Sum of every named whole-chain economic leg (whole-chain-economics.ts); null unless every leg is known.');
  const afterCostDefinition = 'The same whole-chain P&L figure, explicitly labeled after-cost -- never a second subtraction of a cost already embedded in an ACTUAL_FILL_CASHFLOW leg.';
  const wholeChainAfterCostPnl = breakdown.cashflowBasis === 'ACTUAL_FILL_CASHFLOW'
    ? wholeChainPnl.state === 'KNOWN' ? known(wholeChainPnl.value as number, 'USD', afterCostDefinition) : unknown<number>('USD', afterCostDefinition)
    : notApplicable<number>('USD', `${afterCostDefinition} NOT_APPLICABLE here because cashflowBasis is BENCHMARK_CASHFLOW, not an actual fill.`);
  return { wholeChainPnl, wholeChainAfterCostPnl };
}

export function unrealizedMtmLabel(unrealizedStockOrOptionMtm: number | null): R6Label<number> {
  return finite(unrealizedStockOrOptionMtm)
    ? known(unrealizedStockOrOptionMtm, 'USD', 'Mark-to-market unrealized P&L for a position still open as of the label observation time.')
    : unknown('USD', 'Mark-to-market unrealized P&L for a position still open as of the label observation time.');
}

export function capitalDaysLabel(capitalDays: number | null): R6Label<number> {
  return finite(capitalDays) && capitalDays >= 0
    ? known(capitalDays, 'DOLLAR_DAYS', 'Sum over time of capital committed multiplied by days committed (dollars x days).')
    : unknown('DOLLAR_DAYS', 'Sum over time of capital committed multiplied by days committed (dollars x days).');
}

export function returnPerCapitalDayLabel(wholeChainPnl: number | null, capitalDays: number | null): R6Label<number> {
  const definition = 'wholeChainPnl / capitalDays -- capital-time-normalized return; UNKNOWN (never a fabricated ratio) when capitalDays is 0 or either input is unknown.';
  if (!finite(wholeChainPnl) || !finite(capitalDays) || capitalDays === 0) return unknown('USD_PER_DOLLAR_DAY', definition);
  return known(wholeChainPnl / capitalDays, 'USD_PER_DOLLAR_DAY', definition);
}

/**
 * MFE/MAE are READ from the caller's own `ManagedEpisodePathFeatures`
 * (managed-episode-path-features.ts) -- this function never recomputes
 * the analytical-value path fold.
 */
export function mfeMaeLabels(features: ManagedEpisodePathFeatures): { readonly mfe: R6Label<number>; readonly mae: R6Label<number> } {
  const mfeDefinition = 'Maximum Favorable Economic Excursion in dollars (managed-episode-path-features.ts).';
  const maeDefinition = 'Maximum Adverse Economic Excursion in dollars (managed-episode-path-features.ts).';
  return {
    mfe: finite(features.maximumFavorableExcursionDollars)
      ? known(features.maximumFavorableExcursionDollars, 'USD', mfeDefinition) : unknown('USD', mfeDefinition),
    mae: finite(features.maximumAdverseExcursionDollars)
      ? known(features.maximumAdverseExcursionDollars, 'USD', maeDefinition) : unknown('USD', maeDefinition),
  };
}

export function maxDrawdownLabel(equityCurve: readonly { readonly at: string; readonly equity: number | null }[]): R6Label<number> {
  const definition = 'Worst peak-to-trough decline (dollars, non-positive) over a caller-supplied chronological equity curve; UNKNOWN if the curve is empty or any point is unknown/unordered.';
  if (equityCurve.length === 0) return unknown('USD', definition);
  const ordered = equityCurve.slice().sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const first = ordered[0];
  if (first === undefined || !finite(first.equity) || ordered.some((point) => !finite(point.equity) || !Number.isFinite(Date.parse(point.at)))) {
    return unknown('USD', definition);
  }
  let peak = first.equity as number, worst = 0;
  for (const point of ordered) {
    const equity = point.equity as number;
    peak = Math.max(peak, equity);
    worst = Math.min(worst, equity - peak);
  }
  return known(worst, 'USD', definition);
}

export function assignmentOccurredLabel(assignmentConfirmed: boolean | null): R6Label<boolean> {
  const definition = 'Whether the short option was actually assigned (broker-confirmed), never inferred from moneyness alone.';
  return assignmentConfirmed === null ? unknown('BOOLEAN', definition) : known(assignmentConfirmed, 'BOOLEAN', definition);
}

export function recoveryDurationLabel(input: { readonly assignedAt: string | null; readonly stockExitAt: string | null }): R6Label<number> {
  const definition = 'Days from broker-confirmed assignment to the stock position\'s full exit (sale or call-away); UNKNOWN while either endpoint is unresolved.';
  if (input.assignedAt === null || input.stockExitAt === null) return unknown('DAYS', definition);
  const start = Date.parse(input.assignedAt), end = Date.parse(input.stockExitAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return unknown('DAYS', definition);
  return known((end - start) / 86_400_000, 'DAYS', definition);
}

/**
 * `recoverySuccess` NEVER infers success from headline win rate alone --
 * per the standing directive, realizing a loss can be the CORRECT outcome.
 * This label reports only whether the whole-chain P&L, once fully
 * resolved, ended non-negative -- a purely descriptive fact about the
 * resolved chain, not a claim that a positive result proves the recovery
 * DECISION was correct (that judgment belongs to management-regret
 * research, not this label).
 */
export function recoverySuccessLabel(resolvedWholeChainPnl: number | null): R6Label<boolean> {
  const definition = 'Whether the fully-resolved whole-chain P&L for a recovery episode ended non-negative; UNKNOWN while the chain is still open. Descriptive only -- does not itself judge whether the recovery DECISION was correct.';
  return finite(resolvedWholeChainPnl) ? known(resolvedWholeChainPnl >= 0, 'BOOLEAN', definition) : unknown('BOOLEAN', definition);
}

export function coveredCallPremiumContributionLabel(coveredCallPremiumNet: number | null): R6Label<number> {
  const definition = 'Net covered-call premium contribution to whole-chain P&L (premiums collected minus CC close/roll costs).';
  return finite(coveredCallPremiumNet) ? known(coveredCallPremiumNet, 'USD', definition) : unknown('USD', definition);
}

export function stockPnlContributionLabel(stockPnl: number | null): R6Label<number> {
  const definition = 'Stock leg\'s own realized-or-unrealized P&L contribution to whole-chain P&L, per whole-chain-economics.ts\'s STOCK_PNL_AT_SALE_OR_CALL_AWAY/UNREALIZED_STOCK_MTM legs.';
  return finite(stockPnl) ? known(stockPnl, 'USD', definition) : unknown('USD', definition);
}

export function calledAwayOccurredLabel(calledAwayConfirmed: boolean | null): R6Label<boolean> {
  const definition = 'Whether a covered call resulted in the stock actually being called away (broker-confirmed).';
  return calledAwayConfirmed === null ? unknown('BOOLEAN', definition) : known(calledAwayConfirmed, 'BOOLEAN', definition);
}

export function executionSlippageLabel(tcaExecutionShortfall: number | null): R6Label<number> {
  const definition = 'Benchmark execution-shortfall diagnostic (whole-chain-economics.ts tcaExecutionShortfall) -- never subtracted a second time from an already-actual-fill P&L figure.';
  return finite(tcaExecutionShortfall) ? known(tcaExecutionShortfall, 'USD', definition) : unknown('USD', definition);
}

export function fillRateLabel(input: { readonly requestedQuantity: number | null; readonly filledQuantity: number | null }): R6Label<number> {
  const definition = 'filledQuantity / requestedQuantity, in [0,1]; UNKNOWN when requestedQuantity is 0 or either input is unknown.';
  if (!finite(input.requestedQuantity) || !finite(input.filledQuantity) || input.requestedQuantity === 0) return unknown('FRACTION', definition);
  return known(input.filledQuantity / input.requestedQuantity, 'FRACTION', definition);
}

export function timeToFillLabel(input: { readonly submittedAt: string | null; readonly firstFillAt: string | null }): R6Label<number> {
  const definition = 'Seconds from order submission to the first fill event; UNKNOWN while unresolved.';
  if (input.submittedAt === null || input.firstFillAt === null) return unknown('SECONDS', definition);
  const start = Date.parse(input.submittedAt), end = Date.parse(input.firstFillAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return unknown('SECONDS', definition);
  return known((end - start) / 1000, 'SECONDS', definition);
}

/**
 * Explicitly secondary and last, per the standing directive
 * ("do NOT make simple win/loss the primary economic target"). Never
 * consumed as the primary label by any promotion/calibration criterion
 * this module produces.
 */
export function resolvedPositiveLabel(resolvedWholeChainPnl: number | null): R6Label<boolean> {
  const definition = 'SECONDARY descriptive label only: whether resolved whole-chain P&L was strictly positive. Never the primary economic target -- see wholeChainAfterCostPnl/returnPerCapitalDay for that.';
  return finite(resolvedWholeChainPnl) ? known(resolvedWholeChainPnl > 0, 'BOOLEAN', definition) : unknown('BOOLEAN', definition);
}

export interface R6OutcomeLabelSet {
  readonly labelVersion: typeof r6OutcomeLabelVersion;
  readonly chainId: string;
  readonly asOf: string;
  readonly legRealizedPnl: R6Label<number>;
  readonly positionRealizedPnl: R6Label<number>;
  readonly managedEpisodePnl: R6Label<number>;
  readonly wholeChainPnl: R6Label<number>;
  readonly wholeChainAfterCostPnl: R6Label<number>;
  readonly unrealizedMtm: R6Label<number>;
  readonly capitalDays: R6Label<number>;
  readonly returnPerCapitalDay: R6Label<number>;
  readonly mfe: R6Label<number>;
  readonly mae: R6Label<number>;
  readonly maxDrawdown: R6Label<number>;
  readonly assignmentOccurred: R6Label<boolean>;
  readonly recoveryDurationDays: R6Label<number>;
  readonly recoverySuccess: R6Label<boolean>;
  readonly coveredCallPremiumContribution: R6Label<number>;
  readonly stockPnlContribution: R6Label<number>;
  readonly calledAwayOccurred: R6Label<boolean>;
  readonly executionSlippage: R6Label<number>;
  readonly fillRate: R6Label<number>;
  readonly timeToFillSeconds: R6Label<number>;
  /** SECONDARY only -- see `resolvedPositiveLabel`'s own doc comment. */
  readonly resolvedPositive: R6Label<boolean>;
  readonly brokerAuthority: false;
}

/**
 * Assembles every R6 label from already-computed, caller-supplied pieces.
 * This function performs NO accounting of its own -- it is a pure
 * composition of the individual label functions above, each of which
 * reads from an existing canonical source (whole-chain-economics.ts,
 * managed-episode-path-features.ts) or an honest caller-supplied fact.
 */
export function buildR6OutcomeLabelSet(input: {
  readonly chainId: string;
  readonly asOf: string;
  readonly legPnl: R6LegPnlInputs;
  readonly wholeChainBreakdown: WholeChainPnlBreakdown;
  readonly unrealizedMtm: number | null;
  readonly capitalDays: number | null;
  readonly pathFeatures: ManagedEpisodePathFeatures;
  readonly equityCurve: readonly { readonly at: string; readonly equity: number | null }[];
  readonly assignmentConfirmed: boolean | null;
  readonly assignedAt: string | null;
  readonly stockExitAt: string | null;
  readonly coveredCallPremiumNet: number | null;
  readonly stockPnl: number | null;
  readonly calledAwayConfirmed: boolean | null;
  readonly requestedQuantity: number | null;
  readonly filledQuantity: number | null;
  readonly submittedAt: string | null;
  readonly firstFillAt: string | null;
}): R6OutcomeLabelSet {
  const chainLabels = wholeChainPnlLabels(input.wholeChainBreakdown);
  const mfeMae = mfeMaeLabels(input.pathFeatures);
  const resolvedWholeChainPnl = input.wholeChainBreakdown.wholeChainPnl;
  return {
    labelVersion: r6OutcomeLabelVersion, chainId: input.chainId, asOf: input.asOf,
    legRealizedPnl: legRealizedPnlLabel(input.legPnl),
    positionRealizedPnl: positionRealizedPnlLabel(input.legPnl),
    managedEpisodePnl: managedEpisodePnlLabel(input.legPnl),
    wholeChainPnl: chainLabels.wholeChainPnl, wholeChainAfterCostPnl: chainLabels.wholeChainAfterCostPnl,
    unrealizedMtm: unrealizedMtmLabel(input.unrealizedMtm),
    capitalDays: capitalDaysLabel(input.capitalDays),
    returnPerCapitalDay: returnPerCapitalDayLabel(resolvedWholeChainPnl, input.capitalDays),
    mfe: mfeMae.mfe, mae: mfeMae.mae,
    maxDrawdown: maxDrawdownLabel(input.equityCurve),
    assignmentOccurred: assignmentOccurredLabel(input.assignmentConfirmed),
    recoveryDurationDays: recoveryDurationLabel({ assignedAt: input.assignedAt, stockExitAt: input.stockExitAt }),
    recoverySuccess: recoverySuccessLabel(resolvedWholeChainPnl),
    coveredCallPremiumContribution: coveredCallPremiumContributionLabel(input.coveredCallPremiumNet),
    stockPnlContribution: stockPnlContributionLabel(input.stockPnl),
    calledAwayOccurred: calledAwayOccurredLabel(input.calledAwayConfirmed),
    executionSlippage: executionSlippageLabel(input.wholeChainBreakdown.tcaExecutionShortfall),
    fillRate: fillRateLabel({ requestedQuantity: input.requestedQuantity, filledQuantity: input.filledQuantity }),
    timeToFillSeconds: timeToFillLabel({ submittedAt: input.submittedAt, firstFillAt: input.firstFillAt }),
    resolvedPositive: resolvedPositiveLabel(resolvedWholeChainPnl),
    brokerAuthority: false,
  };
}
