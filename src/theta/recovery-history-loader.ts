import type { Pool } from 'pg';

export const recoveryHistoryLoaderVersion = 'theta-recovery-history-loader-v1' as const;

export interface RecoveryHistoryEvidence {
  readonly historicalRecoveryMedianDays: number | null;
  readonly historicalRecoveryP95Days: number | null;
  readonly resolvedRecoveryEpisodeCount: number;
  readonly asOf: string;
  readonly source: 'RESEARCH.THETA_OUTCOME_LABEL';
  readonly policyVersion: typeof recoveryHistoryLoaderVersion;
}

/**
 * Loads only labels that were available by the decision cutoff. The query
 * deliberately uses label_available_at, rather than import time, so a later
 * backfill cannot leak a future outcome into an earlier decision replay.
 */
export async function loadRecoveryHistory(
  pool: Pool, underlying: string, asOf: string,
): Promise<RecoveryHistoryEvidence> {
  const result = await pool.query<{ median_days:string|null;p95_days:string|null;episode_count:number }>(`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY l.recovery_duration_days)::text AS median_days,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY l.recovery_duration_days)::text AS p95_days,
      count(*)::int AS episode_count
    FROM research.theta_outcome_label l
    JOIN trade.economic_chain ec ON ec.chain_id=l.subject_id
    JOIN market.underlying u ON u.underlying_id=ec.underlying_id
    WHERE l.subject_type='WHOLE_CHAIN' AND l.censoring_state='RESOLVED'
      AND l.recovery_duration_days IS NOT NULL AND l.label_available_at <= $1 AND u.symbol=$2`, [asOf, underlying]);
  const row = result.rows[0];
  const finite = (value:string|null|undefined):number|null => {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  return {
    historicalRecoveryMedianDays: finite(row?.median_days),
    historicalRecoveryP95Days: finite(row?.p95_days),
    resolvedRecoveryEpisodeCount: Number(row?.episode_count ?? 0),
    asOf, source: 'RESEARCH.THETA_OUTCOME_LABEL', policyVersion: recoveryHistoryLoaderVersion,
  };
}
