import type { NormalizedOptionContract } from './option-contract.js';
import type { AegisAssessmentResponse } from './aegis-contract.js';
import type { SizingResultResponse } from './sizing-contract.js';
import type { ExecutionQualityResponse } from './execution-quality-contract.js';
import type { OwnershipEvaluationResponse } from './ownership-contract.js';
import type { RegimeSnapshotResponse } from './regime-contract.js';

// R1G decision assembly: composes ALREADY-COMPUTED Python quant outputs
// (ownership, regime, opportunity-frontier per-candidate disposition,
// AEGIS, sizing, execution-quality) into one immutable decision receipt.
//
// This module performs NO quantitative/policy computation of its own --
// no EV formula, no AEGIS risk-family logic, no sizing cap arithmetic. It
// only aggregates already-typed, already-validated contract responses and
// applies the fail-closed packaging rules this phase requires. "Python
// quant is mathematical/policy truth; TypeScript orchestrates" is enforced
// here by construction: there is no code path in this file that computes an
// economic number from raw inputs.

export type NewRiskWinningAction =
  | 'OPEN_FULL'
  | 'OPEN_REDUCED'
  | 'OPEN_ALTERNATE_CONTRACT'
  | 'OPEN_ALTERNATE_EXPIRY'
  | 'OPEN_ALTERNATE_STRUCTURE'
  | 'WAIT'
  | 'PASS'
  | 'SYSTEM_HOLD'
  | 'HARD_VETO';

export type CandidateDisposition =
  | 'OPEN_FULL'
  | 'OPEN_REDUCED'
  | 'OPEN_ALTERNATE_CONTRACT'
  | 'OPEN_ALTERNATE_EXPIRY'
  | 'OPEN_ALTERNATE_STRUCTURE'
  | 'WAIT'
  | 'PASS';

export type WaitReason = 'WAIT_PRICE' | 'WAIT_VOL' | 'WAIT_LIQUIDITY' | 'WAIT_EVENT' | 'WAIT_REGIME';

export interface CandidateFrontierResult {
  readonly candidateId: string;
  readonly contract: NormalizedOptionContract;
  // Disposition/waitReason/rejectionReason are Python opportunity_frontier.py
  // outputs, passed through unchanged -- this module never re-derives them.
  readonly disposition: CandidateDisposition;
  readonly waitReason: WaitReason | null;
  readonly rejectionReason: string | null;
  readonly evNet: number | null;
  readonly returnPerCapitalDay: number | null;
  // Present only for candidates the frontier marked OPEN_* -- WAIT/PASS
  // candidates are never risk-scored further.
  readonly aegis: AegisAssessmentResponse | null;
  readonly sizing: SizingResultResponse | null;
  readonly executionQuality: ExecutionQualityResponse | null;
}

export interface NewRiskDecisionInput {
  readonly snapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly timestamp: string;
  readonly underlying: string;
  readonly ownership: OwnershipEvaluationResponse | null; // null if genuinely not yet computed for this underlying
  readonly regime: RegimeSnapshotResponse | null;
  readonly candidates: readonly CandidateFrontierResult[];
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
  readonly requiredModelVersions: Readonly<Record<string, string>>; // what THIS decision service expects -- mismatch fails closed
  readonly providerStateGood: boolean;
}

export interface NewRiskAlternative {
  readonly candidateId: string;
  readonly disposition: CandidateDisposition;
  readonly evNet: number | null;
  readonly returnPerCapitalDay: number | null;
  readonly aegisState: string | null;
  readonly quantity: number | null;
  readonly executionRecommendedAction: string | null;
  readonly rejectionReason: string | null;
}

export interface NewRiskDecisionReceipt {
  readonly decisionId: string;
  readonly snapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly timestamp: string;
  readonly underlying: string;
  readonly winningAction: NewRiskWinningAction;
  readonly selectedCandidateId: string | null;
  readonly quantity: number;
  readonly alternatives: readonly NewRiskAlternative[];
  readonly ownershipSnapshotId: string | null;
  readonly regimeSnapshotId: string | null;
  readonly executionAuthorized: false;
  readonly reasonCodes: readonly string[];
  readonly plainEnglishExplanation: string;
  readonly failClosedReason: string | null;
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
}

const alternativeFrom = (c: CandidateFrontierResult): NewRiskAlternative => ({
  candidateId: c.candidateId,
  disposition: c.disposition,
  evNet: c.evNet,
  returnPerCapitalDay: c.returnPerCapitalDay,
  aegisState: c.aegis?.newRiskState ?? null,
  quantity: c.sizing?.quantity ?? null,
  executionRecommendedAction: c.executionQuality?.recommendedAction ?? null,
  rejectionReason: c.rejectionReason,
});

