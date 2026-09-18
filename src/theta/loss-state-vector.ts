import type { ManagementInputState } from './management-input-state.js';

export const lossStateVectorVersion = 'theta-loss-state-vector-v1' as const;

/**
 * A forward-looking LOSS STATE vector for a single open leg/position. This
 * is deliberately NOT a scoring model and produces NO probability, EV, or
 * "close/hold" verdict of its own -- it is a structured, honestly-UNKNOWN-
 * safe collection of the facts a management policy or human reviewer needs
 * to reason about a losing (or previously-losing) position, replacing the
 * single "loss magnitude" reason code with the full requested state.
 *
 * Every field is either:
 *   (a) computed from ManagementInputState's CURRENT snapshot (always safe,
 *       no entry-time data required), or
 *   (b) computed only when the caller supplies `LossStateEntrySnapshot`
 *       (values recorded AT ENTRY, which ManagementInputState itself does
 *       not retain -- see `dataCompleteness` below), or
 *   (c) explicitly `null` (UNKNOWN) because the underlying data source
 *       (Optionomics skew/term/GEX/flow feeds, liquidity/OI, entry-time
 *       Greeks/IV) is not yet plumbed into ManagementInputState at all.
 *
 * `assignment_probability` is PERMANENTLY excluded from this vector's
 * outputs -- delta is not probability of assignment/profit, and this
 * module will never compute or accept a substitute for it.
 */
export interface LossStateEntrySnapshot {
  readonly observedAt: string;
  readonly spotAtEntry: number | null;
  readonly ivAtEntry: number | null;
  readonly deltaAtEntry: number | null;
  readonly gammaAtEntry: number | null;
  readonly thetaAtEntry: number | null;
  readonly vegaAtEntry: number | null;
}

export interface LossStateVector {
  readonly contractVersion: typeof lossStateVectorVersion;
  readonly asOf: string;
  // -- price / structure --
  readonly underlyingDrawdownFraction: number | null;
  readonly distanceToStrikeFraction: number | null;
  readonly distanceToBreakevenFraction: number | null;
  readonly expectedMoveDollars: number | null;
  // -- volatility --
  readonly ivCurrent: number | null;
  readonly ivAtEntry: number | null;
  readonly ivChange: number | null;
  // -- greeks (current snapshot only; "at entry" requires entrySnapshot) --
  readonly delta: number | null;
  readonly gamma: number | null;
  readonly theta: number | null;
  readonly vega: number | null;
  readonly deltaAtEntry: number | null;
  // -- time / capital --
  readonly dte: number | null;
  readonly capitalLockedDollars: number | null;
  readonly capitalDaysSoFar: number | null;
  // -- liquidity / execution --
  readonly quoteSpreadDollarsPerContract: number | null;
  // -- context passthrough (opaque; never interpreted here) --
  readonly eventStatePresent: boolean;
  readonly dividendExDateStatePresent: boolean;
  readonly ownershipQualityPresent: boolean;
  readonly assignmentCapacityKnown: boolean;
  readonly concentrationPresent: boolean;
  readonly sectorCorrelationPresent: boolean;
  readonly aegisState: string | null;
  /** Fields this vector cannot honestly populate yet, and why -- named
   * explicitly rather than silently returning null with no explanation. */
  readonly dataCompleteness: {
    readonly missingUpstreamFields: readonly string[];
    readonly requiresEntrySnapshot: readonly string[];
  };
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function daysBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso), to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, (to - from) / 86_400_000);
}

function capitalLocked(state: ManagementInputState): number | null {
  const { strike, multiplier, contracts } = state.contract;
  if (state.lifecycleState === 'CSP_OPEN' || state.lifecycleState === 'CC_OPEN') {
    if (!finite(strike) || !finite(multiplier) || !finite(contracts)) return null;
    return strike * multiplier * contracts;
  }
  if (state.economics.stockBasisPerShare !== null && state.economics.openStockShares > 0) {
    return state.economics.stockBasisPerShare * state.economics.openStockShares;
  }
  return null;
}

