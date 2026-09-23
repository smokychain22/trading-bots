import { buildAegisAssessmentIdentity, type AegisAssessmentIdentity } from '../../src/theta/aegis-assessment-identity.js';

const exitActions = ['CLOSE', 'CANCEL', 'BUY_TO_CLOSE', 'RECONCILE', 'REDUCE_POSITION', 'SAFETY_EXIT'] as const;

export function testAegisAssessmentIdentity(input: Partial<{
  fusionSnapshotId: string;
  fusionSnapshotHash: string;
  runtimeCandidateRef: string;
  persistedCandidateId: string;
  underlying: string;
  optionSymbol: string;
  decisionAsOf: string;
  newRiskState: 'ALLOW_FULL' | 'ALLOW_REDUCED';
}> = {}): AegisAssessmentIdentity {
  const fusionSnapshotId = input.fusionSnapshotId ?? '90000000-0000-4000-8000-000000000001';
  const fusionSnapshotHash = input.fusionSnapshotHash ?? '9'.repeat(64);
  const runtimeCandidateRef = input.runtimeCandidateRef ?? 'THETA_CONVENTIONAL:AAPL261016P00150000';
  const persistedCandidateId = input.persistedCandidateId ?? '44444444-4444-4444-8444-444444444444';
  const underlying = input.underlying ?? 'AAPL';
  const optionSymbol = input.optionSymbol ?? 'AAPL261016P00150000';
  const decisionAsOf = input.decisionAsOf ?? '2026-09-14T14:00:00.000Z';
  const newRiskState = input.newRiskState ?? 'ALLOW_FULL';
  return buildAegisAssessmentIdentity({
    fusionSnapshotId,
    fusionSnapshotHash,
    runtimeCandidateRef,
    assessmentCandidateId:optionSymbol,
    persistedCandidateId,
    underlying,
    optionSymbol,
    decisionAsOf,
    detectorVersions: { aegis: 'aegis-policy-v1', ivStress: 'iv-stress-v1', spreadStress: 'spread-stress-v1' },
    assessment: {
      contractVersion: 'theta-aegis-runtime-v1',
      decisionId: `${fusionSnapshotHash}:${optionSymbol}`,
      snapshotId: fusionSnapshotHash,
      timestamp: decisionAsOf,
      policyVersion: 'aegis-policy-v1',
      families: [{ family: 'SYSTEM', state: newRiskState, reasons: [] }],
      newRiskState,
      reasons: [],
      permittedActions: [...exitActions, 'OPEN_CSP'],
    },
  });
}
