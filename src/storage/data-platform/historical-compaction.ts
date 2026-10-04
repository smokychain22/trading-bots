import type { FinalChainReceipt } from './final-chain-receipt.js';
import { verifyFinalChainReceipt } from './final-chain-receipt.js';

export const historicalCompactionPolicyVersion = 'theta-historical-compaction-v1' as const;

export interface HistoricalCompactionPolicy {
  readonly detailHotSessions: number;
  readonly compactDecisionHotSessions: number;
  readonly rawDiagnosticHotSessions: number;
  readonly rawRuntimeEventHotSessions: number;
  readonly sessionManifestHotSessions: number;
}

export const defaultHistoricalCompactionPolicy: HistoricalCompactionPolicy = {
  detailHotSessions: 10,
  compactDecisionHotSessions: 60,
  rawDiagnosticHotSessions: 30,
  rawRuntimeEventHotSessions: 30,
  sessionManifestHotSessions: 2_520,
};

export interface HistoricalSubject {
  readonly decisionId: string;
  readonly ageSessions: number;
  readonly archiveVerified: boolean;
  readonly replayVerified: boolean;
  readonly primaryArchiveVerified: boolean;
  readonly secondaryAuthorityVerified: boolean;
  readonly offMachineAuthorityVerified: boolean;
  readonly finalChainReceipt: FinalChainReceipt | null;
}

export type HistoricalDisposition = 'KEEP_ACTIVE_DETAIL' | 'KEEP_RECENT_DETAIL' | 'KEEP_COMPACT_DECISION' | 'RETIRE_DECISION_TO_COLD';

export interface HistoricalCompactionDecision {
  readonly decisionId: string;
  readonly disposition: HistoricalDisposition;
  readonly eligible: boolean;
  readonly blockers: readonly string[];
}

export function decideHistoricalCompaction(subject: HistoricalSubject, policy: HistoricalCompactionPolicy = defaultHistoricalCompactionPolicy): HistoricalCompactionDecision {
  const blockers: string[] = [];
  if (subject.finalChainReceipt === null) blockers.push('FINAL_CHAIN_RECEIPT_MISSING');
  else {
    if (!subject.finalChainReceipt.archiveEligible) blockers.push(...subject.finalChainReceipt.blockers);
    blockers.push(...verifyFinalChainReceipt(subject.finalChainReceipt));
  }
  if (!subject.archiveVerified) blockers.push('ARCHIVE_NOT_VERIFIED');
  if (!subject.replayVerified) blockers.push('REPLAY_NOT_VERIFIED');
  if (!subject.primaryArchiveVerified) blockers.push('PRIMARY_ARCHIVE_NOT_VERIFIED');
  if (!subject.secondaryAuthorityVerified) blockers.push('SECONDARY_AUTHORITY_NOT_VERIFIED');
  if (!subject.offMachineAuthorityVerified) blockers.push('OFF_MACHINE_AUTHORITY_NOT_VERIFIED');
  if (blockers.length > 0) return { decisionId: subject.decisionId, disposition: 'KEEP_ACTIVE_DETAIL', eligible: false, blockers: [...new Set(blockers)] };
  if (subject.ageSessions < policy.detailHotSessions) return { decisionId: subject.decisionId, disposition: 'KEEP_RECENT_DETAIL', eligible: true, blockers: [] };
  if (subject.ageSessions < policy.compactDecisionHotSessions) return { decisionId: subject.decisionId, disposition: 'KEEP_COMPACT_DECISION', eligible: true, blockers: [] };
  return { decisionId: subject.decisionId, disposition: 'RETIRE_DECISION_TO_COLD', eligible: true, blockers: [] };
}

export interface RuntimeSessionAggregate {
  readonly sessionDate: string;
  readonly decisionCount: number;
  readonly tradeCount: number;
  readonly waitReasonCounts: Readonly<Record<string, number>>;
  readonly strategyCounts: Readonly<Record<string, number>>;
  readonly aegisCounts: Readonly<Record<string, number>>;
  readonly sizingCounts: Readonly<Record<string, number>>;
  readonly providerIncidentCounts: Readonly<Record<string, number>>;
  readonly errorCounts: Readonly<Record<string, number>>;
  readonly latencyMs: { readonly p50: number | null; readonly p90: number | null; readonly p95: number | null; readonly p99: number | null };
  readonly storage: { readonly peakBytes: number; readonly postArchiveBytes: number };
}

const percentile = (values: readonly number[], p: number): number | null => {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(p * ordered.length) - 1)] ?? null;
};

export function buildRuntimeSessionAggregate(input: Omit<RuntimeSessionAggregate, 'latencyMs'> & { readonly latenciesMs: readonly number[] }): RuntimeSessionAggregate {
  const { latenciesMs, ...rest } = input;
  return { ...rest, latencyMs: { p50: percentile(latenciesMs, 0.5), p90: percentile(latenciesMs, 0.9), p95: percentile(latenciesMs, 0.95), p99: percentile(latenciesMs, 0.99) } };
}
