// Scheduling-policy helpers (R1C continued): maps a WAIT reason (from
// bots/theta/quant/models/opportunity_frontier.py) to the specific
// re-evaluation trigger that should wake a WAIT_RECHECK job, and maps an
// open position's already-computed risk factors to how frequently
// POSITION_MANAGEMENT_SCAN should run for it. This module makes SCHEDULING
// decisions only -- it does not compute WAIT reasons, gamma, or assignment
// probability itself; those are Python quant outputs it consumes.

export type WaitReason = 'WAIT_PRICE' | 'WAIT_VOL' | 'WAIT_LIQUIDITY' | 'WAIT_EVENT' | 'WAIT_REGIME';

export type WaitRecheckTrigger =
  | { readonly kind: 'PRICE_THRESHOLD'; readonly referencePrice: number; readonly thresholdPct: number }
  | { readonly kind: 'VOLATILITY_CHANGE'; readonly referenceRv: number; readonly thresholdPct: number }
  | { readonly kind: 'LIQUIDITY_IMPROVEMENT'; readonly referenceSpreadPct: number }
  | { readonly kind: 'EVENT_LOCKOUT_EXPIRY'; readonly lockoutExpiresAt: string }
  | { readonly kind: 'REGIME_TRANSITION_OR_SCHEDULED'; readonly nextScheduledRefreshAt: string };

export interface WaitRecheckContext {
  readonly referencePrice?: number;
  readonly referenceRv?: number;
  readonly referenceSpreadPct?: number;
  readonly lockoutExpiresAt?: string;
  readonly nextScheduledRefreshAt?: string;
  readonly priceThresholdPct: number;
  readonly volatilityThresholdPct: number;
}

/**
 * Builds the specific, monitorable trigger a WAIT disposition (from the
 * opportunity frontier) should be rechecked against. Throws rather than
 * guessing when the context needed for that specific WAIT reason is
 * missing -- a WAIT with no trigger would be exactly the "indefinite WAIT"
 * this architecture exists to prevent.
 */
export function waitRecheckTrigger(waitReason: WaitReason, context: WaitRecheckContext): WaitRecheckTrigger {
  switch (waitReason) {
    case 'WAIT_PRICE':
      if (context.referencePrice === undefined) {
        throw new Error('referencePrice is required to build a WAIT_PRICE recheck trigger');
      }
      return { kind: 'PRICE_THRESHOLD', referencePrice: context.referencePrice, thresholdPct: context.priceThresholdPct };
    case 'WAIT_VOL':
      if (context.referenceRv === undefined) {
        throw new Error('referenceRv is required to build a WAIT_VOL recheck trigger');
      }
      return { kind: 'VOLATILITY_CHANGE', referenceRv: context.referenceRv, thresholdPct: context.volatilityThresholdPct };
    case 'WAIT_LIQUIDITY':
      if (context.referenceSpreadPct === undefined) {
        throw new Error('referenceSpreadPct is required to build a WAIT_LIQUIDITY recheck trigger');
      }
      return { kind: 'LIQUIDITY_IMPROVEMENT', referenceSpreadPct: context.referenceSpreadPct };
    case 'WAIT_EVENT':
      if (context.lockoutExpiresAt === undefined) {
        throw new Error('lockoutExpiresAt is required to build a WAIT_EVENT recheck trigger');
      }
      return { kind: 'EVENT_LOCKOUT_EXPIRY', lockoutExpiresAt: context.lockoutExpiresAt };
    case 'WAIT_REGIME':
      if (context.nextScheduledRefreshAt === undefined) {
        throw new Error('nextScheduledRefreshAt is required to build a WAIT_REGIME recheck trigger');
      }
      return { kind: 'REGIME_TRANSITION_OR_SCHEDULED', nextScheduledRefreshAt: context.nextScheduledRefreshAt };
  }
}

export interface PositionUrgencyFactors {
  readonly dte: number;
  readonly gammaExposure: number;
  readonly distanceToStrikePct: number;
  readonly eventProximityDays: number | null;
  readonly assignmentProbability: number | null;
}

const BASE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes -- the least-urgent case
const MIN_INTERVAL_MS = 60 * 1000; // never scan more than once a minute, regardless of urgency

/**
 * Position-management scan frequency scales UP (shorter interval) as DTE
 * shrinks, gamma rises, the underlying approaches the strike, an event
 * nears, or assignment probability rises -- never one fixed polling
 * interval regardless of state (this task's explicit scheduling-policy
 * requirement).
 */
export function positionManagementScanIntervalMs(factors: PositionUrgencyFactors): number {
  let urgency = 0;
  if (factors.dte <= 5) urgency += 2;
  else if (factors.dte <= 14) urgency += 1;

  if (factors.gammaExposure > 0.5) urgency += 2;
  else if (factors.gammaExposure > 0.2) urgency += 1;

  if (factors.distanceToStrikePct < 0.02) urgency += 2;
  else if (factors.distanceToStrikePct < 0.05) urgency += 1;

  if (factors.eventProximityDays !== null && factors.eventProximityDays <= 2) urgency += 2;

  if (factors.assignmentProbability !== null && factors.assignmentProbability > 0.5) urgency += 1;

  return Math.max(MIN_INTERVAL_MS, Math.round(BASE_INTERVAL_MS / (1 + urgency)));
}
