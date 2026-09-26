/**
 * COMMAND 4 item 5 / COMMAND 3 correction 0.C + 5. Assignment event label
 * builder. Research-only, `brokerAuthority: false`.
 *
 * `NO_ASSIGNMENT` is a FACTUAL NEGATIVE outcome -- only when assignment
 * exposure definitively ended (position closed, expired unassigned, or
 * another terminal lifecycle event removed exposure). `RIGHT_CENSORED`
 * applies only when the observation cutoff occurs while assignment risk
 * remains genuinely active. A definitively-unassigned closed position is
 * never reported as censored (per direct owner correction).
 */

export const assignmentLabelBuilderVersion = 'theta-assignment-label-builder-v1' as const;

export type AssignmentLabel = 'EARLY_ASSIGNMENT' | 'EXPIRATION_ASSIGNMENT' | 'NO_ASSIGNMENT' | 'RIGHT_CENSORED';

export type AssignmentLegRole = 'Q_SHORT_PUT' | 'H_SHORT_PUT' | 'D_SHORT_LEG_WITH_LONG_PROTECTION' | 'CC_SHORT_CALL';

export interface AssignmentLabelInput {
  readonly positionEpisodeId: string;
  readonly legRole: AssignmentLegRole;
  readonly assignmentNoticeAt: string | null;
  readonly assignmentWasAtExpiration: boolean | null;
  /** True once the option position reached a real terminal lifecycle state
   * (closed, expired, or assigned) -- distinct from "the dataset build
   * cutoff was reached." A position can be terminal without assignment risk
   * ever having been at risk of censoring (e.g. closed early). */
  readonly reachedTerminalLifecycleState: boolean;
  readonly observationCutoffAt: string;
  readonly longProtectionStillOpen: boolean | null;
}

export interface AssignmentLabelResult {
  readonly contractVersion: typeof assignmentLabelBuilderVersion;
  readonly positionEpisodeId: string;
  readonly label: AssignmentLabel;
  /** Only meaningful for `D_SHORT_LEG_WITH_LONG_PROTECTION`: whether the
   * long leg remained open at the moment of a short-leg assignment -- a
   * genuinely distinct economic event from Q's simple binary assignment. */
  readonly longProtectionRemainingAtAssignment: boolean | null;
}

export function buildAssignmentLabel(input: AssignmentLabelInput): AssignmentLabelResult {
  if (!Number.isFinite(Date.parse(input.observationCutoffAt))) throw new Error('ASSIGNMENT_LABEL_INVALID_OBSERVATION_CUTOFF');
  if (input.assignmentNoticeAt !== null && !Number.isFinite(Date.parse(input.assignmentNoticeAt))) {
    throw new Error('ASSIGNMENT_LABEL_INVALID_NOTICE_AT');
  }

  if (input.assignmentNoticeAt !== null) {
    const label: AssignmentLabel = input.assignmentWasAtExpiration === true ? 'EXPIRATION_ASSIGNMENT' : 'EARLY_ASSIGNMENT';
    return {
      contractVersion: assignmentLabelBuilderVersion, positionEpisodeId: input.positionEpisodeId, label,
      longProtectionRemainingAtAssignment: input.legRole === 'D_SHORT_LEG_WITH_LONG_PROTECTION' ? input.longProtectionStillOpen : null,
    };
  }

  // No assignment notice exists. Whether that is a real factual negative
  // (NO_ASSIGNMENT) or a censoring event (RIGHT_CENSORED) depends
  // exclusively on whether assignment exposure has definitively ended --
  // never on whether the observation cutoff has merely been reached.
  const label: AssignmentLabel = input.reachedTerminalLifecycleState ? 'NO_ASSIGNMENT' : 'RIGHT_CENSORED';
  return {
    contractVersion: assignmentLabelBuilderVersion, positionEpisodeId: input.positionEpisodeId, label,
    longProtectionRemainingAtAssignment: null,
  };
}
