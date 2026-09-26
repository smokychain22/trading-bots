/**
 * COMMAND 4 item 3 / COMMAND 3 correction 0.A. Splits THETA's entry concept
 * into two distinct research entities, so a candidate can never silently
 * gain a realized outcome merely by existing at decision time. Research-
 * only, `brokerAuthority: false`.
 *
 *  - `DecisionCandidateObservation`: one candidate at one canonical decision
 *    timestamp, BEFORE selection. `SELECTED | REJECTED | WAITED |
 *    SHADOW_ONLY`. Never carries a `realizedPnl` field at all -- the type
 *    structurally has no such field, so a caller cannot even attempt to
 *    attach one.
 *  - `ExecutedEntryEpisode`: begins ONLY at a real, broker-confirmed fill.
 *    `exposureStartAt` is always the fill timestamp, never the order-
 *    submission timestamp (decision quote and fill are tracked separately
 *    for TCA, matching `confirmed-fill-tca.ts`'s real design).
 */

export const entryUnitSeparationVersion = 'theta-entry-unit-separation-v1' as const;

export type DecisionCandidateStatus = 'SELECTED' | 'REJECTED' | 'WAITED' | 'SHADOW_ONLY';

/** No `realizedPnl`/`outcome` field exists on this type by design -- see
 * module doc comment. Any code needing an outcome for a candidate must go
 * through `entityId` to a separately-resolved, identifiability-tagged
 * outcome record (see `empirical-identifiability-taxonomy.ts`). */
export interface DecisionCandidateObservation {
  readonly contractVersion: typeof entryUnitSeparationVersion;
  readonly candidateId: string;
  readonly decisionId: string;
  readonly decisionAt: string;
  readonly strategyFamily: string;
  readonly status: DecisionCandidateStatus;
  readonly featureSnapshotHash: string;
  readonly sourceSha: string;
  readonly workerSha: string | null;
}

export function buildDecisionCandidateObservation(
  input: Omit<DecisionCandidateObservation, 'contractVersion'>,
): DecisionCandidateObservation {
  if (!Number.isFinite(Date.parse(input.decisionAt))) throw new Error('DECISION_CANDIDATE_INVALID_DECISION_AT');
  return { contractVersion: entryUnitSeparationVersion, ...input };
}

export type ExecutedEntryLifecycleState =
  | 'SUBMITTED' | 'UNFILLED' | 'PARTIALLY_FILLED' | 'FULLY_FILLED'
  | 'CANCELLED' | 'EXPIRED' | 'AMBIGUOUS_PENDING_RECONCILIATION' | 'RECONCILED';

const TERMINAL_STATES: ReadonlySet<ExecutedEntryLifecycleState> = new Set(['FULLY_FILLED', 'CANCELLED', 'EXPIRED', 'RECONCILED']);

/**
 * `exposureStartAt` is `null` until a real fill exists (`FULLY_FILLED` or a
 * `PARTIALLY_FILLED` state with at least one confirmed fill) -- exposure
 * never starts at `submittedAt`. This is the concrete, testable expression
 * of "submission != fill."
 */
export interface ExecutedEntryEpisode {
  readonly contractVersion: typeof entryUnitSeparationVersion;
  readonly executedEntryEpisodeId: string;
  readonly candidateId: string;
  readonly orderIntentId: string;
  readonly lifecycleState: ExecutedEntryLifecycleState;
  readonly submittedAt: string;
  readonly exposureStartAt: string | null;
  readonly filledQuantity: number;
  readonly requestedQuantity: number;
  readonly terminalAt: string | null;
}

export function buildExecutedEntryEpisode(
  input: Omit<ExecutedEntryEpisode, 'contractVersion' | 'exposureStartAt' | 'terminalAt'> & { readonly firstFillAt: string | null },
): ExecutedEntryEpisode {
  if (!Number.isFinite(Date.parse(input.submittedAt))) throw new Error('EXECUTED_ENTRY_INVALID_SUBMITTED_AT');
  if (input.filledQuantity < 0 || input.filledQuantity > input.requestedQuantity) throw new Error('EXECUTED_ENTRY_INVALID_FILLED_QUANTITY');
  const hasConfirmedFill = input.filledQuantity > 0;
  if (hasConfirmedFill && input.firstFillAt === null) throw new Error('EXECUTED_ENTRY_FILL_WITHOUT_FILL_TIMESTAMP');
  if (input.firstFillAt !== null && Date.parse(input.firstFillAt) < Date.parse(input.submittedAt)) {
    throw new Error('EXECUTED_ENTRY_FILL_BEFORE_SUBMISSION');
  }
  const exposureStartAt = hasConfirmedFill ? input.firstFillAt : null;
  const terminalAt = TERMINAL_STATES.has(input.lifecycleState) ? (input.firstFillAt ?? input.submittedAt) : null;
  return { contractVersion: entryUnitSeparationVersion, ...input, exposureStartAt, terminalAt };
}

/** True only once real exposure exists -- the structural test target for
 * "submission != fill" and "selected candidate != executed episode." */
export function hasRealExposure(episode: ExecutedEntryEpisode): boolean {
  return episode.exposureStartAt !== null;
}
