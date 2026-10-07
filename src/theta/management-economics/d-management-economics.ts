// D (THETA_DEFINED_RISK, bull put credit spread) management economics over the WHOLE spread -- SHADOW research record.
//
// Both legs are always priced together (close debit = short ask - long bid). The short leg is never managed in isolation:
// an asymmetric broker state yields ASYMMETRIC_EMERGENCY_REVIEW, which only the sovereign management authority may act on
// (guide 10.5, OWNER_CURATED_SOURCE_CLAIM). Spread payoff math: MATH_REPRODUCED. Thresholds are research parameters.

import { blackScholes, yearsFromDays } from './black-scholes.js';

export const dManagementEconomicsVersion = 'theta-d-management-economics-v1' as const;

export type DManagementAction = 'HOLD' | 'TAKE_PROFIT' | 'FULL_CLOSE' | 'RISK_CLOSE' | 'EXPIRY' | 'ASYMMETRIC_EMERGENCY_REVIEW' | 'RECONCILE_REQUIRED';

export interface DLegQuote { readonly strike: number; readonly bid: number | null; readonly ask: number | null; readonly delta: number | null }

export interface DManagementSnapshot {
  readonly positionId: string;
  readonly observedAt: string;
  readonly multiplier: number;
  readonly quantity: number;
  readonly entryNetCreditPerShare: number;
  readonly shortLeg: DLegQuote;
  readonly longLeg: DLegQuote;
  readonly dte: number;
  readonly spot: number | null;
  readonly iv: number | null;
  readonly eventInWindow: boolean | null;
  /** Broker-confirmed open contracts per leg (positive numbers); null = not reconciled. */
  readonly brokerShortContracts: number | null;
  readonly brokerLongContracts: number | null;
}

export interface DManagementResearchPolicy {
  readonly policyVersion: string;
  readonly profitCaptureTarget: number | null;
  readonly dteExit: number | null;
  /** RISK_CLOSE when the realized fraction of max loss reaches this. */
  readonly maxLossApproachFraction: number | null;
  /** RISK_CLOSE when spot is within this fraction above the short strike. */
  readonly shortStrikeThreatBuffer: number | null;
  /** RISK_CLOSE (liquidity) when both-leg close slippage exceeds this fraction of the width. */
  readonly maxSlippageFractionOfWidth: number | null;
  /** Dynamic: take profit when remaining reward / remaining max loss falls below this. */
  readonly minRemainingRewardToRemainingMaxLoss: number | null;
  readonly closeOnEventInWindow: boolean;
}

