import type { Pool, PoolClient } from 'pg';
import { canonicalJson } from './archive-manifest.js';
import { verifyFinalChainReceipt, type FinalChainReceipt } from './final-chain-receipt.js';
import { persistFinalizedExecutionHistory, type FinalizedExecutionHistoryInput } from './finalized-execution-history.js';
import {
  buildSessionIntegrityManifest,
  decisionIntegrityLeaf,
  verifySessionIntegrityManifest,
  type DecisionIntegrityInput,
  type SessionIntegrityManifest,
} from './session-integrity.js';

const FINALIZER_ADVISORY_LOCK = 7_442_071;

export interface SessionFinalizationInput {
  readonly sessionId: string;
  readonly sessionDate: string;
  readonly decisions: readonly DecisionIntegrityInput[];
  readonly finalChainReceipts: readonly FinalChainReceipt[];
  readonly finalizedExecutionHistories: readonly FinalizedExecutionHistoryInput[];
  readonly parquetManifestHashes: readonly string[];
  readonly sourceSha: string;
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly schemaVersions: readonly string[];
  readonly finalizedAt: string;
}

export interface SessionFinalizationResult {
  readonly state: 'PERSISTED' | 'IDEMPOTENT';
  readonly manifest: SessionIntegrityManifest;
  readonly decisionsWritten: number;
  readonly finalChainReceiptsWritten: number;
  readonly finalizedExecutionHistoriesWritten: number;
}

const sessionDateOf = (timestamp: string): string => timestamp.slice(0, 10);

export function validateSessionFinalizationInput(input: SessionFinalizationInput): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sessionDate)) throw new Error('SESSION_DATE_INVALID');
  if (!/^[0-9a-f]{40}$/.test(input.sourceSha)) throw new Error('SOURCE_SHA_INVALID');
  if (input.decisions.some((decision) => sessionDateOf(decision.decidedAt) !== input.sessionDate)) throw new Error('DECISION_OUTSIDE_SESSION');
  const ids = new Set(input.decisions.map((decision) => decision.decisionId));
  if (ids.size !== input.decisions.length) throw new Error('DUPLICATE_DECISION_ID');
  if (input.decisions.some((decision) => !decision.archivalTerminal && decision.chainId === null)) throw new Error('NON_TERMINAL_DECISION_REQUIRES_CHAIN');
  for (const receipt of input.finalChainReceipts) {
    const problems = verifyFinalChainReceipt(receipt);
    if (problems.length > 0) throw new Error(`FINAL_CHAIN_RECEIPT_INVALID:${problems.join(',')}`);
    if (!receipt.archiveEligible) throw new Error(`FINAL_CHAIN_RECEIPT_NOT_TERMINAL:${receipt.blockers.join(',')}`);
    if (sessionDateOf(receipt.finalizedAt) !== input.sessionDate) throw new Error('FINAL_CHAIN_RECEIPT_OUTSIDE_SESSION');
  }
  const receiptHashes = new Set(input.finalChainReceipts.map((receipt) => receipt.receiptHash));
  if (input.finalizedExecutionHistories.some((history) => !receiptHashes.has(history.finalChainReceipt.receiptHash))) throw new Error('FINALIZED_HISTORY_RECEIPT_NOT_PERSISTED');
}

async function existingManifest(client: PoolClient, sessionId: string, sessionDate: string): Promise<SessionIntegrityManifest | null> {
  const row = (await client.query(
    `SELECT session_id, session_date::text, decision_count, first_decision_id::text, last_decision_id::text,
            archive_ids, archive_hashes, parquet_manifest_hashes, source_sha, policy_versions, schema_versions,
            decision_integrity_root, previous_session_integrity_root, session_integrity_root, manifest_hash,
            created_at::text, verified_at::text
       FROM dp.session_integrity_manifest
      WHERE session_id = $1 AND session_date = $2::date`,
    [sessionId, sessionDate],
  )).rows[0] as Record<string, unknown> | undefined;
  if (row === undefined) return null;
  return {
    version: 'theta-session-integrity-v1',
    sessionId: String(row.session_id),
    sessionDate: String(row.session_date),
    decisionCount: Number(row.decision_count),
    firstDecisionId: row.first_decision_id === null ? null : String(row.first_decision_id),
    lastDecisionId: row.last_decision_id === null ? null : String(row.last_decision_id),
    archiveIds: row.archive_ids as string[],
    archiveHashes: row.archive_hashes as string[],
    parquetManifestHashes: row.parquet_manifest_hashes as string[],
    sourceSha: String(row.source_sha),
    policyVersions: row.policy_versions as Record<string, string>,
    schemaVersions: row.schema_versions as string[],
    decisionIntegrityRoot: String(row.decision_integrity_root),
    previousSessionIntegrityRoot: row.previous_session_integrity_root === null ? null : String(row.previous_session_integrity_root),
    sessionIntegrityRoot: String(row.session_integrity_root),
    manifestHash: String(row.manifest_hash),
    createdAt: new Date(String(row.created_at)).toISOString(),
    verifiedAt: new Date(String(row.verified_at)).toISOString(),
  };
}

