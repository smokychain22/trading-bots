import { z } from 'zod';
import { canonicalHash, validateDotProposal } from './contracts.js';

/** Non-sensitive exchange test. Content integrity alone never proves which
 * agent/environment fetched it. Only a genuine connector invocation can do that. */
export const dotCloudReadChallengeSchema = z.object({
  repository: z.literal('smokychain22/trading-bots'),
  ref: z.string().regex(/^[a-f0-9]{40}$/),
  path: z.string().regex(/^research\/dot-proposals\/examples\/[a-z-]+\.json$/),
  challengeId: z.string().uuid(), proposalHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export function buildDotCloudReadChallenge(ref: string, path: string, rawProposal: unknown, challengeId: string) {
  const proposal = validateDotProposal(rawProposal);
  return dotCloudReadChallengeSchema.parse({ repository: 'smokychain22/trading-bots', ref, path, challengeId,
    proposalHash: proposal.proposalHash, sourceContentHash: canonicalHash(rawProposal) });
}
export function verifyDotCloudReadResponse(challengeInput: unknown, responseInput: unknown) {
  const challenge = dotCloudReadChallengeSchema.parse(challengeInput);
  const response = z.object({ challengeId: z.string().uuid(), ref: z.string(), path: z.string(), proposal: z.unknown() }).strict().parse(responseInput);
  if (response.challengeId !== challenge.challengeId || response.ref !== challenge.ref || response.path !== challenge.path)
    throw new Error('DOT_CLOUD_CHALLENGE_IDENTITY_MISMATCH');
  const proposal = validateDotProposal(response.proposal);
  if (proposal.proposalHash !== challenge.proposalHash || canonicalHash(response.proposal) !== challenge.sourceContentHash)
    throw new Error('DOT_CLOUD_CHALLENGE_CONTENT_MISMATCH');
  return { challengeId: challenge.challengeId, contentVerified: true,
    originQualification: 'REQUIRES_ACTUAL_DOT_CONNECTOR_INVOCATION', dotCloudConnectionProven: false,
    brokerAuthority: false };
}