export interface DManagementShadowRecord {
  readonly contractVersion: typeof dManagementEconomicsVersion;
  readonly policyVersion: string;
  readonly positionId: string;
  readonly authority: 'SHADOW_RESEARCH_NO_EXECUTION';
  readonly legState: 'SYMMETRIC' | 'ASYMMETRIC' | 'UNRECONCILED';
  readonly metrics: {
    readonly widthUsd: number; readonly maxProfitUsd: number; readonly maxLossUsd: number;
    readonly closeDebitUsd: number | null; readonly capturedFraction: number | null; readonly openPnlUsd: number | null;
    readonly remainingRewardUsd: number | null; readonly remainingMaxLossUsd: number | null; readonly maxLossRealizedFraction: number | null;
    readonly bothLegSlippageUsd: number | null; readonly shortDeltaAbs: number | null; readonly spreadDelta: number | null;
    readonly spreadGamma: number | null; readonly expiryPnlUsd: number | null; readonly pinRisk: boolean | null;
  };
  readonly recommended: DManagementAction;
  readonly reasons: readonly string[];
  readonly unknownInputs: readonly string[];
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const r6 = (v: number) => Number(v.toFixed(6));

export function evaluateDManagementShadow(s: DManagementSnapshot, p: DManagementResearchPolicy): DManagementShadowRecord {
  if (!(s.longLeg.strike < s.shortLeg.strike) || !(s.multiplier > 0) || !Number.isInteger(s.quantity) || s.quantity <= 0
    || !(s.entryNetCreditPerShare > 0) || !Number.isInteger(s.dte) || s.dte < 0) throw new Error('D_MANAGEMENT_SNAPSHOT_INVALID');
  const width = s.shortLeg.strike - s.longLeg.strike;
  if (s.entryNetCreditPerShare >= width) throw new Error('D_MANAGEMENT_CREDIT_NOT_BELOW_WIDTH');
  const size = s.multiplier * s.quantity;
  const credit = s.entryNetCreditPerShare;
  const unknownInputs: string[] = [];
  const legState = s.brokerShortContracts === null || s.brokerLongContracts === null ? 'UNRECONCILED'
    : s.brokerShortContracts === s.brokerLongContracts && s.brokerShortContracts === s.quantity ? 'SYMMETRIC' : 'ASYMMETRIC';
  const debit = finite(s.shortLeg.ask) && finite(s.longLeg.bid) ? Math.max(0, s.shortLeg.ask - s.longLeg.bid) : null;
  if (debit === null) unknownInputs.push('BOTH_LEG_CLOSE_QUOTE');
  const slippage = [s.shortLeg, s.longLeg].every((l) => finite(l.bid) && finite(l.ask))
    ? r6(((s.shortLeg.ask as number) - (s.shortLeg.bid as number) + (s.longLeg.ask as number) - (s.longLeg.bid as number)) / 2 * size) : null;
  const spot = finite(s.spot) ? s.spot : null; const iv = finite(s.iv) && s.iv > 0 ? s.iv : null;
  if (spot === null) unknownInputs.push('SPOT');
  if (iv === null) unknownInputs.push('IV');
  if (s.eventInWindow === null) unknownInputs.push('EVENT_STATE');
  const years = yearsFromDays(s.dte);
  const greek = (leg: DLegQuote) => spot === null || iv === null ? null : blackScholes('PUT', spot, leg.strike, years, iv);
  const gS = greek(s.shortLeg); const gL = greek(s.longLeg);
  const shortDeltaAbs = finite(s.shortLeg.delta) ? Math.abs(s.shortLeg.delta) : gS === null ? null : Math.abs(gS.delta);
  const longDeltaAbs = finite(s.longLeg.delta) ? Math.abs(s.longLeg.delta) : gL === null ? null : Math.abs(gL.delta);
  // Short put has +|delta| position delta, the long put -|delta|.
  const spreadDelta = shortDeltaAbs === null || longDeltaAbs === null ? null : r6((shortDeltaAbs - longDeltaAbs) * size);
  const spreadGamma = gS === null || gL === null ? null : r6((gL.gamma - gS.gamma) * size);
  const expiryPnl = spot === null ? null : r6((credit - Math.min(width, Math.max(0, s.shortLeg.strike - spot))) * size);
  const metrics = {
    widthUsd: r6(width * size), maxProfitUsd: r6(credit * size), maxLossUsd: r6((width - credit) * size),
    closeDebitUsd: debit === null ? null : r6(debit * size), capturedFraction: debit === null ? null : r6((credit - debit) / credit),
    openPnlUsd: debit === null ? null : r6((credit - debit) * size), remainingRewardUsd: debit === null ? null : r6(debit * size),
    remainingMaxLossUsd: debit === null ? null : r6((width - debit) * size),
    maxLossRealizedFraction: debit === null ? null : r6(Math.max(0, debit - credit) / (width - credit)),
    bothLegSlippageUsd: slippage, shortDeltaAbs: shortDeltaAbs === null ? null : r6(shortDeltaAbs), spreadDelta, spreadGamma,
    expiryPnlUsd: s.dte === 0 ? expiryPnl : null,
    pinRisk: spot === null ? null : s.dte <= 1 && spot > s.longLeg.strike && spot < s.shortLeg.strike,
  };
  const base = { contractVersion: dManagementEconomicsVersion, policyVersion: p.policyVersion, positionId: s.positionId,
    authority: 'SHADOW_RESEARCH_NO_EXECUTION' as const, legState, metrics, unknownInputs };
  if (legState === 'UNRECONCILED') return { ...base, recommended: 'RECONCILE_REQUIRED', reasons: ['BROKER_LEG_STATE_UNKNOWN_NO_ACTION'] };
  if (legState === 'ASYMMETRIC') {
    return { ...base, recommended: 'ASYMMETRIC_EMERGENCY_REVIEW', reasons: [
      s.brokerLongContracts === 0 ? 'LONG_LEG_ABSENT_SHORT_EXPOSURE_UNDEFINED_RISK' : 'LEG_QUANTITIES_DIFFER',
      'SOVEREIGN_MANAGEMENT_ONLY_NO_ISOLATED_LEG_ACTION_IN_SHADOW'] };
  }
  if (s.dte === 0) return { ...base, recommended: 'EXPIRY', reasons: [metrics.pinRisk ? 'EXPIRING_BETWEEN_STRIKES_PIN_RISK' : 'EXPIRING'] };
  const risk: string[] = [];
  if (p.maxLossApproachFraction !== null && metrics.maxLossRealizedFraction !== null && metrics.maxLossRealizedFraction >= p.maxLossApproachFraction) risk.push('MAX_LOSS_APPROACH');
  if (p.shortStrikeThreatBuffer !== null && spot !== null && spot <= s.shortLeg.strike * (1 + p.shortStrikeThreatBuffer)) risk.push('SHORT_STRIKE_THREATENED');
  if (p.maxSlippageFractionOfWidth !== null && slippage !== null && slippage / (width * size) > p.maxSlippageFractionOfWidth) risk.push('LIQUIDITY_WIDENED');
  if (p.closeOnEventInWindow && s.eventInWindow === true) risk.push('EVENT_IN_WINDOW');
  if (risk.length > 0 && debit !== null) return { ...base, recommended: 'RISK_CLOSE', reasons: [...risk, 'CLOSE_BOTH_LEGS_AS_ONE_PACKAGE'] };
  const profit: string[] = [];
  if (p.profitCaptureTarget !== null && metrics.capturedFraction !== null && metrics.capturedFraction >= p.profitCaptureTarget) profit.push('CREDIT_CAPTURE_TARGET_REACHED');
  if (p.minRemainingRewardToRemainingMaxLoss !== null && debit !== null && (metrics.capturedFraction ?? 0) > 0
    && debit / (width - debit) < p.minRemainingRewardToRemainingMaxLoss) profit.push('REMAINING_REWARD_SMALL_VS_REMAINING_MAX_LOSS');
  if (profit.length > 0) return { ...base, recommended: 'TAKE_PROFIT', reasons: profit };
  if (p.dteExit !== null && s.dte <= p.dteExit && debit !== null) return { ...base, recommended: 'FULL_CLOSE', reasons: ['DTE_AT_OR_BELOW_EXIT'] };
  return { ...base, recommended: 'HOLD', reasons: ['NO_RULE_FIRED'] };
}
