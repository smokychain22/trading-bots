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
import { buildRecoveryState, type BasisSource, type RecoveryState } from './recovery-state.js';
import { evaluateAssignmentUtility } from './assignment-utility.js';
import { computeWholeChainPnl, type WholeChainComponents } from './whole-chain-economics.js';
import { type EventRiskState } from './event-risk-state.js';
import {
  BOOTSTRAP_NEUTRAL_CC_WEIGHT_PROVENANCE, bestCoveredCallCandidate, evaluateCoveredCallCandidates,
  type CoveredCallCandidate, type CoveredCallUtilityWeights,
} from './covered-call-lattice.js';

const DEFAULT_CC_UTILITY_WEIGHTS: CoveredCallUtilityWeights = {
  upsideSacrificePerDollarWeight: 0, spreadPerDollarWeight: 0, eventRiskPenalty: 0,
  dividendExDateRiskPenalty: 0, belowBasisPenalty: 0, provenance: BOOTSTRAP_NEUTRAL_CC_WEIGHT_PROVENANCE,
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
   * for ROLL. Defaults to `UNKNOWN` (never `ABSENT_VERIFIED`) when omitted
   * -- an omitted risk flag means nobody checked, which must never be
   * silently read as "verified safe." */
  readonly dividendExDateRisk?: EventRiskState;
  readonly eventRisk?: EventRiskState;
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
  /**
   * Optional ALTERNATIVE ROLL_CC targets (different call strike/expiry).
   * When supplied, ROLL_CC is evaluated across all of them via
   * `valueForRollCcFromCandidates` (NetRollCredit + AdditionalUpsideDollars,
   * neither deciding alone) rather than the single `ccCandidate` path used
   * by `valueForSingleRollCandidate`. Falls back to that single-candidate
   * path when absent/empty (fully backward compatible).
   */
  readonly rollCcCandidates?: readonly RollCandidate[];
  /**
   * Required, caller-justified weight converting a ROLL_CC candidate's
   * KNOWN `AdditionalUpsideDollars` (the strike-distance gained or given
   * up, in dollars) into a comparable contribution alongside its
   * `NetRollCredit`. Defaults to 0 (the comparison reduces to pure net
   * credit, matching ROLL's own default) when omitted -- never invented
   * internally. A non-zero, caller-justified value lets a debit roll that
   * purchases real strike upside outrank a shallow credit roll that
   * surrenders more upside than the credit is worth, and vice versa --
   * exactly the "neither decides alone" requirement.
   */
  readonly rollCcAdditionalUpsideDollarWeight?: number;
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
 * Compares multiple ALTERNATIVE ROLL_CC targets (different call strike/
 * expiry) on BOTH `NetRollCredit` (old call's ask-side close cost vs. the
 * new call's bid-side opening credit) AND `AdditionalUpsideDollars` (the
 * strike distance gained or given up, in dollars) -- neither decides
 * alone. A debit roll (`NetRollCredit < 0`) can still be the best
 * candidate when it purchases enough real, known strike upside; a credit
 * roll can still lose to a smaller-credit alternative when it sacrifices
 * more upside than the credit is worth. `rollCcAdditionalUpsideDollarWeight`
 * is the required, caller-justified conversion between the two -- 0 (the
 * default) reduces this to the same pure-net-credit rule ROLL itself uses
 * when uninformed.
 */
function valueForRollCcFromCandidates(
  state: PaperBootstrapPolicyInput, currentMark: number, midMark: number | null, thesis: ThesisInvalidationAssessment,
): ManagementPolicyActionValue {
  const base = { action: 'ROLL_CC' as const };
  const candidates = state.rollCcCandidates ?? [];
  const usable = candidates.filter((candidate): candidate is RollCandidate & { bid: number; ask: number } =>
    finite(candidate.bid) && finite(candidate.ask) && candidate.bid >= 0 && candidate.ask >= candidate.bid);
  if (usable.length === 0) return { ...base, ...UNKNOWN_VALUE, reasons: ['NO_USABLE_ROLL_CC_CANDIDATES_IN_LIST'] };

  const oldStrike = state.contract.strike;
  const upsideWeight = state.rollCcAdditionalUpsideDollarWeight ?? 0;
  const assessments = usable.map((candidate) => {
    const newCreditDollars = candidate.bid * candidate.multiplier * candidate.quantity;
    const newCreditMidDollars = (candidate.bid + candidate.ask) / 2 * candidate.multiplier * candidate.quantity;
    const forward = forwardContinuationCashFlow({ closeCostDollars: currentMark, openCreditDollars: newCreditDollars });
    const netRollCredit = forward.netCashFlow as number; // complete=true guaranteed: both legs known here
    const additionalUpsideDollars = finite(oldStrike)
      ? (candidate.strike - oldStrike) * candidate.multiplier * candidate.quantity : null;
    const combinedScore = additionalUpsideDollars === null ? netRollCredit : netRollCredit + upsideWeight * additionalUpsideDollars;
    return { candidate, newCreditDollars, newCreditMidDollars, netRollCredit, additionalUpsideDollars, combinedScore };
  });
  const best = assessments.reduce((champion, candidate) => candidate.combinedScore > champion.combinedScore ? candidate : champion);
  const beatsHold = best.combinedScore > 0;
  const adjustment = thesisUtilityAdjustment(thesis, state.thesisFailureUtilityBias ?? 0);
  const executionEvidence: ManagementActionExecutionEvidence = {
    closeEconomicBoundary: currentMark, openEconomicBoundary: best.newCreditDollars, stockEconomicBoundary: null,
    economicsRemainPositive: beatsHold, expectedAfterCostEv: null, empiricalEconomicsReady: false,
    deterministicEconomicsValidated: true, deterministicNetCredit: best.netRollCredit,
    targetContract: {
      symbol: best.candidate.symbol, optionContractId: best.candidate.optionContractId, optionType: best.candidate.optionType,
      multiplier: best.candidate.multiplier, quantity: best.candidate.quantity,
    },
  };
  return {
    ...base, expectedFutureValue: null, downsideTailEstimate: null, incrementalCapitalDays: null,
    executionCostRisk: Math.abs(currentMark) + Math.abs(best.newCreditDollars) * 0.01, opportunityCost: null, uncertainty: null,
    // Same HOLD-baseline convention as valueForSingleRollCandidate/
    // valueForRollFromCandidates -- a roll must clear 0 on its COMBINED
    // score (net credit + weighted additional upside), never merely on
    // net credit alone.
    utility: (beatsHold ? 0.5 : -2) - adjustment.rollPenalty,
    executionEvidence,
    reasons: [`BEST_OF_${usable.length}_ROLL_CC_CANDIDATES`,
      `NET_ROLL_CREDIT_${best.netRollCredit.toFixed(2)}`,
      best.additionalUpsideDollars === null ? 'ADDITIONAL_UPSIDE_DOLLARS_UNKNOWN' : `ADDITIONAL_UPSIDE_DOLLARS_${best.additionalUpsideDollars.toFixed(2)}`,
      `COMBINED_SCORE_${best.combinedScore.toFixed(2)}`, `ROLL_CC_ADDITIONAL_UPSIDE_DOLLAR_WEIGHT_${upsideWeight}`,
      `NEW_CREDIT_BID_SIDE_${best.newCreditDollars.toFixed(2)}`, `NEW_CREDIT_MID_REFERENCE_ANALYTICAL_ONLY_${best.newCreditMidDollars.toFixed(2)}`,
      `OLD_CALL_CLOSE_COST_ASK_SIDE_${currentMark.toFixed(2)}`, `OLD_CALL_CLOSE_COST_MID_REFERENCE_ANALYTICAL_ONLY_${midMark === null ? 'UNKNOWN' : midMark.toFixed(2)}`,
      ...adjustment.reasons],
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
function valueForSellCcFromCandidates(
  state: PaperBootstrapPolicyInput, canonicalBasis: number | null, referenceBasis: number | null, basisSource: BasisSource,
): ManagementPolicyActionValue {
  const base = { action: 'SELL_CC' as const };
  const candidates = state.ccCandidates ?? [];
  // Used for the conservative strike-comparison safety check only --
  // canonical preferred, the recorded-lot reference otherwise.
  const operationalBasis = canonicalBasis ?? referenceBasis;
  if (!finite(operationalBasis) || candidates.length === 0) {
    return { ...base, ...UNKNOWN_VALUE, reasons: ['NO_IDENTIFIED_CC_CANDIDATE'] };
  }
  const isCanonicalBasis = canonicalBasis !== null;
  const latticeCandidates: CoveredCallCandidate[] = candidates.map((candidate) => ({
    symbol: candidate.symbol, optionContractId: candidate.optionContractId, strike: candidate.strike,
    expiration: candidate.expiration, delta: null, bid: candidate.bid, ask: candidate.ask,
    multiplier: candidate.multiplier, quantity: candidate.quantity,
    openInterest: null, volume: null,
    dividendExDateRisk: candidate.dividendExDateRisk ?? 'UNKNOWN', eventRisk: candidate.eventRisk ?? 'UNKNOWN',
  }));
  // wholeChainPnlIfCalledAway/IfNotCalled make a CANONICAL whole-chain
  // P&L claim -- assignmentStrike here is therefore ONLY ever the
  // canonical basis, never the reference. When canonical is unknown,
  // this stays null, which correctly propagates into
  // computeWholeChainPnl's own stock-leg logic reporting those figures
  // as UNKNOWN rather than fabricated from a lower-confidence reference.
  //
  // When canonicalBasis IS known, it already came from
  // computeEffectiveStockBasis folding initialPutPremium/rollCredits/
  // rollCloseCosts/slippage INTO the strike itself -- passing those same
  // components again here as `null` would wrongly re-flag them as
  // genuinely unknown and force the combined sum to UNKNOWN even though
  // they are honestly, structurally already accounted for (0, not
  // fabricated, not double-counted -- a real defect this pass fixes: a
  // KNOWN canonical basis was silently unable to ever produce a KNOWN
  // combined whole-chain P&L here). They remain `null` (genuinely
  // unknown) only when canonicalBasis itself is unknown.
  const embeddedInCanonicalBasis = canonicalBasis !== null ? 0 : null;
  const wholeChainBase = {
    initialPutPremium: embeddedInCanonicalBasis, rollCredits: embeddedInCanonicalBasis,
    rollCloseCosts: embeddedInCanonicalBasis, assignmentStrike: canonicalBasis,
    stockSharesAssigned: state.economics.openStockShares, dividends: state.economics.dividends,
    // Passed through honestly -- `?? 0` would silently convert genuinely
    // UNKNOWN fee evidence (state.economics.fees is null specifically
    // when unknown_fill_fees is true) into a fabricated real zero.
    fees: state.economics.fees, slippage: embeddedInCanonicalBasis,
  };
  const assessments = evaluateCoveredCallCandidates(
    operationalBasis, state.economics.stockMarkPerShare, state.economics.openStockShares, wholeChainBase, latticeCandidates,
    state.ccUtilityWeights ?? DEFAULT_CC_UTILITY_WEIGHTS,
  );
  const best = bestCoveredCallCandidate(assessments, false);
  if (best === null) {
    // Named per-basis so a rejection driven only by the lower-confidence
    // recorded-lot REFERENCE is never presented with canonical-economics
    // wording -- see the single-candidate SELL_CC path's identical
    // requirement (section 7 of the standing management directive).
    return { ...base, ...UNKNOWN_VALUE, reasons: [
      'NO_SELECTABLE_CC_CANDIDATES_ALL_BELOW_BASIS_OR_UNQUOTED',
      isCanonicalBasis ? 'CANONICAL_EFFECTIVE_BASIS_KNOWN' : 'REFERENCE_BASIS_POLICY_REJECTION',
      `BASIS_SOURCE_${basisSource}`,
    ] };
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
  // the FULL weighted CCUtility (premium net of upside-sacrifice/spread/
  // event/ex-date/below-basis penalties -- covered-call-lattice.ts's own
  // versioned utility, already used to pick `best` among candidates) via
  // a required, caller-justified weight (default 0/neutral, matching
  // every other weight in this file) -- never the raw premium alone,
  // which would silently discard the very penalties that just decided
  // which candidate won.
  const ccWeight = state.sellCcPremiumUtilityWeight ?? 0;
  const bestUtility = best.utility.utility as number;
  return {
    ...base, expectedFutureValue: null, downsideTailEstimate: null, incrementalCapitalDays: null,
    executionCostRisk: premiumDollars * 0.01, opportunityCost: null, uncertainty: null,
    utility: ccWeight * bestUtility, executionEvidence,
    reasons: [`BEST_OF_${candidates.length}_CC_CANDIDATES_BY_UTILITY`, `SELL_CC_UTILITY_WEIGHT_${ccWeight}`,
      `BEST_CANDIDATE_WEIGHTED_CC_UTILITY_${bestUtility.toFixed(2)}`,
      `BASIS_SOURCE_${basisSource}`, isCanonicalBasis ? 'BASIS_COMPARISON_CANONICAL' : 'BASIS_COMPARISON_REFERENCE_ONLY_NOT_CANONICAL',
      ...best.reasons],
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
      //
      // ASSIGNMENT INTENT (informational metadata only, never a new
      // broker action, never a change to HOLD's utility): for a genuinely
      // ITM short put, this labels WHICH continuation HOLD represents --
      // "accept assignment if expiration is reached" vs. "not yet
      // determined" -- by consulting assignment-utility.ts's own real
      // CLOSE/ROLL/LET_EXPIRE/ACCEPT_ASSIGNMENT comparison. This does NOT
      // make ACCEPT_ASSIGNMENT a competing value before the broker cutoff
      // (management-action-frontier.ts's own feasibility gate, correctly
      // unchanged, still requires dte===0 for that) -- it only names what
      // HOLD's neutral 0 utility currently means in context, so a
      // reviewer can see the intent without a second decision authority
      // being created.
      const assignmentIntentReasons = action === 'HOLD' && currentMark !== null
        && state.market.spot !== null && state.contract.strike !== null && state.market.spot < state.contract.strike
        ? (() => {
            const rollCandidate = state.rollCandidate;
            const assignment = evaluateAssignmentUtility(state, currentMark,
              rollCandidate && finite(rollCandidate.bid) && finite(rollCandidate.ask)
                ? { openCreditDollars: rollCandidate.bid * rollCandidate.multiplier * rollCandidate.quantity } : null);
            // assignment-utility.ts's own comparison gives LET_EXPIRE and
            // ACCEPT_ASSIGNMENT the SAME known $0 option-side cash flow
            // (neither claims anything about the resulting stock
            // position) -- its tie-break (first pushed wins) can label
            // the winner 'LET_EXPIRE' even here, but LET_EXPIRE is not
            // economically real in this ITM branch (we are already
            // inside the isItmShortPut guard). Either label winning means
            // the SAME thing here: continuing (0 known cash flow) is at
            // least as good as CLOSE/ROLL's own known cash flow.
            const continuationWins = assignment.best?.action === 'LET_EXPIRE' || assignment.best?.action === 'ACCEPT_ASSIGNMENT';
            return [`ASSIGNMENT_INTENT_${continuationWins ? 'ACCEPT_IF_EXPIRATION_REACHED' : 'NOT_YET_DETERMINED'}`];
          })()
        : [];
      return {
        ...base, ...UNKNOWN_VALUE, utility: 0,
        reasons: ['NO_KNOWN_REASON_TO_ACT', `THESIS_CLASSIFICATION_${thesis.classification}`, ...assignmentIntentReasons],
      };
    }
    case 'RECOVERY_WAIT': {
      // RECOVERY_WAIT now carries REAL forward economics -- the KNOWN
      // cost of continuing to wait -- rather than a flat, always-0
      // baseline. It is the exact SIGN-MIRROR of the two mechanisms
      // SELL_STOCK already uses (never a second, independently-invented
      // pair of levers): what SELL_STOCK gains by acting NOW, RECOVERY_WAIT
      // loses by NOT acting:
      //   (a) a suspected thesis failure -- SELL_STOCK's `closeBias` makes
      //       closing more attractive; RECOVERY_WAIT subtracts that SAME
      //       bias, since continuing to hold a suspected-broken thesis is
      //       the mirror-image cost.
      //   (b) a known capital opportunity cost -- SELL_STOCK treats it as
      //       a benefit of releasing capital; RECOVERY_WAIT treats the
      //       SAME known dollar figure as a cost of keeping it locked up.
      // Both default to 0 (fully neutral, matching every other weight in
      // this file) and use the SAME caller-supplied
      // `sellStockOpportunityCostUtilityWeight`/`thesisFailureUtilityBias`
      // -- one physical quantity, two mirrored consumers, never two
      // independently-configurable numbers that could silently disagree.
      // This module NEVER adds an expected-appreciation, recovery-
      // probability, or time-to-recovery term -- those remain permanently
      // null on RecoveryState and contribute nothing here.
      //
      // Portfolio concentration and event exposure are surfaced as
      // TRANSPARENCY reasons only (no numeric interpretation of the
      // `unknown`-typed upstream context fields exists yet to convert
      // into an honest dollar penalty) -- they never fabricate a
      // magnitude the way the two mechanisms above never do either.
      const adjustment = thesisUtilityAdjustment(thesis, state.thesisFailureUtilityBias ?? 0);
      const waitOpportunityCostWeight = state.sellStockOpportunityCostUtilityWeight ?? 0;
      const waitOpportunityCostContribution = recoveryState.capitalOpportunityCostDollars !== null
        ? waitOpportunityCostWeight * recoveryState.capitalOpportunityCostDollars : 0;
      return {
        ...base, expectedFutureValue: null, downsideTailEstimate: null, incrementalCapitalDays: recoveryState.capitalDaysSoFar,
        executionCostRisk: null, opportunityCost: recoveryState.capitalOpportunityCostDollars, uncertainty: null,
        utility: -adjustment.closeBias - waitOpportunityCostContribution,
        executionEvidence: null,
        reasons: [
          'NO_KNOWN_REASON_TO_ACT',
          `BASIS_SOURCE_${recoveryState.basisSource}`,
          `CANONICAL_DISTANCE_TO_BASIS_FRACTION_${recoveryState.canonicalDistanceToBasisFraction === null ? 'UNKNOWN' : recoveryState.canonicalDistanceToBasisFraction.toFixed(4)}`,
          `REFERENCE_DISTANCE_TO_BASIS_FRACTION_${recoveryState.referenceDistanceToBasisFraction === null ? 'UNKNOWN' : recoveryState.referenceDistanceToBasisFraction.toFixed(4)}`,
          `CAPITAL_DAYS_SO_FAR_${recoveryState.capitalDaysSoFar === null ? 'UNKNOWN' : recoveryState.capitalDaysSoFar.toFixed(1)}`,
          `CONTINUING_CAPITAL_OPPORTUNITY_COST_${recoveryState.capitalOpportunityCostDollars === null ? 'UNKNOWN' : recoveryState.capitalOpportunityCostDollars.toFixed(2)}`,
          `PORTFOLIO_BURDEN_DATA_PRESENT_${recoveryState.portfolioBurdenDataPresent}`,
          `EVENT_RISK_CONTEXT_PRESENT_${recoveryState.eventRiskPresent}`,
          'RECOVERY_PROBABILITY_NOT_MODELED_NO_FABRICATED_ESTIMATE',
          ...adjustment.reasons,
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
      if (state.rollCcCandidates !== undefined && state.rollCcCandidates.length > 0 && currentMark !== null) {
        return valueForRollCcFromCandidates(state, currentMark, midMark, thesis);
      }
      return valueForSingleRollCandidate(action, state, currentMark, midMark, thesis);
    }
    case 'ALLOW_CALL_AWAY': {
      // Structural expiration handling already selects this correctly from
      // broker-confirmed moneyness; this policy adds no competing claim on
      // utility (0, deferred, exactly like LET_EXPIRE/ACCEPT_ASSIGNMENT
      // below). It DOES surface the real canonical whole-chain call-away
      // P&L as informational reasons -- reusing computeWholeChainPnl (never
      // a second formula): gross call-away proceeds are never presented as
      // profit, and this stays UNKNOWN whenever canonical basis is unknown
      // rather than silently substituting the recorded-lot reference.
      const { strike, multiplier, contracts } = state.contract;
      const proceeds = finite(strike) && finite(multiplier) && finite(contracts) ? strike * multiplier * contracts : null;
      const canonicalBasis = recoveryState.canonicalEffectiveBasisPerShare;
      const referenceBasis = recoveryState.recordedLotBasisReferencePerShare;
      // When canonicalBasis IS known, it already folds
      // initialPutPremium/rollCredits/rollCloseCosts/slippage into the
      // strike itself -- re-passing those as `null` would wrongly force
      // this combined sum to UNKNOWN even though they are honestly,
      // structurally already accounted for (0, not fabricated, not
      // double-counted). The REFERENCE basis carries no such adjustment
      // (it may be nothing more than the raw assignment strike), so those
      // components genuinely stay unknown for that lower-confidence path.
      const canonicalCallAwayPnl = proceeds === null || canonicalBasis === null ? null : computeWholeChainPnl({
        initialPutPremium: 0, rollCredits: 0, rollCloseCosts: 0, assignmentStrike: canonicalBasis,
        stockSharesAssigned: state.economics.openStockShares, dividends: state.economics.dividends,
        fees: state.economics.fees, slippage: 0, coveredCallPremium: state.economics.entryCreditDebit,
        coveredCallCloseCosts: 0, stockSaleOrCallAwayProceeds: proceeds, currentStockMarkPerShare: null, openStockShares: 0,
      }).wholeChainPnl;
      const referenceCallAwayPnl = proceeds === null || referenceBasis === null ? null : computeWholeChainPnl({
        initialPutPremium: null, rollCredits: null, rollCloseCosts: null, assignmentStrike: referenceBasis,
        stockSharesAssigned: state.economics.openStockShares, dividends: state.economics.dividends,
        fees: state.economics.fees, slippage: null, coveredCallPremium: state.economics.entryCreditDebit,
        coveredCallCloseCosts: 0, stockSaleOrCallAwayProceeds: proceeds, currentStockMarkPerShare: null, openStockShares: 0,
      }).wholeChainPnl;
      return {
        ...base, ...UNKNOWN_VALUE, utility: 0,
        reasons: [
          'DEFERRED_TO_STRUCTURAL_EXPIRATION_HANDLING',
          canonicalCallAwayPnl !== null ? `CANONICAL_WHOLE_CHAIN_CALL_AWAY_PNL_${canonicalCallAwayPnl.toFixed(2)}`
            : 'CANONICAL_WHOLE_CHAIN_CALL_AWAY_PNL_UNKNOWN_BASIS_INCOMPLETE',
          referenceCallAwayPnl !== null ? `REFERENCE_WHOLE_CHAIN_CALL_AWAY_PNL_USING_RECORDED_LOT_BASIS_${referenceCallAwayPnl.toFixed(2)}`
            : 'REFERENCE_WHOLE_CHAIN_CALL_AWAY_PNL_UNKNOWN',
          `BASIS_SOURCE_${recoveryState.basisSource}`,
        ],
      };
    }
    case 'LET_EXPIRE':
    case 'ACCEPT_ASSIGNMENT':
      return { ...base, ...UNKNOWN_VALUE, utility: 0, reasons: ['DEFERRED_TO_STRUCTURAL_EXPIRATION_HANDLING'] };
    case 'SELL_STOCK': {
      // CRITICAL: SELL_STOCK's own selectability must NOT depend on
      // canonical (or even reference) basis being known -- "THETA must
      // not refuse to sell bad stock merely because accounting history is
      // incomplete." Only the current mark is required here (`capital`
      // is deliberately NOT gated on -- capitalCommitted() itself derives
      // from stockBasisPerShare, which would silently reintroduce the
      // exact basis dependency this fix removes); basis only affects
      // which P&L reason codes can be reported, never whether this
      // action can be evaluated at all.
      const mark = state.economics.stockMarkPerShare;
      if (!finite(mark)) return { ...base, ...UNKNOWN_VALUE };
      // CANONICAL-DEPENDENT claim: null (UNKNOWN) whenever
      // canonicalEffectiveBasisPerShare itself is null -- NEVER computed
      // from the recorded-lot reference instead. This is exactly the
      // "canonical whole-chain P&L" claim that must not be fabricated.
      const canonicalBasis = recoveryState.canonicalEffectiveBasisPerShare;
      const canonicalKnownStockPnl = finite(canonicalBasis)
        ? (mark - canonicalBasis) * state.economics.openStockShares : null;
      // REFERENCE-ONLY claim: always computed from the recorded-lot
      // reference when available, explicitly labeled non-canonical --
      // never presented as, or silently merged with, the canonical figure.
      const referenceBasis = recoveryState.recordedLotBasisReferencePerShare;
      const referenceStockPnl = finite(referenceBasis)
        ? (mark - referenceBasis) * state.economics.openStockShares : null;
      const adjustment = thesisUtilityAdjustment(thesis, state.thesisFailureUtilityBias ?? 0);
      // Neutral baseline (0, the SAME anchor as RECOVERY_WAIT/HOLD) -- this
      // bootstrap policy no longer carries a permanent handicap against
      // liquidating the shares. SELL_STOCK can win when the SEPARATE,
      // caller-justified mechanisms below actually apply -- NEITHER of
      // which requires canonical (or any) basis to be known:
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
          canonicalKnownStockPnl !== null ? `CANONICAL_KNOWN_STOCK_PNL_IF_SOLD_${canonicalKnownStockPnl.toFixed(2)}`
            : 'CANONICAL_STOCK_PNL_UNKNOWN_BASIS_INCOMPLETE',
          referenceStockPnl !== null ? `REFERENCE_STOCK_PNL_USING_RECORDED_LOT_BASIS_${referenceStockPnl.toFixed(2)}`
            : 'REFERENCE_STOCK_PNL_UNKNOWN',
          `BASIS_SOURCE_${recoveryState.basisSource}`,
          `CANONICAL_DISTANCE_TO_BASIS_FRACTION_${recoveryState.canonicalDistanceToBasisFraction === null ? 'UNKNOWN' : recoveryState.canonicalDistanceToBasisFraction.toFixed(4)}`,
          `REFERENCE_DISTANCE_TO_BASIS_FRACTION_${recoveryState.referenceDistanceToBasisFraction === null ? 'UNKNOWN' : recoveryState.referenceDistanceToBasisFraction.toFixed(4)}`,
          `CAPITAL_OPPORTUNITY_COST_${recoveryState.capitalOpportunityCostDollars === null ? 'UNKNOWN' : recoveryState.capitalOpportunityCostDollars.toFixed(2)}`,
          ...adjustment.reasons,
        ],
      };
    }
    case 'SELL_CC': {
      if (state.ccCandidates !== undefined && state.ccCandidates.length > 0) {
        return valueForSellCcFromCandidates(
          state, recoveryState.canonicalEffectiveBasisPerShare, recoveryState.recordedLotBasisReferencePerShare, recoveryState.basisSource,
        );
      }
      // Below/above-basis classification uses whichever basis is
      // actually available (canonical preferred, the recorded-lot
      // reference otherwise) purely so the conservative safety check can
      // still run -- but the REASON CODE always names which kind of
      // basis backed it, so a reference-based rejection is never
      // presented as a canonical economic classification.
      const candidate = state.ccCandidate;
      const basis = recoveryState.canonicalEffectiveBasisPerShare ?? recoveryState.recordedLotBasisReferencePerShare;
      if (!candidate || !finite(candidate.bid) || !finite(candidate.ask) || !finite(basis)) {
        return { ...base, ...UNKNOWN_VALUE, reasons: ['NO_IDENTIFIED_CC_CANDIDATE'] };
      }
      const isCanonicalBasis = recoveryState.canonicalEffectiveBasisPerShare !== null;
      // Deterministic, sensible guard: never write a covered call at a
      // strike below the available basis reference -- that would risk
      // locking in a loss regardless of the premium collected. This is
      // an arithmetic safety rule, not a profitability forecast, and it
      // never claims canonical economics when only a reference is known.
      //
      // When canonical effective basis IS known, this rejection is a real,
      // canonical-economics-grounded fact (CC_STRIKE_BELOW_KNOWN_COST_BASIS_REJECTED,
      // preserved unchanged for existing consumers). When only the
      // recorded-lot REFERENCE is known, this is explicitly a conservative
      // POLICY posture, not an economic truth -- the reference basis may
      // not reflect put-premium/roll/fee history at all, so rejecting on
      // it is a caller-removable safety choice, never presented with
      // "COST_BASIS" wording that could be mistaken for canonical
      // economics. Both the legacy string (kept for backward
      // compatibility with existing consumers) and the directive's
      // required REFERENCE_BASIS_POLICY_REJECTION vocabulary are emitted
      // together so this distinction is unambiguous in `reasons`.
      if (candidate.strike < basis) {
        return { ...base, ...UNKNOWN_VALUE, utility: -3,
          reasons: [
            isCanonicalBasis ? 'CC_STRIKE_BELOW_KNOWN_COST_BASIS_REJECTED' : 'CC_STRIKE_BELOW_RECORDED_REFERENCE_REJECTED',
            isCanonicalBasis ? 'CANONICAL_EFFECTIVE_BASIS_KNOWN' : 'REFERENCE_BASIS_POLICY_REJECTION',
            `BASIS_SOURCE_${recoveryState.basisSource}`,
          ] };
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
          isCanonicalBasis ? 'STRIKE_AT_OR_ABOVE_COST_BASIS' : 'STRIKE_AT_OR_ABOVE_RECORDED_REFERENCE',
          `BASIS_SOURCE_${recoveryState.basisSource}`,
          `HORIZON_ANCHOR_${horizon.horizonAnchor ?? 'UNKNOWN'}`, `SELL_CC_UTILITY_WEIGHT_${ccWeight}`],
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
