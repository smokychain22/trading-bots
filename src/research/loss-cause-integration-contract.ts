/**
 * Loss-cause integration contract (Wave 6 Batch I). Research-only,
 * `brokerAuthority: false`. A negative mark-to-market P&L alone answers
 * "how much," never "why" -- and management policy (hold/close/roll/
 * escalate to AEGIS) legitimately differs by cause even at an identical
 * P&L. This module gives each real loss cause a typed evidence contract
 * (source, severity, duration, confidence, thesis impact, action
 * influence, hard-safety status) so a downstream management frontier can
 * consume "why," not just "how much" -- without this module itself
 * deciding any management action (that remains
 * `management-action-frontier.ts`'s real, separate authority).
 *
 * Distinct from `position-path-state.ts`'s `THESIS_DETERIORATION` path
 * SHAPE classifier (a P&L trajectory pattern over time) -- this module
 * classifies WHY a loss is occurring from causal evidence, not from the
 * shape of the P&L curve alone.
 */

export const lossCauseIntegrationContractVersion = 'theta-loss-cause-integration-contract-v1' as const;

export type LossCause =
  | 'UNDERLYING_DECLINE' | 'IV_EXPANSION' | 'EVENT_DETERIORATION' | 'OWNERSHIP_DETERIORATION'
  | 'PORTFOLIO_STRESS' | 'LIQUIDITY_DETERIORATION' | 'EXECUTION_DETERIORATION' | 'THESIS_DETERIORATION';

export type EvidenceQuality = 'KNOWN' | 'UNKNOWN' | 'PROVIDER_LIMITED' | 'STALE';

export type ThesisImpact = 'INVALIDATES_THESIS' | 'DEGRADES_THESIS' | 'NEUTRAL_TO_THESIS' | 'UNKNOWN';

export type ActionInfluence =
  | 'FAVORS_HOLD' | 'FAVORS_CLOSE' | 'FAVORS_ROLL' | 'FAVORS_ESCALATE_AEGIS' | 'NO_DIRECTIONAL_INFLUENCE' | 'UNKNOWN';

export interface LossCauseEvidence {
  readonly cause: LossCause;
  readonly evidenceQuality: EvidenceQuality;
  /** 0 (negligible) to 1 (severe) -- caller-supplied from a real upstream
   * measurement (e.g. real IV delta, real spread widening ratio). This
   * module never invents a severity scale of its own. */
  readonly severity: number | null;
  /** How many consecutive observed cycles this cause has persisted --
   * distinguishes a one-cycle blip from a sustained deterioration. */
  readonly persistenceCycles: number | null;
  /** 0 to 1 -- confidence in the causal attribution itself, distinct from
   * `severity` (how bad) and from `evidenceQuality` (data availability). */
  readonly confidence: number | null;
  readonly thesisImpact: ThesisImpact;
  readonly actionInfluence: ActionInfluence;
  /** true only when this cause independently triggers a hard AEGIS-level
   * safety override regardless of any other cause's influence -- never
   * inferred, always caller-supplied from the real AEGIS assessment. */
  readonly hardSafetyOverride: boolean;
  readonly sourceEvidenceIds: readonly string[];
  readonly detail: string;
}

export interface LossCauseAssessment {
  readonly contractVersion: typeof lossCauseIntegrationContractVersion;
  readonly positionId: string;
  readonly asOf: string;
  readonly observedNetPnl: number | null;
  /** Every cause this module was asked to evaluate this cycle -- a cause
   * not evaluated is absent, never silently defaulted to NEUTRAL. */
  readonly causes: readonly LossCauseEvidence[];
  /** True when ANY cause reports `hardSafetyOverride`, independent of
   * severity/confidence on that cause -- exit supremacy, mirroring
   * AEGIS's own RISK_REDUCING_ACTIONS-always-permitted rule. */
  readonly hardSafetyOverrideActive: boolean;
  readonly brokerAuthority: false;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/**
 * Assembles a `LossCauseAssessment` from caller-supplied real per-cause
 * evidence. This function performs NO inference of its own beyond: (a)
 * validating each evidence row is internally consistent, and (b) folding
 * `hardSafetyOverride` across all rows (exit supremacy). It never derives
 * a cause from P&L alone, and never assigns a default cause when none was
 * observed.
 */
export function assessLossCauses(
  positionId: string, asOf: string, observedNetPnl: number | null, causes: readonly LossCauseEvidence[],
): LossCauseAssessment {
  for (const c of causes) {
    if (c.severity !== null && (!finite(c.severity) || c.severity < 0 || c.severity > 1)) {
      throw new Error(`LOSS_CAUSE_INVALID_SEVERITY:${c.cause}:${c.severity}`);
    }
    if (c.confidence !== null && (!finite(c.confidence) || c.confidence < 0 || c.confidence > 1)) {
      throw new Error(`LOSS_CAUSE_INVALID_CONFIDENCE:${c.cause}:${c.confidence}`);
    }
    if (c.persistenceCycles !== null && (!Number.isInteger(c.persistenceCycles) || c.persistenceCycles < 0)) {
      throw new Error(`LOSS_CAUSE_INVALID_PERSISTENCE:${c.cause}:${c.persistenceCycles}`);
    }
    // A cause the module cannot evaluate (PROVIDER_LIMITED/UNKNOWN/STALE)
    // must never simultaneously claim a hard safety override -- a safety
    // decision requires real, known evidence, never an absence dressed up
    // as certainty.
    if (c.hardSafetyOverride && c.evidenceQuality !== 'KNOWN') {
      throw new Error(`LOSS_CAUSE_HARD_OVERRIDE_WITHOUT_KNOWN_EVIDENCE:${c.cause}`);
    }
  }

  const distinctCauses = new Set(causes.map((c) => c.cause));
  if (distinctCauses.size !== causes.length) throw new Error('LOSS_CAUSE_DUPLICATE_CAUSE_ROW');

  return {
    contractVersion: lossCauseIntegrationContractVersion, positionId, asOf, observedNetPnl, causes,
    hardSafetyOverrideActive: causes.some((c) => c.hardSafetyOverride),
    brokerAuthority: false,
  };
}
