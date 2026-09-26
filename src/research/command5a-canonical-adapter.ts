/**
 * UNIFIED TAKEOVER GAP 5: the ONE canonical producer -> consumer adapter
 * from Codex's real Command 5A observation evidence into my research
 * contract-path evidence. Every other integration point (the
 * real-data-arrival harness, any future dataset builder) must call THIS
 * function -- no scattered one-off conversions.
 *
 * Composes, but does not reimplement:
 *  - gap 1: `command5a-checkpoint-mapping.ts` (exhaustive enum mapping)
 *  - gap 2/3: `command5a-mark-semantics.ts` (mark/IV, never averaged for D)
 *  - gap 4: `economic-completeness-gate.ts` (rejects silent economic nulls)
 *
 * Deterministic, side-effect-free, versioned, hashable. The original
 * Codex producer record is NEVER destroyed -- `sourceObservation` on the
 * output carries it verbatim, so an adapted row is always traceable back
 * to exactly what runtime actually observed.
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from './point-in-time-evidence.js';
import type { ContractPathObservationReceipt } from './contract-path-observation-runtime.js';
import { mapProducerCheckpointToPathCheckpoint } from './command5a-checkpoint-mapping.js';
import { computePackageMark, type LegIdentityForMark, type PackageMarkResult } from './command5a-mark-semantics.js';
import { evaluateEconomicCompleteness, type EconomicCompletenessResult, type FieldCompletenessState } from './economic-completeness-gate.js';
import type { RawObservationBundleRow } from './real-data-arrival-harness.js';

export const command5aCanonicalAdapterVersion = 'theta-command5a-canonical-adapter-v1' as const;

export interface Command5aAdapterSubjectContext {
  readonly subjectId: string;
  /** Whether this subject was ever actually SELECTED at decision time
   * (`SeriousResearchSubject.selected`) -- an observation of a rejected
   * candidate's later market path can never become factual regardless of
   * how the mark computes. */
  readonly wasSelected: boolean;
  /** `SeriousResearchSubject.shadowOnly` is always literally `true` for
   * every subject this scheduler produces -- carried through explicitly
   * so a caller can never accidentally construct an `OBSERVED_PARALLEL`
   * claim from this adapter's output. */
  readonly wasShadowOnly: true;
}

export interface AdaptedContractPathObservationRow {
  readonly contractVersion: typeof command5aCanonicalAdapterVersion;
  readonly producerContractVersion: string;
  readonly consumerContractVersion: 'theta-contract-path-outcome-dataset-v1';
  readonly adapterVersion: typeof command5aCanonicalAdapterVersion;
  readonly sourceSha: string;
  readonly workerSha: string;
  readonly observationIdentity: string;
  readonly subjectIdentity: string;
  readonly checkpoint: RawObservationBundleRow['checkpoint'];
  readonly observedAt: string;
  readonly targetAt: string;
  readonly delaySeconds: number;
  readonly mark: PackageMarkResult;
  readonly underlyingPrice: number | null;
  readonly wasSelected: boolean;
  readonly wasShadowOnly: true;
  readonly completeness: EconomicCompletenessResult;
  /** The verbatim original producer record -- never destroyed or
   * overwritten by adaptation. This is the canonical source of what
   * runtime actually observed. */
  readonly sourceObservation: ContractPathObservationReceipt;
}

function requirement(fieldPath: string, value: number | null, state: FieldCompletenessState, required: boolean) {
  return { fieldPath, value, state, required };
}

/**
 * Adapts one real Command 5A observation receipt into canonical research
 * evidence. Throws only on structurally invalid input (leg/quote
 * mismatch, already validated by `computePackageMark`); a genuinely
 * missing economic field is reported via `completeness`, never coerced.
 */
