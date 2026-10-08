import type { Pool } from 'pg';

/** Observational only. This receipt never grants authority or changes a gate. */
export type PaperRuntimeAuthorityState = 'AUTHORIZED_ACTIVE' | 'UNAUTHORIZED_ACTIVE'
  | 'LOCKED' | 'PAUSED' | 'STALE_AUTHORITY' | 'UNKNOWN_CONTROL';
export interface PaperRuntimeAuthorityEvidence {
  readonly observedAt: string;
  readonly controlChangedAt: string | null;
  readonly authorizationAt: string | null;
  readonly masterEnabled: boolean | null;
  readonly paused: boolean | null;
  readonly followerEnabled: boolean | null;
  readonly ownerPaperOnly: boolean | null;
  readonly autonomousScope: boolean | null;
  readonly canaryAccepted: boolean | null;
  readonly firstCanaryScope: boolean | null;
  readonly liveAuthorized: boolean | null;
  /** No operator event is a known absence. A malformed event stays unknown. */
  readonly operatorPaused: boolean | null;
  readonly emergencyLock: boolean | null;
}
export interface PaperRuntimeAuthorityTruth {
  readonly version: 'theta-paper-runtime-authority-truth-v1';
  readonly state: PaperRuntimeAuthorityState;
  readonly reasons: readonly string[];
  readonly follower: 'LOCKED' | 'UNAUTHORIZED_ACTIVE' | 'UNKNOWN_CONTROL';
  readonly live: 'NOT_AUTHORIZED' | 'UNAUTHORIZED_ACTIVE' | 'UNKNOWN_CONTROL';
  readonly evidenceObservedAt: string | null;
  readonly workerSha: string | null;
  readonly brokerAuthority: false;
}

export function classifyPaperRuntimeAuthority(input: {
  readonly now: string; readonly maximumAgeMs: number;
  readonly workerSha: string | null; readonly workerHeartbeat: string | null;
  readonly executionGate: string | null;
  readonly evidence: PaperRuntimeAuthorityEvidence | null;
}): PaperRuntimeAuthorityTruth {
  const e = input.evidence;
  const follower = e?.followerEnabled === false ? 'LOCKED' : e?.followerEnabled === true ? 'UNAUTHORIZED_ACTIVE' : 'UNKNOWN_CONTROL';
  const live = e?.liveAuthorized === false ? 'NOT_AUTHORIZED' : e?.liveAuthorized === true ? 'UNAUTHORIZED_ACTIVE' : 'UNKNOWN_CONTROL';
  const done = (state: PaperRuntimeAuthorityState, ...reasons: string[]): PaperRuntimeAuthorityTruth => ({
    version: 'theta-paper-runtime-authority-truth-v1', state, reasons, follower, live,
    evidenceObservedAt: e?.observedAt ?? null, workerSha: input.workerSha, brokerAuthority: false,
  });
  if (!e) return done('UNKNOWN_CONTROL', 'DURABLE_CONTROL_NOT_OBSERVED');
  const active = input.executionGate === 'ACTIVE';
  const contradiction = [
    e.followerEnabled === true ? 'FOLLOWER_EXECUTION_NOT_AUTHORIZED' : null,
    e.liveAuthorized === true ? 'LIVE_MONEY_NOT_AUTHORIZED' : null,
    active && e.masterEnabled === false ? 'ACTIVE_WITH_MASTER_DISABLED' : null,
    active && (e.paused === true || e.operatorPaused === true || e.emergencyLock === true) ? 'ACTIVE_WITH_PAUSE_OR_LOCK' : null,
    active && e.ownerPaperOnly === false ? 'ACTIVE_WITHOUT_PAPER_OWNER_AUTHORITY' : null,
  ].filter((reason): reason is string => reason !== null);
  if (contradiction.length) return done('UNAUTHORIZED_ACTIVE', ...contradiction);
  if ([e.masterEnabled, e.paused, e.followerEnabled, e.liveAuthorized, e.operatorPaused, e.emergencyLock].some(v => v === null)
    || input.executionGate === null || !['ACTIVE', 'LOCKED', 'EXTERNAL_QUOTE_BLOCKER'].includes(input.executionGate))
    return done('UNKNOWN_CONTROL', 'CONTROL_FIELDS_UNAVAILABLE');
  const now = Date.parse(input.now);
  const fresh = (value: string | null) => {
    const age = now - Date.parse(value ?? '');
    return Number.isFinite(age) && age >= 0 && age <= input.maximumAgeMs;
  };
  if (!(input.maximumAgeMs > 0) || !fresh(e.observedAt) || !fresh(input.workerHeartbeat)
    || !/^[a-f0-9]{40}$/.test(input.workerSha ?? '')) return done('STALE_AUTHORITY', 'CURRENT_WORKER_AND_CONTROL_PROOF_REQUIRED');
  // Owner permission is durable, not subject to an invented expiry. Observation
  // freshness and impossible future timestamps are checked separately.
  if (e.controlChangedAt === null || !Number.isFinite(Date.parse(e.controlChangedAt))
    || Date.parse(e.controlChangedAt) > now) return done('UNKNOWN_CONTROL', 'CONTROL_TIMESTAMP_INVALID');
  if (e.emergencyLock || !e.masterEnabled) return done('LOCKED', 'MASTER_DISABLED_OR_EMERGENCY_LOCK');
  if (e.paused || e.operatorPaused) return done('PAUSED', 'NEW_ENTRIES_PAUSED_MANAGEMENT_SEPARATE');
  if (!active) return done('LOCKED', input.executionGate === 'EXTERNAL_QUOTE_BLOCKER' ? 'EXECUTION_QUOTE_BLOCKER' : 'WORKER_EXECUTION_GATE_LOCKED');
  if (e.ownerPaperOnly === null || e.canaryAccepted === null || e.autonomousScope === null || e.firstCanaryScope === null)
    return done('UNKNOWN_CONTROL', 'OWNER_SCOPE_OR_ACCEPTANCE_UNAVAILABLE');
  if (e.authorizationAt === null || !Number.isFinite(Date.parse(e.authorizationAt)) || Date.parse(e.authorizationAt) > now)
    return done('STALE_AUTHORITY', 'OWNER_AUTHORITY_TIMESTAMP_INVALID');
  if (!(e.ownerPaperOnly && ((e.autonomousScope && e.canaryAccepted) || (e.firstCanaryScope && !e.canaryAccepted))))
    return done('UNAUTHORIZED_ACTIVE', 'ACTIVE_OUTSIDE_DURABLE_PAPER_SCOPE');
  return done('AUTHORIZED_ACTIVE', e.canaryAccepted ? 'DURABLE_AUTONOMOUS_PAPER_ACCEPTANCE' : 'DURABLE_FIRST_CANARY_SCOPE');
}