async function persistDecision(client: PoolClient, sessionDate: string, decision: DecisionIntegrityInput): Promise<number> {
  const decisionHash = decisionIntegrityLeaf(decision).hash;
  const result = await client.query(
    `INSERT INTO dp.recent_decision_audit(
       decision_id, session_date, decided_at, action_code, strategy, selected_candidate_id, quantity,
       aegis_outcome, sizing_outcome, binding_constraint, chain_id, archival_terminal, policy_versions, source_sha, archive_id, archive_hash, decision_hash
     ) VALUES ($1::uuid, $2::date, $3::timestamptz, $4, $5, $6, $7::numeric, $8, $9, $10, $11::uuid, $12, $13::jsonb, $14, $15, $16, $17)
     ON CONFLICT (decision_id, session_date) DO NOTHING`,
    [decision.decisionId, sessionDate, decision.decidedAt, decision.action, decision.strategy, decision.selectedCandidateId,
      decision.quantity, decision.aegisOutcome, decision.sizingOutcome, decision.bindingConstraint, decision.chainId, decision.archivalTerminal,
      canonicalJson(decision.policyVersions), decision.sourceSha, decision.archiveId, decision.archiveHash,
      decisionHash],
  );
  if ((result.rowCount ?? 0) === 0) {
    const existing = (await client.query(
      'SELECT decision_hash FROM dp.recent_decision_audit WHERE decision_id=$1::uuid AND session_date=$2::date',
      [decision.decisionId, sessionDate],
    )).rows[0] as { decision_hash: string } | undefined;
    if (existing?.decision_hash !== decisionHash) throw new Error('DECISION_AUDIT_IDEMPOTENCY_CONFLICT');
  }
  return result.rowCount ?? 0;
}

async function persistFinalReceipt(client: PoolClient, sessionDate: string, receipt: FinalChainReceipt): Promise<number> {
  const result = await client.query(
    `INSERT INTO dp.final_chain_receipt(
       chain_id, session_date, finalized_at, receipt_version, archive_eligible, blockers, receipt_json,
       receipt_hash, source_sha, policy_version
     ) VALUES ($1::uuid, $2::date, $3::timestamptz, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
     ON CONFLICT (chain_id, session_date) DO NOTHING`,
    [receipt.chainId, sessionDate, receipt.finalizedAt, receipt.version, receipt.archiveEligible,
      canonicalJson(receipt.blockers), canonicalJson(receipt), receipt.receiptHash, receipt.sourceSha, receipt.policyVersion],
  );
  if ((result.rowCount ?? 0) === 0) {
    const existing = (await client.query(
      'SELECT receipt_hash FROM dp.final_chain_receipt WHERE chain_id=$1::uuid AND session_date=$2::date',
      [receipt.chainId, sessionDate],
    )).rows[0] as { receipt_hash: string } | undefined;
    if (existing?.receipt_hash !== receipt.receiptHash) throw new Error('FINAL_CHAIN_RECEIPT_IDEMPOTENCY_CONFLICT');
  }
  return result.rowCount ?? 0;
}

