// R1H item M: persistence interfaces shared by the research/runtime
// layers. Codex owns the production PostgreSQL schema/migrations, in
// trade.*/core.*/market.*). This file defines repository contracts for
// everything THETA's runtime layer now produces (FusionSnapshot,
// DecisionReceipt, ManagementDecisionReceipt, StrategyRoute,
// ShadowOpportunity, LifecycleEpisode, SchedulerCheckpoint) so a future
// concrete implementation (Postgres-backed, built by Codex against
// whatever schema Codex decides to add) has an exact, already-agreed
// shape to satisfy. NO SQL, NO migration, NO concrete implementation
// lives in this file -- only interfaces and the already-existing runtime
// types they persist.
//
// Mapping against the CURRENT canonical schema (migrations/001-008),
// checked before writing this file:
//
// - FusionSnapshotRepository  -> trade.fusion_snapshot                    (EXISTS, compatible)
// - DecisionReceiptRepository -> trade.decision + trade.decision_reason   (EXISTS, compatible for NEW_RISK)
// - LifecycleEpisodeRepository -> trade.economic_chain                    (EXISTS, compatible)
// - ManagementDecisionReceiptRepository -> trade.management_decision
// - StrategyRouteRepository   -> trade.strategy_route
// - ShadowOpportunityRepository -> trade.shadow_opportunity
// - SchedulerCheckpointRepository -> ops.scheduler_checkpoint

import type { ShadowOpportunityEntry } from './shadow-opportunity-book.js';
import type { ManagementOpportunityEntry } from './management-opportunity-book.js';
import type { ThetaLifecycleState } from './runtime-state.js';

// ---------------------------------------------------------------------------
// FusionSnapshot
// ---------------------------------------------------------------------------

export interface FusionSnapshotRecord {
  readonly fusionSnapshotId: string;
  readonly botInstanceId: string;
  readonly decisionTime: string;
  readonly triggerType: string;
  readonly contentHash: string; // matches trade.fusion_snapshot.content_hash's ^[0-9a-f]{64}$ check
  readonly snapshotJson: Readonly<Record<string, unknown>>;
  readonly unknownFeatures: readonly string[];
}

export interface FusionSnapshotRepository {
  save(record: FusionSnapshotRecord): Promise<void>;
  findById(fusionSnapshotId: string): Promise<FusionSnapshotRecord | null>;
  findByContentHash(botInstanceId: string, contentHash: string): Promise<FusionSnapshotRecord | null>;
}

// ---------------------------------------------------------------------------
// DecisionReceipt (new-risk path: OPEN/WAIT/PASS decisions)
// ---------------------------------------------------------------------------

export interface DecisionReceiptRecord {
  readonly decisionId: string;
  readonly fusionSnapshotId: string;
  readonly decisionKind: string; // e.g. 'NEW_RISK' -- matches trade.decision.decision_kind
  readonly actionCode: string;
  readonly quantity: number; // trade.decision enforces quantity=0 when actionCode='WAIT' -- never max(1,q)
  readonly aegisAction: string;
  readonly strategyBranch: string | null;
  readonly decidedAt: string;
  readonly explanationHash: string | null;
  readonly reasons: readonly { readonly reasonFamily: string; readonly reasonCode: string; readonly polarity: -1 | 0 | 1 }[];
}

export interface DecisionReceiptRepository {
  save(record: DecisionReceiptRecord): Promise<void>;
  findById(decisionId: string): Promise<DecisionReceiptRecord | null>;
  findByFusionSnapshot(fusionSnapshotId: string): Promise<readonly DecisionReceiptRecord[]>;
}

// ---------------------------------------------------------------------------
// ManagementDecisionReceipt (K1-K4: CSP leg / assignment / recovery / CC)
// ---------------------------------------------------------------------------

export interface ManagementDecisionReceiptRecord {
  readonly decisionId: string;
  readonly fusionSnapshotId: string;
  readonly chainId: string;
  readonly lifecycleStateAtDecision: ThetaLifecycleState;
  readonly route: string; // 'SHORT_PUT' | 'ASSIGNMENT_PENDING' | 'STOCK_RECOVERY' | 'COVERED_CALL' | 'CLOSED' | 'UNKNOWN'
  readonly selectedAction: string | null;
  readonly holdAdvantage: number | null;
  readonly valuationsJson: readonly Readonly<Record<string, unknown>>[]; // opaque persisted form of ActionValuation[]
  readonly aegisState: string | null;
  readonly executionQualityAcceptable: boolean | null;
  readonly failClosedReason: string | null;
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
  readonly decidedAt: string;
}

export interface ManagementDecisionReceiptRepository {
  save(record: ManagementDecisionReceiptRecord): Promise<void>;
  findById(decisionId: string): Promise<ManagementDecisionReceiptRecord | null>;
  findByChain(chainId: string): Promise<readonly ManagementDecisionReceiptRecord[]>;
}

