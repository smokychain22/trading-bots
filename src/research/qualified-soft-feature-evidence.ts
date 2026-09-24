/**
 * Qualified soft-feature evidence contract (Wave 13 Batch 2). Research-only,
 * `brokerAuthority: false`. `PROVIDER_QUALIFIED` (per
 * `THETA_OPTIONOMICS_ACTIONABILITY_MATRIX.md`) is not the same claim as
 * "empirically proven to improve trades" -- this module gives the 3
 * currently-qualified Optionomics features (ATM IV, RV20, VRP20) a real,
 * typed evidence record with an explicit `decisionRole` and
 * `empiricalStatus`, so a future ranking consumer can use them as soft
 * inputs without silently treating provider qualification as a license
 * to hard-gate. No feature here may become a hard entry gate from this
 * module alone -- `decisionRole` is fixed to `SOFT_RANKER` for all three
 * at this stage, per this wave's explicit instruction.
 */

export const qualifiedSoftFeatureEvidenceVersion = 'theta-qualified-soft-feature-evidence-v2' as const;

export type QualifiedFeatureId = 'ATM_IV' | 'RV20' | 'VRP20';

export type DecisionRole = 'SOFT_RANKER' | 'SIZE_MODIFIER' | 'STRUCTURE_MODIFIER' | 'SHADOW_ONLY';
export type EmpiricalStatus = 'EMPIRICALLY_UNPROVEN' | 'SUPPORTED_OOS' | 'REJECTED';
export type PitState = 'PIT_SAFE' | 'CURRENT_ONLY' | 'PIT_UNSAFE' | 'UNKNOWN_PIT';
export type QualityState = 'PROVIDER_QUALIFIED' | 'PROVIDER_LIMITED' | 'METHODOLOGY_UNVERIFIED' | 'QUARANTINED';

export interface QualifiedSoftFeatureEvidence {
  readonly featureId: QualifiedFeatureId;
  readonly value: number | null;
  readonly unit: 'DECIMAL' | 'PERCENT';
  readonly provider: 'OPTIONOMICS';
  readonly providerField: string;
  readonly observedAt: string;
  readonly validThrough: string | null;
  readonly requestedDate: string | null;
  readonly servedDate: string | null;
  readonly methodologyVersion: string;
  readonly pitState: PitState;
  readonly qualityState: QualityState;
  readonly decisionRole: DecisionRole;
  readonly empiricalStatus: EmpiricalStatus;
  readonly pitEvidence: { readonly decisionAt: string; readonly providerKnownAt: string;
    readonly thetaFirstObservedAt: string; readonly evidenceId: string; readonly payloadHash: string } | null;
}

/** Fixed, real per-feature provenance -- never invented per call site. */
const FEATURE_REGISTRY: Readonly<Record<QualifiedFeatureId, {
  readonly providerField: string; readonly unit: 'DECIMAL' | 'PERCENT'; readonly methodologyVersion: string;
}>> = {
  ATM_IV: { providerField: 'atm_iv', unit: 'DECIMAL', methodologyVersion: 'optionomics-atm-iv-v1' },
  RV20: { providerField: 'iv_term_structure.realized_vs_implied.rv20', unit: 'DECIMAL', methodologyVersion: 'optionomics-rv20-v1' },
  VRP20: { providerField: 'iv_term_structure.realized_vs_implied.spread', unit: 'DECIMAL', methodologyVersion: 'optionomics-vrp20-v1' },
};

/**
 * Builds one real evidence record for a qualified feature. `value: null`
 * is a legitimate outcome (the provider did not return this field for
 * this observation) -- this function never substitutes a default. Every
 * one of the 3 currently-qualified features gets `decisionRole:
 * 'SOFT_RANKER'` and `empiricalStatus: 'EMPIRICALLY_UNPROVEN'` at
 * construction. Empirical promotion belongs to a separately governed
 * study and cannot be asserted by a caller of this feature builder.
 */
export function buildQualifiedSoftFeatureEvidence(input: {
  readonly featureId: QualifiedFeatureId;
  readonly value: number | null;
  readonly observedAt: string;
  readonly validThrough: string | null;
  readonly requestedDate: string | null;
  readonly servedDate: string | null;
  readonly empiricalStatus?: EmpiricalStatus;
  readonly pitEvidence?: QualifiedSoftFeatureEvidence['pitEvidence'];
}): QualifiedSoftFeatureEvidence {
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error('INVALID_OBSERVED_AT');
  if (input.value !== null && !Number.isFinite(input.value)) throw new Error('INVALID_FEATURE_VALUE');
  if (input.validThrough !== null && (!Number.isFinite(Date.parse(input.validThrough))
    || Date.parse(input.validThrough) < Date.parse(input.observedAt))) throw new Error('INVALID_VALID_THROUGH');
  if (input.empiricalStatus !== undefined && input.empiricalStatus !== 'EMPIRICALLY_UNPROVEN') {
    throw new Error('EMPIRICAL_PROMOTION_REQUIRES_GOVERNED_STUDY_NOT_FEATURE_BUILDER');
  }
  for (const date of [input.requestedDate, input.servedDate]) {
    if (date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
      || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('INVALID_FEATURE_SESSION');
  }
  const pit = input.pitEvidence ?? null;
  if (pit !== null && (!pit.evidenceId.trim() || !/^[a-f0-9]{64}$/.test(pit.payloadHash)
    || [pit.decisionAt, pit.providerKnownAt, pit.thetaFirstObservedAt].some((at) => !Number.isFinite(Date.parse(at))))) {
    throw new Error('INVALID_FEATURE_PIT_EVIDENCE');
  }
  const pitValid = pit !== null && Date.parse(pit.providerKnownAt) <= Date.parse(input.observedAt)
    && Date.parse(pit.thetaFirstObservedAt) <= Date.parse(input.observedAt)
    && Date.parse(input.observedAt) <= Date.parse(pit.decisionAt)
    && input.validThrough !== null && Date.parse(pit.decisionAt) <= Date.parse(input.validThrough);
  const meta = FEATURE_REGISTRY[input.featureId];
  const requestedServedMismatch = input.requestedDate !== null && input.servedDate !== null && input.requestedDate !== input.servedDate;
  const pitState: PitState = input.value === null ? 'UNKNOWN_PIT'
    : requestedServedMismatch ? 'PIT_UNSAFE'
      : pit !== null ? pitValid ? 'PIT_SAFE' : 'PIT_UNSAFE'
        : input.requestedDate !== null || input.servedDate !== null ? 'UNKNOWN_PIT' : 'CURRENT_ONLY';
  return {
    featureId: input.featureId, value: input.value, unit: meta.unit, provider: 'OPTIONOMICS',
    providerField: meta.providerField, observedAt: input.observedAt, validThrough: input.validThrough,
    requestedDate: input.requestedDate, servedDate: input.servedDate, methodologyVersion: meta.methodologyVersion,
    pitState, qualityState: 'PROVIDER_QUALIFIED', decisionRole: 'SOFT_RANKER',
    empiricalStatus: input.empiricalStatus ?? 'EMPIRICALLY_UNPROVEN',
    pitEvidence: pit,
  };
}
