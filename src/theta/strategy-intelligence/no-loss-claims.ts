// Typed evaluation of "risk-free / no-loss / locked profit" claims (research only).
//
// A phrase is not a claim. Each construction is tested against ONE precise claim type.
// The static expiry result and the path risks are reported separately: a non-negative
// expiry payoff is recorded as such even when path risk exists, and path risk is never
// hidden because the expiry payoff is non-negative.

import { entryCashflow, expiryProfile, positionGreeks, type ExpiryProfile, type PayoffLeg } from './option-payoff.js';

export const noLossClaimEvaluatorVersion = 'theta-no-loss-claims-v1' as const;

export type NoLossClaimType =
  | 'STATIC_NO_LOSS_AT_EXPIRY'      // min lifetime P&L at the horizon (after entry cashflows) >= 0
  | 'NON_NEGATIVE_STATIC_PAYOFF'    // terminal value of the legs >= 0 everywhere (ignores what was paid)
  | 'LOCKED_MINIMUM_PROFIT'         // min lifetime P&L at the horizon > 0
  | 'ZERO_NET_DEBIT'                // entry cashflow >= 0
  | 'CREDIT_FINANCED_LONG_VOL'      // entry cashflow >= 0 AND long gamma AND a convex unbounded/large wing
  | 'DELTA_HEDGED_LOCAL_RANGE'      // |delta| small AND instantaneous P&L not negative within a local spot band
  | 'LIMITED_LOSS'                  // max loss finite
  | 'BROKER_MARGIN_REDUCTION';      // needs a broker margin model: never inferred

export type StaticLossShape = 'NO_STATIC_LOSS' | 'LOSS_VALLEY_PRESENT' | 'LOSS_TAIL';

/** NO_STATIC_LOSS: min expiry P&L >= 0. LOSS_VALLEY_PRESENT: the loss is bounded and interior (P&L at both ends of the
 * spot range is above the minimum). LOSS_TAIL: the worst loss sits at an end of the spot range or is unbounded. */
export function staticLossShape(profile: ExpiryProfile): StaticLossShape {
  if (profile.minPnl !== '-UNBOUNDED' && profile.minPnl >= 0) return 'NO_STATIC_LOSS';
  if (profile.minPnl === '-UNBOUNDED' || profile.grid.length < 3) return 'LOSS_TAIL';
  const first = profile.grid[0]?.pnl as number; const last = profile.grid[profile.grid.length - 1]?.pnl as number;
  const tolerance = 1e-6;
  return first > profile.minPnl + tolerance && (last > profile.minPnl + tolerance || profile.upsideSlope > 0) ? 'LOSS_VALLEY_PRESENT' : 'LOSS_TAIL';
}

export type ClaimVerdict = 'REPRODUCED' | 'NOT_REPRODUCED' | 'UNDETERMINED';

export interface PathRiskReport {
  readonly worstMarkToMarketPnl: number | null;
  readonly worstScenario: string | null;
  readonly scenarios: number;
  readonly unknownReasons: readonly string[];
  readonly earlyAssignmentExposure: readonly string[];
  readonly minExpiryPnlAfterCosts: number | '-UNBOUNDED';
  readonly costAssumptionPerContractUsd: number;
}

export interface NoLossClaimResult {
  readonly evaluatorVersion: typeof noLossClaimEvaluatorVersion;
  readonly claim: NoLossClaimType;
  readonly verdict: ClaimVerdict;
  readonly staticEvidence: { readonly minExpiryPnl: number | '-UNBOUNDED'; readonly entryCashflow: number; readonly maxLoss: number | 'UNBOUNDED';
    /** Shape of the static expiry loss: an interior valley (e.g. a credit backspread) is never labelled no-loss. */
    readonly lossShape: StaticLossShape; readonly worstSpot: number | null };
  readonly detail: string;
  /** Always reported, independent of the static verdict. */
  readonly pathRisk: PathRiskReport;
}

export interface ClaimContext {
  readonly spot: number;
  /** Modeled per-contract (per option leg contract) round-trip costs: fees + slippage, USD. */
  readonly costPerContractUsd?: number;
  /** For DELTA_HEDGED_LOCAL_RANGE: fractional band (e.g. 0.02) and delta tolerance in shares. */
  readonly localBandPct?: number;
  readonly deltaToleranceShares?: number;
  /** For BROKER_MARGIN_REDUCTION: caller-supplied broker requirements, never estimated here. */
  readonly brokerMarginBeforeUsd?: number | null;
  readonly brokerMarginAfterUsd?: number | null;
}

const SPOT_SHOCKS = [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2] as const;
const IV_SHOCKS = [-0.1, 0, 0.1] as const;
const TIME_FRACTIONS = [0, 0.5] as const;

export function pathRisk(legs: readonly PayoffLeg[], profile: ExpiryProfile, context: ClaimContext): PathRiskReport {
  let worst: number | null = null; let worstScenario: string | null = null; let scenarios = 0;
  const unknown = new Set<string>();
  for (const s of SPOT_SHOCKS) for (const v of IV_SHOCKS) for (const f of TIME_FRACTIONS) {
    const g = positionGreeks(legs, { spot: context.spot * (1 + s), ivShift: v, elapsedYears: profile.horizonYears * f });
    scenarios++;
    if (g.state === 'UNKNOWN') { g.reasons.forEach((reason) => unknown.add(reason)); continue; }
    if (worst === null || g.pnl < worst) { worst = g.pnl; worstScenario = `spot${s >= 0 ? '+' : ''}${s * 100}%_iv${v >= 0 ? '+' : ''}${v * 100}pt_time${f * 100}%`; }
  }
  const early = legs.filter((leg) => leg.side === 'SHORT' && leg.kind !== 'STOCK' && (leg.exerciseStyle ?? 'AMERICAN') === 'AMERICAN')
    .map((leg) => `SHORT_AMERICAN_${leg.kind}_${leg.strike}:${leg.id}`);
  const contracts = legs.filter((leg) => leg.kind !== 'STOCK').reduce((sum, leg) => sum + leg.quantity, 0);
  const cost = context.costPerContractUsd ?? 0;
  return {
    worstMarkToMarketPnl: unknown.size > 0 ? null : worst, worstScenario: unknown.size > 0 ? null : worstScenario, scenarios,
    unknownReasons: [...unknown], earlyAssignmentExposure: early,
    minExpiryPnlAfterCosts: profile.minPnl === '-UNBOUNDED' ? '-UNBOUNDED' : Number((profile.minPnl - cost * contracts).toFixed(6)),
    costAssumptionPerContractUsd: cost,
  };
}

