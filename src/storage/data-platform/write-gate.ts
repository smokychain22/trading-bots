// The bulk-writer side of the StorageGovernor: one object a research writer asks "may I write this?" before it writes.
// Inert by default (no gate configured = today's behavior). Operational truth (P0) is allowed without consulting anything, and every denial is recorded as
// EVIDENCE_SKIPPED_DUE_TO_STORAGE_PRESSURE with its exact scope. The decision transaction is never failed by the gate.
import type { Pool } from 'pg';
import { gateWrite, isP0Scope, type PressureProvider } from './pressure-state.js';
import type { EvidenceSkippedRecord, WritePriority } from './storage-governor.js';

export type SkipRecorder = (record: EvidenceSkippedRecord) => Promise<void>;

export const postgresSkipRecorder = (pool: Pick<Pool, 'query'>): SkipRecorder => async (record) => {
  try {
    await pool.query(`INSERT INTO dp.evidence_skipped(kind, priority, scope, capacity_state, observed_at) VALUES ($1, $2, $3, $4, $5::timestamptz)`, [record.kind, record.priority, record.scope, record.state, record.observedAt]);
  } catch { /* a missing table or a down database must never fail a writer; the in-process counters below still show the loss */ }
};

export interface GateDecision { readonly allow: boolean; readonly disposition: 'WRITE' | 'QUEUE_FOR_ARCHIVE_ONLY' | 'SKIP_WITH_RECORD'; readonly state: string }

export class StorageWriteGate {
  readonly skipped = new Map<string, number>();
  constructor(readonly provider: PressureProvider, private readonly options: { readonly recorder?: SkipRecorder; readonly now?: () => Date } = {}) {}

  async decide(scope: string, priority?: WritePriority): Promise<GateDecision> {
    if (isP0Scope(scope)) return { allow: true, disposition: 'WRITE', state: 'P0_OPERATIONAL' };
    const now = (this.options.now ?? (() => new Date()))();
    const gated = await gateWrite(this.provider, scope, priority, now);
    const state = gated.snapshot?.state ?? 'UNKNOWN';
    if (!gated.decision.allow) {
      this.skipped.set(scope, (this.skipped.get(scope) ?? 0) + 1);
      const effectiveState = gated.snapshot?.kind === 'KNOWN' ? gated.snapshot.state : 'STORAGE_PRESSURE_UNKNOWN' as const;
      const record: EvidenceSkippedRecord = { kind: 'EVIDENCE_SKIPPED_DUE_TO_STORAGE_PRESSURE', priority: gated.priority, scope, state: effectiveState, observedAt: now.toISOString() };
      if (this.options.recorder !== undefined) await this.options.recorder(record);
    }
    return { allow: gated.decision.allow, disposition: gated.decision.disposition, state };
  }

  async allow(scope: string, priority?: WritePriority): Promise<boolean> { return (await this.decide(scope, priority)).allow; }
}

/** The optional gate: when none is configured every research write proceeds exactly as before. */
export async function gateAllows(gate: StorageWriteGate | undefined, scope: string, priority?: WritePriority): Promise<boolean> {
  return gate === undefined ? true : gate.allow(scope, priority);
}
