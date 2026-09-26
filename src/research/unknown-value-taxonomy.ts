/**
 * COMMAND 5C-7 item 6-9: canonical research-side UNKNOWN taxonomy.
 * Distinguishes "good UNKNOWN" (epistemically honest, nothing to fix) from
 * "avoidable UNKNOWN" (a real, closeable research-side gap). No generic
 * UNKNOWN may remain classified `UNCLASSIFIED_UNKNOWN` where a real reason
 * is already known -- that value exists only for a genuinely fresh,
 * not-yet-investigated case, never as a permanent resting state.
 */

export const unknownValueTaxonomyVersion = 'theta-unknown-value-taxonomy-v1' as const;

export type UnknownReasonCode =
  | 'LEGITIMATE_NOT_OBSERVABLE'
  | 'PROVIDER_FIELD_ABSENT'
  | 'PROVIDER_NOT_ENTITLED'
  | 'PROVIDER_FAILURE'
  | 'STALE_OBSERVATION'
  | 'TIMESTAMP_UNVERIFIED'
  | 'PARSE_FAILURE'
  | 'SOURCE_NOT_WIRED'
  | 'SOURCE_AVAILABLE_NOT_CONSUMED'
  | 'DERIVATION_NOT_IMPLEMENTED'
  | 'INSUFFICIENT_INPUTS'
  | 'LIFECYCLE_NOT_APPLICABLE'
  | 'COUNTERFACTUAL_NOT_IDENTIFIABLE'
  | 'FUTURE_LABEL_PENDING'
  | 'RIGHT_CENSORED'
  | 'RUNTIME_INPUT_PENDING'
  | 'UNCLASSIFIED_UNKNOWN';

export const ALL_UNKNOWN_REASON_CODES: readonly UnknownReasonCode[] = [
  'LEGITIMATE_NOT_OBSERVABLE', 'PROVIDER_FIELD_ABSENT', 'PROVIDER_NOT_ENTITLED', 'PROVIDER_FAILURE',
  'STALE_OBSERVATION', 'TIMESTAMP_UNVERIFIED', 'PARSE_FAILURE', 'SOURCE_NOT_WIRED',
  'SOURCE_AVAILABLE_NOT_CONSUMED', 'DERIVATION_NOT_IMPLEMENTED', 'INSUFFICIENT_INPUTS',
  'LIFECYCLE_NOT_APPLICABLE', 'COUNTERFACTUAL_NOT_IDENTIFIABLE', 'FUTURE_LABEL_PENDING',
  'RIGHT_CENSORED', 'RUNTIME_INPUT_PENDING', 'UNCLASSIFIED_UNKNOWN',
];

/**
 * `LEGITIMATE`: nothing to fix -- the value is genuinely unknowable right
 * now for a structural reason (lifecycle N/A, right-censored, a real
 * future label not yet arrived, an identified counterfactual). `AVOIDABLE`:
 * a real research-side gap that CAN be closed with code (an adapter that
 * isn't wired, a source that exists but isn't consumed, a derivation that
 * was never implemented, a parse failure). `EXTERNAL`: depends on a
 * provider or Codex-owned runtime input this research code cannot itself
 * produce.
 */
export type UnknownAvoidability = 'LEGITIMATE' | 'AVOIDABLE' | 'EXTERNAL' | 'UNCLASSIFIED';

const AVOIDABILITY_BY_REASON: Readonly<Record<UnknownReasonCode, UnknownAvoidability>> = {
  LEGITIMATE_NOT_OBSERVABLE: 'LEGITIMATE',
  LIFECYCLE_NOT_APPLICABLE: 'LEGITIMATE',
  COUNTERFACTUAL_NOT_IDENTIFIABLE: 'LEGITIMATE',
  FUTURE_LABEL_PENDING: 'LEGITIMATE',
  RIGHT_CENSORED: 'LEGITIMATE',
  PROVIDER_FIELD_ABSENT: 'EXTERNAL',
  PROVIDER_NOT_ENTITLED: 'EXTERNAL',
  PROVIDER_FAILURE: 'EXTERNAL',
  RUNTIME_INPUT_PENDING: 'EXTERNAL',
  STALE_OBSERVATION: 'AVOIDABLE',
  TIMESTAMP_UNVERIFIED: 'AVOIDABLE',
  PARSE_FAILURE: 'AVOIDABLE',
  SOURCE_NOT_WIRED: 'AVOIDABLE',
  SOURCE_AVAILABLE_NOT_CONSUMED: 'AVOIDABLE',
  DERIVATION_NOT_IMPLEMENTED: 'AVOIDABLE',
  INSUFFICIENT_INPUTS: 'AVOIDABLE',
  UNCLASSIFIED_UNKNOWN: 'UNCLASSIFIED',
};

export function classifyUnknownAvoidability(reason: UnknownReasonCode): UnknownAvoidability {
  return AVOIDABILITY_BY_REASON[reason];
}

export interface ClassifiedUnknown {
  readonly contractVersion: typeof unknownValueTaxonomyVersion;
  readonly fieldPath: string;
  readonly reason: UnknownReasonCode;
  readonly avoidability: UnknownAvoidability;
  readonly detail: string | null;
  readonly observedAt: string;
}

export function classifyUnknown(input: {
  readonly fieldPath: string;
  readonly reason: UnknownReasonCode;
  readonly detail?: string | null;
  readonly observedAt: string;
}): ClassifiedUnknown {
  return {
    contractVersion: unknownValueTaxonomyVersion,
    fieldPath: input.fieldPath,
    reason: input.reason,
    avoidability: classifyUnknownAvoidability(input.reason),
    detail: input.detail ?? null,
    observedAt: input.observedAt,
  };
}

/**
 * The central rule (Command 5C-7 §9): UNKNOWN must preserve epistemic
 * truth. This guard exists purely so calling code has one explicit place
 * to prove it never "fixes" an UNKNOWN by silently substituting a
 * plausible default. It throws if a caller passes a non-null fallback for
 * a value already classified as UNKNOWN -- there is no legitimate reason
 * to construct a numeric/boolean placeholder for an unknown field, and
 * this function makes that a hard, structural error rather than a
 * documentation-only convention.
 */
export function assertUnknownIsNeverCoercedToDefault<T>(
  value: T | null,
  classified: ClassifiedUnknown | null,
): T | null {
  if (classified !== null && value !== null) {
    throw new Error(`UNKNOWN_TAXONOMY_FORBIDDEN_COERCION:${classified.fieldPath}`);
  }
  return value;
}
