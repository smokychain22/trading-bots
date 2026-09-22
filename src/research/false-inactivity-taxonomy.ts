/**
 * False-inactivity taxonomy (Wave 13 Batch 4). Research-only,
 * `brokerAuthority: false`. Classifies a real candidate/WAIT outcome
 * into one of 12 real, distinct causes, aligned with Codex's canonical
 * `FirstPaperBlockerClass` (`first-paper-blocker-budget.ts`:
 * `EXTERNAL`/`IMPLEMENTATION`/`PROVIDER`/`POLICY`) and this engagement's
 * own `historical-false-reject-analyzer.ts` states, rather than a
 * separate, disconnected vocabulary. Deliberately does NOT collapse
 * these into one "bot did nothing" percentage -- per this wave's own
 * instruction, the whole point is that a `GOOD_WAIT` and an
 * `IMPLEMENTATION_FALSE_REJECT` are categorically different events that
 * must never be summed into a single inactivity number.
 */
import type { FirstPaperBlockerClass } from '../theta/first-paper-blocker-budget.js';

export const falseInactivityTaxonomyVersion = 'theta-false-inactivity-taxonomy-v1' as const;

export type FalseInactivityCause =
  | 'GOOD_WAIT' | 'ECONOMIC_WAIT' | 'HARD_SAFETY_REJECT' | 'EXECUTION_QUALITY_REJECT'
  | 'EVENT_REJECT' | 'AEGIS_REJECT' | 'SIZING_REJECT' | 'IMPLEMENTATION_FALSE_REJECT'
  | 'PROVIDER_FAILURE_REJECT' | 'DATA_STALE_REJECT' | 'DATA_UNAVAILABLE_REJECT' | 'PIPELINE_NOT_EVALUATED';

/** Real mapping to Codex's own blocker-class vocabulary -- not a parallel
 * taxonomy invented independently of the Production classification. */
export const falseInactivityToBlockerClass: Readonly<Record<FalseInactivityCause, FirstPaperBlockerClass | null>> = {
  GOOD_WAIT: null, // not a blocker at all -- a correct decision
  ECONOMIC_WAIT: null, // not a blocker -- a correct economic decision
  HARD_SAFETY_REJECT: null, // not a first-Paper readiness blocker -- the gate working as intended
  EXECUTION_QUALITY_REJECT: null, // same -- correctly hard per THETA_HARD_VS_SOFT_DECISION_AUDIT.md
  EVENT_REJECT: 'POLICY',
  AEGIS_REJECT: 'IMPLEMENTATION', // when caused by the known stressIvShock/SpreadWidening null-producer gap (Q-6)
  SIZING_REJECT: 'POLICY',
  IMPLEMENTATION_FALSE_REJECT: 'IMPLEMENTATION',
  PROVIDER_FAILURE_REJECT: 'PROVIDER',
  DATA_STALE_REJECT: 'PROVIDER',
  DATA_UNAVAILABLE_REJECT: 'EXTERNAL',
  PIPELINE_NOT_EVALUATED: null, // normal pipeline behavior (a candidate correctly never reaching a later stage), not itself a defect
};

export interface FalseInactivityRecord {
  readonly candidateId: string;
  readonly cause: FalseInactivityCause;
}

/** Every rate below is reported SEPARATELY -- never combined into one
 * inactivity percentage, per this wave's explicit instruction. */
export interface FalseInactivityRates {
  readonly totalRecords: number;
  readonly goodWaitRate: number;
  readonly economicWaitRate: number;
  readonly safetyRejectRate: number;
  readonly executionRejectRate: number;
  readonly implementationFalseRejectRate: number;
  readonly providerFailureRejectRate: number;
  readonly dataUnavailableRejectRate: number;
}

function rate(records: readonly FalseInactivityRecord[], causes: readonly FalseInactivityCause[]): number {
  if (records.length === 0) return 0;
  return records.filter((r) => causes.includes(r.cause)).length / records.length;
}

/** Aggregates a real batch of classified records into the requested,
 * deliberately-separate rate metrics. Pure counting -- no estimation. */
export function computeFalseInactivityRates(records: readonly FalseInactivityRecord[]): FalseInactivityRates {
  return {
    totalRecords: records.length,
    goodWaitRate: rate(records, ['GOOD_WAIT']),
    economicWaitRate: rate(records, ['ECONOMIC_WAIT']),
    safetyRejectRate: rate(records, ['HARD_SAFETY_REJECT', 'AEGIS_REJECT']),
    executionRejectRate: rate(records, ['EXECUTION_QUALITY_REJECT']),
    implementationFalseRejectRate: rate(records, ['IMPLEMENTATION_FALSE_REJECT']),
    providerFailureRejectRate: rate(records, ['PROVIDER_FAILURE_REJECT', 'DATA_STALE_REJECT']),
    dataUnavailableRejectRate: rate(records, ['DATA_UNAVAILABLE_REJECT']),
  };
}
