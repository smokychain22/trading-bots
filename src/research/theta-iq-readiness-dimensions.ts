/**
 * COMMAND 5B item 24: "THETA IQ" readiness dimensions. Research-only,
 * `brokerAuthority: false`. Nine separate, non-combined dimensions -- the
 * directive explicitly forbids combining these into an arbitrary
 * "87/100" style score, so this module structurally has no
 * dimension-combining function at all (see the compile-time proof test in
 * `tests/theta-iq-readiness-dimensions.test.ts`).
 */

export const thetaIqReadinessDimensionsVersion = 'theta-iq-readiness-dimensions-v1' as const;

export type ReadinessLevel = 'NONE' | 'PARTIAL' | 'SUBSTANTIAL' | 'MATURE';

export interface ReadinessDimension {
  readonly level: ReadinessLevel;
  readonly evidence: string;
  /** null wherever a numeric measure genuinely doesn't yet exist -- never
   * fabricated to make the dimension look more complete. */
  readonly numericMeasure: number | null;
}

export interface ThetaReadinessReport {
  readonly contractVersion: typeof thetaIqReadinessDimensionsVersion;
  readonly generatedAt: string;
  readonly stateCoverage: ReadinessDimension;
  readonly strategyCoverage: ReadinessDimension;
  readonly outcomeCoverage: ReadinessDimension;
  readonly labelMaturity: ReadinessDimension;
  readonly independentN: ReadinessDimension;
  readonly calibrationReadiness: ReadinessDimension;
  readonly executionModelReadiness: ReadinessDimension;
  readonly managementEvidence: ReadinessDimension;
  readonly tailRiskEvidence: ReadinessDimension;
}

/** Every field required, so a caller cannot silently omit a dimension the
 * way an optional-field design would allow. No method on this module (and
 * no exported function anywhere in this file) combines these nine fields
 * into a single number. */
export function buildThetaReadinessReport(input: Omit<ThetaReadinessReport, 'contractVersion'>): ThetaReadinessReport {
  return { contractVersion: thetaIqReadinessDimensionsVersion, ...input };
}

const NONE_DIMENSION: ReadinessDimension = { level: 'NONE', evidence: 'No real resolved episodes exist yet.', numericMeasure: null };

/** The honest starting report before any real Paper data exists -- every
 * dimension NONE, not a guessed intermediate level. */
export function buildInitialReadinessReport(generatedAt: string): ThetaReadinessReport {
  return buildThetaReadinessReport({
    generatedAt,
    stateCoverage: NONE_DIMENSION, strategyCoverage: NONE_DIMENSION, outcomeCoverage: NONE_DIMENSION,
    labelMaturity: NONE_DIMENSION, independentN: NONE_DIMENSION, calibrationReadiness: NONE_DIMENSION,
    executionModelReadiness: NONE_DIMENSION, managementEvidence: NONE_DIMENSION, tailRiskEvidence: NONE_DIMENSION,
  });
}
