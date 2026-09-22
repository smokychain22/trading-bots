/**
 * R8 Hold-Strike terminal valuation PIT contract (directive item A11).
 * Research-only, `brokerAuthority: false`. Hold-Strike v2's preregistration
 * (`docs/research/THETA_R8_HOLD_STRIKE_PREREGISTRATION_V2.md`) already
 * chose `ANALYTICAL_MTM_AT_HORIZON` for a chain still open at the
 * horizon boundary, to avoid the selection bias of dropping open
 * chains. This module specifies exactly what PIT evidence that
 * analytical mark may legally consume: every input the mark is built
 * from must have been observed AT OR BEFORE the horizon timestamp it is
 * valuing -- never today's Optionomics surface used to value a
 * historical open position, and never a revised/restated event state
 * discovered after the fact.
 */

export const holdStrikeTerminalValuationPitContractVersion = 'theta-hold-strike-terminal-valuation-pit-v1' as const;

export type TerminalValuationProvenance = 'REALIZED' | 'ANALYTICAL_MTM_AT_HORIZON' | 'TERMINAL_VALUATION_NOT_IDENTIFIABLE';

/** Every field is the real observation timestamp for that input category, or `null` if genuinely unavailable -- never backfilled with "now." */
export interface TerminalValuationEvidenceTimestamps {
  readonly underlyingObservedAt: string | null;
  readonly optionInputsObservedAt: string | null;
  readonly volatilityInputsObservedAt: string | null;
  readonly eventStateObservedAt: string | null;
}

const EVIDENCE_FIELDS = ['underlyingObservedAt', 'optionInputsObservedAt', 'volatilityInputsObservedAt', 'eventStateObservedAt'] as const;

export interface TerminalValuationPitSafetyResult {
  readonly safe: boolean;
  /** Empty iff `safe`. Names every field that is missing OR observed strictly after `horizonTimestamp`. */
  readonly violatingFields: readonly (typeof EVIDENCE_FIELDS)[number][];
}

/**
 * PIT-safe iff EVERY evidence timestamp is known AND `<= horizonTimestamp`.
 * A missing timestamp cannot prove PIT-safety and is treated as a
 * violation, never assumed safe by omission.
 */
export function classifyTerminalValuationPitSafety(horizonTimestamp: string, evidence: TerminalValuationEvidenceTimestamps): TerminalValuationPitSafetyResult {
  const horizonMs = new Date(horizonTimestamp).getTime();
  const violatingFields = EVIDENCE_FIELDS.filter((field) => {
    const observedAt = evidence[field];
    if (observedAt === null) return true;
    return new Date(observedAt).getTime() > horizonMs;
  });
  return { safe: violatingFields.length === 0, violatingFields };
}

export interface TerminalValuationRecord {
  readonly chainId: string;
  readonly horizonTimestamp: string;
  readonly terminalValuationTimestamp: string | null;
  readonly terminalValuationModelVersion: string | null;
  readonly terminalValuationInputEvidenceIds: readonly string[];
  readonly evidenceTimestamps: TerminalValuationEvidenceTimestamps;
  readonly terminalValuationProvenance: TerminalValuationProvenance;
  /** The real dollar mark (or realized P&L, for `REALIZED`) -- `null` iff `terminalValuationProvenance === 'TERMINAL_VALUATION_NOT_IDENTIFIABLE'`. */
  readonly analyticalMarkValue: number | null;
}

/**
 * `computeMark` is a caller-supplied, real analytical-mark computation
 * (the same convention as `analyticalOptionMarkDollars`/stock-mark
 * elsewhere in this codebase) -- it is ONLY invoked when
 * `classifyTerminalValuationPitSafety` confirms every input evidence
 * timestamp precedes the horizon; if not, this function short-circuits
 * to `TERMINAL_VALUATION_NOT_IDENTIFIABLE` WITHOUT calling `computeMark`
 * at all, so a caller cannot accidentally compute a mark from
 * out-of-window evidence and then discard the provenance tag.
 */
export function buildAnalyticalTerminalValuation(
  chainId: string, horizonTimestamp: string, modelVersion: string, inputEvidenceIds: readonly string[],
  evidenceTimestamps: TerminalValuationEvidenceTimestamps, computeMark: () => number,
): TerminalValuationRecord {
  const safety = classifyTerminalValuationPitSafety(horizonTimestamp, evidenceTimestamps);
  if (!safety.safe) {
    return {
      chainId, horizonTimestamp, terminalValuationTimestamp: null, terminalValuationModelVersion: modelVersion,
      terminalValuationInputEvidenceIds: inputEvidenceIds, evidenceTimestamps,
      terminalValuationProvenance: 'TERMINAL_VALUATION_NOT_IDENTIFIABLE', analyticalMarkValue: null,
    };
  }
  return {
    chainId, horizonTimestamp, terminalValuationTimestamp: horizonTimestamp, terminalValuationModelVersion: modelVersion,
    terminalValuationInputEvidenceIds: inputEvidenceIds, evidenceTimestamps,
    terminalValuationProvenance: 'ANALYTICAL_MTM_AT_HORIZON', analyticalMarkValue: computeMark(),
  };
}

/** For a chain that genuinely closed before the horizon boundary -- no analytical mark, no PIT question, just the real realized figure. */
export function buildRealizedTerminalValuation(chainId: string, horizonTimestamp: string, realizedPnl: number): TerminalValuationRecord {
  return {
    chainId, horizonTimestamp, terminalValuationTimestamp: horizonTimestamp, terminalValuationModelVersion: null,
    terminalValuationInputEvidenceIds: [],
    evidenceTimestamps: { underlyingObservedAt: null, optionInputsObservedAt: null, volatilityInputsObservedAt: null, eventStateObservedAt: null },
    terminalValuationProvenance: 'REALIZED', analyticalMarkValue: realizedPnl,
  };
}
