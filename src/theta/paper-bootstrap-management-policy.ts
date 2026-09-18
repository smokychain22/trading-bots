import type { ManagementInputState } from './management-input-state.js';
import type { ManagementPolicyEvidenceProvider } from './autonomous-runtime.js';
import {
  buildManagementActionFrontier, managementPolicyEvidenceVersion,
  type ManagementActionExecutionEvidence, type ManagementFrontierAction,
  type ManagementPolicyActionValue, type ManagementPolicyEvidence,
} from './management-action-frontier.js';
import { buildCommonHorizonComparison, forwardContinuationCashFlow, sunkRealizedEconomics } from './common-horizon-economics.js';
import { evaluateRollCandidates, type RollCandidateEconomics } from './roll-incremental-utility.js';
import { assessThesisInvalidation, type ThesisInvalidationAssessment } from './thesis-invalidation.js';
import { buildRecoveryState, type RecoveryState } from './recovery-state.js';
import { evaluateAssignmentUtility } from './assignment-utility.js';
import type { WholeChainComponents } from './whole-chain-economics.js';
import {
  bestCoveredCallCandidate, evaluateCoveredCallCandidates, type CoveredCallCandidate, type CoveredCallUtilityWeights,
} from './covered-call-lattice.js';

const DEFAULT_CC_UTILITY_WEIGHTS: CoveredCallUtilityWeights = {
  upsideSacrificePerDollarWeight: 0, spreadPerDollarWeight: 0, eventRiskPenalty: 0,
  dividendExDateRiskPenalty: 0, belowBasisPenalty: 0,
};

export const paperBootstrapManagementPolicyVersion = 'theta-paper-bootstrap-management-policy-v1' as const;

/**
 * PAPER_BOOTSTRAP_MANAGEMENT_POLICY.
 *
 * A deterministic, non-empirical management policy for the FIRST Paper
 * canary and any subsequent bounded Paper activity that has not yet earned
 * empirical promotion. It implements the same `ManagementPolicyEvidenceProvider`
 * interface a future empirically-promoted policy would -- `evaluate()`
 * returns a `ManagementPolicyEvidence | null` -- so it slots into
 * `buildRuntimeManagementFrontiers` (autonomous-runtime.ts) without any
 * runtime wiring change.
 *
 * WHAT THIS POLICY IS: an honest, arithmetic-only decision layer. Every
 * number it produces is either a KNOWN current fact (unrealized P&L,
 * remaining extrinsic value, capital committed, days to expiration) or a
 * simple, clearly-labeled DERIVED quantity from those facts (never a
 * forecast, never a probability, never a claim of statistical edge).
 *
 * WHAT THIS POLICY IS NOT:
 *   - It is NOT an empirically-promoted policy. `empiricalEconomicsReady`
 *     is never set true anywhere in this file. Every `expectedFutureValue`/
 *     `expectedAfterCostEv` field it produces is explicitly `null` --
 *     UNKNOWN is reported honestly rather than a fabricated confidence.
 *   - It does NOT search for or select a roll target contract. ROLL
 *     requires the CALLER to supply an already-identified target (bid/ask
 *     known) via `input.rollCandidate`; without one, ROLL remains
 *     structurally unselected (not fabricated), and the policy falls back
 *     to HOLD/CLOSE_FULL/structural-expiration handling, which the
 *     existing `buildManagementActionFrontier` machinery already covers
 *     correctly on its own.
 *   - It does NOT override broker-confirmed lifecycle facts. Assignment/
 *     call-away/expiration handling remains the existing structural
 *     mechanism in management-action-frontier.ts; this policy never
 *     contradicts it, only supplements the actions that mechanism leaves
 *     genuinely undecided (HOLD vs. CLOSE vs. ROLL while the position
 *     remains open).
 *   - It NEVER claims a fixed profit-target/stop-loss percentage has
 *     execution authority. Any percentage-shaped observation surfaces only
 *     as a REASON CODE for a human/research reviewer, never as the sole
 *     basis for a selection.
 *
 * Fails safe throughout: any missing required input degrades the specific
 * action's own utility to UNKNOWN (never a fabricated number), and the
 * policy as a whole returns `null` (not a fabricated frontier) whenever it
 * cannot construct a complete, honest comparison for the current lifecycle
 * state -- exactly the same "absence stays a conservative passive action"
 * contract `buildRuntimeManagementFrontiers` already documents.
 */

export interface RollCandidate {
  readonly optionContractId: string;
  readonly symbol: string;
  readonly optionType: 'PUT' | 'CALL';
  readonly strike: number;
  readonly expiration: string;
  readonly multiplier: number;
  readonly quantity: number;
  readonly bid: number | null;
  readonly ask: number | null;
  /** Only meaningful for `ccCandidates` (covered-call targets) -- ignored
   * for ROLL. Defaults to false (no known risk) when omitted; this is a
   * simplification, not a claim the risk is verified absent -- a genuinely
   * UNKNOWN risk flag is out of scope for this simple candidate shape. */
  readonly dividendExDateRisk?: boolean;
  readonly eventRisk?: boolean;
}