export function adaptCommand5aObservation(input: {
  readonly receipt: ContractPathObservationReceipt;
  readonly legIdentities: readonly LegIdentityForMark[];
  readonly subject: Command5aAdapterSubjectContext;
}): AdaptedContractPathObservationRow {
  if (input.receipt.subjectId !== input.subject.subjectId) throw new Error('COMMAND5A_ADAPTER_SUBJECT_MISMATCH');
  const mark = computePackageMark({ legIdentities: input.legIdentities, quotes: input.receipt.legs });
  const checkpoint = mapProducerCheckpointToPathCheckpoint(input.receipt.checkpoint);

  const fields = [
    requirement('mark.packageMark', mark.packageMark, mark.identifiability === 'NOT_IDENTIFIABLE' ? 'FIELD_PROVIDER_MISSING' : 'FIELD_PRESENT_VALID', true),
    requirement('underlying.price', input.receipt.underlying.price, input.receipt.underlying.price === null ? 'FIELD_PROVIDER_MISSING' : 'FIELD_PRESENT_VALID', true),
    requirement(
      'mark.impliedVolatility',
      mark.singleLegImpliedVolatility ?? mark.shortLegImpliedVolatility,
      (mark.singleLegImpliedVolatility ?? mark.shortLegImpliedVolatility) === null ? 'FIELD_PROVIDER_MISSING' : 'FIELD_PRESENT_VALID',
      false, // IV absence never blocks acceptance -- it's a real, common provider gap, not evidence of an adapter defect
    ),
  ];
  const completeness = evaluateEconomicCompleteness({
    datasetId: input.receipt.observationId, fields, observedAt: input.receipt.actualObservedAt,
  });

  const withoutHash = {
    contractVersion: command5aCanonicalAdapterVersion,
    producerContractVersion: input.receipt.contractVersion,
    consumerContractVersion: 'theta-contract-path-outcome-dataset-v1' as const,
    adapterVersion: command5aCanonicalAdapterVersion,
    sourceSha: input.receipt.sourceSha,
    workerSha: input.receipt.workerSha,
    observationIdentity: input.receipt.observationId,
    subjectIdentity: input.receipt.subjectId,
    checkpoint,
    observedAt: input.receipt.actualObservedAt,
    targetAt: input.receipt.targetAt,
    delaySeconds: input.receipt.delaySeconds,
    mark,
    underlyingPrice: input.receipt.underlying.price,
    wasSelected: input.subject.wasSelected,
    wasShadowOnly: input.subject.wasShadowOnly,
    completeness,
    sourceObservation: input.receipt,
  };
  return withoutHash;
}

/** Projects the canonical adapted row down into the harness's existing
 * `RawObservationBundleRow` shape -- kept as a real, named, separately
 * testable narrowing step (not folded silently into
 * `adaptCommand5aObservation`) so a future consumer that needs the full
 * canonical row (mark detail, leg-level IV, completeness verdict) is not
 * forced to lose it just because one particular downstream (the harness)
 * only needs the narrower shape. */
export function projectToRawObservationBundleRow(row: AdaptedContractPathObservationRow): RawObservationBundleRow {
  if (row.completeness.outcome === 'DATASET_INCOMPLETE') {
    throw new Error(`COMMAND5A_ADAPTER_DATASET_INCOMPLETE:${row.completeness.rejectedFields.join(',')}`);
  }
  return {
    subjectId: row.subjectIdentity,
    checkpoint: row.checkpoint,
    observedAt: row.observedAt,
    marketMarkPrice: row.mark.packageMark,
    impliedVolatility: row.mark.singleLegImpliedVolatility ?? row.mark.shortLegImpliedVolatility,
    underlyingPrice: row.underlyingPrice,
    sourceSha: row.sourceSha,
    workerSha: row.workerSha,
    provenance: 'REAL_SCHEDULED_OBSERVATION',
  };
}

export function hashAdaptedRow(row: AdaptedContractPathObservationRow): string {
  return createHash('sha256').update(canonicalJson(row)).digest('hex');
}