const systemHold = (
  input: NewRiskDecisionInput,
  reason: string,
  reasonCodes: readonly string[],
): NewRiskDecisionReceipt => ({
  decisionId: `${input.snapshotId}:${input.underlying}`,
  snapshotId: input.snapshotId,
  fusionSnapshotHash: input.fusionSnapshotHash,
  timestamp: input.timestamp,
  underlying: input.underlying,
  winningAction: 'SYSTEM_HOLD',
  selectedCandidateId: null,
  quantity: 0,
  alternatives: input.candidates.map(alternativeFrom),
  ownershipSnapshotId: null,
  regimeSnapshotId: null,
  executionAuthorized: false,
  reasonCodes,
  plainEnglishExplanation: reason,
  failClosedReason: reason,
  policyVersion: input.policyVersion,
  modelVersions: input.modelVersions,
});

/**
 * Builds a SYSTEM_HOLD receipt for a runtime PRECONDITION that is a known,
 * confirmed VALUE -- not a provider data-quality failure -- and therefore
 * never even reaches the ownership/regime/lattice/AEGIS pipeline. The
 * canonical example is a confirmed-closed market: the clock call
 * succeeded and told us something real (the market is closed right now),
 * which is an operational fact, never a strategy WAIT, never a risk
 * HARD_VETO, and never a provider-quality SYSTEM_HOLD. Callers outside
 * this module (e.g. theta-shadow-cycle.ts) use this instead of
 * constructing a receipt by hand, so the shape/invariants stay in one
 * place.
 */
export function assembleRuntimePreconditionHold(params: {
  readonly snapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly timestamp: string;
  readonly underlying: string;
  readonly reasonCode: string;
  readonly detail: string;
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
}): NewRiskDecisionReceipt {
  return {
    decisionId: `${params.snapshotId}:${params.underlying}`,
    snapshotId: params.snapshotId,
    fusionSnapshotHash: params.fusionSnapshotHash,
    timestamp: params.timestamp,
    underlying: params.underlying,
    winningAction: 'SYSTEM_HOLD',
    selectedCandidateId: null,
    quantity: 0,
    alternatives: [],
    ownershipSnapshotId: null,
    regimeSnapshotId: null,
    executionAuthorized: false,
    reasonCodes: [params.reasonCode],
    plainEnglishExplanation: params.detail,
    failClosedReason: null, // a confirmed known value is not a fail-closed safety veto
    policyVersion: params.policyVersion,
    modelVersions: params.modelVersions,
  };
}

/**
 * Records the economically meaningful result of a completed scan that
 * produced no candidate contracts. A scan backed by valid required truth is
 * a real PASS. An incomplete snapshot is a fail-closed SYSTEM_HOLD. Both are
 * quantity zero and remain permanently non-executable.
 */
export function assembleNoCandidateDecision(params: {
  readonly snapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly timestamp: string;
  readonly underlying: string;
  readonly snapshotValidForNewRisk: boolean;
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
}): NewRiskDecisionReceipt {
  const valid = params.snapshotValidForNewRisk;
  const detail = valid
    ? 'The completed scan produced no eligible option candidate. No new risk was opened.'
    : 'The scan produced no candidate and required provider truth was not valid for new risk. The cycle was held closed.';
  return {
    decisionId: `${params.snapshotId}:${params.underlying}`,
    snapshotId: params.snapshotId,
    fusionSnapshotHash: params.fusionSnapshotHash,
    timestamp: params.timestamp,
    underlying: params.underlying,
    winningAction: valid ? 'PASS' : 'SYSTEM_HOLD',
    selectedCandidateId: null,
    quantity: 0,
    alternatives: [],
    ownershipSnapshotId: null,
    regimeSnapshotId: null,
    executionAuthorized: false,
    reasonCodes: [valid ? 'NO_CANDIDATES_AVAILABLE' : 'NO_CANDIDATES_WITH_INVALID_REQUIRED_TRUTH'],
    plainEnglishExplanation: detail,
    failClosedReason: valid ? null : detail,
    policyVersion: params.policyVersion,
    modelVersions: params.modelVersions,
  };
}

/**
 * Assembles the final new-risk decision receipt from already-computed
 * per-candidate frontier/AEGIS/sizing/execution-quality results. Fails
 * closed (winningAction=SYSTEM_HOLD, quantity=0) on: invalid provider state,
 * model-version mismatch, missing ownership/regime context, or an
 * inconsistent snapshot reference across candidates. `executionAuthorized`
 * is always `false` -- this phase produces a decision receipt and,
 * downstream, an order intent; it never authorizes broker submission.
 */
