/**
 * COMMAND 4 item 1/2. Central, versioned truth/identifiability taxonomy for
 * every empirical research dataset THETA builds. Research-only,
 * `brokerAuthority: false`.
 *
 * Distinct from (and more granular than) `wait-regret-dataset.ts`'s
 * `CounterfactualStatus` (`OBSERVED_PARALLEL | ESTIMABLE | NOT_IDENTIFIABLE`)
 * and `cross-strategy-common-horizon-contract.ts`'s `EmpiricalDatum`
 * (`KNOWN | UNKNOWN | NOT_APPLICABLE`, a data-availability concept, not a
 * causal-identifiability one). This module does not replace either -- it is
 * the shared vocabulary every NEW dataset contract in this build wave uses,
 * so no two builders invent inconsistent strings for the same concept.
 *
 * The six states, per THETA COMMAND 3 Part 2:
 *  - FACTUAL_OBSERVED: the action/strategy actually taken, real observed
 *    outcome. Eligible for supervised training, calibration, promotion
 *    evidence -- the strongest class.
 *  - OBSERVED_PARALLEL: an alternative independently AUTHORIZED and
 *    ACTUALLY EXECUTED (real broker fills), whose outcome was observed. A
 *    pure shadow/model prediction can never earn this status (see
 *    `assertNotShadowClaimingObservedParallel`).
 *  - OFF_POLICY_ESTIMABLE: not taken here, but estimable under a KNOWN
 *    logged behavior policy with known propensity/support. Usable only for
 *    policy evaluation, never as a direct supervised label.
 *  - MATCHED_ESTIMABLE: estimated from sufficiently comparable historical
 *    episodes. Usable for policy evaluation and research visualization,
 *    never promotion evidence alone.
 *  - MODEL_BASED_ESTIMATE: a model's own prediction. Research visualization
 *    only -- must NEVER be treated as ground truth, including by the model
 *    that produced it (no self-referential bootstrapping).
 *  - NOT_IDENTIFIABLE: no defensible estimate exists. Retained as a
 *    denominator record; quantitative outcome stays `null`, never a
 *    fabricated value.
 */

export const identifiabilityTaxonomyVersion = 'theta-identifiability-taxonomy-v1' as const;

export type IdentifiabilityStatus =
  | 'FACTUAL_OBSERVED'
  | 'OBSERVED_PARALLEL'
  | 'OFF_POLICY_ESTIMABLE'
  | 'MATCHED_ESTIMABLE'
  | 'MODEL_BASED_ESTIMATE'
  | 'NOT_IDENTIFIABLE';

export type IdentifiabilityUse = 'SUPERVISED_TRAINING' | 'CALIBRATION' | 'POLICY_EVALUATION' | 'RESEARCH_VISUALIZATION' | 'PROMOTION_EVIDENCE';

/** The exact allowed-use matrix from COMMAND 3 Part 2. `FACTUAL_OBSERVED` is
 * the only status eligible for every use; `NOT_IDENTIFIABLE` is eligible
 * for none (it carries no usable outcome at all). */
const ALLOWED_USES: Readonly<Record<IdentifiabilityStatus, readonly IdentifiabilityUse[]>> = {
  FACTUAL_OBSERVED: ['SUPERVISED_TRAINING', 'CALIBRATION', 'POLICY_EVALUATION', 'RESEARCH_VISUALIZATION', 'PROMOTION_EVIDENCE'],
  OBSERVED_PARALLEL: ['SUPERVISED_TRAINING', 'CALIBRATION', 'POLICY_EVALUATION', 'RESEARCH_VISUALIZATION'],
  OFF_POLICY_ESTIMABLE: ['POLICY_EVALUATION', 'RESEARCH_VISUALIZATION'],
  MATCHED_ESTIMABLE: ['POLICY_EVALUATION', 'RESEARCH_VISUALIZATION'],
  MODEL_BASED_ESTIMATE: ['RESEARCH_VISUALIZATION'],
  NOT_IDENTIFIABLE: [],
};

export function isUseAllowed(status: IdentifiabilityStatus, use: IdentifiabilityUse): boolean {
  return ALLOWED_USES[status].includes(use);
}

/** Throws if `status` may not be used for `use` -- the enforcement point
 * every dataset builder in this build wave calls before treating a row as
 * ground truth for that purpose. */
export function assertIdentifiabilityUse(status: IdentifiabilityStatus, use: IdentifiabilityUse): void {
  if (!isUseAllowed(status, use)) {
    throw new Error(`IDENTIFIABILITY_USE_NOT_ALLOWED:${status}:${use}`);
  }
}

/**
 * A `MODEL_BASED_ESTIMATE` (or anything less than `OBSERVED_PARALLEL`) may
 * never be relabeled `OBSERVED_PARALLEL` merely because a shadow model ran
 * in parallel -- `OBSERVED_PARALLEL` requires a real, independently
 * authorized, ACTUALLY EXECUTED alternative (real broker fills). A pure
 * shadow prediction has no broker authority by construction (see
 * `shadow-prediction-receipt.ts`) and can never earn this status. Callers
 * constructing an `OBSERVED_PARALLEL` row must supply proof of real
 * execution; this function is the one place that assertion is checked.
 */
export function assertNotShadowClaimingObservedParallel(input: { readonly status: IdentifiabilityStatus; readonly wasShadowOnly: boolean }): void {
  if (input.status === 'OBSERVED_PARALLEL' && input.wasShadowOnly) {
    throw new Error('SHADOW_PREDICTION_CANNOT_BE_OBSERVED_PARALLEL');
  }
}

/** A quantitative outcome value paired with its identifiability status.
 * `NOT_IDENTIFIABLE` structurally forces `value: null` -- there is no way
 * to construct one of these with a non-null value and that status, so a
 * caller cannot accidentally attach a real number to an unidentifiable row. */
export type IdentifiedOutcome<T> =
  | { readonly status: Exclude<IdentifiabilityStatus, 'NOT_IDENTIFIABLE'>; readonly value: T }
  | { readonly status: 'NOT_IDENTIFIABLE'; readonly value: null };

export function factualOutcome<T>(value: T): IdentifiedOutcome<T> { return { status: 'FACTUAL_OBSERVED', value }; }
export function notIdentifiableOutcome<T>(): IdentifiedOutcome<T> { return { status: 'NOT_IDENTIFIABLE', value: null }; }

/** Extracts the value only if `status` is allowed for `use`; otherwise
 * returns `null` rather than letting a caller silently misuse a weaker
 * evidence class as if it were the strongest one. */
export function outcomeValueForUse<T>(outcome: IdentifiedOutcome<T>, use: IdentifiabilityUse): T | null {
  return isUseAllowed(outcome.status, use) ? outcome.value : null;
}
