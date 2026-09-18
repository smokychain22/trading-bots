import { forwardContinuationCashFlow } from './common-horizon-economics.js';

export const rollIncrementalUtilityVersion = 'theta-roll-incremental-utility-v1' as const;

/**
 * ROLL is a replacement trade: close the old leg, open a new one. This
 * module never collapses that into a single number without first
 * preserving every component the directive requires kept explicit --
 * old realized P&L, old close cost, new opening credit, new strike/
 * expiration, days extended, new delta, and new capital burden are all
 * carried on the result, not discarded once a utility score is produced.
 *
 * `RollIncrementalUtility` is an ORDINAL comparison score, never a dollar
 * EV estimate -- it never claims a forecast, only ranks known, complete,
 * forward-only cash-flow and capital-burden facts against each other and
 * against HOLD. A roll is never preferred merely because its net cash
 * flow is a credit; a large new capital burden or short-lived extension
 * can still make HOLD (or a different candidate) rank higher.
 */

export interface RollOldLeg {
  readonly closeCostDollars: number | null;
  readonly strike: number | null;
  readonly expiration: string | null;
  readonly delta: number | null;
  readonly capitalCommittedDollars: number | null;
}

export interface RollCandidateEconomics {
  readonly symbol: string;
  readonly optionContractId: string;
  readonly strike: number;
  readonly expiration: string;
  readonly delta: number | null;
  readonly openCreditDollars: number | null;
  readonly capitalCommittedDollars: number | null;
}

export interface RollCandidateAssessment {
  readonly candidate: RollCandidateEconomics;
  readonly netCreditDollars: number | null;
  readonly incrementalCapitalDollars: number | null;
  readonly daysExtended: number | null;
  readonly rollIncrementalUtility: number | null;
  readonly reasons: readonly string[];
}

export interface RollComparisonResult {
  readonly contractVersion: typeof rollIncrementalUtilityVersion;
  readonly oldLeg: RollOldLeg;
  readonly sunkRealizedPnl: number | null;
  readonly assessments: readonly RollCandidateAssessment[];
  readonly bestCandidate: RollCandidateAssessment | null;
  readonly bestBeatsHold: boolean;
}

function daysBetween(fromIso: string | null, toIso: string | null): number | null {
  if (fromIso === null || toIso === null) return null;
  const from = Date.parse(fromIso), to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * `incrementalCapitalDayWeight` is a required, caller-justified penalty per
 * dollar of ADDITIONAL capital committed per ADDITIONAL day extended --
 * this module never invents that weight itself. A weight of 0 is valid
 * (capital-day cost ignored entirely, comparison reduces to pure net
 * credit) if the caller has justified that choice.
 */
export function evaluateRollCandidates(
  oldLeg: RollOldLeg, sunkRealizedPnl: number | null,
  candidates: readonly RollCandidateEconomics[], incrementalCapitalDayWeight: number,
): RollComparisonResult {
  if (!Number.isFinite(incrementalCapitalDayWeight) || incrementalCapitalDayWeight < 0) {
    throw new Error('ROLL_INCREMENTAL_UTILITY_INVALID_CAPITAL_DAY_WEIGHT');
  }
  const assessments = candidates.map((candidate): RollCandidateAssessment => {
    const daysExtended = daysBetween(oldLeg.expiration, candidate.expiration);
    const incrementalCapitalDollars = oldLeg.capitalCommittedDollars !== null && candidate.capitalCommittedDollars !== null
      ? candidate.capitalCommittedDollars - oldLeg.capitalCommittedDollars : null;
    // A roll structurally always has TWO legs (close the old, open the
    // new) -- unlike a single-leg close or a fresh covered-call sale, a
    // missing open-credit here is genuinely UNKNOWN, never a legitimate
    // "no such leg" zero. forwardContinuationCashFlow's generic
    // completeness rule (only both-null is incomplete) is correct for
    // single-leg actions but not for this always-dual-leg comparison, so
    // that requirement is enforced explicitly here instead.
    if (oldLeg.closeCostDollars === null || candidate.openCreditDollars === null) {
      return {
        candidate, netCreditDollars: null, incrementalCapitalDollars, daysExtended,
        rollIncrementalUtility: null, reasons: ['FORWARD_ECONOMICS_INCOMPLETE'],
      };
    }
    const forward = forwardContinuationCashFlow({
      closeCostDollars: oldLeg.closeCostDollars, openCreditDollars: candidate.openCreditDollars,
    });
    const netCreditDollars = forward.netCashFlow;
    const capitalDayPenalty = incrementalCapitalDollars !== null && daysExtended !== null
      ? incrementalCapitalDayWeight * Math.abs(incrementalCapitalDollars) * daysExtended : null;
    const rollIncrementalUtility = capitalDayPenalty === null ? null : (netCreditDollars as number) - capitalDayPenalty;
    const reasons = [
      `NET_CREDIT_${(netCreditDollars as number).toFixed(2)}`,
      daysExtended !== null ? `DAYS_EXTENDED_${daysExtended}` : 'DAYS_EXTENDED_UNKNOWN',
      incrementalCapitalDollars !== null ? `INCREMENTAL_CAPITAL_${incrementalCapitalDollars.toFixed(2)}` : 'INCREMENTAL_CAPITAL_UNKNOWN',
      capitalDayPenalty === null ? 'CAPITAL_DAY_PENALTY_UNKNOWN' : `CAPITAL_DAY_PENALTY_${capitalDayPenalty.toFixed(2)}`,
    ];
    return { candidate, netCreditDollars, incrementalCapitalDollars, daysExtended, rollIncrementalUtility, reasons };
  });

  const ranked = assessments.filter((assessment): assessment is RollCandidateAssessment & { rollIncrementalUtility: number } =>
    assessment.rollIncrementalUtility !== null).sort((left, right) => right.rollIncrementalUtility - left.rollIncrementalUtility);
  const bestCandidate = ranked[0] ?? null;
  // HOLD's baseline utility is 0 by the same convention used throughout the
  // bootstrap management policy -- a roll must clear that bar, not merely
  // be better than a worse roll.
  const bestBeatsHold = bestCandidate !== null && bestCandidate.rollIncrementalUtility > 0;

  return {
    contractVersion: rollIncrementalUtilityVersion, oldLeg, sunkRealizedPnl, assessments, bestCandidate, bestBeatsHold,
  };
}
