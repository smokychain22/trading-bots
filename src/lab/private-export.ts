import { z } from 'zod';
import type { DotLabStore } from './store.js';
import { canonicalHash } from './contracts.js';
import { dotFeedbackSchema } from './feedback.js';

const observation = z.object({ providerAccountId: z.string().uuid(), observationId: z.string().uuid(),
  receivedAt: z.string().datetime({ offset: true }), data: z.unknown() }).strict();

/** Private connector payload, never a GitHub artifact. Empty lifecycle feedback means unavailable, not zero P&L. */
export function exportDotPrivateObservation(store: DotLabStore, sourceSha: string | null = null) {
  if (sourceSha !== null && !/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('DOT_SOURCE_SHA_INVALID');
  const observations = store.list('OBSERVATION', 50).map(value => observation.parse(value));
  if (observations.some(value => value.providerAccountId !== store.identity.providerAccountId)) throw new Error('DOT_EXPORT_ACCOUNT_MISMATCH');
  const payload = { version: 'dot-private-export-v1', accountIdentity: store.identity,
    sourceSha, sourceIdentityState: sourceSha === null ? 'UNVERIFIED' : 'CALLER_SUPPLIED_NOT_DEPLOYMENT_PROOF',
    observations, lifecycleFeedbackState: 'CANONICAL_IMPORT_NOT_CONNECTED', feedback: [],
    brokerAuthority: false, profitability: 'EMPIRICALLY_UNPROVEN' };
  return { ...payload, payloadHash: canonicalHash(payload) };
}
export function exportSyntheticDotFeedback(input: unknown) {
  // Test/replay material is explicitly modeled. It cannot mint BROKER_ACTUAL evidence for an agent.
  const feedback = dotFeedbackSchema.parse(input);
  if (feedback.truthClass !== 'MODELED_RESEARCH') throw new Error('DOT_SYNTHETIC_EXPORT_MUST_BE_MODELED');
  return { feedback, hash: canonicalHash(feedback), brokerAuthority: false };
}