export function evaluateNoLossClaim(claim: NoLossClaimType, legs: readonly PayoffLeg[], context: ClaimContext): NoLossClaimResult {
  const profile = expiryProfile(legs, { spot: context.spot });
  const cash = entryCashflow(legs);
  const staticEvidence = { minExpiryPnl: profile.minPnl, entryCashflow: Number(cash.toFixed(6)), maxLoss: profile.maxLoss,
    lossShape: staticLossShape(profile), worstSpot: profile.minPnlAtSpot };
  const out = (verdict: ClaimVerdict, detail: string): NoLossClaimResult => ({
    evaluatorVersion: noLossClaimEvaluatorVersion, claim, verdict, staticEvidence, detail, pathRisk: pathRisk(legs, profile, context) });
  const min = profile.minPnl;
  switch (claim) {
    case 'STATIC_NO_LOSS_AT_EXPIRY':
      return min === '-UNBOUNDED' ? out('NOT_REPRODUCED', 'UNBOUNDED_LOSS') : out(min >= -1e-9 ? 'REPRODUCED' : 'NOT_REPRODUCED', `MIN_EXPIRY_PNL=${min}`);
    case 'LOCKED_MINIMUM_PROFIT':
      return min === '-UNBOUNDED' ? out('NOT_REPRODUCED', 'UNBOUNDED_LOSS') : out(min > 1e-9 ? 'REPRODUCED' : 'NOT_REPRODUCED', `MIN_EXPIRY_PNL=${min}`);
    case 'NON_NEGATIVE_STATIC_PAYOFF': {
      const terminalMin = min === '-UNBOUNDED' ? -Infinity : min - cash; // remove entry cashflows from the lifetime P&L
      return out(terminalMin >= -1e-9 ? 'REPRODUCED' : 'NOT_REPRODUCED', `MIN_TERMINAL_VALUE=${terminalMin}`);
    }
    case 'ZERO_NET_DEBIT':
      return out(cash >= -1e-9 ? 'REPRODUCED' : 'NOT_REPRODUCED', `ENTRY_CASHFLOW=${cash}`);
    case 'LIMITED_LOSS':
      return out(profile.maxLoss === 'UNBOUNDED' ? 'NOT_REPRODUCED' : 'REPRODUCED', `MAX_LOSS=${profile.maxLoss}`);
    case 'CREDIT_FINANCED_LONG_VOL': {
      const g = positionGreeks(legs, { spot: context.spot });
      if (g.state === 'UNKNOWN') return out('UNDETERMINED', g.reasons.join(','));
      const tail = profile.grid.at(-1)?.pnl ?? 0; const floor = profile.grid[0]?.pnl ?? 0;
      const convexWing = profile.upsideSlope > 0 || floor > Math.max(0, cash) + 1e-9 || tail > Math.max(0, cash) + 1e-9;
      const ok = cash >= -1e-9 && g.gamma > 0 && convexWing;
      return out(ok ? 'REPRODUCED' : 'NOT_REPRODUCED', `CASH=${cash.toFixed(2)} GAMMA=${g.gamma.toFixed(6)} CONVEX_WING=${convexWing}`);
    }
    case 'DELTA_HEDGED_LOCAL_RANGE': {
      const band = context.localBandPct; const tol = context.deltaToleranceShares;
      if (band === undefined || tol === undefined) return out('UNDETERMINED', 'LOCAL_BAND_AND_DELTA_TOLERANCE_REQUIRED');
      const base = positionGreeks(legs, { spot: context.spot });
      if (base.state === 'UNKNOWN') return out('UNDETERMINED', base.reasons.join(','));
      let worst = Infinity;
      for (let i = -10; i <= 10; i++) {
        const move = context.spot * band * i / 10;
        const g = positionGreeks(legs, { spot: context.spot + move });
        // Residual delta (within tolerance) is assumed re-hedged at the current delta; the claim is about the hedged book.
        if (g.state === 'KNOWN') worst = Math.min(worst, g.pnl - base.pnl - base.delta * move);
      }
      const ok = Math.abs(base.delta) <= tol && worst >= -1e-6;
      return out(ok ? 'REPRODUCED' : 'NOT_REPRODUCED', `DELTA=${base.delta.toFixed(4)} WORST_INSTANT_HEDGED_BAND_PNL=${worst.toFixed(4)} (instantaneous only; theta/IV drift are path risk)`);
    }
    case 'BROKER_MARGIN_REDUCTION': {
      const before = context.brokerMarginBeforeUsd; const after = context.brokerMarginAfterUsd;
      if (before == null || after == null) return out('UNDETERMINED', 'BROKER_MARGIN_MODEL_NOT_AVAILABLE');
      return out(after < before ? 'REPRODUCED' : 'NOT_REPRODUCED', `MARGIN ${before} -> ${after}`);
    }
  }
}
