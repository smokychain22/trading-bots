/**
 * COMMAND 5C-7 item 46: real session-experience aggregator. Builds a
 * `SessionExperienceReport` (Command 5B) from an array of real per-cycle
 * evidence records rather than caller-asserted counts -- and distinguishes
 * a measured zero from UNKNOWN/NOT_APPLICABLE/NOT_YET_MATURED explicitly,
 * via `unknown-value-taxonomy.ts`, in a companion data-quality receipt
 * (the base `SessionExperienceCounts` schema is all real integers by
 * design -- "how many" is always a real count -- so the distinction this
 * item asks for lives in a separate per-field data-quality view, not by
 * changing counts into nullable fields).
 */
import { buildSessionExperienceReport, type SessionExperienceCounts, type SessionExperienceReport } from './session-experience-report.js';
import { classifyUnknown, type UnknownReasonCode } from './unknown-value-taxonomy.js';

export const sessionExperienceBuilderVersion = 'theta-session-experience-builder-v1' as const;

export type CycleSubjectKind = 'CONTRACT' | 'Q' | 'H' | 'D' | 'RECOVERY_CC';

export interface CycleEvidenceRecord {
  readonly cycleId: string;
  readonly observedAt: string;
  readonly subjectsBySubjectKind: Readonly<Record<CycleSubjectKind, number>>;
  readonly wasWait: boolean;
  readonly futureObservationRecorded: boolean;
  readonly outcomeMatured: boolean;
  readonly outcomePending: boolean;
  readonly observationMissed: boolean;
  readonly providerFailed: boolean;
  readonly identifiable: boolean;
  readonly flowCohort: string | null;
  readonly wasAssignmentEvent: boolean;
  readonly wasRecoveryEvent: boolean;
  readonly strategyComparisonPerformed: boolean;
  readonly newCalibrationSample: boolean;
  /** Real reason when a field genuinely could not be determined for this
   * cycle -- distinct from a measured "false"/0 for that field. */
  readonly unresolvedFields: readonly { readonly field: string; readonly reason: UnknownReasonCode }[];
}

export interface SessionDataQualityEntry {
  readonly field: string;
  readonly reason: UnknownReasonCode;
  readonly avoidability: string;
}

export interface SessionExperienceBuildResult {
  readonly contractVersion: typeof sessionExperienceBuilderVersion;
  readonly report: SessionExperienceReport;
  readonly dataQuality: readonly SessionDataQualityEntry[];
  readonly cyclesProcessed: number;
}

function tally(records: readonly CycleEvidenceRecord[], kind: CycleSubjectKind): number {
  return records.reduce((sum, r) => sum + (r.subjectsBySubjectKind[kind] ?? 0), 0);
}

function flowCohortCounts(records: readonly CycleEvidenceRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    if (record.flowCohort === null) continue;
    counts[record.flowCohort] = (counts[record.flowCohort] ?? 0) + 1;
  }
  return counts;
}

/**
 * Real aggregator: sums real per-cycle evidence into the session's
 * counts (every field a genuine count, zero is a real, meaningful zero),
 * and separately surfaces every field any cycle reported as genuinely
 * unresolved (rather than silently omitting it from the tally, or
 * silently coercing it to zero).
 */
export function buildSessionExperienceFromEvidence(input: {
  readonly sessionDate: string; readonly generatedAt: string; readonly records: readonly CycleEvidenceRecord[];
}): SessionExperienceBuildResult {
  const { records } = input;
  const counts: Partial<SessionExperienceCounts> = {
    newContractSubjects: tally(records, 'CONTRACT'), newQSubjects: tally(records, 'Q'),
    newHSubjects: tally(records, 'H'), newDSubjects: tally(records, 'D'), newRecoveryCcSubjects: tally(records, 'RECOVERY_CC'),
    waitCount: records.filter((r) => r.wasWait).length,
    newFutureObservations: records.filter((r) => r.futureObservationRecorded).length,
    maturedOutcomes: records.filter((r) => r.outcomeMatured).length,
    pendingOutcomes: records.filter((r) => r.outcomePending).length,
    missedObservations: records.filter((r) => r.observationMissed).length,
    providerFailures: records.filter((r) => r.providerFailed).length,
    identifiableCount: records.filter((r) => r.identifiable).length,
    notIdentifiableCount: records.filter((r) => !r.identifiable).length,
    flowCohortCounts: flowCohortCounts(records),
    assignmentEvents: records.filter((r) => r.wasAssignmentEvent).length,
    recoveryEvents: records.filter((r) => r.wasRecoveryEvent).length,
    strategyComparisonCoverage: records.filter((r) => r.strategyComparisonPerformed).length,
    newCalibrationSamples: records.filter((r) => r.newCalibrationSample).length,
  };
  const dataQuality: SessionDataQualityEntry[] = records.flatMap((r) =>
    r.unresolvedFields.map((u) => {
      const classified = classifyUnknown({ fieldPath: `${r.cycleId}.${u.field}`, reason: u.reason, observedAt: r.observedAt });
      return { field: classified.fieldPath, reason: classified.reason, avoidability: classified.avoidability };
    }));

  return {
    contractVersion: sessionExperienceBuilderVersion,
    report: buildSessionExperienceReport({ sessionDate: input.sessionDate, generatedAt: input.generatedAt, counts }),
    dataQuality, cyclesProcessed: records.length,
  };
}
