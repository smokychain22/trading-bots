/**
 * Current-impact classification for broker facts observed during a read-only
 * reconciliation. The classifier never treats age as evidence. A fact stops
 * blocking entry only when the same reconciliation cycle supplies explicit
 * evidence that no order, position, or unsettled obligation remains.
 */

export const brokerFactImpactClassifierVersion = 'theta-broker-fact-impact-v1' as const;
export const historicalBrokerFactClassifierVersion = brokerFactImpactClassifierVersion;

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

export function classifyBrokerFact(evidence: BrokerFactEvidence): BrokerFactClassificationResult {
  const missing: string[] = [];
  if (evidence.currentBrokerOrderExists === null) missing.push('currentBrokerOrderExists');
  if (evidence.currentPositionExists === null) missing.push('currentPositionExists');
  if (evidence.currentUnsettledObligationExists === null) missing.push('currentUnsettledObligationExists');

  if (evidence.currentBrokerOrderExists === true || evidence.currentPositionExists === true
    || evidence.currentUnsettledObligationExists === true) {
    return {
      factId: evidence.factId, classification: 'CURRENT_ECONOMIC_EXPOSURE',
      reason: 'Same-cycle broker evidence shows an open order, current position, or unsettled obligation.',
      requiredEvidenceMissing: [],
    };
  }

  if (evidence.reconciliationStatus === 'UNRECONCILED'
    && evidence.currentBrokerOrderExists === false && evidence.currentPositionExists === false
    && evidence.currentUnsettledObligationExists === false) {
    return {
      factId: evidence.factId, classification: 'CURRENT_RECONCILIATION_DEFECT',
      reason: 'Current exposure signals are false, but reconciliation remains explicitly unresolved.',
      requiredEvidenceMissing: [],
    };
  }

  if (missing.length > 0) {
    return {
      factId: evidence.factId, classification: 'UNKNOWN_CURRENT_IMPACT',
      reason: `Required current-impact evidence is missing: ${missing.join(', ')}. Fact age is not evidence of settlement.`,
      requiredEvidenceMissing: missing,
    };
  }

  if (evidence.reconciliationStatus === 'UNKNOWN') {
    return {
      factId: evidence.factId, classification: 'UNKNOWN_CURRENT_IMPACT',
      reason: 'Current exposure signals are false, but reconciliation status is unknown.',
      requiredEvidenceMissing: ['reconciliationStatus'],
    };
  }

  const linked = evidence.linkedLocalOrderId !== null || evidence.linkedLocalChainId !== null;
  return linked ? {
    factId: evidence.factId, classification: 'HISTORICAL_RECONCILED',
    reason: 'Same-cycle current-impact signals are false and the settled fact links to a local order or chain.',
    requiredEvidenceMissing: [],
  } : {
    factId: evidence.factId, classification: 'HISTORICAL_ACCOUNTING_ONLY',
    reason: 'Same-cycle current-impact signals are false and the posted fact is settled but has no local linkage.',
    requiredEvidenceMissing: [],
  };
}

export interface BrokerFactBatchSummary {
  readonly version: typeof brokerFactImpactClassifierVersion;
  readonly totalFacts: number;
  readonly entryBlockingFactCount: number;
  readonly currentEconomicExposureCount: number;
  readonly currentReconciliationDefectCount: number;
  readonly historicalReconciledCount: number;
  readonly historicalAccountingOnlyCount: number;
  readonly unknownCurrentImpactCount: number;
  readonly results: readonly BrokerFactClassificationResult[];
}

export function classifyBrokerFactBatch(evidenceRows: readonly BrokerFactEvidence[]): BrokerFactBatchSummary {
  const results = evidenceRows.map(classifyBrokerFact);
  const count = (classification: BrokerFactClassification): number =>
    results.filter((result) => result.classification === classification).length;
  const currentEconomicExposureCount = count('CURRENT_ECONOMIC_EXPOSURE');
  const currentReconciliationDefectCount = count('CURRENT_RECONCILIATION_DEFECT');
  const unknownCurrentImpactCount = count('UNKNOWN_CURRENT_IMPACT');
  return {
    version: brokerFactImpactClassifierVersion,
    totalFacts: results.length,
    entryBlockingFactCount: currentEconomicExposureCount + currentReconciliationDefectCount + unknownCurrentImpactCount,
    currentEconomicExposureCount,
    currentReconciliationDefectCount,
    historicalReconciledCount: count('HISTORICAL_RECONCILED'),
    historicalAccountingOnlyCount: count('HISTORICAL_ACCOUNTING_ONLY'),
    unknownCurrentImpactCount,
    results,
  };
}
