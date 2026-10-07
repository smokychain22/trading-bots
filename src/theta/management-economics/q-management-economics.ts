// Q (THETA_CONVENTIONAL, short cash-secured put) management economics -- SHADOW research record only.
//
// Enumerates HOLD / TAKE_PROFIT / RISK_CLOSE / TIME_EXIT / ROLL / ACCEPT_ASSIGNMENT / LET_EXPIRE from ONE timestamped
// snapshot and recommends one under a versioned RESEARCH policy. It never publishes a plan, never changes the Production
// management action, and carries authority 'SHADOW_RESEARCH_NO_EXECUTION'.
//
// Provenance:
//  - "Do not close only because red; do not hold only because it may recover" (guide 8.9): OWNER_CURATED_SOURCE_CLAIM.
//  - "When 80-95% of max credit is captured and residual reward is tiny, closing may dominate" (guide 8.8):
//    OWNER_CURATED_SOURCE_CLAIM, implemented as an explicit remaining-reward vs remaining-tail-risk comparison.
//  - Remaining reward, tail-at-expiry losses, BS mark shocks, cushion in sigma: MATH_REPRODUCED.
//  - Every threshold in QManagementResearchPolicy is a research parameter for replay grids, NOT a Production value.

import { blackScholes, yearsFromDays } from './black-scholes.js';

export const qManagementEconomicsVersion = 'theta-q-management-economics-v1' as const;

export type QManagementAction = 'HOLD' | 'TAKE_PROFIT' | 'RISK_CLOSE' | 'TIME_EXIT' | 'ROLL' | 'ACCEPT_ASSIGNMENT' | 'LET_EXPIRE';
export type TradeState = 'FAVORABLE' | 'FLAT' | 'ADVERSE' | 'UNKNOWN';
export type ThesisStatus = 'VALID' | 'WEAKENING' | 'INVALIDATED' | 'UNKNOWN';

export interface QManagementSnapshot {
  readonly positionId: string;
  readonly observedAt: string;
  readonly strike: number;
  readonly multiplier: number;
  readonly quantity: number;
  readonly entryCreditPerShare: number;
  readonly entrySpot: number | null;
  /** Calendar days to expiry at the snapshot (0 = expiry day). */
  readonly dte: number;
  readonly daysHeld: number;
  readonly spot: number | null;
  /** Executable buy-to-close price (ask) and bid of the short put. */
  readonly closeAsk: number | null;
  readonly closeBid: number | null;
  readonly iv: number | null;
  readonly delta: number | null;
  readonly supportLevel: number | null;
  readonly eventInWindow: boolean | null;
  /** True when the current regime label differs materially from the entry regime (regime engine); null = UNKNOWN. */
  readonly regimeChangedSinceEntry: boolean | null;
  /** Return per capital-day available from redeploying the capital (opportunity rate); null = UNKNOWN. */
  readonly redeploymentReturnPerCapitalDay: number | null;
  readonly riskFreeRate?: number;
}

/** Versioned research parameters (replay grid inputs). Null disables a rule; nothing here is a Production default. */
export interface QManagementResearchPolicy {
  readonly policyVersion: string;
  readonly profitCaptureTarget: number | null;
  readonly dteExit: number | null;
  readonly favorableCaptureThreshold: number;
  readonly adverseLossMultiple: number;
  readonly riskCloseDelta: number | null;
  readonly riskClosePremiumMultiple: number | null;
  readonly riskCloseCushionSigmas: number | null;
  readonly weakeningCushionSigmas: number | null;
  /** Close when remaining reward / worst modeled remaining tail loss falls below this (dynamic remaining-reward rule). */
  readonly minRemainingRewardToTail: number | null;
  /** Close when holding earns less per capital-day than redeployment by at least this margin. */
  readonly redeploymentAdvantage: number | null;
  readonly rollPermitted: boolean;
}

export interface QActionEvaluation {
  readonly action: QManagementAction;
  readonly feasible: boolean;
  readonly triggered: boolean;
  readonly reasons: readonly string[];
}