export function assembleNewRiskDecision(input: NewRiskDecisionInput): NewRiskDecisionReceipt {
  if (!input.providerStateGood) {
    return systemHold(input, 'Required provider state is not GOOD; no new risk can be evaluated.', ['PROVIDER_STATE_INVALID']);
  }

  for (const [modelName, requiredVersion] of Object.entries(input.requiredModelVersions)) {
    const actualVersion = input.modelVersions[modelName];
    if (actualVersion !== requiredVersion) {
      return systemHold(
        input,
        `Model version mismatch for ${modelName}: expected ${requiredVersion}, got ${actualVersion ?? 'MISSING'}.`,
        ['MODEL_VERSION_MISMATCH'],
      );
    }
  }

  if (input.ownership === null) {
    return systemHold(input, 'Ownership evaluation is unavailable for this underlying.', ['OWNERSHIP_UNAVAILABLE']);
  }
  if (input.regime === null) {
    return systemHold(input, 'Regime context is unavailable.', ['REGIME_UNAVAILABLE']);
  }

  const inconsistentSnapshot = input.candidates.some((c) => c.contract.underlying !== input.underlying);
  if (inconsistentSnapshot) {
    return systemHold(input, 'One or more candidates reference a different underlying than this decision.', ['SNAPSHOT_INCONSISTENT']);
  }

  const alternatives = input.candidates.map(alternativeFrom);

  const openCandidates = input.candidates.filter(
    (c) =>
      (c.disposition === 'OPEN_FULL' || c.disposition === 'OPEN_REDUCED' || c.disposition === 'OPEN_ALTERNATE_CONTRACT' || c.disposition === 'OPEN_ALTERNATE_EXPIRY' || c.disposition === 'OPEN_ALTERNATE_STRUCTURE') &&
      c.contract.executable &&
      c.evNet !== null &&
      c.evNet > 0 &&
      c.returnPerCapitalDay !== null &&
      c.returnPerCapitalDay > 0 &&
      c.aegis !== null &&
      c.aegis.newRiskState !== 'HOLD_ONLY' &&
      c.aegis.newRiskState !== 'HARD_VETO' &&
      c.sizing !== null &&
      c.sizing.quantity > 0 &&
      c.executionQuality !== null &&
      c.executionQuality.recommendedAction === 'SUBMIT',
  );

  if (openCandidates.length === 0) {
    const anyWait = input.candidates.find((c) => c.disposition === 'WAIT');
    const winningAction: NewRiskWinningAction = anyWait ? 'WAIT' : 'PASS';
    return {
      decisionId: `${input.snapshotId}:${input.underlying}`,
      snapshotId: input.snapshotId,
      fusionSnapshotHash: input.fusionSnapshotHash,
      timestamp: input.timestamp,
      underlying: input.underlying,
      winningAction,
      selectedCandidateId: null,
      quantity: 0,
      alternatives,
      ownershipSnapshotId: input.snapshotId,
      regimeSnapshotId: input.snapshotId,
      executionAuthorized: false,
      reasonCodes: ['NO_QUALIFYING_CANDIDATE'],
      plainEnglishExplanation: anyWait
        ? 'No candidate is ready to open now, but at least one is being monitored for a specific condition change.'
        : 'No candidate in this scan qualifies for new risk; none had a positive, executable, risk-permitted opportunity.',
      failClosedReason: null,
      policyVersion: input.policyVersion,
      modelVersions: input.modelVersions,
    };
  }

  openCandidates.sort((a, b) => {
    // The filter above proves both values are known. Keep the comparison
    // explicit so UNKNOWN can never acquire the economic meaning of zero.
    if (a.returnPerCapitalDay === null || b.returnPerCapitalDay === null) {
      throw new Error('OPEN_CANDIDATE_ECONOMICS_UNKNOWN');
    }
    return b.returnPerCapitalDay - a.returnPerCapitalDay;
  });
  const winner = openCandidates[0];
  if (winner === undefined || winner.sizing === null) {
    return systemHold(input, 'Internal inconsistency: a qualifying candidate lost its sizing result during selection.', ['INTERNAL_INCONSISTENCY']);
  }

  return {
    decisionId: `${input.snapshotId}:${input.underlying}`,
    snapshotId: input.snapshotId,
    fusionSnapshotHash: input.fusionSnapshotHash,
    timestamp: input.timestamp,
    underlying: input.underlying,
    winningAction: winner.disposition,
    selectedCandidateId: winner.candidateId,
    quantity: winner.sizing.quantity,
    alternatives,
    ownershipSnapshotId: input.snapshotId,
    regimeSnapshotId: input.snapshotId,
    executionAuthorized: false,
    reasonCodes: ['CANDIDATE_SELECTED'],
    plainEnglishExplanation: `${winner.candidateId} was selected: positive economics, risk-permitted, and executable.`,
    failClosedReason: null,
    policyVersion: input.policyVersion,
    modelVersions: input.modelVersions,
  };
}
