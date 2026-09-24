import type { z } from 'zod';
import { thetaFeatureFamily } from '../theta/strategy-package.js';

/**
 * Research/diagnostic only. `brokerAuthority: false` always. This module
 * owns NO ownership, AEGIS, sizing, or routing authority. It never
 * decides whether a candidate is applicable/eligible/tradeable -- it only
 * measures, over an already-recorded batch of candidate evidence, WHICH
 * evidence was missing, HOW OFTEN, and AT WHICH pipeline stage.
 *
 * Confirmed by direct inspection before writing this file (against
 * canonical main `bac973b`): `zero-trade-diagnostic.ts` (Codex, 431
 * lines) already builds a rich CYCLE-level and regex-bucketed
 * quote/liquidity/AEGIS funnel over the same raw `unknownEvidence`/
 * `hardBlockers` reason-code strings this module consumes -- this module
 * does not duplicate that funnel. What canonical main does NOT have,
 * confirmed by inspection of `canonical-strategy-frontier.ts`'s
 * `commonEvidence()` (the actual place these reason-code strings are
 * generated): ownership's `OwnershipEvaluationResponse.ownability`/its 5
 * components (`ownership-contract.ts`) are NEVER pushed into
 * `unknownEvidence` at all today -- only AEGIS gets an explicit
 * `AEGIS_STATE_UNKNOWN` code. This is a genuine, confirmed gap: ownership
 * completeness cannot currently be measured from reason-code tallies the
 * way AEGIS/quote/liquidity completeness can, so this module accepts
 * ownership evidence as its own direct field (`ownershipComponents`)
 * rather than trying to regex-mine it out of strings that don't exist.
 *
 * `featureFamilyCompleteness` reuses the canonical `thetaFeatureFamily`
 * enum (`strategy-package.ts`) as its grouping taxonomy -- it does not
 * invent a parallel one. The reason-code -> feature-family mapping
 * (`REASON_CODE_FEATURE_FAMILY`) below is built ONLY from reason-code
 * strings confirmed present in real canonical code
 * (`canonical-strategy-frontier.ts`'s `commonEvidence()`/`structuralSizing()`),
 * never invented; any reason code not in that table is tracked
 * separately as `unmappedReasonCodeCounts` rather than silently dropped
 * or force-mapped.
 */
export const evidenceCompletenessDiagnosticVersion = 'theta-evidence-completeness-diagnostic-v1' as const;

export type ThetaFeatureFamily = z.infer<typeof thetaFeatureFamily>;

/** Exact member names of `ownership-contract.ts`'s `componentScoreSchema.name`. */
export type OwnershipComponentName = 'LiquidityQuality' | 'StructuralQuality' | 'RecoveryQuality' | 'TailQuality' | 'EventAdjustment';

/** Confirmed exact reason-code strings from `canonical-strategy-frontier.ts`'s
 * `commonEvidence()`/`structuralSizing()`, mapped to the canonical
 * `thetaFeatureFamily` they most directly describe. `null` means the code
 * is a real canonical reason but does not correspond to any single
 * feature family (e.g. AEGIS's own state, which is a separate risk
 * authority, not a "feature"). This table is deliberately NOT exhaustive
 * of every reason code that could ever appear -- any code observed at
 * runtime that isn't listed here is reported under
 * `unmappedReasonCodeCounts`, never guessed into a family. */
export const REASON_CODE_FEATURE_FAMILY: Readonly<Record<string, ThetaFeatureFamily | null>> = {
  OCC_IDENTITY_UNKNOWN: 'EXECUTION_QUALITY',
  AEGIS_STATE_UNKNOWN: null,
  EVENT_STATE_UNKNOWN: 'EVENT_CONTEXT',
  IV_UNKNOWN: 'IV',
  DELTA_UNKNOWN: 'IV',
  OPEN_INTEREST_UNKNOWN: 'VOLUME_OPEN_INTEREST',
  VOLUME_UNKNOWN: 'VOLUME_OPEN_INTEREST',
  ASSIGNMENT_CAPACITY_UNKNOWN: 'PORTFOLIO_EXPOSURE',
  NO_ASSIGNMENT_CAPACITY: 'PORTFOLIO_EXPOSURE',
  REDUCED_MULTIPLIER_UNKNOWN: 'EXECUTION_QUALITY',
  MULTI_LEG_PRICE_UNKNOWN: 'EXECUTION_QUALITY',
  INVALID_SPREAD_WIDTH: 'EXECUTION_QUALITY',
  MISMATCHED_EXPIRATION: 'EXECUTION_QUALITY',
  MISMATCHED_MULTIPLIER: 'EXECUTION_QUALITY',
  NON_POSITIVE_NET_CREDIT: null,
};

