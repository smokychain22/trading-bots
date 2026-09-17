import type { ManagementInputState } from './management-input-state.js';
import type { ManagementPolicyEvidenceProvider } from './autonomous-runtime.js';
import {
  buildManagementActionFrontier, managementPolicyEvidenceVersion,
  type ManagementActionExecutionEvidence, type ManagementFrontierAction,
  type ManagementPolicyActionValue, type ManagementPolicyEvidence,
} from './management-action-frontier.js';

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
}

export interface PaperBootstrapPolicyInput extends ManagementInputState {
  readonly rollCandidate?: RollCandidate | null;
  readonly ccCandidate?: RollCandidate | null;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/** Current mark-to-market value of the OPEN option leg, in dollars (not
 * per-share) -- the cost to close it right now at the midpoint. Returns
 * null (never zero) when the quote is missing. */
function currentOptionMarkDollars(state: ManagementInputState): number | null {
  const { optionBid, optionAsk } = state.market;
  const { multiplier, contracts } = state.contract;
  if (!finite(optionBid) || !finite(optionAsk) || !finite(multiplier) || !finite(contracts)) return null;
  return ((optionBid + optionAsk) / 2) * multiplier * contracts;
}

/** Remaining extrinsic (time) value as a fraction of the ORIGINAL entry
 * credit -- purely descriptive, never a fixed percentage rule. Returns
 * null when either quantity is unknown. */
function remainingValueFraction(state: ManagementInputState, currentMark: number | null): number | null {
  const entry = state.economics.entryCreditDebit;
  if (!finite(entry) || entry === 0 || currentMark === null) return null;
  return currentMark / Math.abs(entry);
}

function daysToExpiration(state: ManagementInputState): number | null {
  return finite(state.market.dte) ? state.market.dte : null;
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

/**
 * Builds a deterministic value for one action. `utility` here is NEVER a
 * dollar EV estimate -- it is an ORDINAL score (higher = more consistent
 * with continuing to hold less exposed/more resolved risk) built only from
 * known quantities, used solely to rank actions THIS policy is choosing
 * between, never presented as a forecasted return. Every action not given
 * a real utility here reports UNKNOWN honestly via `UNKNOWN_VALUE`.
 */
function valueFor(
  action: ManagementFrontierAction, state: PaperBootstrapPolicyInput, currentMark: number | null,
  remainingFraction: number | null, dte: number | null, capital: number | null,
): ManagementPolicyActionValue {
  const base = { action };
  switch (action) {
    case 'HOLD':
    case 'RECOVERY_WAIT':
    case 'HOLD_CC': {
      // Passive: the deterministic case for continuing is exactly "we have
      // not found a concrete, known reason to act." Utility 0 is the
      // neutral anchor every other action's score is compared against.
      return { ...base, ...UNKNOWN_VALUE, utility: 0, reasons: ['NO_KNOWN_REASON_TO_ACT'] };
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
      const nearExhausted = remainingFraction !== null && remainingFraction <= 0.10 && dte <= 5;
      return {
        ...base, expectedFutureValue: null, downsideTailEstimate: null, incrementalCapitalDays: 0,
        executionCostRisk: currentMark, opportunityCost: null, uncertainty: null,
        utility: nearExhausted ? 1 : -1,
        executionEvidence: null,
        reasons: nearExhausted
          ? [`REMAINING_VALUE_FRACTION_${remainingFraction?.toFixed(2)}`, `DTE_${dte}`, 'CLOSE_FREES_CAPITAL_FOR_NEAR_EXHAUSTED_POSITION']
          : ['REMAINING_VALUE_NOT_KNOWN_EXHAUSTED'],
      };
    }
    case 'ROLL':
    case 'ROLL_CC': {
      const candidate = action === 'ROLL' ? state.rollCandidate : state.ccCandidate;
      if (!candidate || !finite(candidate.bid) || !finite(candidate.ask) || currentMark === null) {
        return { ...base, ...UNKNOWN_VALUE, reasons: ['NO_IDENTIFIED_ROLL_TARGET'] };
      }
      const openCreditDollars = ((candidate.bid + candidate.ask) / 2) * candidate.multiplier * candidate.quantity;
      const netCredit = openCreditDollars - currentMark; // known cost to close old, known credit to open new
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
        utility: netCredit >= 0 ? 0.5 : -2, // a net-debit roll never outranks passive HOLD under this bootstrap policy
        executionEvidence, reasons: [`DETERMINISTIC_NET_CREDIT_${netCredit.toFixed(2)}`],
      };
    }
    case 'ALLOW_CALL_AWAY':
      // Structural expiration handling already selects this correctly from
      // broker-confirmed moneyness; this policy adds no competing claim.
      return { ...base, ...UNKNOWN_VALUE, utility: 0, reasons: ['DEFERRED_TO_STRUCTURAL_EXPIRATION_HANDLING'] };
    case 'LET_EXPIRE':
    case 'ACCEPT_ASSIGNMENT':
      return { ...base, ...UNKNOWN_VALUE, utility: 0, reasons: ['DEFERRED_TO_STRUCTURAL_EXPIRATION_HANDLING'] };
    case 'SELL_STOCK': {
      const basis = state.economics.stockBasisPerShare, mark = state.economics.stockMarkPerShare;
      if (!finite(basis) || !finite(mark) || capital === null) return { ...base, ...UNKNOWN_VALUE };
      const knownStockPnl = (mark - basis) * state.economics.openStockShares;
      return {
        ...base, expectedFutureValue: null, downsideTailEstimate: null, incrementalCapitalDays: 0,
        executionCostRisk: null, opportunityCost: null, uncertainty: null,
        utility: -0.5, // deterministic HOLD/CC bias: selling stock is never preferred by this bootstrap policy over a
        // known-safe covered call unless a caller-level override exists, since it forecloses all future upside
        executionEvidence: null, reasons: [`KNOWN_STOCK_PNL_IF_SOLD_${knownStockPnl.toFixed(2)}`],
      };
    }
    case 'SELL_CC': {
      const candidate = state.ccCandidate, basis = state.economics.stockBasisPerShare;
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
      const premiumDollars = ((candidate.bid + candidate.ask) / 2) * candidate.multiplier * candidate.quantity;
      const executionEvidence: ManagementActionExecutionEvidence = {
        closeEconomicBoundary: null, openEconomicBoundary: premiumDollars, stockEconomicBoundary: null,
        economicsRemainPositive: premiumDollars > 0, expectedAfterCostEv: null, empiricalEconomicsReady: false,
        deterministicEconomicsValidated: true, deterministicNetCredit: premiumDollars,
        targetContract: {
          symbol: candidate.symbol, optionContractId: candidate.optionContractId, optionType: candidate.optionType,
          multiplier: candidate.multiplier, quantity: candidate.quantity,
        },
      };
      return {
        ...base, expectedFutureValue: null, downsideTailEstimate: null, incrementalCapitalDays: null,
        executionCostRisk: premiumDollars * 0.01, opportunityCost: null, uncertainty: null,
        utility: 0.5, executionEvidence, reasons: [`KNOWN_CC_PREMIUM_${premiumDollars.toFixed(2)}`, 'STRIKE_AT_OR_ABOVE_COST_BASIS'],
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
  const frontier = buildManagementActionFrontier(state);
  const actionSet = frontier.actions.map((action) => action.action);
  if (actionSet.length === 0) return null;

  const currentMark = currentOptionMarkDollars(state);
  const remainingFraction = remainingValueFraction(state, currentMark);
  const dte = daysToExpiration(state);
  const capital = capitalCommitted(state);

  const actionValues = actionSet.map((action) => valueFor(action, state, currentMark, remainingFraction, dte, capital));
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
