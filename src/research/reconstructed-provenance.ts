/**
 * COMMAND 4 item 9 (PIT validation extension) / COMMAND 3 item 39. Explicit
 * provenance split so reconstructed historical information can never
 * masquerade as data actually known at the original decision time.
 * Research-only, `brokerAuthority: false`. Extends (does not replace)
 * `point-in-time-evidence.ts`'s real `assertNoFutureLabels`/PIT machinery.
 */

export const reconstructedProvenanceVersion = 'theta-reconstructed-provenance-v1' as const;

export type ProvenanceKind = 'OBSERVED_POINT_IN_TIME' | 'RECONSTRUCTED';

export interface ProvenanceTaggedValue<T> {
  readonly contractVersion: typeof reconstructedProvenanceVersion;
  readonly kind: ProvenanceKind;
  readonly value: T;
  /** Required, non-empty only for `RECONSTRUCTED` -- names the real source
   * and method used to reconstruct the value, and the honest limitation
   * (e.g. "derived from current-code re-evaluation of historical Sep 2026
   * replay; original session never captured this field"). */
  readonly reconstructionNote: string | null;
  readonly observedAt: string | null;
}

export function observedAtDecisionTime<T>(value: T, observedAt: string): ProvenanceTaggedValue<T> {
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('PROVENANCE_INVALID_OBSERVED_AT');
  return { contractVersion: reconstructedProvenanceVersion, kind: 'OBSERVED_POINT_IN_TIME', value, reconstructionNote: null, observedAt };
}

export function reconstructedValue<T>(value: T, reconstructionNote: string): ProvenanceTaggedValue<T> {
  if (reconstructionNote.trim().length === 0) throw new Error('PROVENANCE_RECONSTRUCTED_REQUIRES_NOTE');
  return { contractVersion: reconstructedProvenanceVersion, kind: 'RECONSTRUCTED', value, reconstructionNote, observedAt: null };
}

/**
 * Structural rule: two `ProvenanceTaggedValue`s can never be merged into
 * one field without the caller explicitly choosing a resolution -- this
 * function refuses to silently prefer one, forcing the decision into the
 * open. Real point-in-time-observed values are the only ones eligible for
 * factual supervised training (see `empirical-identifiability-taxonomy.ts`);
 * a `RECONSTRUCTED` value is eligible for research visualization only.
 */
export function assertNotSilentlyMerged<T>(observed: ProvenanceTaggedValue<T> | null, reconstructed: ProvenanceTaggedValue<T> | null): void {
  if (observed !== null && reconstructed !== null) {
    throw new Error('PROVENANCE_OBSERVED_AND_RECONSTRUCTED_MUST_NOT_COEXIST_FOR_SAME_FIELD');
  }
}

export function isEligibleForFactualTraining(tagged: ProvenanceTaggedValue<unknown>): boolean {
  return tagged.kind === 'OBSERVED_POINT_IN_TIME';
}
