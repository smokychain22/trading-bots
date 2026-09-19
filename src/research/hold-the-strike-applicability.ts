import type { EventRiskState } from '../theta/event-risk-state.js';

export const holdTheStrikeApplicabilityVersion = 'theta-hold-the-strike-applicability-v1' as const;

/**
 * Research/shadow only. `brokerAuthority: false` always. THETA_HOLD_STRIKE
 * remains `RESEARCH_ONLY` (`strategy-package.ts`) -- this module never
 * grants it broker authority and never feeds `canonical-strategy-
 * frontier.ts`'s own live route-eligibility check (`strategy_router.py`).
 * It exists to answer the six WHY questions the standing directive
 * requires this branch to answer INDEPENDENTLY, never derived from
 * "THETA_CONVENTIONAL found no candidate" -- this module's own function
 * signature has no parameter carrying THETA_CONVENTIONAL's result at all,
 * so that dependency is structurally impossible to introduce by accident.
 *
 * Applicability is a conjunctive gate (every named condition must be
 * explicitly TRUE), which is the CORRECT shape for an applicability
 * question (per the standing anti-paralysis rule, a giant AND-gate is a
 * problem for RANKING/ELIMINATING candidates before economics are
 * compared -- it is not a problem for "is this specific strategy branch
 * allowed to be considered at all," which is what this function answers).
 * UNKNOWN on any condition makes the branch NOT_APPLICABLE, never assumed
 * acceptable, mirroring `universe-policy.ts`'s own discipline.
 *
 * No numeric threshold is invented here -- every floor/acceptability
 * input the caller supplies (`ownershipWillingnessFloor`,
 * `premiumEconomicsAcceptable`) must already be a caller-justified
 * decision, never a constant this module picks on its own.
 */
export interface HoldTheStrikeApplicabilityInput {
  readonly underlying: string;
  readonly asOf: string;
  /** [0,1] graded ownership-willingness score, e.g. from
   * `bots/theta/quant/models/ownership_v0.py`'s output -- never a binary
   * bullish screen. `null` = UNKNOWN. */
  readonly ownershipWillingnessScore: number | null;
  /** Caller-justified floor for the score above -- required, never
   * invented internally. */
  readonly ownershipWillingnessFloor: number;
  /** Whether the operator has explicitly named the candidate strike as an
   * intentional, acceptable ownership level for this underlying --
   * distinct from ordinary ownership willingness, since Hold-the-Strike's
   * whole thesis is deliberate near-ATM assignment, not merely "this
   * stock is acceptable to own somewhere." */
  readonly intentionalStrikeOwnershipLevel: boolean | null;
  readonly liquidityAcceptable: boolean | null;
  readonly eventRisk: EventRiskState;
  readonly capitalCapacityAvailable: boolean | null;
  readonly portfolioConcentrationAcceptable: boolean | null;
  /** Whether the caller's own AEGIS/risk evaluation accepts assignment at
   * this strike -- this module makes no independent assignment-risk
   * judgment of its own. */
  readonly assignmentAcceptable: boolean | null;
  /** Whether the caller has already evaluated the premium/capital-day
   * economics of the specific candidate as acceptable -- this module
   * never re-derives or re-ranks that economic judgment itself. */
  readonly premiumEconomicsAcceptable: boolean | null;
}

export type HoldTheStrikeApplicabilityState = 'APPLICABLE' | 'NOT_APPLICABLE' | 'UNKNOWN';

export interface HoldTheStrikeApplicability {
  readonly contractVersion: typeof holdTheStrikeApplicabilityVersion;
  readonly underlying: string;
  readonly asOf: string;
  readonly state: HoldTheStrikeApplicabilityState;
  /** Named per-condition reasons -- never a single collapsed score. Every
   * condition that failed or was unknown is named explicitly. */
  readonly reasons: readonly string[];
  readonly brokerAuthority: false;
}

function check(label: string, value: boolean | null, reasons: string[]): boolean {
  if (value === null) { reasons.push(`${label}_UNKNOWN`); return false; }
  if (value === false) { reasons.push(`${label}_NOT_MET`); return false; }
  reasons.push(`${label}_MET`);
  return true;
}

/**
 * Answers WHY_UNDERLYING / WHY_HOLD_STRIKE / WHY_NOW (the applicability
 * half of the six-question set -- WHY_EXPIRY/WHY_STRIKE/WHY_SIZE are
 * answered per-candidate by `buildHoldTheStrikeCandidateEvidence` below,
 * and management's own WHY questions are answered by the EXISTING
 * `management-action-frontier.ts`/`paper-bootstrap-management-policy.ts`,
 * never rebuilt here).
 */
