import type { ManagementInputState } from './management-input-state.js';
import { forwardContinuationCashFlow } from './common-horizon-economics.js';

export const assignmentUtilityVersion = 'theta-assignment-utility-v1' as const;

/**
 * Assignment is a modeled lifecycle transition, not automatic failure --
 * and not automatically accepted merely because the option is ITM. This
 * module builds an explicit AssignmentState and compares CLOSE / ROLL /
 * LET_EXPIRE / ACCEPT_ASSIGNMENT on the SAME forward, common-horizon basis
 * as every other bootstrap action. It is deliberately STANDALONE this
 * pass -- it does not yet feed into `paper-bootstrap-management-policy.ts`'s
 * action selection or override the existing structural expiration/
 * assignment mechanism in management-action-frontier.ts (which remains the
 * broker-truth-driven gate on WHEN assignment can actually be selected).
 * It exists as an honest comparison a reviewer, a later wiring pass, or a
 * research challenger can consume.
 */
export interface AssignmentState {
  readonly contractVersion: typeof assignmentUtilityVersion;
  readonly underlyingPrice: number | null;
  readonly strike: number | null;
  readonly premiumAlreadyCollected: number | null;
  readonly securedCashDollars: number | null;
  readonly sharesIfAssigned: number | null;
  readonly ownershipQualityPresent: boolean;
  readonly concentrationPresent: boolean;
  readonly sectorCorrelationPresent: boolean;
  readonly eventStatePresent: boolean;
  readonly dividendExDateStatePresent: boolean;
  readonly capitalLockedDollars: number | null;
  /** Fields no upstream data source in this codebase yet provides -- named
   * rather than fabricated (expected recovery horizon, stock downside
   * estimate, covered-call opportunity quality all require either a
   * research model or a caller-supplied candidate, neither present here). */
  readonly dataCompleteness: { readonly missingUpstreamFields: readonly string[] };
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function buildAssignmentState(state: ManagementInputState): AssignmentState {
  const { spot } = state.market;
  const { strike, multiplier, contracts } = state.contract;
  const { entryCreditDebit } = state.economics;
  const securedCashDollars = finite(strike) && finite(multiplier) && finite(contracts)
    ? strike * multiplier * contracts : null;
  return {
    contractVersion: assignmentUtilityVersion,
    underlyingPrice: spot, strike, premiumAlreadyCollected: entryCreditDebit,
    securedCashDollars, sharesIfAssigned: finite(multiplier) && finite(contracts) ? multiplier * contracts : null,
    ownershipQualityPresent: state.context.ownershipQuality !== null,
    concentrationPresent: state.context.concentration !== null,
    sectorCorrelationPresent: state.context.sectorCorrelation !== null,
    eventStatePresent: state.context.eventState !== null,
    dividendExDateStatePresent: state.context.dividendExDateState !== null,
    capitalLockedDollars: securedCashDollars,
    dataCompleteness: {
      missingUpstreamFields: [
        'expected_recovery_horizon', 'stock_downside_estimate', 'covered_call_opportunity_quality',
        'iv_rv_context', 'earnings_proximity', 'portfolio_concentration_interpreted',
      ],
    },
  };
}

export type AssignmentComparisonAction = 'CLOSE' | 'ROLL' | 'LET_EXPIRE' | 'ACCEPT_ASSIGNMENT';

export interface AssignmentActionAssessment {
  readonly action: AssignmentComparisonAction;
  readonly forwardCashFlowDollars: number | null;
  readonly utility: number | null;
  readonly reasons: readonly string[];
}

export interface AssignmentUtilityComparison {
  readonly contractVersion: typeof assignmentUtilityVersion;
  readonly assignmentState: AssignmentState;
  readonly assessments: readonly AssignmentActionAssessment[];
  readonly best: AssignmentActionAssessment | null;
}

export interface AssignmentRollCandidate {
  readonly openCreditDollars: number | null;
}

/**
 * Compares the four assignment-window actions on forward cash flow only --
 * never claiming ITM alone justifies ACCEPT_ASSIGNMENT, and never claiming
 * a probability of recovery this module has no model for. `closeCostDollars`
 * is the known cost to close the option right now (null if unknown).
 * `rollCandidate` is optional, caller-supplied (this module does not search
 * a contract lattice). ACCEPT_ASSIGNMENT's forward cash flow is 0 by
 * definition (no option-side cash flow at assignment itself -- the stock
 * position's OWN forward economics are a separate, later comparison, see
 * recovery-state.ts) -- its utility instead reflects only what is
 * concretely KNOWN about assignment's own qualitative state (secured cash,
 * ownership-quality data presence), never a fabricated recovery estimate.
 */
export function evaluateAssignmentUtility(
  state: ManagementInputState, closeCostDollars: number | null, rollCandidate: AssignmentRollCandidate | null,
): AssignmentUtilityComparison {
  const assignmentState = buildAssignmentState(state);
  const assessments: AssignmentActionAssessment[] = [];

  assessments.push({
    action: 'LET_EXPIRE', forwardCashFlowDollars: 0, utility: 0,
    reasons: ['NO_FORWARD_CASH_FLOW_IF_OTM_AT_EXPIRATION'],
  });

  if (closeCostDollars === null) {
    assessments.push({ action: 'CLOSE', forwardCashFlowDollars: null, utility: null, reasons: ['CLOSE_COST_UNKNOWN'] });
  } else {
    assessments.push({
      action: 'CLOSE', forwardCashFlowDollars: -closeCostDollars, utility: -closeCostDollars,
      reasons: [`KNOWN_CLOSE_COST_${closeCostDollars.toFixed(2)}`],
    });
  }

  if (rollCandidate === null || closeCostDollars === null) {
    assessments.push({ action: 'ROLL', forwardCashFlowDollars: null, utility: null, reasons: ['NO_IDENTIFIED_ROLL_TARGET'] });
  } else {
    const forward = forwardContinuationCashFlow({ closeCostDollars, openCreditDollars: rollCandidate.openCreditDollars });
    assessments.push({
      action: 'ROLL', forwardCashFlowDollars: forward.netCashFlow, utility: forward.netCashFlow,
      reasons: forward.complete ? [`DETERMINISTIC_NET_CREDIT_${(forward.netCashFlow as number).toFixed(2)}`] : ['ROLL_ECONOMICS_INCOMPLETE'],
    });
  }

  // ACCEPT_ASSIGNMENT's option-side forward cash flow is 0 (the option
  // simply resolves into stock at the strike -- no additional option cash
  // flow beyond the premium already collected, which is sunk, not forward).
  // Its utility is deliberately 0 here (neutral), never negative-by-default
  // and never positive-by-default: this module makes no claim about
  // whether the RESULTING stock position is good or bad -- that is
  // recovery-state.ts's job, evaluated separately once assignment is a
  // broker-confirmed fact.
  assessments.push({
    action: 'ACCEPT_ASSIGNMENT', forwardCashFlowDollars: 0, utility: 0,
    reasons: [
      'OPTION_SIDE_FORWARD_CASH_FLOW_IS_ZERO_AT_ASSIGNMENT',
      `SECURED_CASH_${assignmentState.securedCashDollars === null ? 'UNKNOWN' : assignmentState.securedCashDollars.toFixed(2)}`,
      `OWNERSHIP_QUALITY_DATA_PRESENT_${assignmentState.ownershipQualityPresent}`,
      'RESULTING_STOCK_POSITION_ECONOMICS_EVALUATED_SEPARATELY_BY_RECOVERY_STATE',
    ],
  });

  const known = assessments.filter((assessment): assessment is AssignmentActionAssessment & { utility: number } => assessment.utility !== null);
  const best = known.length === 0 ? null : known.reduce((champion, candidate) => candidate.utility > champion.utility ? candidate : champion);

  return { contractVersion: assignmentUtilityVersion, assignmentState, assessments, best };
}
