// Storage budget architecture v2 (Phase 4 storage decision). Pure functions; no I/O. NOT yet wired into the runtime writers (see
// docs/operations/THETA_PHASE4_STORAGE_DECISION_PACKET_20261003.md): today only the audit tool reports a disposition, no writer consumes it.
//
// Separates the provider's hard limit from THETA's own soft and hard budgets, projects growth in SESSIONS (an idle weekend adds about zero),
// and states what the growth is made of. The write policy can never throttle operational truth: that is enforced by the type and by tests.

export const OPERATIONAL_WRITE_CLASSES = [
  'ORDERS', 'FILLS', 'BROKER_RECONCILIATION', 'EXECUTION_STATE', 'INVENTORY', 'RISK_STATE', 'MANAGEMENT_STATE', 'AUDIT_LINEAGE', 'DECISION_TRUTH', 'SAFETY_EVENTS',
] as const;
export const RESEARCH_WRITE_CLASSES = ['CURRENT_RUNTIME_EVIDENCE', 'RESEARCH_HISTORY', 'RAW_PROVIDER_PAYLOADS', 'CYCLE_ARCHIVE_BLOBS'] as const;
export type OperationalWriteClass = (typeof OPERATIONAL_WRITE_CLASSES)[number];
export type ResearchWriteClass = (typeof RESEARCH_WRITE_CLASSES)[number];
export type WriteClass = OperationalWriteClass | ResearchWriteClass;
export type WriteDisposition = 'ALLOW' | 'DIVERT_TO_LOCAL_ARCHIVE' | 'PAUSE';

export type StorageActionState = 'NORMAL' | 'WATCH' | 'ARCHIVE_RECOMMENDED' | 'RESEARCH_DIVERT' | 'PROVIDER_EMERGENCY';

export interface StorageBudgetV2Policy {
  readonly policyVersion: 'theta-storage-budget-v2';
  /** The provider plan allocation. Reaching it is an outage risk, not a policy line. */
  readonly providerHardLimitBytes: number;
  /** THETA's own soft budget: archive/compaction is recommended from here. */
  readonly internalSoftBytes: number;
  /** THETA's own hard budget: research writes are diverted from here (never operational truth). */
  readonly internalHardBytes: number;
  /** Alarm horizons, in active sessions. */
  readonly watchWithinSessions: number;
  readonly archiveWithinSessions: number;
  readonly divertWithinSessions: number;
}

export interface GrowthByClassMib {
  readonly operationalTruth: number;
  readonly research: number;
  readonly archivableHistory: number;
}

export interface StorageBudgetV2Input {
  readonly currentBytes: number;
  /** Measured growth per ACTIVE session in bytes; null when it cannot be measured. */
  readonly growthBytesPerSession: number | null;
  readonly archivableBytes: number;
  /** Largest observed bytes per decision of any single stored form divided by the median across forms (a duplication indicator), null if unmeasured. */
  readonly growthMibByClass?: GrowthByClassMib | null;
  readonly duplicationRatio?: number | null;
}

export interface StorageBudgetV2Assessment {
  readonly policyVersion: StorageBudgetV2Policy['policyVersion'];
  readonly currentBytes: number;
  readonly softBudgetBytes: number;
  readonly hardBudgetBytes: number;
  readonly providerHardLimitBytes: number;
  readonly growthBytesPerSession: number | null;
  readonly sessionsToSoft: number | null;
  readonly sessionsToHard: number | null;
  readonly sessionsToProviderLimit: number | null;
  readonly archivableBytes: number;
  readonly nonArchivableBytes: number;
  readonly growthKind: 'UNKNOWN' | 'NONE' | 'OPERATIONAL_TRUTH' | 'RESEARCH' | 'ARCHIVABLE_HISTORY' | 'PATHOLOGICAL_DUPLICATION';
  readonly actionState: StorageActionState;
  readonly writePolicy: Readonly<Record<WriteClass, WriteDisposition>>;
}

/** The measured 2026-10-03 policy: the plan allocation is 8 GiB, the existing internal guard breaches at 4 GiB and warns at 3.2 GiB. */
export const thetaStorageBudgetV2: StorageBudgetV2Policy = {
  policyVersion: 'theta-storage-budget-v2',
  providerHardLimitBytes: 8 * 1024 ** 3,
  internalSoftBytes: Math.round(3.2 * 1024 ** 3),
  internalHardBytes: 4 * 1024 ** 3,
  watchWithinSessions: 40,
  archiveWithinSessions: 20,
  divertWithinSessions: 8,
};