export interface CandidateEvidenceCompletenessInput {
  readonly candidateId: string;
  readonly snapshotId: string;
  readonly underlying: string;
  readonly branch: string;
  /** `null` when the ownership model never ran at all for this
   * underlying/cycle (a coarser absence than "ran but returned UNKNOWN"). */
  readonly ownershipComponents: readonly { readonly name: OwnershipComponentName; readonly value: number | null }[] | null;
  /** Whether an `AegisAssessmentResponse` existed at all for this
   * decision (`aegis-contract.ts`). `false` means AEGIS never ran. */
  readonly aegisAssessmentPresent: boolean;
  /** `riskStateSchema` value when `aegisAssessmentPresent`, else `null`. */
  readonly aegisNewRiskState: string | null;
  readonly quantity: number | null;
  /** Raw reason-code strings, reused verbatim from wherever the caller
   * recorded them (`canonical-strategy-frontier.ts`'s `commonEvidence()`
   * output, or the persisted `CandidatePointInTimeEvidence.unknownEconomics`). */
  readonly unknownEvidence: readonly string[];
  readonly hardBlockers: readonly string[];
}

export interface OwnershipComponentCompletenessEntry {
  readonly component: OwnershipComponentName;
  readonly knownCount: number;
  readonly unknownCount: number;
}

export interface FeatureFamilyCompletenessEntry {
  readonly family: ThetaFeatureFamily;
  readonly knownCount: number;
  readonly unknownCount: number;
}

export interface SymbolCompletenessEntry {
  readonly underlying: string;
  readonly candidateCount: number;
  readonly ownershipUnknownCount: number;
  readonly aegisUnknownCount: number;
}

export interface CycleCompletenessEntry {
  readonly snapshotId: string;
  readonly candidateCount: number;
  readonly ownershipUnknownCount: number;
  readonly aegisUnknownCount: number;
}

export interface ReasonCodeCount {
  readonly code: string;
  readonly count: number;
}

export interface EvidenceCompletenessReport {
  readonly contractVersion: typeof evidenceCompletenessDiagnosticVersion;
  readonly totalCandidateCount: number;

  /** Ownership never ran at all for this candidate's underlying/cycle. */
  readonly ownershipNotEvaluatedCount: number;
  /** Ownership ran and every component was known (`ownability` computable). */
  readonly ownershipKnownCount: number;
  /** Ownership ran but at least one component was `null` (`ownability`
   * therefore collapsed to `null` per `ownership-contract.ts`'s invariant). */
  readonly ownershipUnknownCount: number;
  readonly ownershipComponentCompleteness: readonly OwnershipComponentCompletenessEntry[];

  readonly aegisNotEvaluatedCount: number;
  readonly aegisKnownCount: number;

  readonly quoteUsableButOwnershipUnknownCount: number;
  readonly ownershipKnownButAegisUnknownCount: number;
  readonly aegisKnownButQuantityZeroCount: number;

  readonly reasonCodeCounts: readonly ReasonCodeCount[];
  readonly unmappedReasonCodeCounts: readonly ReasonCodeCount[];
  readonly featureFamilyCompleteness: readonly FeatureFamilyCompletenessEntry[];
  readonly symbolCompleteness: readonly SymbolCompletenessEntry[];
  readonly cycleCompleteness: readonly CycleCompletenessEntry[];

  readonly brokerAuthority: false;
}

function rankedCounts(values: readonly string[]): readonly ReasonCodeCount[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([code, count]) => ({ code, count })).sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
}

/**
 * Aggregates already-recorded candidate evidence into a pure descriptive
 * completeness report. Throws on a caller-side integrity defect
 * (duplicate `candidateId`, since two rows for the same candidate would
 * silently double-count completeness) rather than silently summing.
 */
