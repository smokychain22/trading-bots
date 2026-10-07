// AdjustmentProposal and ProfitLockProposal builders (research/shadow only).
//
// An adjustment is a NEW decision: close some legs at a stated exit price (their realized
// P&L is immutable from that moment) and open new legs at stated entry prices. A roll is
// close-old + open-new, never one magical action. The proposal compares the lifetime
// payoff of HOLD (current legs) against ADJUST (realized cash + remaining + new legs) and
// only says IMPROVES when the stated objective improves under stated evidence and no
// constraint is violated. Whether the position is currently losing is not an input.
// Expected value stays UNKNOWN: there is no calibrated model.

import { expiryProfile, pnlAtHorizon, positionGreeks, type Bound, type PayoffLeg, type PositionGreeks } from './option-payoff.js';

export const adjustmentPlannerVersion = 'theta-adjustment-planner-v1' as const;

export type AdjustmentVariant =
  | 'DELTA_HEDGE' | 'ROLL_WINNING_SIDE' | 'ADD_CALL_WING' | 'ADD_PUT_WING' | 'SHORT_STRANGLE_TO_IRON_CONDOR'
  | 'SHORT_PREMIUM_TO_CREDIT_SPREAD' | 'CONVERT_TO_BUTTERFLY' | 'CALENDAR_HEDGE' | 'PROTECTIVE_PUT_PROFIT_LOCK';

export type AdjustmentObjective =
  | { readonly kind: 'REDUCE_MAX_LOSS' }
  | { readonly kind: 'RAISE_MIN_PAYOFF' }
  | { readonly kind: 'REDUCE_ABS_DELTA' }
  /** Mean horizon P&L over an evidence range of spots (e.g. the expected move), equally weighted. Not EV. */
  | { readonly kind: 'IMPROVE_RANGE_PNL'; readonly low: number; readonly high: number; readonly evidence: string };

export interface ClosedLeg { readonly legId: string; readonly exitPrice: number }

export interface StructureSummary {
  readonly legs: readonly PayoffLeg[];
  readonly realizedPnl: number;
  readonly maxProfit: Bound;
  readonly maxLoss: Bound;
  readonly minExpiryPnl: number | '-UNBOUNDED';
  readonly breakevens: readonly number[];
  readonly greeks: PositionGreeks | { readonly state: 'UNKNOWN'; readonly reasons: readonly string[] };
  readonly uncoveredShortCalls: number;
}

export interface AdjustmentProposal {
  readonly plannerVersion: typeof adjustmentPlannerVersion;
  readonly variant: AdjustmentVariant;
  readonly before: StructureSummary;
  readonly after: StructureSummary;
  readonly closed: readonly { readonly legId: string; readonly exitPrice: number; readonly realizedPnl: number }[];
  readonly opened: readonly PayoffLeg[];
  /** Net cash of the adjustment itself (closing + opening), USD; positive = credit. */
  readonly adjustmentCashflow: number;
  /** Increase in max loss (capital at risk proxy); 'UNBOUNDED' if the adjustment creates unbounded loss. */
  readonly additionalCapital: number | 'UNBOUNDED' | 'REDUCED_FROM_UNBOUNDED';
  readonly legDirectionViolations: readonly string[];
  readonly objective: AdjustmentObjective;
  readonly objectiveBefore: number | null;
  readonly objectiveAfter: number | null;
  readonly verdict: 'IMPROVES_UNDER_STATED_EVIDENCE' | 'DOES_NOT_IMPROVE' | 'INVALID' | 'UNDETERMINED';
  readonly reasons: readonly string[];
  readonly expectedValueChange: { readonly state: 'UNKNOWN'; readonly reason: 'EV_MODEL_NOT_EMPIRICALLY_READY' };
}

const s = (side: PayoffLeg['side']) => side === 'LONG' ? 1 : -1;

/** Short calls not covered by long calls (same or later expiry, any strike) or long stock (per contract unit). */
function uncoveredShortCalls(legs: readonly PayoffLeg[]): number {
  const shortCallShares = legs.filter((l) => l.kind === 'CALL' && l.side === 'SHORT').reduce((n, l) => n + l.quantity * l.multiplier, 0);
  const cover = legs.filter((l) => (l.kind === 'CALL' || l.kind === 'STOCK') && l.side === 'LONG').reduce((n, l) => n + l.quantity * l.multiplier, 0);
  return Math.max(0, shortCallShares - cover);
}