const sessionsUntil = (limitBytes: number, currentBytes: number, growth: number | null): number | null => {
  if (currentBytes >= limitBytes) return 0;
  if (growth === null || !(growth > 0)) return null;
  return (limitBytes - currentBytes) / growth;
};

/** Operational classes are ALLOW in every state. Research classes follow the action state. */
export function writePolicyFor(state: StorageActionState): Readonly<Record<WriteClass, WriteDisposition>> {
  const research: WriteDisposition = state === 'RESEARCH_DIVERT' ? 'DIVERT_TO_LOCAL_ARCHIVE' : state === 'PROVIDER_EMERGENCY' ? 'PAUSE' : 'ALLOW';
  const policy = {} as Record<WriteClass, WriteDisposition>;
  for (const writeClass of OPERATIONAL_WRITE_CLASSES) policy[writeClass] = 'ALLOW';
  for (const writeClass of RESEARCH_WRITE_CLASSES) {
    // current runtime evidence stays in the database until the provider is at risk; bulk classes divert first
    policy[writeClass] = writeClass === 'CURRENT_RUNTIME_EVIDENCE' && state === 'RESEARCH_DIVERT' ? 'ALLOW' : research;
  }
  return policy;
}

export function assessStorageBudgetV2(input: StorageBudgetV2Input, policy: StorageBudgetV2Policy = thetaStorageBudgetV2): StorageBudgetV2Assessment {
  if (!Number.isFinite(input.currentBytes) || input.currentBytes < 0 || !Number.isFinite(input.archivableBytes) || input.archivableBytes < 0 || input.archivableBytes > input.currentBytes) {
    throw new Error('INVALID_STORAGE_BUDGET_INPUT');
  }
  if (!(policy.internalSoftBytes < policy.internalHardBytes && policy.internalHardBytes < policy.providerHardLimitBytes)) throw new Error('INVALID_STORAGE_BUDGET_POLICY');
  const growth = input.growthBytesPerSession;
  const sessionsToSoft = sessionsUntil(policy.internalSoftBytes, input.currentBytes, growth);
  const sessionsToHard = sessionsUntil(policy.internalHardBytes, input.currentBytes, growth);
  const sessionsToProvider = sessionsUntil(policy.providerHardLimitBytes, input.currentBytes, growth);
  const within = (sessions: number | null, horizon: number): boolean => sessions !== null && sessions <= horizon;
  const overHard = input.currentBytes >= policy.internalHardBytes;
  const state: StorageActionState =
    input.currentBytes >= policy.providerHardLimitBytes * 0.9 || within(sessionsToProvider, 3) ? 'PROVIDER_EMERGENCY'
      : overHard && (sessionsToProvider === null || within(sessionsToProvider, policy.divertWithinSessions * 2)) ? 'RESEARCH_DIVERT'
        : input.currentBytes >= policy.internalSoftBytes || overHard || within(sessionsToHard, policy.archiveWithinSessions) ? 'ARCHIVE_RECOMMENDED'
          : within(sessionsToSoft, policy.watchWithinSessions) ? 'WATCH' : 'NORMAL';
  const classes = input.growthMibByClass ?? null;
  const growthKind: StorageBudgetV2Assessment['growthKind'] = growth === null ? 'UNKNOWN' : growth <= 0 ? 'NONE'
    : input.duplicationRatio != null && input.duplicationRatio >= 5 ? 'PATHOLOGICAL_DUPLICATION'
      : classes === null ? 'UNKNOWN'
        : ([['OPERATIONAL_TRUTH', classes.operationalTruth], ['RESEARCH', classes.research], ['ARCHIVABLE_HISTORY', classes.archivableHistory]] as const)
          .reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
  return {
    policyVersion: policy.policyVersion,
    currentBytes: input.currentBytes,
    softBudgetBytes: policy.internalSoftBytes,
    hardBudgetBytes: policy.internalHardBytes,
    providerHardLimitBytes: policy.providerHardLimitBytes,
    growthBytesPerSession: growth,
    sessionsToSoft, sessionsToHard, sessionsToProviderLimit: sessionsToProvider,
    archivableBytes: input.archivableBytes,
    nonArchivableBytes: input.currentBytes - input.archivableBytes,
    growthKind,
    actionState: state,
    writePolicy: writePolicyFor(state),
  };
}