export function buildEvidenceCompletenessReport(
  candidates: readonly CandidateEvidenceCompletenessInput[],
  quoteUsableByCandidateId: Readonly<Record<string, boolean | null>> = {},
): EvidenceCompletenessReport {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.candidateId)) throw new Error(`EVIDENCE_COMPLETENESS_DUPLICATE_CANDIDATE_ID: ${candidate.candidateId}`);
    seen.add(candidate.candidateId);
  }

  let ownershipNotEvaluatedCount = 0;
  let ownershipKnownCount = 0;
  let ownershipUnknownCount = 0;
  const componentKnown = new Map<OwnershipComponentName, number>();
  const componentUnknown = new Map<OwnershipComponentName, number>();
  let aegisNotEvaluatedCount = 0;
  let aegisKnownCount = 0;
  let quoteUsableButOwnershipUnknownCount = 0;
  let ownershipKnownButAegisUnknownCount = 0;
  let aegisKnownButQuantityZeroCount = 0;
  const allReasonCodes: string[] = [];
  const unmappedReasonCodes: string[] = [];
  const familyKnown = new Map<ThetaFeatureFamily, number>();
  const familyUnknown = new Map<ThetaFeatureFamily, number>();
  const bySymbol = new Map<string, { candidateCount: number; ownershipUnknownCount: number; aegisUnknownCount: number }>();
  const byCycle = new Map<string, { candidateCount: number; ownershipUnknownCount: number; aegisUnknownCount: number }>();

  for (const candidate of candidates) {
    const ownershipEvaluated = candidate.ownershipComponents !== null;
    const ownershipUnknown = !ownershipEvaluated || (candidate.ownershipComponents as readonly { value: number | null }[]).some((component) => component.value === null);
    if (!ownershipEvaluated) ownershipNotEvaluatedCount += 1;
    else if (ownershipUnknown) ownershipUnknownCount += 1;
    else ownershipKnownCount += 1;

    if (ownershipEvaluated) {
      for (const component of candidate.ownershipComponents as readonly { readonly name: OwnershipComponentName; readonly value: number | null }[]) {
        if (component.value === null) componentUnknown.set(component.name, (componentUnknown.get(component.name) ?? 0) + 1);
        else componentKnown.set(component.name, (componentKnown.get(component.name) ?? 0) + 1);
      }
    }

    const aegisUnknown = !candidate.aegisAssessmentPresent || candidate.aegisNewRiskState === null;
    if (!candidate.aegisAssessmentPresent) aegisNotEvaluatedCount += 1;
    else aegisKnownCount += 1;

    const quoteUsable = quoteUsableByCandidateId[candidate.candidateId] ?? null;
    if (quoteUsable === true && ownershipUnknown) quoteUsableButOwnershipUnknownCount += 1;
    if (!ownershipUnknown && ownershipEvaluated && aegisUnknown) ownershipKnownButAegisUnknownCount += 1;
    if (!aegisUnknown && candidate.quantity === 0) aegisKnownButQuantityZeroCount += 1;

    for (const code of [...candidate.unknownEvidence, ...candidate.hardBlockers]) {
      allReasonCodes.push(code);
      const family = Object.prototype.hasOwnProperty.call(REASON_CODE_FEATURE_FAMILY, code) ? REASON_CODE_FEATURE_FAMILY[code] : undefined;
      if (family === undefined) unmappedReasonCodes.push(code);
    }
    const observedFamilies = new Set<ThetaFeatureFamily>();
    for (const code of [...candidate.unknownEvidence, ...candidate.hardBlockers]) {
      const family = REASON_CODE_FEATURE_FAMILY[code];
      if (family !== null && family !== undefined) observedFamilies.add(family);
    }
    for (const family of thetaFeatureFamily.options) {
      if (observedFamilies.has(family)) familyUnknown.set(family, (familyUnknown.get(family) ?? 0) + 1);
      else familyKnown.set(family, (familyKnown.get(family) ?? 0) + 1);
    }

    const symbolRow = bySymbol.get(candidate.underlying) ?? { candidateCount: 0, ownershipUnknownCount: 0, aegisUnknownCount: 0 };
    symbolRow.candidateCount += 1;
    if (ownershipUnknown) symbolRow.ownershipUnknownCount += 1;
    if (aegisUnknown) symbolRow.aegisUnknownCount += 1;
    bySymbol.set(candidate.underlying, symbolRow);

    const cycleRow = byCycle.get(candidate.snapshotId) ?? { candidateCount: 0, ownershipUnknownCount: 0, aegisUnknownCount: 0 };
    cycleRow.candidateCount += 1;
    if (ownershipUnknown) cycleRow.ownershipUnknownCount += 1;
    if (aegisUnknown) cycleRow.aegisUnknownCount += 1;
    byCycle.set(candidate.snapshotId, cycleRow);
  }

  const componentNames: readonly OwnershipComponentName[] = ['LiquidityQuality', 'StructuralQuality', 'RecoveryQuality', 'TailQuality', 'EventAdjustment'];

  return {
    contractVersion: evidenceCompletenessDiagnosticVersion, totalCandidateCount: candidates.length,
    ownershipNotEvaluatedCount, ownershipKnownCount, ownershipUnknownCount,
    ownershipComponentCompleteness: componentNames.map((component) => ({
      component, knownCount: componentKnown.get(component) ?? 0, unknownCount: componentUnknown.get(component) ?? 0,
    })),
    aegisNotEvaluatedCount, aegisKnownCount,
    quoteUsableButOwnershipUnknownCount, ownershipKnownButAegisUnknownCount, aegisKnownButQuantityZeroCount,
    reasonCodeCounts: rankedCounts(allReasonCodes), unmappedReasonCodeCounts: rankedCounts(unmappedReasonCodes),
    featureFamilyCompleteness: thetaFeatureFamily.options.map((family) => ({
      family, knownCount: familyKnown.get(family) ?? 0, unknownCount: familyUnknown.get(family) ?? 0,
    })),
    symbolCompleteness: [...bySymbol.entries()].map(([underlying, row]) => ({ underlying, ...row })).sort((left, right) => left.underlying.localeCompare(right.underlying)),
    cycleCompleteness: [...byCycle.entries()].map(([snapshotId, row]) => ({ snapshotId, ...row })).sort((left, right) => left.snapshotId.localeCompare(right.snapshotId)),
    brokerAuthority: false,
  };
}

