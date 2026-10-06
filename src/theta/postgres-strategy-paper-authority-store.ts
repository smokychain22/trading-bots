import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { withRuntimePostgresReadRetry, withRuntimePostgresTransaction } from './runtime-postgres-client.js';
import { strategyPaperAuthorityReceiptSchema, verifyStrategyPaperAuthorityReceipt, type PaperExposureStrategy, type StrategyPaperAuthorityReceipt } from './strategy-paper-authority.js';

/**
 * The governed, persisted home of a strategy's Paper authority receipt. Authority is a RECORDED, hash-verified act, never an inference:
 *  - append-only (an immutable table); a later receipt supersedes an earlier one only by being newer;
 *  - bound to the EXACT release SHA it was issued for, so a code change silently revokes it (a new SHA has no receipt until one is recorded for it);
 *  - absence, a hash mismatch, a blocked receipt or a different SHA all read as "no authority" (fail closed).
 * Nothing in the runtime writes here: only the explicit governed tool (tools/theta-strategy-authority.ts) records a receipt.
 */
export class PostgresStrategyPaperAuthorityStore {
  constructor(private readonly pool: Pool) {}

  async record(input: { receipt: StrategyPaperAuthorityReceipt; sourceSha: string; recordedBy: string }): Promise<{ recorded: boolean }> {
    if (!/^[0-9a-f]{40}$/.test(input.sourceSha)) throw new Error('STRATEGY_AUTHORITY_SOURCE_SHA_INVALID');
    strategyPaperAuthorityReceiptSchema.parse(input.receipt);
    if (input.recordedBy.trim() === '') throw new Error('STRATEGY_AUTHORITY_RECORDER_REQUIRED');
    return withRuntimePostgresTransaction(this.pool, async (client) => {
      const inserted = await client.query(`INSERT INTO ops.theta_strategy_paper_authority(strategy,receipt_json,receipt_hash,source_sha,recorded_by_ref_hash)
        VALUES($1,$2::jsonb,$3,$4,$5) ON CONFLICT(strategy,receipt_hash,source_sha) DO NOTHING RETURNING strategy_paper_authority_id`,
      [input.receipt.strategy, JSON.stringify(input.receipt), input.receipt.receiptHash, input.sourceSha, createHash('sha256').update(input.recordedBy).digest('hex')]);
      return { recorded: (inserted.rowCount ?? 0) > 0 };
    });
  }

  /** the newest receipt recorded for THIS release SHA that verifies and actually allows a Paper opening order; otherwise undefined */
  async current(strategy: PaperExposureStrategy, releaseSha: string | null): Promise<StrategyPaperAuthorityReceipt | undefined> {
    if (releaseSha === null || !/^[0-9a-f]{40}$/.test(releaseSha)) return undefined;
    const rows = await withRuntimePostgresReadRetry(this.pool, (client) => client.query(`SELECT receipt_json FROM ops.theta_strategy_paper_authority
      WHERE strategy=$1 AND source_sha=$2 ORDER BY recorded_at DESC, strategy_paper_authority_id DESC LIMIT 1`, [strategy, releaseSha]));
    const row = rows.value.rows[0] as { receipt_json: unknown } | undefined;
    if (row === undefined) return undefined;
    const parsed = strategyPaperAuthorityReceiptSchema.safeParse(row.receipt_json);
    if (!parsed.success) return undefined;
    const receipt = parsed.data as StrategyPaperAuthorityReceipt;
    return verifyStrategyPaperAuthorityReceipt(receipt, strategy) ? receipt : undefined;
  }
}
