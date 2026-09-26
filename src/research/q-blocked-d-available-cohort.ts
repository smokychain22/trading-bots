/**
 * COMMAND 5C-7 item 25 (Command 2 §9's original ask, re-specified). A
 * dedicated research cohort for decision cycles where Q was blocked by
 * collateral/concentration/assignment-capacity while D remained
 * structurally available. The cohort builder is complete now; the
 * OUTCOME comparison stays UNKNOWN/NOT_IDENTIFIABLE until real data
 * exists -- this module does NOT conclude D was preferable.
 */

export const qBlockedDAvailableCohortVersion = 'theta-q-blocked-d-available-cohort-v1' as const;

export type QBlockReason = 'COLLATERAL_CAPACITY' | 'CONCENTRATION' | 'ASSIGNMENT_CAPACITY';

export interface QBlockedDAvailableSubject {
  readonly decisionId: string;
  readonly decisionAt: string;
  readonly underlying: string;
  readonly qBlockReasons: readonly QBlockReason[];
  readonly dStructurallyAvailable: boolean;
  /** Real capital-at-risk comparison at decision time -- structural, not
   * an outcome claim. Q's would-be capital exposure vs. D's actual
   * capital-at-risk (per `return-normalization.ts`'s max-loss basis). */
  readonly qWouldBeCapitalAtRisk: number | null;
  readonly dActualCapitalAtRisk: number | null;
}

export interface QBlockedDAvailableCohortSummary {
  readonly contractVersion: typeof qBlockedDAvailableCohortVersion;
  readonly subjectCount: number;
  readonly byBlockReason: Readonly<Record<QBlockReason, number>>;
  readonly averageCapitalAtRiskReduction: number | null;
  /** Explicitly UNKNOWN until real resolved episodes exist for both
   * sides -- this cohort NEVER reports an economic conclusion from
   * structural availability alone. */
  readonly economicConclusion: 'NOT_YET_POSSIBLE';
}

export function isQBlockedDAvailable(subject: QBlockedDAvailableSubject): boolean {
  return subject.qBlockReasons.length > 0 && subject.dStructurallyAvailable;
}

export function buildQBlockedDAvailableCohort(
  subjects: readonly QBlockedDAvailableSubject[],
): QBlockedDAvailableCohortSummary {
  const cohort = subjects.filter(isQBlockedDAvailable);
  const byBlockReason: Record<QBlockReason, number> = { COLLATERAL_CAPACITY: 0, CONCENTRATION: 0, ASSIGNMENT_CAPACITY: 0 };
  for (const subject of cohort) {
    for (const reason of subject.qBlockReasons) byBlockReason[reason] += 1;
  }
  const reductions = cohort
    .map((s) => (s.qWouldBeCapitalAtRisk !== null && s.dActualCapitalAtRisk !== null
      ? s.qWouldBeCapitalAtRisk - s.dActualCapitalAtRisk : null))
    .filter((v): v is number => v !== null);
  return {
    contractVersion: qBlockedDAvailableCohortVersion,
    subjectCount: cohort.length, byBlockReason,
    averageCapitalAtRiskReduction: reductions.length === 0 ? null : reductions.reduce((a, b) => a + b, 0) / reductions.length,
    economicConclusion: 'NOT_YET_POSSIBLE',
  };
}