function summarize(legs: readonly PayoffLeg[], realizedPnl: number, spot: number): StructureSummary {
  if (legs.length === 0) return { legs, realizedPnl, maxProfit: Math.max(0, realizedPnl), maxLoss: Math.max(0, -realizedPnl),
    minExpiryPnl: realizedPnl, breakevens: [], greeks: { state: 'KNOWN', value: 0, delta: 0, gamma: 0, thetaPerDay: 0, vegaPerPoint: 0, rhoPerPoint: 0, pnl: 0 },
    uncoveredShortCalls: 0 };
  const p = expiryProfile(legs, { spot });
  const min = p.minPnl === '-UNBOUNDED' ? p.minPnl : p.minPnl + realizedPnl;
  return { legs, realizedPnl, maxProfit: p.maxPnl === 'UNBOUNDED' ? 'UNBOUNDED' : Math.max(0, p.maxPnl + realizedPnl),
    maxLoss: min === '-UNBOUNDED' ? 'UNBOUNDED' : Math.max(0, -min), minExpiryPnl: min,
    breakevens: realizedPnl === 0 ? p.breakevens : breakevensWith(legs, realizedPnl, spot),
    greeks: positionGreeks(legs, { spot }), uncoveredShortCalls: uncoveredShortCalls(legs) };
}

function breakevensWith(legs: readonly PayoffLeg[], realized: number, spot: number): number[] {
  const p = expiryProfile(legs, { spot });
  const out: number[] = [];
  for (let i = 1; i < p.grid.length; i++) {
    const a = p.grid[i - 1] as { spot: number; pnl: number }; const b = p.grid[i] as { spot: number; pnl: number };
    const fa = a.pnl + realized; const fb = b.pnl + realized;
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) out.push(Number((a.spot + (b.spot - a.spot) * (-fa) / (fb - fa)).toFixed(6)));
  }
  return out;
}

function objectiveValue(o: AdjustmentObjective, x: StructureSummary): number | null {
  if (o.kind === 'REDUCE_MAX_LOSS') return x.maxLoss === 'UNBOUNDED' ? Infinity : x.maxLoss;
  if (o.kind === 'RAISE_MIN_PAYOFF') return x.minExpiryPnl === '-UNBOUNDED' ? -Infinity : x.minExpiryPnl;
  if (o.kind === 'REDUCE_ABS_DELTA') return x.greeks.state === 'KNOWN' ? Math.abs(x.greeks.delta) : null;
  if (!(o.low > 0 && o.high > o.low)) return null;
  let sum = 0; const n = 50;
  for (let i = 0; i <= n; i++) sum += (x.legs.length === 0 ? 0 : pnlAtHorizon(x.legs, o.low + (o.high - o.low) * i / n)) + x.realizedPnl;
  return sum / (n + 1);
}
const better = (o: AdjustmentObjective, before: number, after: number): boolean =>
  o.kind === 'REDUCE_MAX_LOSS' || o.kind === 'REDUCE_ABS_DELTA' ? after < before - 1e-9 : after > before + 1e-9;

export interface AdjustmentInput {
  readonly variant: AdjustmentVariant;
  readonly current: readonly PayoffLeg[];
  readonly close: readonly ClosedLeg[];
  readonly open: readonly PayoffLeg[];
  readonly spot: number;
  readonly objective: AdjustmentObjective;
  /** Constraint: max acceptable increase in max loss (USD). Default 0: the adjustment may not add risk. */
  readonly maxAdditionalCapital?: number;
}

