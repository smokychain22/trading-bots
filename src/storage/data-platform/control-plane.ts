// THETA Data Control Plane: the ONE storage authority. It composes the StorageGovernor, ArchiveManager (archivePartition), RetentionManager (planRetention),
// PartitionManager (partition lifecycle + ops), CompactionManager, ArchiveVerifier, ReplayVerifier, GrowthForecaster (growth-slo) and StoragePressureGate.
// Post-session and pre-session automation live here; the owner does nothing. Storage work yields to operations: before every partition step the plane asks
// `yieldToOperations()` and stops (to resume next run) if risk management, position management, reconciliation or order work needs the database.
import { datasetRegistry, partitionKeyFor, type DatasetPolicy } from './dataset-registry.js';
import { archivePartition, closePartition, retirePartition, reverifyArchive, type PartitionOps, type PipelineContext, type ArchiveCodec, type ReplayVerifier } from './archival-pipeline.js';
import type { ArchiveBackend } from './archive-backend.js';
import { incident, incidentFromError, type PlatformIncident } from './incidents.js';
import { assessCapacity, preSessionGate, type GovernorAssessment, type GovernorInput, type PreSessionChecks } from './storage-governor.js';
import { assessSteadyState, growthIncident } from './growth-slo.js';
import { buildReceipt, type StorageReceipt } from './platform-board.js';
import { planRetention, archiveQueueState } from './retention-manager.js';
import { planCompaction, type ArchiveFileEntry, type CompactionPlan } from './compaction-manager.js';
import type { PartitionStateStore } from './partition-store.js';
import type { PartitionRecord } from './partition-lifecycle.js';

export interface ControlPlaneDeps {
  readonly botId: string;
  readonly sourceSha: string;
  readonly policyVersion: string;
  readonly backend: ArchiveBackend;
  readonly store: PartitionStateStore;
  readonly opsFor: (dataset: string) => PartitionOps;
  readonly codecFor: (dataset: string) => ArchiveCodec;
  readonly replayFor: (dataset: string) => ReplayVerifier;
  readonly now: () => string;
  /** current database size and allocation */
  readonly measure: () => Promise<{ readonly dbBytes: number; readonly planBytes: number }>;
  /** bytes of detail an unarchived/archived partition holds in PostgreSQL */
  readonly partitionBytes: (record: PartitionRecord) => number;
  /** routine maintenance after retirement (ANALYZE; never a full vacuum) */
  readonly maintenance?: () => Promise<void>;
  /** true while urgent operational work (risk, positions, reconciliation, orders) needs priority */
  readonly yieldToOperations?: () => boolean;
  /** the two-authority purge rule (durability-policy.ts); when absent retirement is REFUSED unless allowUnverifiedRetirement is set (tests and simulation only) */
  readonly durabilityCheck?: PipelineContext['durabilityCheck'];
  readonly allowUnverifiedRetirement?: boolean;
  /** row-level terminality gate for datasets whose old rows may still represent live exposure */
  readonly retirementEligible?: (dataset: string, partition: string) => Promise<{ readonly eligible: boolean; readonly reason: string }>;
  readonly registry?: readonly DatasetPolicy[];
}

export interface PostSessionResult {
  readonly receipt: StorageReceipt;
  readonly incidents: readonly PlatformIncident[];
  readonly yielded: boolean;
  readonly compaction: CompactionPlan;
}

export class DataControlPlane {
  private readonly registry: readonly DatasetPolicy[];
  /** post-archive size history, one entry per session (the SLO input) */
  readonly postArchiveHistory: number[] = [];
  readonly recentSessionGrowth: number[] = [];
  private lastPostArchive: number | null = null;
  /** sessions before the post-archive series is judged: the longest hot window (in sessions) plus a margin, so the fill-up phase is not mistaken for growth */
  readonly warmupSessions: number;

  constructor(private readonly deps: ControlPlaneDeps) {
    this.registry = deps.registry ?? datasetRegistry;
    this.warmupSessions = this.registry.reduce((max, policy) => (typeof policy.hotSessions === 'number' && policy.partition.granularity !== 'NONE' ? Math.max(max, policy.hotSessions) : max), 0) + 10;
  }

  private context(dataset: string): PipelineContext {
    return { botId: this.deps.botId, sourceSha: this.deps.sourceSha, policyVersion: this.deps.policyVersion, backend: this.deps.backend, store: this.deps.store, ops: this.deps.opsFor(dataset),
      codec: this.deps.codecFor(dataset), replay: this.deps.replayFor(dataset), now: this.deps.now, durabilityCheck: this.deps.durabilityCheck, ...(this.deps.allowUnverifiedRetirement === true ? { allowUnverifiedRetirement: true } : {}) };
  }

