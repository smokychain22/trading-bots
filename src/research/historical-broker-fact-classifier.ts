/**
 * Historical broker-fact classifier (Wave 15 section 13). Research-only,
 * `brokerAuthority: false`. Codex's real `assessReconciliationReadiness`
 * (`first-paper-blocker-budget.ts`) correctly hard-blocks first Paper on
 * any nonzero `externalOrUnknownCount` -- this module does NOT propose
 * loosening that gate. It gives Codex the semantic classification the
 * gate itself does not need but a human reviewing the 11 real historical
 * facts does: which of them plausibly represent CURRENT economic
 * exposure vs. which are old, accounted-for history. This module never
 * infers harmlessness from age alone -- every classification requires
 * explicit, real linkage evidence, and defaults to the most cautious
 * classification (`UNKNOWN_CURRENT_IMPACT`) when that evidence is
 * missing.
 */

export const historicalBrokerFactClassifierVersion = 'theta-historical-broker-fact-classifier-v1' as const;

export type BrokerFactClassification =
  | 'CURRENT_ECONOMIC_EXPOSURE' | 'CURRENT_RECONCILIATION_DEFECT'
  | 'HISTORICAL_RECONCILED' | 'HISTORICAL_ACCOUNTING_ONLY' | 'UNKNOWN_CURRENT_IMPACT';

export interface BrokerFactEvidence {
  readonly factId: string;
  readonly brokerObjectType: 'ORDER' | 'ACTIVITY' | 'POSITION' | 'OTHER';
  readonly activityType: 'FILL' | 'FEE' | 'JNLC' | 'DIV' | 'OTHER' | null;
  readonly eventTimestamp: string | null;
  readonly firstSeenTimestamp: string | null;
  readonly linkedLocalOrderId: string | null;
  readonly linkedLocalChainId: string | null;
  /** Whether a CURRENT (as-of-now) broker query still shows this exact
   * order/position/obligation as open -- required real evidence, never
   * inferred from age or activity type alone. */
  readonly currentBrokerOrderExists: boolean | null;
  readonly currentPositionExists: boolean | null;
  readonly currentUnsettledObligationExists: boolean | null;
  readonly cashEffect: number | null;
  readonly reconciliationStatus: 'RECONCILED' | 'UNRECONCILED' | 'UNKNOWN';
}

export interface BrokerFactClassificationResult {
  readonly factId: string;
  readonly classification: BrokerFactClassification;
  readonly reason: string;
  readonly requiredEvidenceMissing: readonly string[];
}

/**
 * Classifies ONE real broker fact. Requires POSITIVE, explicit evidence
 * to reach any classification other than `UNKNOWN_CURRENT_IMPACT` --
 * per this wave's explicit instruction, age alone (`firstSeenTimestamp`
 * being old) is never sufficient to conclude a fact is harmless
 * history.
 */
export function classifyBrokerFact(evidence: BrokerFactEvidence): BrokerFactClassificationResult {
  const missing: string[] = [];
  if (evidence.currentBrokerOrderExists === null) missing.push('currentBrokerOrderExists');
  if (evidence.currentPositionExists === null) missing.push('currentPositionExists');
  if (evidence.currentUnsettledObligationExists === null) missing.push('currentUnsettledObligationExists');

  // Any real, explicit CURRENT exposure signal (order still open, a
  // position exists, or an obligation is unsettled) is a hard,
  // unconditional CURRENT_ECONOMIC_EXPOSURE classification -- checked
  // first, before any missing-evidence early return, because a known
  // "yes" is always decisive regardless of what else is unknown.
  if (evidence.currentBrokerOrderExists === true || evidence.currentPositionExists === true
    || evidence.currentUnsettledObligationExists === true) {
    return {
      factId: evidence.factId, classification: 'CURRENT_ECONOMIC_EXPOSURE',
      reason: 'At least one real, explicit current-exposure signal (open order, existing position, or unsettled obligation) is true.',
      requiredEvidenceMissing: [],
    };
  }

  if (evidence.reconciliationStatus === 'UNRECONCILED'
    && (evidence.currentBrokerOrderExists === false && evidence.currentPositionExists === false
      && evidence.currentUnsettledObligationExists === false)) {
    return {
      factId: evidence.factId, classification: 'CURRENT_RECONCILIATION_DEFECT',
      reason: 'No current exposure signal is true, but reconciliation status is explicitly UNRECONCILED -- a real accounting discrepancy, not settled history.',
      requiredEvidenceMissing: [],
    };
  }

  if (missing.length > 0) {
    return {
      factId: evidence.factId, classification: 'UNKNOWN_CURRENT_IMPACT',
      reason: `Required current-exposure evidence not supplied: ${missing.join(', ')}. Age (firstSeenTimestamp) alone is never sufficient to classify a fact as harmless history.`,
      requiredEvidenceMissing: missing,
    };
  }

  // All three current-exposure signals are explicitly false, and
  // reconciliation is not UNRECONCILED at this point.
  if (evidence.reconciliationStatus === 'UNKNOWN') {
    return {
      factId: evidence.factId, classification: 'UNKNOWN_CURRENT_IMPACT',
      reason: 'All current-exposure signals are false, but reconciliationStatus is UNKNOWN -- cannot confirm the fact is truly settled.',
      requiredEvidenceMissing: ['reconciliationStatus'],
    };
  }

  const linked = evidence.linkedLocalOrderId !== null || evidence.linkedLocalChainId !== null;
  if (linked) {
    return {
      factId: evidence.factId, classification: 'HISTORICAL_RECONCILED',
      reason: 'No current exposure signal is true, reconciliation is RECONCILED, and this fact is explicitly linked to a known local order/chain.',
      requiredEvidenceMissing: [],
    };
  }

  // Reconciled, no current exposure, but no local linkage -- a real
  // but unlinked historical fact (e.g. a FEE or JNLC entry with no
  // corresponding local order record). This is the accounting-only
  // bucket, not the stronger HISTORICAL_RECONCILED claim, which
  // requires real linkage.
  return {
    factId: evidence.factId, classification: 'HISTORICAL_ACCOUNTING_ONLY',
    reason: 'No current exposure signal is true and reconciliation is RECONCILED, but this fact has no linked local order/chain record -- treated as accounting-only history, not confirmed-linked history.',
    requiredEvidenceMissing: [],
  };
}

export interface BrokerFactBatchSummary {
  readonly totalFacts: number;
  readonly currentEconomicExposureCount: number;
  readonly currentReconciliationDefectCount: number;
  readonly historicalReconciledCount: number;
  readonly historicalAccountingOnlyCount: number;
  readonly unknownCurrentImpactCount: number;
  readonly results: readonly BrokerFactClassificationResult[];
}

export function classifyBrokerFactBatch(evidenceRows: readonly BrokerFactEvidence[]): BrokerFactBatchSummary {
  const results = evidenceRows.map(classifyBrokerFact);
  const count = (c: BrokerFactClassification): number => results.filter((r) => r.classification === c).length;
  return {
    totalFacts: results.length,
    currentEconomicExposureCount: count('CURRENT_ECONOMIC_EXPOSURE'),
    currentReconciliationDefectCount: count('CURRENT_RECONCILIATION_DEFECT'),
    historicalReconciledCount: count('HISTORICAL_RECONCILED'),
    historicalAccountingOnlyCount: count('HISTORICAL_ACCOUNTING_ONLY'),
    unknownCurrentImpactCount: count('UNKNOWN_CURRENT_IMPACT'),
    results,
  };
}