export async function finalizeSession(pool: Pool, input: SessionFinalizationInput): Promise<SessionFinalizationResult> {
  validateSessionFinalizationInput(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [FINALIZER_ADVISORY_LOCK]);
    const prior = await existingManifest(client, input.sessionId, input.sessionDate);
    const head = (await client.query(
      'SELECT session_id, session_date::text, session_integrity_root FROM dp.session_integrity_head WHERE singleton FOR UPDATE',
    )).rows[0] as { session_id: string; session_date: string; session_integrity_root: string } | undefined;
    const previousRoot = head?.session_integrity_root ?? null;
    if (head !== undefined && head.session_date >= input.sessionDate && prior === null) throw new Error('SESSION_FINALIZATION_OUT_OF_ORDER');
    const manifest = buildSessionIntegrityManifest({
      sessionId: input.sessionId,
      sessionDate: input.sessionDate,
      decisions: input.decisions,
      parquetManifestHashes: input.parquetManifestHashes,
      sourceSha: input.sourceSha,
      policyVersions: input.policyVersions,
      schemaVersions: input.schemaVersions,
      previousSessionIntegrityRoot: prior?.previousSessionIntegrityRoot ?? previousRoot,
      createdAt: input.finalizedAt,
      verifiedAt: input.finalizedAt,
    });
    const problems = verifySessionIntegrityManifest(manifest, input.decisions);
    if (problems.length > 0) throw new Error(`SESSION_MANIFEST_INVALID:${problems.join(',')}`);
    if (prior !== null) {
      if (prior.manifestHash !== manifest.manifestHash) throw new Error('SESSION_FINALIZATION_IDEMPOTENCY_CONFLICT');
      await client.query('COMMIT');
      return { state: 'IDEMPOTENT', manifest: prior, decisionsWritten: 0, finalChainReceiptsWritten: 0, finalizedExecutionHistoriesWritten: 0 };
    }

    let decisionsWritten = 0;
    for (const decision of input.decisions) decisionsWritten += await persistDecision(client, input.sessionDate, decision);
    let finalChainReceiptsWritten = 0;
    for (const receipt of input.finalChainReceipts) finalChainReceiptsWritten += await persistFinalReceipt(client, input.sessionDate, receipt);
    let finalizedExecutionHistoriesWritten = 0;
    for (const history of input.finalizedExecutionHistories) {
      if (history.finalizedAt.slice(0, 10) !== input.sessionDate) throw new Error('FINALIZED_HISTORY_OUTSIDE_SESSION');
      finalizedExecutionHistoriesWritten += await persistFinalizedExecutionHistory(client, history);
    }
    await client.query(
      `INSERT INTO dp.session_integrity_manifest(
         session_id, session_date, decision_count, first_decision_id, last_decision_id, archive_ids, archive_hashes,
         parquet_manifest_hashes, source_sha, policy_versions, schema_versions, decision_integrity_root,
         previous_session_integrity_root, session_integrity_root, manifest_hash, created_at, verified_at
       ) VALUES ($1, $2::date, $3, $4::uuid, $5::uuid, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10::jsonb, $11::jsonb,
                 $12, $13, $14, $15, $16::timestamptz, $17::timestamptz)`,
      [manifest.sessionId, manifest.sessionDate, manifest.decisionCount, manifest.firstDecisionId, manifest.lastDecisionId,
        canonicalJson(manifest.archiveIds), canonicalJson(manifest.archiveHashes), canonicalJson(manifest.parquetManifestHashes),
        manifest.sourceSha, canonicalJson(manifest.policyVersions), canonicalJson(manifest.schemaVersions),
        manifest.decisionIntegrityRoot, manifest.previousSessionIntegrityRoot, manifest.sessionIntegrityRoot,
        manifest.manifestHash, manifest.createdAt, manifest.verifiedAt],
    );
    await client.query(
      `INSERT INTO dp.session_integrity_head(singleton, session_id, session_date, session_integrity_root, manifest_hash, updated_at)
       VALUES (true, $1, $2::date, $3, $4, $5::timestamptz)
       ON CONFLICT (singleton) DO UPDATE SET session_id = EXCLUDED.session_id, session_date = EXCLUDED.session_date,
         session_integrity_root = EXCLUDED.session_integrity_root, manifest_hash = EXCLUDED.manifest_hash,
         updated_at = EXCLUDED.updated_at`,
      [manifest.sessionId, manifest.sessionDate, manifest.sessionIntegrityRoot, manifest.manifestHash, manifest.verifiedAt],
    );
    await client.query('COMMIT');
    return { state: 'PERSISTED', manifest, decisionsWritten, finalChainReceiptsWritten, finalizedExecutionHistoriesWritten };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* the original failure is authoritative */ }
    throw error;
  } finally {
    client.release();
  }
}