  private partitioned(): readonly DatasetPolicy[] {
    return this.registry.filter((policy) => policy.coldPolicy !== 'NEVER_LEAVES_POSTGRES' && policy.partition.granularity !== 'NONE');
  }

  /** Pre-session: capacity assessment and the new-risk gate. Never blocks management of existing positions. */
  async preSession(governor: Omit<GovernorInput, 'currentBytes' | 'planBytes' | 'recentSessionGrowthBytes'>, checks: PreSessionChecks): Promise<{ assessment: GovernorAssessment; newRisk: ReturnType<typeof preSessionGate> }> {
    const { dbBytes, planBytes } = await this.deps.measure();
    const assessment = assessCapacity({ ...governor, currentBytes: dbBytes, planBytes, recentSessionGrowthBytes: this.recentSessionGrowth.slice(-20) });
    return { assessment, newRisk: preSessionGate(assessment, checks) };
  }

  /**
   * Post-session: close the finished session's partitions, archive and verify everything closed, retire partitions past their hot windows, run maintenance, measure,
   * evaluate the steady-state SLO and publish the receipt. One failing dataset never stops the others; every failure becomes a typed incident.
   */
  async postSession(closedSession: string, sessions: readonly string[], preSession: { readonly preSessionBytes: number; readonly sessionPeakBytes: number }, nextSession: string | null = null): Promise<PostSessionResult> {
    const incidents: PlatformIncident[] = [];
    const archived: string[] = [];
    const retired: string[] = [];
    let yielded = false;
    const observedAt = this.deps.now();
    const { dbBytes: beforeArchive } = await this.deps.measure();
    const stop = (): boolean => { if (this.deps.yieldToOperations?.() === true) { yielded = true; return true; } return false; };

    for (const policy of this.partitioned()) {
      if (stop()) break;
      const context = this.context(policy.id);
      const partition = partitionKeyFor(closedSession, policy.partition.granularity);
      // a partition closes only when the NEXT session falls in a different partition (a weekly partition stays open through the week)
      if (nextSession !== null && partitionKeyFor(nextSession, policy.partition.granularity) === partition) continue;
      try { if (await context.ops.exists(policy.id, partition)) await closePartition(context, policy.id, partition); } catch (error) { incidents.push(incidentFromError(error, { dataset: policy.id, partition }, observedAt)); }
    }
    for (const policy of this.partitioned()) {
      const records = await this.deps.store.list(policy.id);
      const plan = planRetention(policy, sessions, records, nextSession);
      for (const partition of plan.archive) {
        if (stop()) break;
        try {
          if (!(await this.deps.opsFor(policy.id).exists(policy.id, partition))) continue;
          // an EMPTY partition older than the session just closed holds no data: drop it (nothing to archive, nothing can be lost) instead of archiving an empty object
          if (partition < partitionKeyFor(closedSession, policy.partition.granularity) && (await this.deps.opsFor(policy.id).countRows(policy.id, partition)) === 0 && (await this.deps.store.get(policy.id, partition)) === null) {
            await this.deps.opsFor(policy.id).detach(policy.id, partition);
            await this.deps.opsFor(policy.id).drop(policy.id, partition);
            continue;
          }
          if (partition === partitionKeyFor(closedSession, policy.partition.granularity) && (await this.deps.opsFor(policy.id).countRows(policy.id, partition)) === 0) continue;
          // sessions that were never explicitly closed (the worker was down, a session was missed) are closed here: a partition before the open one receives no more writes
          if (plan.close.includes(partition)) await closePartition(this.context(policy.id), policy.id, partition); const record = await archivePartition(this.context(policy.id), policy.id, partition); if (record.state === 'ARCHIVED_VERIFIED') archived.push(`${policy.id}/${partition}`); }
        catch (error) { incidents.push(incidentFromError(error, { dataset: policy.id, partition }, observedAt)); }
      }
      // re-plan after archiving: partitions archived and verified in THIS run may already be past their hot window (catch-up after missed sessions)
      const retirePlan = planRetention(policy, sessions, await this.deps.store.list(policy.id), nextSession);
      for (const partition of retirePlan.retire) {
        if (stop()) break;
        try {
          const eligibility = await this.deps.retirementEligible?.(policy.id, partition) ?? { eligible: true, reason: 'NO_ROW_LEVEL_GATE_REQUIRED' };
          if (!eligibility.eligible) {
            incidents.push(incident('PARTITION_RETIREMENT_FAILURE', 'WARNING', { dataset: policy.id, partition }, `TERMINALITY_GATE:${eligibility.reason}`, observedAt));
            continue;
          }
          const record = await retirePartition(this.context(policy.id), policy.id, partition); if (record.state === 'DROPPED') retired.push(`${policy.id}/${partition}`);
        }
        catch (error) { incidents.push(incident('PARTITION_RETIREMENT_FAILURE', 'WARNING', { dataset: policy.id, partition }, error instanceof Error ? error.message : String(error), observedAt)); }
      }
    }
    if (!yielded && retired.length > 0 && this.deps.maintenance !== undefined) { try { await this.deps.maintenance(); } catch (error) { incidents.push(incidentFromError(error, {}, observedAt)); } }

    const { dbBytes: postArchive, planBytes } = await this.deps.measure();
    this.postArchiveHistory.push(postArchive);
    this.recentSessionGrowth.push(Math.max(0, preSession.sessionPeakBytes - preSession.preSessionBytes));
    const slo = assessSteadyState(this.postArchiveHistory.slice(this.warmupSessions));
    const growth = growthIncident(slo, observedAt);
    if (growth !== null) incidents.push(growth);
    const all = await this.deps.store.list();
    const queue = archiveQueueState(all, this.deps.partitionBytes, sessions);
    if (queue.lagSessions > 3) incidents.push(incident('ARCHIVE_BACKLOG', 'WARNING', {}, `archive lag ${queue.lagSessions} sessions, ${queue.queuePartitions} partitions`, observedAt));
    const assessment = assessCapacity({ currentBytes: postArchive, planBytes, recentSessionGrowthBytes: this.recentSessionGrowth.slice(-20), archiveRetireBytesPerSession: 0, retirableBytesNow: 0, queue });
    const receipt = buildReceipt({ sessionDate: closedSession, preSessionBytes: preSession.preSessionBytes, sessionPeakBytes: preSession.sessionPeakBytes, postSessionPreArchiveBytes: beforeArchive, postArchiveBytes: postArchive,
      previousPostArchiveBytes: this.lastPostArchive, archivedPartitions: archived, retiredPartitions: retired, incidents, capacityState: assessment.state });
    this.lastPostArchive = postArchive;
    const entries: ArchiveFileEntry[] = all.flatMap((record) => record.manifest === null ? [] : [{ archiveId: record.manifest.archiveId, dataset: record.dataset, partition: record.partition, compressedBytes: record.manifest.compressedBytes,
      rowCount: record.manifest.rowCount, contentHash: record.manifest.contentHash, schemaVersion: record.manifest.schemaVersion }]);
    return { receipt, incidents, yielded, compaction: planCompaction(entries) };
  }