export interface QManagementShadowRecord {
  readonly contractVersion: typeof qManagementEconomicsVersion;
  readonly policyVersion: string;
  readonly positionId: string;
  readonly observedAt: string;
  readonly authority: 'SHADOW_RESEARCH_NO_EXECUTION';
  readonly tradeState: TradeState;
  readonly thesisStatus: ThesisStatus;
  readonly metrics: {
    readonly creditUsd: number;
    readonly closeDebitUsd: number | null;
    readonly capturedFraction: number | null;
    readonly openPnlUsd: number | null;
    readonly remainingRewardUsd: number | null;
    readonly tailLossAtExpiryMinus2SigmaUsd: number | null;
    readonly tailLossAtExpiryMinus3SigmaUsd: number | null;
    readonly markShockOneWeekUsd: number | null;
    readonly remainingRewardToTail: number | null;
    readonly cushionSigmas: number | null;
    readonly deltaAbs: number | null;
    readonly premiumMultiple: number | null;
    readonly capitalLockedUsd: number;
    readonly holdReturnPerCapitalDay: number | null;
    readonly redeploymentGapPerCapitalDay: number | null;
    readonly assignmentEffectiveBasis: number;
  };
  readonly evaluations: readonly QActionEvaluation[];
  readonly recommended: QManagementAction;
  readonly recommendationReasons: readonly string[];
  readonly unknownInputs: readonly string[];
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (v: number, p = 6) => Number(v.toFixed(p));

export function evaluateQManagementShadow(s: QManagementSnapshot, p: QManagementResearchPolicy): QManagementShadowRecord {
  if (!(s.strike > 0) || !(s.multiplier > 0) || !Number.isInteger(s.quantity) || s.quantity <= 0 || !(s.entryCreditPerShare > 0)
    || !Number.isInteger(s.dte) || s.dte < 0) throw new Error('Q_MANAGEMENT_SNAPSHOT_INVALID');
  const size = s.multiplier * s.quantity;
  const unknownInputs: string[] = [];
  if (!finite(s.spot)) unknownInputs.push('SPOT');
  if (!finite(s.closeAsk)) unknownInputs.push('CLOSE_ASK');
  if (!finite(s.iv) || (s.iv as number) <= 0) unknownInputs.push('IV');
  if (s.supportLevel === null) unknownInputs.push('SUPPORT_LEVEL');
  if (s.eventInWindow === null) unknownInputs.push('EVENT_STATE');
  if (s.regimeChangedSinceEntry === null) unknownInputs.push('REGIME_CHANGE');
  if (s.redeploymentReturnPerCapitalDay === null) unknownInputs.push('REDEPLOYMENT_RATE');
  const spot = finite(s.spot) ? s.spot : null;
  const iv = finite(s.iv) && s.iv > 0 ? s.iv : null;
  const rate = s.riskFreeRate ?? 0;
  const years = yearsFromDays(s.dte);
  const credit = s.entryCreditPerShare;
  const breakeven = s.strike - credit;
  const closeAsk = finite(s.closeAsk) ? s.closeAsk : null;

  const capturedFraction = closeAsk === null ? null : round((credit - closeAsk) / credit);
  const openPnl = closeAsk === null ? null : round((credit - closeAsk) * size, 4);
  const remainingReward = closeAsk === null ? null : round(closeAsk * size, 4);
  // Loss of HOLDING to expiry versus CLOSING now, if the underlying ends k sigma lower (expiry intrinsic).
  const tailAt = (k: number): number | null => spot === null || iv === null || closeAsk === null ? null
    : round((Math.max(0, s.strike - spot * Math.exp(-k * iv * Math.sqrt(Math.max(years, 1 / 365)))) - closeAsk) * size, 4);
  const tail2 = tailAt(2); const tail3 = tailAt(3);
  const worstTail = tail2 === null || tail3 === null ? null : Math.max(tail2, tail3);
  const remainingRewardToTail = remainingReward === null || worstTail === null ? null
    : worstTail <= 0 ? null : round(remainingReward / worstTail);
  // One-week mark shock: spot -2 sigma over 5 trading days and IV x1.25, BS repriced (European; early exercise not modeled).
  const markShock = spot === null || iv === null || closeAsk === null || s.dte <= 0 ? null : (() => {
    const horizon = Math.min(7, s.dte);
    const shockedSpot = spot * Math.exp(-2 * iv * Math.sqrt(5 / 252));
    const repriced = blackScholes('PUT', shockedSpot, s.strike, yearsFromDays(s.dte - horizon), iv * 1.25, rate).price;
    return round((repriced - closeAsk) * size, 4);
  })();
  const cushionSigmas = spot === null || iv === null || breakeven <= 0 ? null
    : round(Math.log(spot / breakeven) / (iv * Math.sqrt(Math.max(years, 1 / 365))));
  const deltaAbs = finite(s.delta) ? Math.abs(s.delta) : spot !== null && iv !== null
    ? Math.abs(blackScholes('PUT', spot, s.strike, years, iv, rate).delta) : null;
  if (!finite(s.delta) && deltaAbs !== null) unknownInputs.push('DELTA_COMPUTED_BS_FROM_IV');
  const premiumMultiple = closeAsk === null ? null : round(closeAsk / credit);
  const capital = s.strike * size;
  const holdRate = remainingReward === null || s.dte <= 0 ? null : round(remainingReward / capital / s.dte, 10);
  const redeployGap = holdRate === null || s.redeploymentReturnPerCapitalDay === null ? null
    : round(s.redeploymentReturnPerCapitalDay - holdRate, 10);

  const tradeState: TradeState = capturedFraction === null ? 'UNKNOWN'
    : capturedFraction >= p.favorableCaptureThreshold ? 'FAVORABLE'
      : (premiumMultiple as number) >= 1 + p.adverseLossMultiple || (spot !== null && spot < breakeven) ? 'ADVERSE' : 'FLAT';

  const invalidations: string[] = [];
  if (spot !== null && spot < breakeven) invalidations.push('SPOT_BELOW_BREAKEVEN');
  if (spot !== null && s.supportLevel !== null && spot < s.supportLevel) invalidations.push('SUPPORT_BROKEN');
  if (p.riskCloseDelta !== null && deltaAbs !== null && deltaAbs >= p.riskCloseDelta) invalidations.push('DELTA_EXPANDED');
  const weakenings: string[] = [];
  if (p.weakeningCushionSigmas !== null && cushionSigmas !== null && cushionSigmas < p.weakeningCushionSigmas) weakenings.push('CUSHION_SHRINKING');
  if (s.eventInWindow === true) weakenings.push('EVENT_IN_WINDOW');
  if (s.regimeChangedSinceEntry === true) weakenings.push('REGIME_CHANGED_REASSESS');
  const thesisStatus: ThesisStatus = invalidations.length > 0 ? 'INVALIDATED' : spot === null || iv === null ? 'UNKNOWN'
    : weakenings.length > 0 ? 'WEAKENING' : 'VALID';

  const expired = s.dte === 0;
  const itm = spot !== null && spot < s.strike;
  const evaluations: QActionEvaluation[] = [];
  const push = (action: QManagementAction, feasible: boolean, triggered: boolean, reasons: string[]) =>
    evaluations.push({ action, feasible, triggered: feasible && triggered, reasons });

  // RISK_CLOSE: never because merely red -- needs an explicit invalidation AND a configured risk trigger.
  const riskTriggers: string[] = [];
  if (p.riskCloseDelta !== null && deltaAbs !== null && deltaAbs >= p.riskCloseDelta) riskTriggers.push('DELTA_AT_OR_ABOVE_RISK_LIMIT');
  if (p.riskClosePremiumMultiple !== null && premiumMultiple !== null && premiumMultiple >= p.riskClosePremiumMultiple) riskTriggers.push('PREMIUM_MULTIPLE_AT_OR_ABOVE_LIMIT');
  if (p.riskCloseCushionSigmas !== null && cushionSigmas !== null && cushionSigmas <= p.riskCloseCushionSigmas) riskTriggers.push('BREAKEVEN_THREAT_CUSHION_SIGMA');
  push('RISK_CLOSE', !expired && closeAsk !== null, riskTriggers.length > 0 && thesisStatus === 'INVALIDATED',
    riskTriggers.length === 0 ? ['NO_RISK_TRIGGER'] : thesisStatus !== 'INVALIDATED' ? [...riskTriggers, 'THESIS_NOT_INVALIDATED_NO_CLOSE_ON_RED_ALONE'] : [...riskTriggers, ...invalidations]);

  const profitReasons: string[] = [];
  if (p.profitCaptureTarget !== null && capturedFraction !== null && capturedFraction >= p.profitCaptureTarget) profitReasons.push('CREDIT_CAPTURE_TARGET_REACHED');
  if (p.minRemainingRewardToTail !== null && remainingRewardToTail !== null && remainingRewardToTail < p.minRemainingRewardToTail
    && (capturedFraction ?? 0) > 0) profitReasons.push('REMAINING_REWARD_SMALL_VS_REMAINING_TAIL');
  if (p.redeploymentAdvantage !== null && redeployGap !== null && redeployGap >= p.redeploymentAdvantage && (capturedFraction ?? 0) > 0)
    profitReasons.push('REDEPLOYMENT_RETURN_EXCEEDS_HOLD_RETURN');
  push('TAKE_PROFIT', !expired && closeAsk !== null, profitReasons.length > 0, profitReasons.length > 0 ? profitReasons : ['NO_PROFIT_RULE_MET']);

  push('TIME_EXIT', !expired && closeAsk !== null, p.dteExit !== null && s.dte <= p.dteExit,
    p.dteExit !== null && s.dte <= p.dteExit ? ['DTE_AT_OR_BELOW_EXIT'] : ['DTE_ABOVE_EXIT_OR_RULE_OFF']);
  push('ROLL', !expired && p.rollPermitted, false, p.rollPermitted
    ? ['ROLL_REQUIRES_FRESH_NEW_CONTRACT_DECISION_CLOSE_PLUS_OPEN'] : ['ROLL_NOT_PERMITTED_BY_Q_POLICY']);
  push('ACCEPT_ASSIGNMENT', expired && spot !== null, itm, itm ? ['EXPIRING_ITM_EFFECTIVE_BASIS_STRIKE_MINUS_CREDIT'] : ['NOT_ITM']);
  push('LET_EXPIRE', expired && spot !== null, !itm, itm ? ['ITM'] : ['EXPIRING_OTM_FULL_CREDIT_RETAINED']);
  push('HOLD', !expired, true, ['DEFAULT_WHEN_NO_RULE_FIRES']);

  const order: QManagementAction[] = ['ACCEPT_ASSIGNMENT', 'LET_EXPIRE', 'RISK_CLOSE', 'TAKE_PROFIT', 'TIME_EXIT', 'HOLD'];
  const chosen = order.map((a) => evaluations.find((e) => e.action === a)).find((e) => e?.triggered) as QActionEvaluation | undefined;
  const recommended: QManagementAction = chosen?.action ?? (expired ? 'LET_EXPIRE' : 'HOLD');
  return {
    contractVersion: qManagementEconomicsVersion, policyVersion: p.policyVersion, positionId: s.positionId, observedAt: s.observedAt,
    authority: 'SHADOW_RESEARCH_NO_EXECUTION', tradeState, thesisStatus,
    metrics: { creditUsd: round(credit * size, 4), closeDebitUsd: closeAsk === null ? null : round(closeAsk * size, 4), capturedFraction,
      openPnlUsd: openPnl, remainingRewardUsd: remainingReward, tailLossAtExpiryMinus2SigmaUsd: tail2, tailLossAtExpiryMinus3SigmaUsd: tail3,
      markShockOneWeekUsd: markShock, remainingRewardToTail, cushionSigmas, deltaAbs: deltaAbs === null ? null : round(deltaAbs),
      premiumMultiple, capitalLockedUsd: capital, holdReturnPerCapitalDay: holdRate, redeploymentGapPerCapitalDay: redeployGap,
      assignmentEffectiveBasis: round(breakeven, 4) },
    evaluations, recommended,
    recommendationReasons: chosen?.reasons ?? ['NO_RULE_FIRED'],
    unknownInputs,
  };
}