export interface PaperBootstrapPolicyInput extends ManagementInputState {
  readonly rollCandidate?: RollCandidate | null;
  readonly ccCandidate?: RollCandidate | null;
  /**
   * Optional ALTERNATIVE short-put roll targets (different strike and/or
   * expiration). When supplied (length >= 1), ROLL is evaluated across all
   * of them via `evaluateRollCandidates`/`RollIncrementalUtility` rather
   * than the single `rollCandidate` path -- this is what lets the policy
   * genuinely compare "this strike vs. that strike, this expiry vs. that
   * expiry" instead of only ever seeing one pre-picked target. Falls back
   * to `rollCandidate` when absent/empty (fully backward compatible).
   */
  readonly rollCandidates?: readonly RollCandidate[];
  /** Required, caller-justified penalty per dollar of additional capital
   * committed per additional day extended by a roll. Defaults to 0 (no
   * capital-day penalty applied) when omitted -- never invented internally. */
  readonly rollIncrementalCapitalDayWeight?: number;
  /**
   * Required, caller-justified continuous utility bias applied ONLY when
   * `assessThesisInvalidation` reports a THESIS_FAILURE_* classification --
   * it shifts CLOSE_FULL/CLOSE_CC utility up and ROLL/ROLL_CC utility down
   * by this amount. Defaults to 0 (thesis classification has NO effect on
   * ranking -- pure economics) when omitted, matching the same
   * caller-supplies-every-threshold convention as
   * `rollIncrementalCapitalDayWeight`. This is a continuous ordinal
   * adjustment, never a boolean gate: a mild bias lets a large economic
   * upside still outrank a suspected (not confirmed) thesis failure, and
   * the dollar loss magnitude itself never appears in this bias at all --
   * only the SEPARATE thesis classification does.
   */
  readonly thesisFailureUtilityBias?: number;
  /**
   * Optional ALTERNATIVE covered-call targets (different strike/DTE),
   * compared via `evaluateCoveredCallCandidates`/`selectableCoveredCallCandidates`
   * on whole-chain economics rather than the single `ccCandidate` path.
   * Falls back to `ccCandidate` when absent/empty (fully backward compatible).
   */
  readonly ccCandidates?: readonly RollCandidate[];
  /** Required, caller-justified weights for `computeCoveredCallUtility`.
   * Defaults to all-zero (utility reduces to pure premium income) when
   * omitted -- the architecture supports a richer, multi-factor ranking,
   * but this bootstrap policy never invents non-zero weights itself. */
  readonly ccUtilityWeights?: CoveredCallUtilityWeights;
  /** Caller-supplied, honest inputs for `buildRecoveryState` -- both optional;
   * omitted, capital-days/opportunity-cost stay UNKNOWN rather than fabricated. */
  readonly assignedAtObservedAt?: string | null;
  readonly annualOpportunityCostRate?: number | null;
  /**
   * Required, caller-justified weight converting a KNOWN capital
   * opportunity cost (RecoveryState.capitalOpportunityCostDollars) into a
   * positive utility contribution for SELL_STOCK. Defaults to 0 (inert)
   * when omitted. This -- together with `thesisFailureUtilityBias`, which
   * SELL_STOCK now also reacts to exactly like CLOSE_FULL/ROLL -- replaces
   * the previous PERMANENT, unconditional -0.5 handicap against
   * liquidating assigned stock. SELL_STOCK's baseline utility is now the
   * same neutral 0 as RECOVERY_WAIT/HOLD; it wins only through these two
   * explicit, versioned, default-neutral mechanisms, never a hidden bias.
   */
  readonly sellStockOpportunityCostUtilityWeight?: number;
  /**
   * Optional, caller-supplied full chain-history components (initial put
   * premium, roll credits/close costs, fees, slippage) feeding the ONE
   * canonical `computeEffectiveStockBasis` (whole-chain-economics.ts).
   * `ManagementInputState` does not itself carry per-chain roll history,
   * so this must come from the caller when available. Omitted, or
   * incomplete, RecoveryState honestly falls back to the broker-recorded
   * `economics.stockBasisPerShare` rather than fabricating a canonical
   * figure it cannot actually compute -- see `buildRecoveryState`'s doc
   * comment in recovery-state.ts.
   */
  readonly wholeChainComponents?: WholeChainComponents | null;
  /**
   * Required, caller-justified weight converting the KNOWN, bid-side
   * SELL_CC premium into utility. Defaults to 0 (fully neutral -- SELL_CC
   * ties with RECOVERY_WAIT/HOLD's baseline of 0) when omitted. This
   * replaces a previous flat, unconditional positive constant that made
   * any candidate with a positive premium automatically outrank
   * RECOVERY_WAIT/SELL_STOCK regardless of the premium's actual size --
   * exactly the hidden permanent preference the recovery-frontier
   * architecture must not contain (no action may have a structural law
   * favoring it over another).
   */
  readonly sellCcPremiumUtilityWeight?: number;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/**
 * THREE conceptually distinct quantities exist for the same open option
 * leg, and this module keeps them structurally separate rather than
 * letting one silently alias another (a confirmed integration blocker):
 *
 *   1. EstimatedExecutableCloseCost (this function) -- the conservative,
 *      ASK-side, PRE-FILL cost to buy back the short leg RIGHT NOW. Feeds
 *      ONLY execution/timing decisions (is it cheap enough to act NOW):
 *      CLOSE_FULL/CLOSE_CC's near-exhausted trigger, ROLL/ROLL_CC's
 *      old-leg close cost in forwardContinuationCashFlow. Never used to
 *      classify P&L or loss state.
 *   2. AnalyticalOptionMark (`analyticalOptionMarkDollars`) -- the
 *      neutral valuation reference used for P&L/loss-state classification,
 *      remaining-value analytics, and (later) MFE/MAE path features. No
 *      better analytical source exists in this codebase yet than the
 *      midpoint, so this currently computes the same number as
 *      `midReferenceDollars` -- but the TWO call sites (P&L classification
 *      vs. "here is mid for comparison" reason codes) must reference the
 *      semantically-correct function, not merely the same number by
 *      coincidence, so a future real analytical-mark source (broker-
 *      reported mark, a calibrated model) can replace this one function
 *      without touching every consumer.
 *   3. ActualCloseFill -- broker-reconciled realized truth. This bootstrap
 *      policy has no fill data at all (it runs pre-order); this concept
 *      exists only as a documented boundary so nothing here is ever
 *      mistaken for it. Whole-chain accounting (whole-chain-economics.ts)
 *      is the only place a real fill/realized value belongs once one
 *      exists -- it is a SEPARATE field from `deterministicNetCredit`
 *      (this module's pre-fill estimate), never the same field reused.
 *
 * `estimatedExecutableCloseCostDollars` returns null (never zero) when
 * the quote is missing or crossed.
 */
function estimatedExecutableCloseCostDollars(state: ManagementInputState): number | null {
  const { optionBid, optionAsk } = state.market;
  const { multiplier, contracts } = state.contract;
  if (!finite(optionBid) || !finite(optionAsk) || optionBid < 0 || optionAsk < optionBid
    || !finite(multiplier) || !finite(contracts)) return null;
  return optionAsk * multiplier * contracts;
}

/** The neutral analytical valuation reference for P&L/loss-state
 * classification and remaining-value analytics -- see the doc comment on
 * `estimatedExecutableCloseCostDollars` for why this is a semantically
 * DIFFERENT function from that one, even though both currently compute
 * from the same quote (no better analytical mark source exists yet). A
 * widening ask does not, by itself, worsen this value the way it worsens
 * the executable close-cost estimate. */
function analyticalOptionMarkDollars(state: ManagementInputState): number | null {
  const { optionBid, optionAsk } = state.market;
  const { multiplier, contracts } = state.contract;
  if (!finite(optionBid) || !finite(optionAsk) || optionBid < 0 || optionAsk < optionBid
    || !finite(multiplier) || !finite(contracts)) return null;
  return ((optionBid + optionAsk) / 2) * multiplier * contracts;
}

/** Identical formula to `analyticalOptionMarkDollars` -- kept as a
 * separately-named export used specifically for side-by-side "here is
 * what mid suggests" reason codes next to the executable close-cost
 * estimate, so a reviewer can see the gap explicitly. Never fed into any
 * action's utility. */
function midReferenceDollars(state: ManagementInputState): number | null {
  return analyticalOptionMarkDollars(state);
}

/**
 * The EXECUTION-timing fraction: estimated executable close cost divided
 * by original entry credit. This answers "is it now cheap to ACT," not
 * "what is the analytical P&L state" -- feeds ONLY the near-exhausted
 * CLOSE trigger. Purely descriptive, never a fixed percentage rule.
 */
function executableRemainingValueFraction(state: ManagementInputState, executableCloseCost: number | null): number | null {
  const entry = state.economics.entryCreditDebit;
  if (!finite(entry) || entry === 0 || executableCloseCost === null) return null;
  return executableCloseCost / Math.abs(entry);
}

/**
 * The ANALYTICAL fraction: the neutral analytical mark divided by
 * original entry credit. This is the one that legitimately answers
 * "what does the position's current value suggest about P&L" -- it must
 * NOT worsen merely because the ask side widened (a pure execution-cost
 * artifact), since that would falsely manufacture a loss signal that
 * never actually happened analytically.
 */
function analyticalRemainingValueFraction(state: ManagementInputState, analyticalMark: number | null): number | null {
  const entry = state.economics.entryCreditDebit;
  if (!finite(entry) || entry === 0 || analyticalMark === null) return null;
  return analyticalMark / Math.abs(entry);
}

function daysToExpiration(state: ManagementInputState): number | null {
  return finite(state.market.dte) ? state.market.dte : null;
}

/**
 * Mirrors management-action-frontier.ts's own `structuralExpirationSelection`
 * condition EXACTLY (dte===0, broker session confirmed closed, spot/
 * strike/optionType all known). `buildManagementActionFrontier` only
 * engages that already-correct, already-tested LET_EXPIRE-vs-
 * ACCEPT_ASSIGNMENT/ALLOW_CALL_AWAY-vs-HOLD_CC broker-truth selection
 * when it receives NO policy evidence (`evidence === null`) -- this
 * bootstrap policy must therefore explicitly STEP ASIDE (return null,
 * not merely a tied utility=0) at this exact moment, or its own
 * always-non-null evidence would silently override that mechanism and
 * let HOLD win a tiebreak against the one action broker truth has
 * already made feasible. Before this exact point, this policy's own
 * CLOSE_FULL/ROLL comparison remains fully active -- this guard affects
 * ONLY the precise dte=0/session-closed instant, nothing earlier.
 */
function atStructuralExpirationCutoff(state: ManagementInputState): boolean {
  return state.market.dte === 0 && state.market.marketOpen === false
    && state.market.spot !== null && state.contract.strike !== null && state.contract.optionType !== null;
}

function capitalCommitted(state: ManagementInputState): number | null {
  const { strike, multiplier, contracts } = state.contract;
  if (state.lifecycleState === 'CSP_OPEN') {
    if (!finite(strike) || !finite(multiplier) || !finite(contracts)) return null;
    return strike * multiplier * contracts;
  }
  if (state.economics.stockBasisPerShare !== null && state.economics.openStockShares > 0) {
    return state.economics.stockBasisPerShare * state.economics.openStockShares;
  }
  return null;
}

const UNKNOWN_VALUE: Omit<ManagementPolicyActionValue, 'action'> = {
  expectedFutureValue: null, downsideTailEstimate: null, incrementalCapitalDays: null,
  executionCostRisk: null, opportunityCost: null, uncertainty: null, utility: null,
  executionEvidence: null, reasons: ['DETERMINISTIC_INPUT_INCOMPLETE'],
};

const THESIS_FAILURE_CLASSIFICATIONS = new Set<ThesisInvalidationAssessment['classification']>([
  'THESIS_FAILURE_SUSPECTED', 'THESIS_FAILURE_AND_PRICE_LOSS',
]);

/**
 * Reads the SEPARATE thesis classification (never the dollar loss itself)
 * to produce a continuous utility adjustment. `bias` of 0 (the default)
 * makes this fully inert -- classification never affects ranking unless
 * the caller explicitly supplies a justified non-zero value. This is the
 * mechanism the directive requires: PRICE_LOSS and THESIS_HEALTH stay
 * structurally separate all the way through, and thesis state never acts
 * as a single boolean magic gate -- it only nudges an ordinal comparison
 * that the position's own forward economics still dominate.
 */
function thesisUtilityAdjustment(thesis: ThesisInvalidationAssessment, bias: number): {
  readonly closeBias: number; readonly rollPenalty: number; readonly failurePresent: boolean; readonly reasons: readonly string[];
} {
  const failurePresent = THESIS_FAILURE_CLASSIFICATIONS.has(thesis.classification);
  const reasons = [
    `PRICE_LOSS_KNOWN_${thesis.priceLossKnown}`,
    `THESIS_CLASSIFICATION_${thesis.classification}`,
    ...(failurePresent ? thesis.thesisFailureSignals : []),
    ...(thesis.uninterpretedSignals.length > 0 ? [`THESIS_UNCERTAINTY_SIGNALS_${thesis.uninterpretedSignals.length}`] : []),
  ];
  return { closeBias: failurePresent ? bias : 0, rollPenalty: failurePresent ? bias : 0, failurePresent, reasons };
}

function valueForSingleRollCandidate(
  action: 'ROLL' | 'ROLL_CC', state: PaperBootstrapPolicyInput, currentMark: number | null, midMark: number | null,
  thesis: ThesisInvalidationAssessment,
): ManagementPolicyActionValue {
  const base = { action };
  const candidate = action === 'ROLL' ? state.rollCandidate : state.ccCandidate;
  const hasQuote = !!candidate && finite(candidate.bid) && finite(candidate.ask)
    && candidate.bid >= 0 && candidate.ask >= candidate.bid;
  if (!candidate || !hasQuote || currentMark === null) {
    return { ...base, ...UNKNOWN_VALUE, reasons: ['NO_IDENTIFIED_ROLL_TARGET'] };
  }
  // Conservative, executable reference for OPENING the new short leg: the
  // BID side, never the midpoint -- a midpoint premium is not a
  // guaranteed fill. The midpoint is reported below only as an
  // informational reason, never fed into the economics.
  const openCreditDollars = candidate.bid * candidate.multiplier * candidate.quantity;
  const openCreditMidDollars = (candidate.bid + candidate.ask) / 2 * candidate.multiplier * candidate.quantity;
  // Sunk (already-realized) economics are deliberately NOT read anywhere in
  // this block -- forwardContinuationCashFlow only ever sees the two
  // current-quote dollar boundaries, so the old leg's realized P&L cannot
  // be silently re-added into this roll's forward comparison.
  const forward = forwardContinuationCashFlow({ closeCostDollars: currentMark, openCreditDollars });
  const netCredit = forward.netCashFlow as number; // complete=true guaranteed: both legs are known here
  const horizon = buildCommonHorizonComparison(state.observedAt, state.economics, state.contract.expiration, [candidate.expiration]);
  const adjustment = thesisUtilityAdjustment(thesis, state.thesisFailureUtilityBias ?? 0);
  const executionEvidence: ManagementActionExecutionEvidence = {
    closeEconomicBoundary: currentMark, openEconomicBoundary: openCreditDollars, stockEconomicBoundary: null,
    economicsRemainPositive: netCredit >= 0, expectedAfterCostEv: null, empiricalEconomicsReady: false,
    deterministicEconomicsValidated: true, deterministicNetCredit: netCredit,
    targetContract: {
      symbol: candidate.symbol, optionContractId: candidate.optionContractId, optionType: candidate.optionType,
      multiplier: candidate.multiplier, quantity: candidate.quantity,
    },
  };
  return {
    ...base, expectedFutureValue: null, downsideTailEstimate: null,
    incrementalCapitalDays: null, executionCostRisk: Math.abs(currentMark) + Math.abs(openCreditDollars) * 0.01,
    opportunityCost: null, uncertainty: null,
    // a net-debit roll never outranks passive HOLD under this bootstrap
    // policy; a suspected thesis failure additionally penalizes extending
    // exposure via `rollPenalty` (0 unless the caller supplied a bias).
    utility: (netCredit >= 0 ? 0.5 : -2) - adjustment.rollPenalty,
    executionEvidence,
    reasons: [`DETERMINISTIC_NET_CREDIT_${netCredit.toFixed(2)}`, `HORIZON_ANCHOR_${horizon.horizonAnchor ?? 'UNKNOWN'}`,
      `OPEN_CREDIT_BID_SIDE_${openCreditDollars.toFixed(2)}`, `OPEN_CREDIT_MID_REFERENCE_ANALYTICAL_ONLY_${openCreditMidDollars.toFixed(2)}`,
      `CLOSE_COST_ASK_SIDE_${currentMark.toFixed(2)}`, `CLOSE_COST_MID_REFERENCE_ANALYTICAL_ONLY_${midMark === null ? 'UNKNOWN' : midMark.toFixed(2)}`,
      'SUNK_REALIZED_PNL_EXCLUDED_FROM_FORWARD_COMPARISON', ...adjustment.reasons],
  };
}

/**
 * Compares multiple ALTERNATIVE roll targets (different strike/expiry) via
 * `RollIncrementalUtility` instead of only ever evaluating one pre-picked
 * candidate. Old-leg economics (close cost, strike, expiration, delta,
 * capital committed) and the sunk realized P&L are preserved explicitly on
 * every assessment rather than being collapsed away.
 */
function valueForRollFromCandidates(
  action: 'ROLL', state: PaperBootstrapPolicyInput, currentMark: number, midMark: number | null, thesis: ThesisInvalidationAssessment,
): ManagementPolicyActionValue {
  const base = { action };
  const candidates = state.rollCandidates ?? [];
  const usable = candidates.filter((candidate): candidate is RollCandidate & { bid: number; ask: number } =>
    finite(candidate.bid) && finite(candidate.ask) && candidate.bid >= 0 && candidate.ask >= candidate.bid);
  if (usable.length === 0) return { ...base, ...UNKNOWN_VALUE, reasons: ['NO_USABLE_ROLL_CANDIDATES_IN_LIST'] };

  const oldLeg = {
    closeCostDollars: currentMark, strike: state.contract.strike, expiration: state.contract.expiration,
    delta: state.market.delta, capitalCommittedDollars: capitalCommitted(state),
  };
  const sunk = sunkRealizedEconomics(state.economics);
  // Conservative, executable reference for each candidate's new-leg
  // opening credit: BID side, never the midpoint (see
  // valueForSingleRollCandidate's identical rule).
  const candidateEconomics: RollCandidateEconomics[] = usable.map((candidate) => ({
    symbol: candidate.symbol, optionContractId: candidate.optionContractId, strike: candidate.strike,
    expiration: candidate.expiration, delta: null,
    openCreditDollars: candidate.bid * candidate.multiplier * candidate.quantity,
    capitalCommittedDollars: candidate.strike * candidate.multiplier * candidate.quantity,
  }));
  const comparison = evaluateRollCandidates(oldLeg, sunk, candidateEconomics, state.rollIncrementalCapitalDayWeight ?? 0);
  if (comparison.bestCandidate === null) {
    return { ...base, ...UNKNOWN_VALUE, reasons: ['ROLL_CANDIDATE_COMPARISON_INCOMPLETE'] };
  }
  const best = comparison.bestCandidate;
  const matchedSource = usable.find((candidate) => candidate.optionContractId === best.candidate.optionContractId);
  if (matchedSource === undefined) return { ...base, ...UNKNOWN_VALUE, reasons: ['ROLL_CANDIDATE_MATCH_FAILED'] };
  const netCredit = best.netCreditDollars as number;
  const adjustment = thesisUtilityAdjustment(thesis, state.thesisFailureUtilityBias ?? 0);
  const executionEvidence: ManagementActionExecutionEvidence = {
    closeEconomicBoundary: currentMark, openEconomicBoundary: best.candidate.openCreditDollars, stockEconomicBoundary: null,
    economicsRemainPositive: comparison.bestBeatsHold, expectedAfterCostEv: null, empiricalEconomicsReady: false,
    deterministicEconomicsValidated: true, deterministicNetCredit: netCredit,
    targetContract: {
      symbol: matchedSource.symbol, optionContractId: matchedSource.optionContractId, optionType: matchedSource.optionType,
      multiplier: matchedSource.multiplier, quantity: matchedSource.quantity,
    },
  };
  return {
    ...base, expectedFutureValue: null, downsideTailEstimate: null, incrementalCapitalDays: best.daysExtended,
    executionCostRisk: Math.abs(currentMark) + Math.abs(best.candidate.openCreditDollars ?? 0) * 0.01,
    opportunityCost: null, uncertainty: null,
    // A roll is preferred only when its RollIncrementalUtility clears the
    // same HOLD baseline (0) every other bootstrap action is compared
    // against -- never merely because netCredit >= 0 -- and a suspected
    // thesis failure additionally penalizes it via `rollPenalty`.
    utility: (comparison.bestBeatsHold ? 0.5 : -2) - adjustment.rollPenalty,
    executionEvidence,
    reasons: [`BEST_OF_${usable.length}_ROLL_CANDIDATES`, ...best.reasons,
      `CLOSE_COST_ASK_SIDE_${currentMark.toFixed(2)}`, `CLOSE_COST_MID_REFERENCE_ANALYTICAL_ONLY_${midMark === null ? 'UNKNOWN' : midMark.toFixed(2)}`,
      `SUNK_REALIZED_PNL_${sunk === null ? 'UNKNOWN' : sunk.toFixed(2)}_EXCLUDED_FROM_FORWARD_COMPARISON`, ...adjustment.reasons],
  };
}

/**
 * Compares multiple ALTERNATIVE covered-call targets on whole-chain
 * economics (via covered-call-lattice.ts) instead of only ever evaluating
 * one pre-picked candidate. Whole-chain components this bootstrap policy
 * cannot honestly know from `ManagementInputState` alone (initial put
 * premium, roll credits/close costs from an earlier leg of THIS chain) are
 * passed as `null` -- `wholeChainPnlIfCalledAway`/`IfNotCalled` then stay
 * honestly UNKNOWN rather than fabricated, while the candidate's own
 * premium/call-away-price/below-basis facts remain fully known and usable
 * for selection.
 */
function valueForSellCcFromCandidates(state: PaperBootstrapPolicyInput, basis: number | null): ManagementPolicyActionValue {
  const base = { action: 'SELL_CC' as const };
  const candidates = state.ccCandidates ?? [];
  if (!finite(basis) || candidates.length === 0) {
    return { ...base, ...UNKNOWN_VALUE, reasons: ['NO_IDENTIFIED_CC_CANDIDATE'] };
  }
  const latticeCandidates: CoveredCallCandidate[] = candidates.map((candidate) => ({
    symbol: candidate.symbol, optionContractId: candidate.optionContractId, strike: candidate.strike,
    expiration: candidate.expiration, delta: null, bid: candidate.bid, ask: candidate.ask,
    multiplier: candidate.multiplier, quantity: candidate.quantity,
    openInterest: null, volume: null,
    dividendExDateRisk: candidate.dividendExDateRisk ?? false, eventRisk: candidate.eventRisk ?? false,
  }));
  const wholeChainBase = {
    initialPutPremium: null, rollCredits: null, rollCloseCosts: null, assignmentStrike: basis,
    stockSharesAssigned: state.economics.openStockShares, dividends: state.economics.dividends,
    fees: state.economics.fees ?? 0, slippage: null,
  };
  const assessments = evaluateCoveredCallCandidates(
    basis, state.economics.stockMarkPerShare, state.economics.openStockShares, wholeChainBase, latticeCandidates,
    state.ccUtilityWeights ?? DEFAULT_CC_UTILITY_WEIGHTS,
  );
  const best = bestCoveredCallCandidate(assessments, false);
  if (best === null) {
    return { ...base, ...UNKNOWN_VALUE, reasons: ['NO_SELECTABLE_CC_CANDIDATES_ALL_BELOW_BASIS_OR_UNQUOTED'] };
  }
  const premiumDollars = best.premiumIncomeDollars as number;
  const executionEvidence: ManagementActionExecutionEvidence = {
    closeEconomicBoundary: null, openEconomicBoundary: premiumDollars, stockEconomicBoundary: null,
    economicsRemainPositive: premiumDollars > 0, expectedAfterCostEv: null, empiricalEconomicsReady: false,
    deterministicEconomicsValidated: true, deterministicNetCredit: premiumDollars,
    targetContract: {
      symbol: best.candidate.symbol, optionContractId: best.candidate.optionContractId, optionType: 'CALL',
      multiplier: best.candidate.multiplier, quantity: best.candidate.quantity,
    },
  };
  // No permanent "SELL_CC beats RECOVERY_WAIT" law: utility scales with
  // the ACTUAL known premium via a required, caller-justified weight
  // (default 0/neutral, matching every other weight in this file) --
  // never a flat constant that would make any positive premium
  // automatically win regardless of size or genuine attractiveness.
  const ccWeight = state.sellCcPremiumUtilityWeight ?? 0;
  return {
    ...base, expectedFutureValue: null, downsideTailEstimate: null, incrementalCapitalDays: null,
    executionCostRisk: premiumDollars * 0.01, opportunityCost: null, uncertainty: null,
    utility: ccWeight * premiumDollars, executionEvidence,
    reasons: [`BEST_OF_${candidates.length}_CC_CANDIDATES_BY_UTILITY`, `SELL_CC_UTILITY_WEIGHT_${ccWeight}`, ...best.reasons],
  };
}

/**
 * Builds a deterministic value for one action. `utility` here is NEVER a
 * dollar EV estimate -- it is an ORDINAL score (higher = more consistent
 * with continuing to hold less exposed/more resolved risk) built only from
 * known quantities, used solely to rank actions THIS policy is choosing
 * between, never presented as a forecasted return. Every action not given
 * a real utility here reports UNKNOWN honestly via `UNKNOWN_VALUE`.
 */
function valueFor(
  action: ManagementFrontierAction, state: PaperBootstrapPolicyInput, currentMark: number | null, midMark: number | null,
  executableFraction: number | null, analyticalFraction: number | null, dte: number | null, capital: number | null,
  thesis: ThesisInvalidationAssessment, recoveryState: RecoveryState,
): ManagementPolicyActionValue {
  const base = { action };
  switch (action) {
    case 'HOLD':
    case 'HOLD_CC': {
      // Passive: the deterministic case for continuing is exactly "we have
      // not found a concrete, known reason to act." Utility 0 is the
      // neutral anchor every other action's score is compared against --
      // thesis classification is surfaced for transparency but never moves
      // this baseline; only CLOSE/ROLL react to it.
      return {
        ...base, ...UNKNOWN_VALUE, utility: 0,
        reasons: ['NO_KNOWN_REASON_TO_ACT', `THESIS_CLASSIFICATION_${thesis.classification}`],
      };
    }
    case 'RECOVERY_WAIT': {
      // Same passive baseline as HOLD/HOLD_CC, with RecoveryState's known
      // (never fabricated) distance-to-basis/capital-days surfaced purely
      // as transparency -- it never shifts this action's own utility.
      return {
        ...base, ...UNKNOWN_VALUE, utility: 0,
        reasons: [
          'NO_KNOWN_REASON_TO_ACT',
          `DISTANCE_TO_BASIS_FRACTION_${recoveryState.distanceToBasisFraction === null ? 'UNKNOWN' : recoveryState.distanceToBasisFraction.toFixed(4)}`,
          `CAPITAL_DAYS_SO_FAR_${recoveryState.capitalDaysSoFar === null ? 'UNKNOWN' : recoveryState.capitalDaysSoFar.toFixed(1)}`,
          'RECOVERY_PROBABILITY_NOT_MODELED_NO_FABRICATED_ESTIMATE',
        ],
      };
    }
    case 'CLOSE_FULL':
    case 'CLOSE_CC': {
      if (currentMark === null || dte === null) return { ...base, ...UNKNOWN_VALUE };
      // A deterministic (not statistical) preference for closing: remaining
      // extrinsic value is a small, KNOWN fraction of what was collected,
      // and very little time remains -- continuing to hold risks gamma/
      // pin/assignment surprise for little further known gain. This is a
      // DESCRIPTIVE observation about a KNOWN remaining-value fraction, not
      // a fixed universal profit-target percentage (the threshold itself
      // must be supplied by the caller, never invented here).
      // EXECUTION-timing trigger: is it now cheap to ACT, using the
      // conservative executable close-cost estimate. This never uses the
      // analytical fraction -- a wide spread making execution expensive
      // is a real execution-cost fact, distinct from analytical P&L.
      const nearExhausted = executableFraction !== null && executableFraction <= 0.10 && dte <= 5;
      // Informational only -- surfaces the ANALYTICAL loss-magnitude
      // signal (neutral mark vs. entry credit), never the execution-cost
      // fraction, so a widening ask alone can never manufacture a false
      // analytical loss claim. The dollar loss magnitude itself NEVER
      // decides this action; only `adjustment.closeBias` (driven purely
      // by the SEPARATE thesis classification) can shift this utility,
      // and it defaults to 0 (inert) unless the caller supplies a
      // justified bias.
      const lossMagnitudeReason = analyticalFraction !== null && analyticalFraction > 1
        ? [`ANALYTICAL_MARK_EXCEEDS_ENTRY_CREDIT_FRACTION_${analyticalFraction.toFixed(2)}`] : [];
      const adjustment = thesisUtilityAdjustment(thesis, state.thesisFailureUtilityBias ?? 0);
      // When CLOSE_FULL is being weighed on a short put that is genuinely
      // ITM (assignment-relevant), surface assignment-utility.ts's own
      // known facts (secured cash, ownership-quality data presence) as
      // transparency -- consuming the real module rather than leaving it
      // standalone. This NEVER changes CLOSE_FULL's own utility; the
      // module's own ACCEPT_ASSIGNMENT valuation is deliberately neutral
      // (0) and makes no claim about the resulting stock position, so
      // there is nothing here that could legitimately shift a number.
      const spot = state.market.spot, strike = state.contract.strike;
      const isItmShortPut = action === 'CLOSE_FULL' && spot !== null && strike !== null && spot < strike;
      const assignmentReasons = isItmShortPut
        ? (() => {
            const rollCandidate = state.rollCandidate;
            const assignment = evaluateAssignmentUtility(state, currentMark,
              rollCandidate && finite(rollCandidate.bid) && finite(rollCandidate.ask)
                ? { openCreditDollars: rollCandidate.bid * rollCandidate.multiplier * rollCandidate.quantity } : null);
            return [
              `ASSIGNMENT_RELEVANT_ITM_SHORT_PUT`,
              `SECURED_CASH_IF_ASSIGNED_${assignment.assignmentState.securedCashDollars === null ? 'UNKNOWN' : assignment.assignmentState.securedCashDollars.toFixed(2)}`,
              `OWNERSHIP_QUALITY_DATA_PRESENT_${assignment.assignmentState.ownershipQualityPresent}`,
              `ASSIGNMENT_ALTERNATIVE_BEST_ACTION_${assignment.best?.action ?? 'UNKNOWN'}`,
            ];
          })()
        : [];
      return {
        ...base, expectedFutureValue: null, downsideTailEstimate: null, incrementalCapitalDays: 0,
        executionCostRisk: currentMark, opportunityCost: null,
        uncertainty: thesis.uninterpretedSignals.length > 0 ? thesis.uninterpretedSignals.length : null,
        utility: (nearExhausted ? 1 : -1) + adjustment.closeBias,
        executionEvidence: null,
        reasons: [
          ...(nearExhausted
            ? [`EXECUTABLE_REMAINING_VALUE_FRACTION_${executableFraction?.toFixed(2)}`, `DTE_${dte}`, 'CLOSE_FREES_CAPITAL_FOR_NEAR_EXHAUSTED_POSITION']
            : ['EXECUTABLE_REMAINING_VALUE_NOT_KNOWN_EXHAUSTED', ...lossMagnitudeReason]),
          `CLOSE_COST_ASK_SIDE_${currentMark.toFixed(2)}`, `CLOSE_COST_MID_REFERENCE_ANALYTICAL_ONLY_${midMark === null ? 'UNKNOWN' : midMark.toFixed(2)}`,
          ...assignmentReasons, ...adjustment.reasons,
        ],
      };
    }
    case 'ROLL': {
      if (state.rollCandidates !== undefined && state.rollCandidates.length > 0 && currentMark !== null) {
        return valueForRollFromCandidates(action, state, currentMark, midMark, thesis);
      }
      return valueForSingleRollCandidate(action, state, currentMark, midMark, thesis);
    }
    case 'ROLL_CC': {
      return valueForSingleRollCandidate(action, state, currentMark, midMark, thesis);
    }
    case 'ALLOW_CALL_AWAY':
      // Structural expiration handling already selects this correctly from
      // broker-confirmed moneyness; this policy adds no competing claim.
      return { ...base, ...UNKNOWN_VALUE, utility: 0, reasons: ['DEFERRED_TO_STRUCTURAL_EXPIRATION_HANDLING'] };
    case 'LET_EXPIRE':
    case 'ACCEPT_ASSIGNMENT':
      return { ...base, ...UNKNOWN_VALUE, utility: 0, reasons: ['DEFERRED_TO_STRUCTURAL_EXPIRATION_HANDLING'] };
    case 'SELL_STOCK': {
      // The ONE canonical effective basis (RecoveryState.effectiveBasisPerShare,
      // itself sourced from computeEffectiveStockBasis when full chain
      // history is supplied) -- never a second, independently-derived
      // basis figure for this action.
      const basis = recoveryState.effectiveBasisPerShare, mark = state.economics.stockMarkPerShare;
      if (!finite(basis) || !finite(mark) || capital === null) return { ...base, ...UNKNOWN_VALUE };
      const knownStockPnl = (mark - basis) * state.economics.openStockShares;
      const adjustment = thesisUtilityAdjustment(thesis, state.thesisFailureUtilityBias ?? 0);
      // Neutral baseline (0, the SAME anchor as RECOVERY_WAIT/HOLD) -- this
      // bootstrap policy no longer carries a permanent handicap against
      // liquidating the shares. SELL_STOCK can win when the SEPARATE,
      // caller-justified mechanisms below actually apply:
      //   (a) a suspected thesis failure -- reuses the exact same
      //       thesisFailureUtilityBias already governing CLOSE_FULL/ROLL,
      //       never a second, independently-invented bias.
      //   (b) a known, real capital opportunity cost (from
      //       RecoveryState.capitalOpportunityCostDollars, itself only
      //       computed when the caller supplied entry data + a justified
      //       annual rate) times a caller-justified weight -- an honest,
      //       quantified economic reason, never a fabricated one.
      // Both default to 0/neutral. Neither is invented internally.
      const opportunityCostWeight = state.sellStockOpportunityCostUtilityWeight ?? 0;
      const opportunityCostContribution = recoveryState.capitalOpportunityCostDollars !== null
        ? opportunityCostWeight * recoveryState.capitalOpportunityCostDollars : 0;
      return {
        ...base, expectedFutureValue: null, downsideTailEstimate: null, incrementalCapitalDays: 0,
        executionCostRisk: null, opportunityCost: recoveryState.capitalOpportunityCostDollars, uncertainty: null,
        utility: adjustment.closeBias + opportunityCostContribution,
        executionEvidence: null,
        reasons: [
          `KNOWN_STOCK_PNL_IF_SOLD_${knownStockPnl.toFixed(2)}`,
          `DISTANCE_TO_BASIS_FRACTION_${recoveryState.distanceToBasisFraction === null ? 'UNKNOWN' : recoveryState.distanceToBasisFraction.toFixed(4)}`,
          `CAPITAL_OPPORTUNITY_COST_${recoveryState.capitalOpportunityCostDollars === null ? 'UNKNOWN' : recoveryState.capitalOpportunityCostDollars.toFixed(2)}`,
          ...adjustment.reasons,
        ],
      };
    }
    case 'SELL_CC': {
      if (state.ccCandidates !== undefined && state.ccCandidates.length > 0) {
        return valueForSellCcFromCandidates(state, recoveryState.effectiveBasisPerShare);
      }
      // Same ONE canonical basis as SELL_STOCK -- never a second formula.
      const candidate = state.ccCandidate, basis = recoveryState.effectiveBasisPerShare;
      if (!candidate || !finite(candidate.bid) || !finite(candidate.ask) || !finite(basis)) {
        return { ...base, ...UNKNOWN_VALUE, reasons: ['NO_IDENTIFIED_CC_CANDIDATE'] };
      }
      // Deterministic, sensible guard: never write a covered call at a
      // strike below the stock's own known cost basis -- that would lock
      // in a loss regardless of the premium collected. This is an
      // arithmetic safety rule, not a profitability forecast.
      if (candidate.strike < basis) {
        return { ...base, ...UNKNOWN_VALUE, utility: -3, reasons: ['CC_STRIKE_BELOW_KNOWN_COST_BASIS_REJECTED'] };
      }
      // Conservative, executable reference: the BID side, never the
      // midpoint -- a midpoint premium must never silently become the
      // number this policy treats as realizable income (see
      // covered-call-lattice.ts's same fix). The midpoint is retained
      // below only as an informational reason code, never as the value
      // driving economics or selection.
      const midDollars = (candidate.bid + candidate.ask) / 2 * candidate.multiplier * candidate.quantity;
      const forward = forwardContinuationCashFlow({ closeCostDollars: null, openCreditDollars:
        candidate.bid * candidate.multiplier * candidate.quantity });
      const premiumDollars = forward.netCashFlow as number;
      const horizon = buildCommonHorizonComparison(state.observedAt, state.economics, null, [candidate.expiration]);
      const executionEvidence: ManagementActionExecutionEvidence = {
        closeEconomicBoundary: null, openEconomicBoundary: premiumDollars, stockEconomicBoundary: null,
        economicsRemainPositive: premiumDollars > 0, expectedAfterCostEv: null, empiricalEconomicsReady: false,
        deterministicEconomicsValidated: true, deterministicNetCredit: premiumDollars,
        targetContract: {
          symbol: candidate.symbol, optionContractId: candidate.optionContractId, optionType: candidate.optionType,
          multiplier: candidate.multiplier, quantity: candidate.quantity,
        },
      };
      // Same no-permanent-law rule as the multi-candidate path above.
      const ccWeight = state.sellCcPremiumUtilityWeight ?? 0;
      return {
        ...base, expectedFutureValue: null, downsideTailEstimate: null, incrementalCapitalDays: null,
        executionCostRisk: premiumDollars * 0.01, opportunityCost: null, uncertainty: null,
        utility: ccWeight * premiumDollars, executionEvidence,
        reasons: [`BID_SIDE_EXECUTABLE_REFERENCE_${premiumDollars.toFixed(2)}`, `MID_REFERENCE_ANALYTICAL_ONLY_${midDollars.toFixed(2)}`,
          'STRIKE_AT_OR_ABOVE_COST_BASIS', `HORIZON_ANCHOR_${horizon.horizonAnchor ?? 'UNKNOWN'}`, `SELL_CC_UTILITY_WEIGHT_${ccWeight}`],
      };
    }
    case 'REDEPLOY':
      // This bootstrap policy never claims a redeployment target has known
      // economics -- REDEPLOY always remains UNKNOWN here, matching the
      // frontier's own structural CURRENT_EXPOSURE_NOT_RESOLVED blocker.
      return { ...base, ...UNKNOWN_VALUE };
    default:
      return { ...base, ...UNKNOWN_VALUE };
  }
}

/**
 * The single entry point. Returns null (never a fabricated frontier) when
 * the lifecycle state has no bootstrap-covered action set, or when every
 * candidate action's value is UNKNOWN (nothing to rank).
 */
export function evaluatePaperBootstrapManagementPolicy(
  state: PaperBootstrapPolicyInput,
): ManagementPolicyEvidence | null {
  // Defer entirely to the frontier's own structural expiration mechanism
  // at the exact broker-truth cutoff -- see atStructuralExpirationCutoff's
  // doc comment for why this must be an explicit null, not a competing
  // (and tie-losing) utility value.
  if (atStructuralExpirationCutoff(state)) return null;

  const frontier = buildManagementActionFrontier(state);
  const actionSet = frontier.actions.map((action) => action.action);
  if (actionSet.length === 0) return null;

  const currentMark = estimatedExecutableCloseCostDollars(state);
  const midMark = midReferenceDollars(state);
  const analyticalMark = analyticalOptionMarkDollars(state);
  // Two structurally distinct fractions -- see executableRemainingValueFraction/
  // analyticalRemainingValueFraction's own doc comments. A widening ask
  // must never manufacture a false analytical loss signal.
  const executableFraction = executableRemainingValueFraction(state, currentMark);
  const analyticalFraction = analyticalRemainingValueFraction(state, analyticalMark);
  const dte = daysToExpiration(state);
  const capital = capitalCommitted(state);
  // Computed once per state, shared by every action -- the SAME thesis
  // read is never re-derived per action, so a HOLD/CLOSE/ROLL comparison
  // can never see a different thesis picture than another.
  const thesis = assessThesisInvalidation(state);
  const recoveryState = buildRecoveryState(
    state, state.assignedAtObservedAt ?? null, state.annualOpportunityCostRate ?? null, state.wholeChainComponents ?? null,
  );

  const actionValues = actionSet.map((action) =>
    valueFor(action, state, currentMark, midMark, executableFraction, analyticalFraction, dte, capital, thesis, recoveryState));
  const known = actionValues.filter((value) => value.utility !== null);
  if (known.length === 0) return null;

  // Only actions the base frontier already reports FEASIBLE or UNKNOWN
  // (never INFEASIBLE -- this policy proposes no override of a hard
  // structural blocker) are eligible for selection.
  const eligible = new Set(frontier.actions
    .filter((action) => action.feasibility !== 'INFEASIBLE')
    .map((action) => action.action));
  const ranked = known.filter((value) => eligible.has(value.action))
    .sort((left, right) => (right.utility as number) - (left.utility as number));
  const selected = ranked[0];
  if (selected === undefined) return null;

  const unsigned = {
    contractVersion: managementPolicyEvidenceVersion, inputContentHash: state.contentHash, decidedAt: state.observedAt,
    policyVersion: paperBootstrapManagementPolicyVersion, comparisonComplete: true,
    selectedAction: selected.action, actionValues,
    reasonCodes: ['BOOTSTRAP_DETERMINISTIC_NO_EMPIRICAL_CLAIM', ...selected.reasons],
  };
  return unsigned;
}

/**
 * Candidate lookup: supplies an already-identified roll/covered-call target
 * for a chain, if one exists. This policy never searches a contract lattice
 * itself -- that enumeration belongs to the strategy-router/execution
 * domain. Returning `null` for either field is always safe; it degrades the
 * corresponding action to UNKNOWN rather than fabricating a target.
 */
export interface PaperBootstrapCandidateSource {
  candidatesFor(chainId: string): Promise<{
    readonly rollCandidate: RollCandidate | null;
    readonly ccCandidate: RollCandidate | null;
  }>;
}

const noCandidates: PaperBootstrapCandidateSource = {
  async candidatesFor() { return { rollCandidate: null, ccCandidate: null }; },
};

/**
 * Wires `evaluatePaperBootstrapManagementPolicy` into the
 * `ManagementPolicyEvidenceProvider` contract `buildRuntimeManagementFrontiers`
 * (autonomous-runtime.ts) expects, without changing that runtime wiring at
 * all -- this class is a drop-in `dependencies.managementPolicyEvidenceProvider`.
 */
export class PaperBootstrapManagementPolicyProvider implements ManagementPolicyEvidenceProvider {
  constructor(private readonly candidates: PaperBootstrapCandidateSource = noCandidates) {}

  async evaluate(state: ManagementInputState): Promise<ManagementPolicyEvidence | null> {
    const { rollCandidate, ccCandidate } = await this.candidates.candidatesFor(state.chainId);
    return evaluatePaperBootstrapManagementPolicy({ ...state, rollCandidate, ccCandidate });
  }
}