// ---------------------------------------------------------------------------
// StrategyRoute (the router's OWN eligibility/reasons per branch, not just
// the single branch a decision ultimately used)
// ---------------------------------------------------------------------------

export interface StrategyRouteRecord {
  readonly routeId: string;
  readonly fusionSnapshotId: string;
  readonly evaluatedAt: string;
  readonly branchEligibility: readonly {
    readonly branch: string; // THETA_CONVENTIONAL | THETA_HOLD_STRIKE | THETA_DEFINED_RISK | THETA_RECOVERY | THETA_CC
    readonly eligible: boolean;
    readonly reasonCodes: readonly string[];
  }[];
  readonly selectedBranch: string | null;
  readonly policyVersion: string;
}

export interface StrategyRouteRepository {
  save(record: StrategyRouteRecord): Promise<void>;
  findByFusionSnapshot(fusionSnapshotId: string): Promise<StrategyRouteRecord | null>;
}

// ---------------------------------------------------------------------------
// ShadowOpportunity (new-risk book, shadow-opportunity-book.ts)
// ---------------------------------------------------------------------------

export interface ShadowOpportunityRepository {
  save(entry: ShadowOpportunityEntry): Promise<void>;
  findBySnapshot(snapshotId: string): Promise<readonly ShadowOpportunityEntry[]>;
  findByUnderlying(underlying: string, sinceIso: string): Promise<readonly ShadowOpportunityEntry[]>;
}

// ---------------------------------------------------------------------------
// ManagementOpportunity (management path, management-opportunity-book.ts) --
// a sibling of ShadowOpportunityRepository, not a variant of it, since the
// two entry shapes are genuinely different (single evNet vs. multi-
// alternative utilities).
// ---------------------------------------------------------------------------

export interface ManagementOpportunityRepository {
  save(entry: ManagementOpportunityEntry): Promise<void>;
  findByChain(chainId: string): Promise<readonly ManagementOpportunityEntry[]>;
}

// ---------------------------------------------------------------------------
// LifecycleEpisode (trade.economic_chain is already schema-compatible)
// ---------------------------------------------------------------------------

export interface LifecycleEpisodeRecord {
  readonly chainId: string;
  readonly botInstanceId: string;
  readonly underlying: string;
  readonly lifecycleState: ThetaLifecycleState;
  readonly openedAt: string;
  readonly closedAt: string | null;
}

export interface LifecycleEpisodeRepository {
  save(record: LifecycleEpisodeRecord): Promise<void>;
  findById(chainId: string): Promise<LifecycleEpisodeRecord | null>;
  findOpenByBotInstance(botInstanceId: string): Promise<readonly LifecycleEpisodeRecord[]>;
  appendTransition(chainId: string, to: ThetaLifecycleState, at: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// SchedulerCheckpoint (R1I -- restart-safe scheduler; no compatible table
// exists yet, see the schema change request)
// ---------------------------------------------------------------------------

export interface SchedulerCheckpointRecord {
  readonly jobId: string; // deterministic correlation id -- see scheduler.ts
  readonly jobKind: string;
  readonly correlationId: string;
  readonly leaseOwner: string | null;
  readonly leaseAcquiredAt: string | null;
  readonly leaseExpiresAt: string | null;
  readonly lastHeartbeatAt: string | null;
  readonly attempt: number;
  readonly status: 'PENDING' | 'LEASED' | 'COMPLETED' | 'FAILED' | 'ABANDONED';
  readonly resultStatus: 'SUCCEEDED' | 'DEGRADED' | 'FAILED' | 'SKIPPED' | 'QUARANTINED' | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly nextEligibleAt: string | null;
  readonly runtimeVersion: string | null;
  readonly policyVersion: string | null;
  readonly lastError: string | null;
  readonly resultMetadata: Readonly<Record<string, unknown>>;
}

export interface SchedulerCheckpointRepository {
  save(record: SchedulerCheckpointRecord): Promise<void>;
  findById(jobId: string): Promise<SchedulerCheckpointRecord | null>;
  // Atomic compare-and-swap lease acquisition -- returns false (never
  // throws) if another owner already holds an unexpired lease, so the
  // caller can treat "someone else has this" as an ordinary, expected
  // outcome rather than an error.
  tryAcquireLease(
    jobId: string,
    owner: string,
    leaseExpiresAt: string,
    runtimeVersion?: string,
    policyVersion?: string,
  ): Promise<boolean>;
  heartbeat(jobId: string, owner: string, leaseExpiresAt: string): Promise<boolean>;
  releaseLease(jobId: string, owner: string): Promise<void>;
  findExpiredLeases(asOfIso: string): Promise<readonly SchedulerCheckpointRecord[]>;
  findRetryableFailures(asOfIso: string): Promise<readonly SchedulerCheckpointRecord[]>;
}
