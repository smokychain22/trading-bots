/**
 * UNIFIED TAKEOVER GAP 4 (the most dangerous integration defect found by
 * the Command 5A review): a naive integration can PASS schema validation
 * while silently emitting `null` for real economic fields, because `null`
 * is a legitimately valid value for genuinely-unobservable data. That
 * makes an economically-empty row indistinguishable from a real one at
 * the schema layer alone.
 *
 * This module adds a SECOND, separate gate that runs on top of (never
 * instead of) schema validation: every economic field a dataset row
 * claims is explicitly classified, and a row whose classification implies
 * "this should have been populated but the adapter failed to map it" is
 * REJECTED (`DATASET_INCOMPLETE`), not silently accepted as valid with
 * null economics.
 *
 * Reuses `unknown-value-taxonomy.ts`'s real `UnknownReasonCode` as the
 * underlying classification vocabulary rather than inventing a second,
 * parallel unknown taxonomy -- the seven field-completeness states below
 * are a narrower, field-scoped VIEW onto that same taxonomy, each mapped
 * to exactly one real `UnknownReasonCode`.
 */
import { classifyUnknown, type UnknownReasonCode, type ClassifiedUnknown } from './unknown-value-taxonomy.js';

export const economicCompletenessGateVersion = 'theta-economic-completeness-gate-v1' as const;

export type FieldCompletenessState =
  | 'FIELD_NOT_APPLICABLE'
  | 'FIELD_NOT_OBSERVED'
  | 'FIELD_PROVIDER_MISSING'
  | 'FIELD_PRODUCER_NOT_WIRED'
  | 'FIELD_DERIVATION_NOT_IMPLEMENTED'
  | 'FIELD_COUNTERFACTUAL_NOT_IDENTIFIABLE'
  | 'FIELD_PRESENT_VALID';

/** Every `FieldCompletenessState` other than `FIELD_PRESENT_VALID` and
 * `FIELD_NOT_APPLICABLE` means "this field is null for a reason that
 * indicates a real gap the adapter/producer chain should eventually
 * close" -- these are the states that make a REQUIRED economic field's
 * nullness dangerous rather than honest. */
const REQUIRES_ADAPTER_ATTENTION: ReadonlySet<FieldCompletenessState> = new Set([
  'FIELD_PROVIDER_MISSING', 'FIELD_PRODUCER_NOT_WIRED', 'FIELD_DERIVATION_NOT_IMPLEMENTED',
]);

const UNKNOWN_REASON_BY_FIELD_STATE: Readonly<Record<FieldCompletenessState, UnknownReasonCode | null>> = {
  FIELD_NOT_APPLICABLE: 'LIFECYCLE_NOT_APPLICABLE',
  FIELD_NOT_OBSERVED: 'RUNTIME_INPUT_PENDING',
  FIELD_PROVIDER_MISSING: 'PROVIDER_FIELD_ABSENT',
  FIELD_PRODUCER_NOT_WIRED: 'SOURCE_NOT_WIRED',
  FIELD_DERIVATION_NOT_IMPLEMENTED: 'DERIVATION_NOT_IMPLEMENTED',
  FIELD_COUNTERFACTUAL_NOT_IDENTIFIABLE: 'COUNTERFACTUAL_NOT_IDENTIFIABLE',
  FIELD_PRESENT_VALID: null,
};

export interface EconomicFieldRequirement {
  readonly fieldPath: string;
  readonly value: unknown;
  readonly state: FieldCompletenessState;
  /** Whether this dataset type structurally requires this field to be
   * `FIELD_PRESENT_VALID` (or a genuinely legitimate absence class) before
   * the row may be accepted -- e.g. a resolved whole-chain row requires
   * `packageMark`, but an open/censored chain does not. */
  readonly required: boolean;
}

export interface EconomicCompletenessResult {
  readonly contractVersion: typeof economicCompletenessGateVersion;
  readonly datasetId: string;
  readonly outcome: 'ACCEPTED' | 'DATASET_INCOMPLETE';
  readonly rejectedFields: readonly string[];
  readonly unknowns: readonly ClassifiedUnknown[];
}

/**
 * The actual gate. For every `required: true` field whose `value` is
 * `null`, the field's classification must be a LEGITIMATE absence
 * (`FIELD_NOT_APPLICABLE` or `FIELD_COUNTERFACTUAL_NOT_IDENTIFIABLE`) --
 * anything in `REQUIRES_ADAPTER_ATTENTION` means the value SHOULD exist
 * but a real link in the chain (provider/producer/derivation) failed, and
 * the row is rejected outright rather than silently passed through with a
 * null in an "accepted" dataset.
 *
 * This is the exact mechanism that catches the review's own finding:
 * `marketMarkPrice`/`impliedVolatility`/`underlyingPrice` passing schema
 * validation as `null` on a row that DOES have real observed evidence
 * available (i.e. the adapter simply failed to map it) is now a hard
 * reject, not a silent pass.
 */
export function evaluateEconomicCompleteness(input: {
  readonly datasetId: string;
  readonly fields: readonly EconomicFieldRequirement[];
  readonly observedAt: string;
}): EconomicCompletenessResult {
  const rejectedFields: string[] = [];
  const unknowns: ClassifiedUnknown[] = [];
  for (const field of input.fields) {
    if (field.value !== null) continue; // present -- no completeness concern regardless of declared state
    if (field.state === 'FIELD_PRESENT_VALID') {
      throw new Error(`ECONOMIC_COMPLETENESS_STATE_VALUE_MISMATCH:${field.fieldPath}`);
    }
    const reason = UNKNOWN_REASON_BY_FIELD_STATE[field.state];
    if (reason !== null) unknowns.push(classifyUnknown({ fieldPath: field.fieldPath, reason, observedAt: input.observedAt }));
    if (field.required && REQUIRES_ADAPTER_ATTENTION.has(field.state)) rejectedFields.push(field.fieldPath);
  }
  return {
    contractVersion: economicCompletenessGateVersion,
    datasetId: input.datasetId,
    outcome: rejectedFields.length > 0 ? 'DATASET_INCOMPLETE' : 'ACCEPTED',
    rejectedFields,
    unknowns,
  };
}