  /**
   * Weekly integrity sweep: re-reads a sample of archived partitions and verifies manifest, hash, row count and readability. A failure sends the partition back to
   * ARCHIVE_PENDING (so it is re-exported while the hot copy still exists) and raises ARCHIVE_CORRUPTION; nothing is ever dropped on an unverifiable archive.
   */
  async weeklyIntegrity(sample: number): Promise<readonly PlatformIncident[]> {
    const out: PlatformIncident[] = [];
    const records = (await this.deps.store.list()).filter((record) => record.manifest !== null);
    const stride = Math.max(1, Math.floor(records.length / Math.max(1, sample)));
    for (let index = 0; index < records.length && out.length < sample * 2; index += stride) {
      const record = records[index];
      if (record === undefined || record.manifest === null) continue;
      try { await reverifyArchive(this.context(record.dataset), record.manifest); }
      catch (error) {
        out.push(incidentFromError(error, { dataset: record.dataset, partition: record.partition }, this.deps.now()));
        if (record.state === 'ARCHIVED_VERIFIED' || record.state === 'DETACH_ELIGIBLE') await this.deps.store.put({ ...record, state: 'ARCHIVE_PENDING', step: 'NONE', uploaded: null, verifiedAt: null, replayVerified: null, manifest: null, lastError: error instanceof Error ? error.message : String(error), updatedAt: this.deps.now() });
      }
    }
    return out;
  }
}

// Named facade so every storage capability resolves to this one module (spec 5: no competing authorities).
export { assessCapacity as StorageGovernor, archivePartition as ArchiveManager, planRetention as RetentionManager, planCompaction as CompactionManager, reverifyArchive as ArchiveVerifier,
  retirePartition as PartitionManager, assessSteadyState as GrowthForecaster, preSessionGate as StoragePressureGate };
