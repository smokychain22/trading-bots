// In-memory reference implementations of persistence-repositories.ts's
// interfaces. NOT production persistence -- Codex owns the real
// Postgres-backed implementation. This exists only to prove the
// interfaces are coherent/exercisable and to give the rest of THETA's
// runtime something concrete to test against before that real
// implementation exists.

import type {
  FusionSnapshotRecord, FusionSnapshotRepository,
  DecisionReceiptRecord, DecisionReceiptRepository,
  ManagementDecisionReceiptRecord, ManagementDecisionReceiptRepository,
  StrategyRouteRecord, StrategyRouteRepository,
  ShadowOpportunityRepository,
  ManagementOpportunityRepository,
  LifecycleEpisodeRecord, LifecycleEpisodeRepository,
  SchedulerCheckpointRecord, SchedulerCheckpointRepository,
} from './persistence-repositories.js';
import type { ShadowOpportunityEntry } from './shadow-opportunity-book.js';
import type { ManagementOpportunityEntry } from './management-opportunity-book.js';
import type { ThetaLifecycleState } from './runtime-state.js';

export class InMemoryFusionSnapshotRepository implements FusionSnapshotRepository {
  private readonly byId = new Map<string, FusionSnapshotRecord>();

  async save(record: FusionSnapshotRecord): Promise<void> {
    this.byId.set(record.fusionSnapshotId, record);
  }
  async findById(fusionSnapshotId: string): Promise<FusionSnapshotRecord | null> {
    return this.byId.get(fusionSnapshotId) ?? null;
  }
  async findByContentHash(botInstanceId: string, contentHash: string): Promise<FusionSnapshotRecord | null> {
    for (const record of this.byId.values()) {
      if (record.botInstanceId === botInstanceId && record.contentHash === contentHash) return record;
    }
    return null;
  }
}

export class InMemoryDecisionReceiptRepository implements DecisionReceiptRepository {
  private readonly byId = new Map<string, DecisionReceiptRecord>();

  async save(record: DecisionReceiptRecord): Promise<void> {
    this.byId.set(record.decisionId, record);
  }
  async findById(decisionId: string): Promise<DecisionReceiptRecord | null> {
    return this.byId.get(decisionId) ?? null;
  }
  async findByFusionSnapshot(fusionSnapshotId: string): Promise<readonly DecisionReceiptRecord[]> {
    return Array.from(this.byId.values()).filter((r) => r.fusionSnapshotId === fusionSnapshotId);
  }
}

export class InMemoryManagementDecisionReceiptRepository implements ManagementDecisionReceiptRepository {
  private readonly byId = new Map<string, ManagementDecisionReceiptRecord>();

  async save(record: ManagementDecisionReceiptRecord): Promise<void> {
    this.byId.set(record.decisionId, record);
  }
  async findById(decisionId: string): Promise<ManagementDecisionReceiptRecord | null> {
    return this.byId.get(decisionId) ?? null;
  }
  async findByChain(chainId: string): Promise<readonly ManagementDecisionReceiptRecord[]> {
    return Array.from(this.byId.values()).filter((r) => r.chainId === chainId);
  }
}

export class InMemoryStrategyRouteRepository implements StrategyRouteRepository {
  private readonly byFusionSnapshotId = new Map<string, StrategyRouteRecord>();

  async save(record: StrategyRouteRecord): Promise<void> {
    this.byFusionSnapshotId.set(record.fusionSnapshotId, record);
  }
  async findByFusionSnapshot(fusionSnapshotId: string): Promise<StrategyRouteRecord | null> {
    return this.byFusionSnapshotId.get(fusionSnapshotId) ?? null;
  }
}

export class InMemoryShadowOpportunityRepository implements ShadowOpportunityRepository {
  private readonly entries: ShadowOpportunityEntry[] = [];

  async save(entry: ShadowOpportunityEntry): Promise<void> {
    this.entries.push(entry);
  }
  async findBySnapshot(snapshotId: string): Promise<readonly ShadowOpportunityEntry[]> {
    return this.entries.filter((e) => e.snapshotId === snapshotId);
  }
  async findByUnderlying(underlying: string, sinceIso: string): Promise<readonly ShadowOpportunityEntry[]> {
    return this.entries.filter((e) => e.underlying === underlying && e.timestamp >= sinceIso);
  }
}

export class InMemoryManagementOpportunityRepository implements ManagementOpportunityRepository {
  private readonly entries: ManagementOpportunityEntry[] = [];

  async save(entry: ManagementOpportunityEntry): Promise<void> {
    this.entries.push(entry);
  }
  async findByChain(chainId: string): Promise<readonly ManagementOpportunityEntry[]> {
    return this.entries.filter((e) => e.chainId === chainId);
  }
}

export class InMemoryLifecycleEpisodeRepository implements LifecycleEpisodeRepository {
  private readonly byId = new Map<string, LifecycleEpisodeRecord>();

  async save(record: LifecycleEpisodeRecord): Promise<void> {
    this.byId.set(record.chainId, record);
  }
  async findById(chainId: string): Promise<LifecycleEpisodeRecord | null> {
    return this.byId.get(chainId) ?? null;
  }
  async findOpenByBotInstance(botInstanceId: string): Promise<readonly LifecycleEpisodeRecord[]> {
    return Array.from(this.byId.values()).filter((r) => r.botInstanceId === botInstanceId && r.closedAt === null);
  }
  async appendTransition(chainId: string, to: ThetaLifecycleState, at: string): Promise<void> {
    const existing = this.byId.get(chainId);
    if (existing === undefined) throw new Error(`no LifecycleEpisode for chain ${chainId}`);
    this.byId.set(chainId, { ...existing, lifecycleState: to, closedAt: to === 'CLOSED' ? at : existing.closedAt });
  }
}

export class InMemorySchedulerCheckpointRepository implements SchedulerCheckpointRepository {
  private readonly byId = new Map<string, SchedulerCheckpointRecord>();

  async save(record: SchedulerCheckpointRecord): Promise<void> {
    this.byId.set(record.jobId, record);
  }
  async findById(jobId: string): Promise<SchedulerCheckpointRecord | null> {
    return this.byId.get(jobId) ?? null;
  }
  async tryAcquireLease(jobId: string, owner: string, leaseExpiresAt: string): Promise<boolean> {
    const existing = this.byId.get(jobId);
    const now = new Date().toISOString();
    if (existing !== undefined && existing.status === 'LEASED' && existing.leaseExpiresAt > now && existing.leaseOwner !== owner) {
      return false; // someone else holds an unexpired lease -- expected, not an error
    }
    this.byId.set(jobId, {
      jobId, jobKind: existing?.jobKind ?? 'UNKNOWN', leaseOwner: owner, leaseExpiresAt,
      lastHeartbeatAt: now, attempt: (existing?.attempt ?? 0) + 1, status: 'LEASED', lastError: null,
    });
    return true;
  }
  async releaseLease(jobId: string, owner: string): Promise<void> {
    const existing = this.byId.get(jobId);
    if (existing === undefined || existing.leaseOwner !== owner) return; // not ours to release -- silently a no-op, never a forced takeover
    this.byId.set(jobId, { ...existing, status: 'COMPLETED' });
  }
  async findExpiredLeases(asOfIso: string): Promise<readonly SchedulerCheckpointRecord[]> {
    return Array.from(this.byId.values()).filter((r) => r.status === 'LEASED' && r.leaseExpiresAt <= asOfIso);
  }
}