const bool = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
const time = (value: unknown): string | null => value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null;

/** One read snapshot, no new pool, no mutations, and no ambient/local env authority. */
export async function readPaperRuntimeAuthorityEvidence(pool: Pick<Pool, 'query'>): Promise<PaperRuntimeAuthorityEvidence | null> {
  const result = await pool.query(`SELECT now() AS observed_at, pec.changed_at, pec.master_execution_enabled,
    pec.pause_new_orders, pec.follower_execution_enabled, pae.authorized_at,
    (pae.account_role='MASTER_THETA_PAPER' AND pae.environment='PAPER' AND pae.master_submission_authorized
      AND NOT pae.follower_submission_authorized AND NOT pae.live_money_authorized) AS owner_paper_only,
    pae.live_money_authorized,
    pae.authorization_scope_json->'autonomousPaperAfterAcceptedCanaryAuthorized' AS autonomous_scope,
    pae.authorization_scope_json->'automaticLockAfterFirstBrokerOrder' AS first_canary_scope,
    EXISTS(SELECT 1 FROM copy.operator_audit_event WHERE action='ACTIVATE_AUTONOMOUS_MASTER_PAPER'
      AND result='ACCEPTED') AS canary_accepted,
    op.state_version AS operator_version, op.resulting_state_json AS operator_state
    FROM ops.paper_execution_control pec LEFT JOIN ops.paper_execution_authorization_event pae
      ON pae.authorization_event_id=pec.authorization_event_id
    LEFT JOIN LATERAL (SELECT state_version,resulting_state_json FROM ops.theta_operator_control_event
      ORDER BY state_version DESC,created_at DESC LIMIT 1) op ON true
    WHERE pec.singleton=true`);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const op = row.operator_state as Record<string, unknown> | null;
  const noOperator = row.operator_version === null;
  return {
    observedAt: time(row.observed_at) ?? '', controlChangedAt: time(row.changed_at), authorizationAt: time(row.authorized_at),
    masterEnabled: bool(row.master_execution_enabled), paused: bool(row.pause_new_orders), followerEnabled: bool(row.follower_execution_enabled),
    ownerPaperOnly: bool(row.owner_paper_only), liveAuthorized: bool(row.live_money_authorized), canaryAccepted: bool(row.canary_accepted),
    // Missing keys in a present immutable JSON object express no such grant.
    autonomousScope: row.authorized_at == null ? null : row.autonomous_scope === null ? false : bool(row.autonomous_scope),
    firstCanaryScope: row.authorized_at == null ? null : row.first_canary_scope === null ? false : bool(row.first_canary_scope),
    operatorPaused: noOperator ? false : bool(op?.newEntriesPaused), emergencyLock: noOperator ? false : bool(op?.emergencyExecutionLock),
  };
}