export function evaluateHoldTheStrikeApplicability(input: HoldTheStrikeApplicabilityInput): HoldTheStrikeApplicability {
  const reasons: string[] = [];
  const ownershipKnown = input.ownershipWillingnessScore !== null && Number.isFinite(input.ownershipWillingnessScore);
  const ownershipMet = ownershipKnown && (input.ownershipWillingnessScore as number) >= input.ownershipWillingnessFloor;
  reasons.push(ownershipKnown
    ? `OWNERSHIP_WILLINGNESS_${ownershipMet ? 'MET' : 'NOT_MET'}_${(input.ownershipWillingnessScore as number).toFixed(3)}_VS_FLOOR_${input.ownershipWillingnessFloor.toFixed(3)}`
    : 'OWNERSHIP_WILLINGNESS_UNKNOWN');

  const intentional = check('INTENTIONAL_STRIKE_OWNERSHIP_LEVEL', input.intentionalStrikeOwnershipLevel, reasons);
  const liquidity = check('LIQUIDITY_ACCEPTABLE', input.liquidityAcceptable, reasons);
  const capital = check('CAPITAL_CAPACITY_AVAILABLE', input.capitalCapacityAvailable, reasons);
  const concentration = check('PORTFOLIO_CONCENTRATION_ACCEPTABLE', input.portfolioConcentrationAcceptable, reasons);
  const assignment = check('ASSIGNMENT_ACCEPTABLE', input.assignmentAcceptable, reasons);
  const premium = check('PREMIUM_ECONOMICS_ACCEPTABLE', input.premiumEconomicsAcceptable, reasons);

  if (input.eventRisk === 'PRESENT') reasons.push('EVENT_RISK_PRESENT');
  else if (input.eventRisk === 'UNKNOWN') reasons.push('EVENT_RISK_UNKNOWN_NOT_TREATED_AS_SAFE');
  else reasons.push('EVENT_RISK_ABSENT_VERIFIED');
  const eventOk = input.eventRisk === 'ABSENT_VERIFIED';

  const anyUnknown = !ownershipKnown || [input.intentionalStrikeOwnershipLevel, input.liquidityAcceptable, input.capitalCapacityAvailable,
    input.portfolioConcentrationAcceptable, input.assignmentAcceptable, input.premiumEconomicsAcceptable].includes(null)
    || input.eventRisk === 'UNKNOWN';
  const allMet = ownershipMet && intentional && liquidity && eventOk && capital && concentration && assignment && premium;

  const state: HoldTheStrikeApplicabilityState = allMet ? 'APPLICABLE' : anyUnknown && !reasons.some((reason) => reason.endsWith('_NOT_MET')) ? 'UNKNOWN' : 'NOT_APPLICABLE';

  return {
    contractVersion: holdTheStrikeApplicabilityVersion, underlying: input.underlying, asOf: input.asOf,
    state, reasons, brokerAuthority: false,
  };
}

// ---------------------------------------------------------------------
// Per-candidate structural evidence (single candidate only -- no
// cross-candidate aggregation, learning directly from the real defects
// found in the retired contract-research-evidence.ts: never sum a
// per-share quantity across a varying contract count, never assign a
// higher-is-better/lower-is-better direction to a short-premium Greek
// without checking the position's actual economic sign).
// ---------------------------------------------------------------------

export interface HoldTheStrikeCandidateEvidence {
  readonly contractVersion: typeof holdTheStrikeApplicabilityVersion;
  readonly underlying: string;
  readonly optionSymbol: string;
  readonly expiration: string;
  readonly dte: number;
  readonly strike: number;
  /** Raw delta, reported as a plain fact -- never treated as a
   * probability of profit or of assignment. */
  readonly delta: number | null;
  /** Bid-side premium reference (conservative, matches every other
   * short-premium estimate in this codebase). */
  readonly premiumPerShare: number | null;
  /** CSP break-even = strike - premium. Reported as a plain fact only --
   * this module does NOT rank it "higher is better" or "lower is
   * better" on its own; a caller doing cross-candidate comparison must
   * make that direction judgment explicitly and separately, exactly the
   * step the retired comparator got backwards. */
  readonly breakEven: number | null;
  readonly spreadPct: number | null;
  readonly openInterest: number | null;
  readonly volume: number | null;
  readonly assignmentCapacityQty: number | null;
  /** Distance from spot to expected move boundary, in dollars -- caller-
   * supplied, `null` = UNKNOWN, this module has no expected-move model
   * of its own. */
  readonly expectedMoveDistance: number | null;
  readonly eventRisk: EventRiskState;
  readonly brokerAuthority: false;
}

export function buildHoldTheStrikeCandidateEvidence(input: {
  readonly underlying: string;
  readonly optionSymbol: string;
  readonly expiration: string;
  readonly dte: number;
  readonly strike: number;
  readonly delta: number | null;
  readonly bid: number | null;
  readonly spreadPct: number | null;
  readonly openInterest: number | null;
  readonly volume: number | null;
  readonly assignmentCapacityQty: number | null;
  readonly expectedMoveDistance: number | null;
  readonly eventRisk: EventRiskState;
}): HoldTheStrikeCandidateEvidence {
  const premiumPerShare = input.bid !== null && Number.isFinite(input.bid) ? input.bid : null;
  const breakEven = premiumPerShare !== null ? input.strike - premiumPerShare : null;
  return {
    contractVersion: holdTheStrikeApplicabilityVersion, underlying: input.underlying, optionSymbol: input.optionSymbol,
    expiration: input.expiration, dte: input.dte, strike: input.strike, delta: input.delta, premiumPerShare, breakEven,
    spreadPct: input.spreadPct, openInterest: input.openInterest, volume: input.volume,
    assignmentCapacityQty: input.assignmentCapacityQty, expectedMoveDistance: input.expectedMoveDistance,
    eventRisk: input.eventRisk, brokerAuthority: false,
  };
}