// ---------------------------------------------------------------------
// Data-lineage map (directive section 10): FIELD -> EXPECTED_SOURCE ->
// INGESTION_PATH -> NORMALIZED_FIELD -> SNAPSHOT_FIELD ->
// OWNERSHIP_CONSUMER -> AEGIS_DEPENDENCY. Built only from what direct
// inspection of canonical main confirmed -- never guessed.
// ---------------------------------------------------------------------

export interface OwnershipAegisDataLineageEntry {
  readonly field: string;
  readonly expectedSource: string;
  readonly ingestionPath: string;
  readonly normalizedField: string;
  readonly snapshotField: string;
  readonly ownershipConsumer: string;
  readonly aegisDependency: string;
}

export const ownershipAegisDataLineage: readonly OwnershipAegisDataLineageEntry[] = [
  {
    field: 'ownership.ownability',
    expectedSource: 'Canonical Python ownership model at bots/theta/quant/models/ownership_v0.py, fed by real underlying history plus candidate-specific option OI, volume and spread observations',
    ingestionPath: 'theta-shadow-cycle.ts builds candidate ownershipInputOverrides; new-risk-orchestrator.ts invokes ownership once per freshness-eligible candidate and validates the response',
    normalizedField: 'OwnershipEvaluationResponse.ownability (theta/ownership-contract.ts) -- null enforced (superRefine) whenever any of the 5 components is null',
    snapshotField: 'candidateEvidenceSchema.ownership stores both the underlying assessment and the candidate-specific assessment; the JSON envelope is schema-opaque but the validated ownership payload is preserved',
    ownershipConsumer: 'new-risk-orchestrator.ts passes candidate-specific ownability to the Q lattice and bootstrap evidence assessment; decision assembly consumes the resulting candidate frontier state',
    aegisDependency: 'None -- aegis-contract.ts/aegis-derivation.ts do not consume ownership.ownability at all',
  },
  ...(['LiquidityQuality', 'StructuralQuality', 'RecoveryQuality', 'TailQuality', 'EventAdjustment'] as const).map((component) => ({
    field: `ownership.components[name=${component}].value`,
    expectedSource: 'Same canonical Python ownership model as ownability; its policy and input-to-component calculations are implemented in ownership_v0.py',
    ingestionPath: 'Same candidate-specific ownership invocation as ownability; components arrive inside the validated OwnershipEvaluationResponse payload',
    normalizedField: `componentScoreSchema entry with name === '${component}' (theta/ownership-contract.ts)`,
    snapshotField: 'Persisted inside candidateEvidenceSchema.ownership.candidateAssessment.components, with the complete validated component array retained in the immutable evidence payload',
    ownershipConsumer: 'The ownership model uses components to derive ownability; Paper bootstrap also records named unknown components and permits only its explicit versioned subset',
    aegisDependency: 'None',
  })),
  {
    field: 'aegis.newRiskState',
    expectedSource: 'Python AEGIS model, invoked via the same bridge pattern as ownership',
    ingestionPath: 'new-risk-orchestrator.ts: invokeAndValidate(bridge, "aegis", {decisionId, snapshotId, timestamp, policy: aegisPolicy, inputs: aegisInputs}) -> parseAegisAssessmentResponse',
    normalizedField: 'AegisAssessmentResponse.newRiskState (theta/aegis-contract.ts) -- one of ALLOW_FULL|ALLOW_REDUCED|DEFINED_RISK_ONLY|HOLD_ONLY|HARD_VETO, always the strictest family state (superRefine-enforced)',
    snapshotField: 'candidateEvidenceSchema.aegis preserves the complete validated AEGIS assessment, including families and decision lineage, inside the immutable evidence payload',
    ownershipConsumer: 'None -- ownership evaluation runs before AEGIS in the pipeline and does not consume its output',
    aegisDependency: 'decision-assembly.ts requires c.aegis !== null && newRiskState not in (HOLD_ONLY, HARD_VETO) for a candidate to be selectable; canonical-strategy-frontier.ts commonEvidence() pushes AEGIS_STATE_UNKNOWN when input.aegisNewRiskState === null, and AEGIS_<STATE> as a hard blocker for HOLD_ONLY/HARD_VETO/EMERGENCY_EXIT_ONLY',
  },
  {
    field: 'aegis.families[].state (per-family: PER_TRADE/UNDERLYING/SECTOR/CORRELATION/PORTFOLIO/INVENTORY/ASSIGNMENT/RECOVERY/LIQUIDITY/EXECUTION/PROVIDER/SYSTEM)',
    expectedSource: 'Same Python AEGIS model as newRiskState',
    ingestionPath: 'Same as aegis.newRiskState -- families arrive already-scored inside the same AegisAssessmentResponse payload',
    normalizedField: 'familyAssessmentSchema entries (theta/aegis-contract.ts); an evidence gap is represented by a conservative family state and explicit reason code rather than a nullable family row',
    snapshotField: 'Persisted as the full families array inside candidateEvidenceSchema.aegis, rather than separate relational columns',
    ownershipConsumer: 'None',
    aegisDependency: 'newRiskState is derived as the strictest of these family states (superRefine-enforced) -- families are the source of truth newRiskState summarizes',
  },
  {
    field: 'aegis inputs: sectorConcentrationPct, correlationClusterExposurePct, stressIvShockDetected, stressSpreadWideningDetected',
    expectedSource: 'Candidate-inclusive broker exposure derives sector/correlation exactly for the governed sole-risk-group case and preserves UNKNOWN for multi-underlying cases; aegis-alpaca-iv-stress.ts and aegis-spread-stress.ts provide real timestamped detector evidence',
    ingestionPath: 'theta-shadow-cycle.ts merges candidate capacity, per-contract Alpaca IV stress and persisted Alpaca BBO spread stress into candidate aegisInputOverrides; immature, stale or invalid detector evidence remains null',
    normalizedField: 'CandidateInclusiveAegisInputs plus AegisAlpacaIvStressAssessment and AegisSpreadStressAssessment, each with evidence/maturity state and policy version',
    snapshotField: 'FusionSnapshot.riskState preserves IV/spread assessments and baselines; candidateEvidenceSchema.aegis preserves the resulting validated AEGIS assessment',
    ownershipConsumer: 'None',
    aegisDependency: 'Consumed by the Python AEGIS model. Missing evidence remains null and conservative; the versioned Paper cold-start policy is the only governed route for an immature historical detector to become not applicable',
  },
];