export function buildAdjustmentProposal(input: AdjustmentInput): AdjustmentProposal {
  const byId = new Map(input.current.map((leg) => [leg.id, leg]));
  const violations: string[] = [];
  const closed = input.close.map((c) => {
    const leg = byId.get(c.legId);
    if (leg === undefined) { violations.push(`CLOSE_UNKNOWN_LEG:${c.legId}`); return { legId: c.legId, exitPrice: c.exitPrice, realizedPnl: 0 }; }
    return { legId: c.legId, exitPrice: c.exitPrice, realizedPnl: s(leg.side) * (c.exitPrice - leg.entryPrice) * leg.quantity * leg.multiplier };
  });
  const closedIds = new Set(input.close.map((c) => c.legId));
  const remaining = input.current.filter((leg) => !closedIds.has(leg.id));
  violations.push(...variantDirectionChecks(input.variant, input.current, input.close.map((c) => byId.get(c.legId)).filter((l): l is PayoffLeg => l !== undefined), input.open));
  const realized = closed.reduce((sum, c) => sum + c.realizedPnl, 0);
  const before = summarize(input.current, 0, input.spot);
  const afterLegs = [...remaining, ...input.open];
  const after = summarize(afterLegs, realized, input.spot);
  const adjustmentCashflow = closed.reduce((sum, c) => { const leg = byId.get(c.legId); return leg === undefined ? sum : sum + s(leg.side) * c.exitPrice * leg.quantity * leg.multiplier; }, 0)
    - input.open.reduce((sum, leg) => sum + s(leg.side) * leg.entryPrice * leg.quantity * leg.multiplier, 0);
  const additionalCapital = after.maxLoss === 'UNBOUNDED' ? (before.maxLoss === 'UNBOUNDED' ? 0 : 'UNBOUNDED')
    : before.maxLoss === 'UNBOUNDED' ? 'REDUCED_FROM_UNBOUNDED' as const : after.maxLoss - before.maxLoss;
  if (after.uncoveredShortCalls > before.uncoveredShortCalls) violations.push('ADJUSTMENT_CREATES_NAKED_SHORT_CALL');
  const ob = objectiveValue(input.objective, before); const oa = objectiveValue(input.objective, after);
  const reasons: string[] = [];
  let verdict: AdjustmentProposal['verdict'];
  if (violations.length > 0) { verdict = 'INVALID'; reasons.push(...violations); }
  else if (ob === null || oa === null) { verdict = 'UNDETERMINED'; reasons.push('OBJECTIVE_INPUT_UNKNOWN'); }
  else {
    const capitalOk = additionalCapital === 'REDUCED_FROM_UNBOUNDED'
      || (additionalCapital !== 'UNBOUNDED' && additionalCapital <= (input.maxAdditionalCapital ?? 0) + 1e-9);
    if (!capitalOk) reasons.push('ADDITIONAL_CAPITAL_EXCEEDS_LIMIT');
    if (!better(input.objective, ob, oa)) reasons.push('OBJECTIVE_NOT_IMPROVED');
    verdict = reasons.length === 0 ? 'IMPROVES_UNDER_STATED_EVIDENCE' : 'DOES_NOT_IMPROVE';
    if (verdict === 'IMPROVES_UNDER_STATED_EVIDENCE') reasons.push(`${input.objective.kind}:${ob}->${oa}`);
  }
  return { plannerVersion: adjustmentPlannerVersion, variant: input.variant, before, after, closed, opened: input.open,
    adjustmentCashflow: Number(adjustmentCashflow.toFixed(6)), additionalCapital,
    legDirectionViolations: violations, objective: input.objective, objectiveBefore: ob, objectiveAfter: oa, verdict, reasons,
    expectedValueChange: { state: 'UNKNOWN', reason: 'EV_MODEL_NOT_EMPIRICALLY_READY' } };
}

