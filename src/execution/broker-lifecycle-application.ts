import { createHash } from 'node:crypto';
import { reconcileManagedOptionLifecycle, type BrokerConfirmedLifecycleResult,
  type ManagedOptionLifecycleInput } from './broker-lifecycle-evidence.js';
import type { LifecycleApplication, LifecycleApplicationResult } from '../theta/postgres-lifecycle-application-store.js';

export interface LifecycleApplicationStore {
  apply(application: LifecycleApplication): Promise<LifecycleApplicationResult>;
}

export interface BrokerLifecycleApplicationResult {
  readonly evidence: BrokerConfirmedLifecycleResult;
  readonly application: LifecycleApplicationResult | null;
}

export type ConfirmedLifecycleApplicationFactory = (
  evidence: BrokerConfirmedLifecycleResult & { readonly state: 'CONFIRMED' },
) => LifecycleApplication;

/**
 * The sole terminal broker-evidence bridge. UNKNOWN and INVALID evidence can
 * never reach the atomic writer. The writer remains responsible for checking
 * stored quantities, multipliers, P&L, chain state, and replay safety.
 */
export async function classifyAndApplyBrokerLifecycle(
  input: ManagedOptionLifecycleInput,
  store: LifecycleApplicationStore,
  buildApplication: ConfirmedLifecycleApplicationFactory,
): Promise<BrokerLifecycleApplicationResult> {
  const evidence = reconcileManagedOptionLifecycle(input);
  if (evidence.state !== 'CONFIRMED') return { evidence, application: null };
  const confirmedEvidence = evidence as BrokerConfirmedLifecycleResult & { readonly state: 'CONFIRMED' };
  if (evidence.brokerActivityId === null) throw new Error('CONFIRMED_BROKER_ACTIVITY_ID_MISSING');
  const application = buildApplication(confirmedEvidence);
  if (application.chainId !== input.chainId) throw new Error('LIFECYCLE_APPLICATION_CHAIN_MISMATCH');
  if (application.providerActivityRefHash === null) throw new Error('LIFECYCLE_APPLICATION_BROKER_EVIDENCE_REQUIRED');
  const expectedProviderHash = createHash('sha256').update(evidence.brokerActivityId).digest('hex');
  if (application.providerActivityRefHash !== expectedProviderHash) throw new Error('LIFECYCLE_APPLICATION_BROKER_EVIDENCE_MISMATCH');
  const allowedEvent = input.legKind === 'SHORT_PUT'
    ? new Set<LifecycleApplication['eventKind']>(['SHORT_PUT_ASSIGNMENT', 'OPTION_EXPIRATION'])
    : new Set<LifecycleApplication['eventKind']>(['COVERED_CALL_ASSIGNMENT', 'OPTION_EXPIRATION']);
  if (!allowedEvent.has(application.eventKind)) throw new Error('LIFECYCLE_APPLICATION_EVENT_MISMATCH');
  return { evidence, application: await store.apply(application) };
}
