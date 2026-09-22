import type { EventRiskState } from './event-risk-state.js';

export const managementCandidateMaxQuoteAgeMs = 30_000;

/** Broker-observed alternatives for the one canonical Paper management policy.
 * Discovery does not rank or authorize an action. */
export interface ManagementCandidate {
  readonly optionContractId: string;
  readonly symbol: string;
  readonly optionType: 'PUT' | 'CALL';
  readonly strike: number;
  readonly expiration: string;
  readonly multiplier: number;
  readonly quantity: number;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly dividendExDateRisk?: EventRiskState;
  readonly eventRisk?: EventRiskState;
  readonly quoteSnapshotId?: number;
  readonly quoteTimestamp?: string;
  readonly quoteReceivedAt?: string;
  readonly quoteFeed?: 'PAPER_INDICATIVE_REFERENCE';
  readonly bidSize?: number | null;
  readonly askSize?: number | null;
  readonly delta?: number | null;
}

export type ManagementCandidateDiscoveryState =
  'READY' | 'VALID_EMPTY' | 'PARTIAL_COVERAGE' | 'PROVIDER_ERROR' | 'STALE' | 'NOT_ENTITLED' | 'INVALID';

export interface ManagementCandidateRejection {
  readonly symbol: string;
  readonly reason: string;
}

export interface ManagementCandidateDiscovery {
  readonly contractVersion: 'theta-management-candidate-discovery-v1';
  readonly state: ManagementCandidateDiscoveryState;
  readonly provider: 'ALPACA';
  readonly quoteSemantics: 'PAPER_INDICATIVE_REFERENCE';
  readonly observedAt: string;
  readonly contractsComplete: boolean;
  readonly quotesComplete: boolean;
  readonly rollCandidates: readonly ManagementCandidate[];
  readonly ccCandidates: readonly ManagementCandidate[];
  readonly rollCcCandidates: readonly ManagementCandidate[];
  readonly rejections: readonly ManagementCandidateRejection[];
  readonly reason: string | null;
}
