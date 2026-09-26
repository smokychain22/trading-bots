/**
 * COMMAND 5B item 25: session experience report. Research-only,
 * `brokerAuthority: false`. A deterministic, callable report generator --
 * runs today against empty/fixture input and honestly reports an
 * empty-state, proving the mechanism itself works before any real data
 * exists. Never claims profitability.
 */

export const sessionExperienceReportVersion = 'theta-session-experience-report-v1' as const;

export interface SessionExperienceCounts {
  readonly newContractSubjects: number;
  readonly newQSubjects: number;
  readonly newHSubjects: number;
  readonly newDSubjects: number;
  readonly newRecoveryCcSubjects: number;
  readonly waitCount: number;
  readonly newFutureObservations: number;
  readonly maturedOutcomes: number;
  readonly pendingOutcomes: number;
  readonly missedObservations: number;
  readonly providerFailures: number;
  readonly identifiableCount: number;
  readonly notIdentifiableCount: number;
  readonly flowCohortCounts: Readonly<Record<string, number>>;
  readonly assignmentEvents: number;
  readonly recoveryEvents: number;
  readonly strategyComparisonCoverage: number;
  readonly newCalibrationSamples: number;
}

export interface SessionExperienceReport {
  readonly contractVersion: typeof sessionExperienceReportVersion;
  readonly sessionDate: string;
  readonly generatedAt: string;
  readonly counts: SessionExperienceCounts;
  /** Structurally present and always false at this contract level -- this
   * report never asserts a profitability conclusion; a real profitability
   * verdict, if any, lives in a separate, evidence-gated contract, never
   * folded into a session tally. */
  readonly profitabilityClaimed: false;
}

const EMPTY_COUNTS: SessionExperienceCounts = {
  newContractSubjects: 0, newQSubjects: 0, newHSubjects: 0, newDSubjects: 0, newRecoveryCcSubjects: 0,
  waitCount: 0, newFutureObservations: 0, maturedOutcomes: 0, pendingOutcomes: 0, missedObservations: 0,
  providerFailures: 0, identifiableCount: 0, notIdentifiableCount: 0, flowCohortCounts: {}, assignmentEvents: 0,
  recoveryEvents: 0, strategyComparisonCoverage: 0, newCalibrationSamples: 0,
};

/**
 * Deterministic report builder. Given real per-session counts, assembles
 * the report; given no input (or a partial one), fields default to the
 * honest empty state above -- never a fabricated nonzero count.
 */
export function buildSessionExperienceReport(input: {
  readonly sessionDate: string; readonly generatedAt: string; readonly counts?: Partial<SessionExperienceCounts>;
}): SessionExperienceReport {
  return {
    contractVersion: sessionExperienceReportVersion,
    sessionDate: input.sessionDate, generatedAt: input.generatedAt,
    counts: { ...EMPTY_COUNTS, ...input.counts },
    profitabilityClaimed: false,
  };
}

/** Proves the report mechanism itself is real and callable today, against
 * no real session data -- used by tests and available for a real caller
 * to invoke on a day with genuinely zero activity. */
export function buildEmptySessionExperienceReport(sessionDate: string, generatedAt: string): SessionExperienceReport {
  return buildSessionExperienceReport({ sessionDate, generatedAt });
}