const UPSTREAM_FIELDS_NOT_YET_PLUMBED = [
  'skew_change', 'term_change', 'volatility_surface', 'gex_regime', 'gamma_flip', 'walls',
  'vanna', 'charm', 'flow', 'unusual_options_activity', 'dark_pool', 'earnings_proximity',
  'liquidity_open_interest_volume', 'roll_quality', 'recovery_candidate_quality', 'redeployment_utility',
  'support_break_or_recovery', 'ownership_score_interpreted',
] as const;

/**
 * Builds the loss state vector. Never throws on missing data -- every
 * field degrades to `null` (or `false`/an empty array for booleans/lists)
 * rather than fabricating a value. Never computes or exposes assignment
 * probability.
 */
export function buildLossStateVector(
  state: ManagementInputState, entrySnapshot: LossStateEntrySnapshot | null = null,
): LossStateVector {
  const { spot, iv, delta, gamma, theta, vega, dte, optionBid, optionAsk } = state.market;
  const { strike, optionType, multiplier, contracts } = state.contract;
  const { entryCreditDebit, stockBasisPerShare, stockMarkPerShare } = state.economics;

  const underlyingDrawdownFraction = entrySnapshot?.spotAtEntry !== null && entrySnapshot?.spotAtEntry !== undefined
    && finite(entrySnapshot.spotAtEntry) && finite(spot)
    ? (spot - entrySnapshot.spotAtEntry) / entrySnapshot.spotAtEntry
    : finite(stockMarkPerShare) && finite(stockBasisPerShare) && stockBasisPerShare !== 0
      ? (stockMarkPerShare - stockBasisPerShare) / stockBasisPerShare : null;

  const distanceToStrikeFraction = finite(spot) && finite(strike) && strike !== 0 ? (spot - strike) / strike : null;

  const breakevenPerShare = finite(entryCreditDebit) && finite(strike) && finite(multiplier) && finite(contracts)
    && multiplier > 0 && contracts > 0 && optionType !== null
    ? (optionType === 'PUT' ? strike - entryCreditDebit / (multiplier * contracts)
      : strike + entryCreditDebit / (multiplier * contracts))
    : null;
  const distanceToBreakevenFraction = finite(spot) && breakevenPerShare !== null && breakevenPerShare !== 0
    ? (spot - breakevenPerShare) / breakevenPerShare : null;

  const expectedMoveDollars = finite(iv) && finite(spot) && finite(dte) && dte >= 0
    ? spot * iv * Math.sqrt(dte / 365) : null;

  const ivAtEntry = entrySnapshot?.ivAtEntry ?? null;
  const ivChange = finite(iv) && finite(ivAtEntry) ? iv - ivAtEntry : null;

  const spreadDollars = finite(optionBid) && finite(optionAsk) && finite(multiplier)
    ? (optionAsk - optionBid) * multiplier : null;

  const capitalDaysSoFar = entrySnapshot !== null ? daysBetween(entrySnapshot.observedAt, state.observedAt) : null;

  const missingUpstreamFields = [...UPSTREAM_FIELDS_NOT_YET_PLUMBED];
  const requiresEntrySnapshot: string[] = [];
  if (entrySnapshot === null) {
    requiresEntrySnapshot.push('ivAtEntry', 'deltaAtEntry', 'capitalDaysSoFar', 'underlyingDrawdownFraction (option positions)');
  }

  return {
    contractVersion: lossStateVectorVersion, asOf: state.observedAt,
    underlyingDrawdownFraction, distanceToStrikeFraction, distanceToBreakevenFraction, expectedMoveDollars,
    ivCurrent: iv, ivAtEntry, ivChange,
    delta, gamma, theta, vega, deltaAtEntry: entrySnapshot?.deltaAtEntry ?? null,
    dte, capitalLockedDollars: capitalLocked(state), capitalDaysSoFar,
    quoteSpreadDollarsPerContract: spreadDollars,
    eventStatePresent: state.context.eventState !== null,
    dividendExDateStatePresent: state.context.dividendExDateState !== null,
    ownershipQualityPresent: state.context.ownershipQuality !== null,
    assignmentCapacityKnown: state.context.assignmentCapacity !== null,
    concentrationPresent: state.context.concentration !== null,
    sectorCorrelationPresent: state.context.sectorCorrelation !== null,
    aegisState: typeof state.context.aegisState === 'string' ? state.context.aegisState : null,
    dataCompleteness: { missingUpstreamFields, requiresEntrySnapshot },
  };
}