/** Structural checks per variant: wrong leg direction is INVALID, never "an adjustment". */
function variantDirectionChecks(variant: AdjustmentVariant, current: readonly PayoffLeg[], closing: readonly PayoffLeg[], open: readonly PayoffLeg[]): string[] {
  const v: string[] = [];
  const shorts = (kind: 'CALL' | 'PUT') => current.filter((l) => l.kind === kind && l.side === 'SHORT');
  const wingOk = (kind: 'CALL' | 'PUT') => open.some((l) => l.kind === kind && l.side === 'LONG'
    && shorts(kind).some((sh) => kind === 'CALL' ? (l.strike as number) > (sh.strike as number) : (l.strike as number) < (sh.strike as number)));
  switch (variant) {
    case 'DELTA_HEDGE':
      if (closing.length > 0 || open.length !== 1 || open[0]?.kind !== 'STOCK') v.push('DELTA_HEDGE_IS_ONE_STOCK_LEG');
      break;
    case 'ADD_CALL_WING': if (closing.length > 0 || open.some((l) => l.side !== 'LONG') || !wingOk('CALL')) v.push('CALL_WING_MUST_BE_LONG_CALL_ABOVE_A_SHORT_CALL'); break;
    case 'ADD_PUT_WING': if (closing.length > 0 || open.some((l) => l.side !== 'LONG') || !wingOk('PUT')) v.push('PUT_WING_MUST_BE_LONG_PUT_BELOW_A_SHORT_PUT'); break;
    case 'SHORT_STRANGLE_TO_IRON_CONDOR':
      if (shorts('CALL').length === 0 || shorts('PUT').length === 0) v.push('REQUIRES_SHORT_STRANGLE');
      if (closing.length > 0 || open.some((l) => l.side !== 'LONG') || !wingOk('CALL') || !wingOk('PUT')) v.push('CONDOR_WINGS_MUST_BE_LONG_OUTSIDE_BOTH_SHORTS');
      break;
    case 'SHORT_PREMIUM_TO_CREDIT_SPREAD':
      if (closing.length > 0 || open.length !== 1 || open[0]?.side !== 'LONG' || !(wingOk('CALL') || wingOk('PUT'))) v.push('CREDIT_SPREAD_WING_MUST_BE_ONE_LONG_OPTION_FURTHER_OTM');
      break;
    case 'ROLL_WINNING_SIDE': {
      const c = closing[0]; const o = open[0];
      if (closing.length !== 1 || open.length !== 1 || c === undefined || o === undefined || c.side !== 'SHORT' || o.side !== 'SHORT' || c.kind !== o.kind || o.quantity > c.quantity)
        v.push('ROLL_IS_CLOSE_ONE_SHORT_AND_OPEN_SAME_TYPE_SHORT_NO_LARGER');
      break;
    }
    case 'CALENDAR_HEDGE': {
      const o = open[0];
      if (closing.length > 0 || open.length !== 1 || o === undefined || o.side !== 'LONG' || o.kind === 'STOCK'
        || !current.some((l) => l.side === 'SHORT' && l.kind === o.kind && (o.expiryYears as number) > (l.expiryYears as number)))
        v.push('CALENDAR_HEDGE_IS_LONG_LATER_EXPIRY_OPTION_AGAINST_A_SHORT');
      break;
    }
    case 'PROTECTIVE_PUT_PROFIT_LOCK':
      if (closing.length > 0 || open.length !== 1 || open[0]?.kind !== 'PUT' || open[0]?.side !== 'LONG') v.push('PROFIT_LOCK_HEDGE_IS_ONE_LONG_PUT');
      if (!current.some((l) => l.side === 'LONG' && (l.kind === 'CALL' || l.kind === 'STOCK'))) v.push('PROFIT_LOCK_REQUIRES_LONG_UPSIDE_EXPOSURE');
      break;
    case 'CONVERT_TO_BUTTERFLY': {
      const after = [...current.filter((l) => !closing.includes(l)), ...open].filter((l) => l.kind !== 'STOCK');
      const kinds = new Set(after.map((l) => l.kind));
      const strikes = [...new Set(after.map((l) => l.strike as number))].sort((a, b) => a - b);
      const net = (k: number) => after.filter((l) => l.strike === k).reduce((n, l) => n + s(l.side) * l.quantity, 0);
      const [lo, mid, hi] = strikes;
      const ok = kinds.size === 1 && strikes.length === 3 && lo !== undefined && mid !== undefined && hi !== undefined
        && Math.abs((mid - lo) - (hi - mid)) < 1e-9 && net(mid) === -2 * net(lo) && net(lo) === net(hi) && net(lo) !== 0
        && new Set(after.map((l) => l.expiryYears)).size === 1;
      if (!ok) v.push('RESULT_IS_NOT_A_1_2_1_SAME_EXPIRY_BUTTERFLY');
      break;
    }
  }
  return v;
}

// ---------------------------------------------------------------- Profit lock
export interface ProfitLockProposal {
  readonly plannerVersion: typeof adjustmentPlannerVersion;
  readonly currentOpenProfit: number | null;
  readonly hedgeCost: number;
  readonly minimumLockedPayoff: number | '-UNBOUNDED';
  readonly remainingUpside: Bound;
  readonly newMaxLoss: Bound;
  readonly greeksBefore: AdjustmentProposal['before']['greeks'];
  readonly greeksAfter: AdjustmentProposal['after']['greeks'];
  readonly capitalImpact: number;
  readonly proposal: AdjustmentProposal;
  readonly locksProfit: boolean;
}

/** Profit lock = protective long put on long upside exposure. Locks only if the post-hedge minimum lifetime payoff is > 0. */
export function buildProfitLockProposal(current: readonly PayoffLeg[], hedge: PayoffLeg, spot: number): ProfitLockProposal {
  const proposal = buildAdjustmentProposal({ variant: 'PROTECTIVE_PUT_PROFIT_LOCK', current, close: [], open: [hedge], spot,
    objective: { kind: 'RAISE_MIN_PAYOFF' }, maxAdditionalCapital: 0 });
  const g = positionGreeks(current, { spot });
  return {
    plannerVersion: adjustmentPlannerVersion, currentOpenProfit: g.state === 'KNOWN' ? g.pnl : null,
    hedgeCost: hedge.entryPrice * hedge.quantity * hedge.multiplier,
    minimumLockedPayoff: proposal.after.minExpiryPnl, remainingUpside: proposal.after.maxProfit, newMaxLoss: proposal.after.maxLoss,
    greeksBefore: proposal.before.greeks, greeksAfter: proposal.after.greeks, capitalImpact: hedge.entryPrice * hedge.quantity * hedge.multiplier,
    proposal, locksProfit: proposal.verdict !== 'INVALID' && proposal.after.minExpiryPnl !== '-UNBOUNDED' && proposal.after.minExpiryPnl > 0,
  };
}
