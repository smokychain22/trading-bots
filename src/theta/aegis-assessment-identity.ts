import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, type JsonValue } from '../market/fusion-snapshot.js';
import { aegisAssessmentResponseSchema, type AegisAssessmentResponse } from './aegis-contract.js';

export const aegisAssessmentIdentityVersion = 'theta-aegis-assessment-identity-v1' as const;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const uuid = z.string().uuid();

const unsignedAegisAssessmentIdentitySchema = z.object({
  contractVersion: z.literal(aegisAssessmentIdentityVersion),
  fusionSnapshotId: uuid,
  fusionSnapshotHash: sha256,
  runtimeCandidateRef: z.string().min(1),
  strategyBranch: z.enum(['THETA_CONVENTIONAL','THETA_HOLD_STRIKE','THETA_DEFINED_RISK']).optional(),
  assessmentCandidateId: z.string().min(1),
  persistedCandidateId: uuid,
  underlying: z.string().min(1).max(16),
  optionSymbol: z.string().min(1).max(64),
  decisionAsOf: z.string().datetime({ offset: true }),
  aegisPolicyVersion: z.string().min(1),
  detectorVersions: z.record(z.string(), z.string().min(1)),
  newRiskState: z.enum(['ALLOW_FULL', 'ALLOW_REDUCED', 'DEFINED_RISK_ONLY', 'HOLD_ONLY', 'HARD_VETO']),
  assessment: aegisAssessmentResponseSchema,
  assessmentHash: sha256,
}).strict();

export const aegisAssessmentIdentitySchema = unsignedAegisAssessmentIdentitySchema.extend({
  identityHash: sha256,
}).strict();

export type AegisAssessmentIdentity = z.infer<typeof aegisAssessmentIdentitySchema>;

const hash = (value: unknown): string => createHash('sha256')
  .update(canonicalJson(value as JsonValue), 'utf8').digest('hex');

type IdentityBranch = 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK';

/**
 * The exact candidate an AEGIS assessment was made FOR, per branch. Q is assessed per option symbol (`THETA_CONVENTIONAL:<symbol>`). H and D receive their own
 * candidate-bound assessment keyed by the canonical candidate id, which already carries the branch and every leg (`THETA_HOLD_STRIKE:<symbol>`,
 * `THETA_DEFINED_RISK:<short>:<long>`), so an H/D identity can never be satisfied by Q's assessment of the same contract (no borrowing across strategies).
 * `optionSymbol` is the (short) leg the order opens first in the package.
 */
function candidateIdentityValid(branch: IdentityBranch, runtimeCandidateRef: string, assessmentCandidateId: string, optionSymbol: string): boolean {
  if (branch === 'THETA_CONVENTIONAL') {
    return assessmentCandidateId === optionSymbol && runtimeCandidateRef === `${branch}:${assessmentCandidateId}`;
  }
  if (assessmentCandidateId !== runtimeCandidateRef) return false;
  if (branch === 'THETA_HOLD_STRIKE') return runtimeCandidateRef === `${branch}:${optionSymbol}`;
  const parts = runtimeCandidateRef.split(':');
  return parts.length === 3 && parts[0] === branch && parts[1] === optionSymbol && (parts[2] ?? '') !== '' && parts[2] !== optionSymbol;
}

export function buildAegisAssessmentIdentity(input: {
  readonly fusionSnapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly runtimeCandidateRef: string;
  readonly strategyBranch?: 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK';
  readonly assessmentCandidateId: string;
  readonly persistedCandidateId: string;
  readonly underlying: string;
  readonly optionSymbol: string;
  readonly decisionAsOf: string;
  readonly detectorVersions: Readonly<Record<string, string>>;
  readonly assessment: AegisAssessmentResponse;
}): AegisAssessmentIdentity {
  const assessment = aegisAssessmentResponseSchema.parse(input.assessment);
  if (assessment.snapshotId !== input.fusionSnapshotHash) throw new Error('AEGIS_ASSESSMENT_SNAPSHOT_MISMATCH');
  const strategyBranch = input.strategyBranch ?? 'THETA_CONVENTIONAL';
  if (!candidateIdentityValid(strategyBranch, input.runtimeCandidateRef, input.assessmentCandidateId, input.optionSymbol))
    throw new Error('AEGIS_ASSESSMENT_CONTRACT_IDENTITY_MISMATCH');
  if (assessment.decisionId !== `${input.fusionSnapshotHash}:${input.assessmentCandidateId}`)
    throw new Error('AEGIS_ASSESSMENT_CANDIDATE_MISMATCH');
  if (Date.parse(assessment.timestamp) !== Date.parse(input.decisionAsOf))
    throw new Error('AEGIS_ASSESSMENT_DECISION_TIME_MISMATCH');
  const assessmentHash = hash(assessment);
  const unsigned = unsignedAegisAssessmentIdentitySchema.parse({
    contractVersion: aegisAssessmentIdentityVersion,
    fusionSnapshotId: input.fusionSnapshotId,
    fusionSnapshotHash: input.fusionSnapshotHash,
    runtimeCandidateRef: input.runtimeCandidateRef,
    strategyBranch,
    assessmentCandidateId: input.assessmentCandidateId,
    persistedCandidateId: input.persistedCandidateId,
    underlying: input.underlying,
    optionSymbol: input.optionSymbol,
    decisionAsOf: new Date(input.decisionAsOf).toISOString(),
    aegisPolicyVersion: assessment.policyVersion,
    detectorVersions: input.detectorVersions,
    newRiskState: assessment.newRiskState,
    assessment,
    assessmentHash,
  });
  return aegisAssessmentIdentitySchema.parse({ ...unsigned, identityHash: hash(unsigned) });
}

export function verifyAegisAssessmentIdentity(value: unknown): AegisAssessmentIdentity | null {
  const parsed = aegisAssessmentIdentitySchema.safeParse(value);
  if (!parsed.success) return null;
  const { identityHash, ...unsigned } = parsed.data;
  if (hash(unsigned) !== identityHash || hash(parsed.data.assessment) !== parsed.data.assessmentHash) return null;
  if (parsed.data.assessment.snapshotId !== parsed.data.fusionSnapshotHash) return null;
  const strategyBranch = parsed.data.strategyBranch ?? 'THETA_CONVENTIONAL';
  if (!candidateIdentityValid(strategyBranch, parsed.data.runtimeCandidateRef, parsed.data.assessmentCandidateId, parsed.data.optionSymbol)) return null;
  if (parsed.data.assessment.decisionId !== `${parsed.data.fusionSnapshotHash}:${parsed.data.assessmentCandidateId}`) return null;
  if (Date.parse(parsed.data.assessment.timestamp) !== Date.parse(parsed.data.decisionAsOf)) return null;
  if (parsed.data.assessment.policyVersion !== parsed.data.aegisPolicyVersion
    || parsed.data.assessment.newRiskState !== parsed.data.newRiskState) return null;
  return parsed.data;
}
