import { gzipSync } from 'node:zlib';
import type { PoolClient } from 'pg';
import { canonicalJson, sha256Hex } from './archive-manifest.js';
import { verifyFinalChainReceipt, type FinalChainReceipt } from './final-chain-receipt.js';

export const FINALIZED_EXECUTION_HISTORY_VERSION = 'theta-finalized-execution-history-v1' as const;

export interface FinalizedExecutionHistoryInput {
  readonly chainId: string;
  readonly finalizedAt: string;
  readonly finalChainReceipt: FinalChainReceipt;
  readonly orders: readonly Readonly<Record<string, unknown>>[];
  readonly fills: readonly Readonly<Record<string, unknown>>[];
  readonly inventory: readonly Readonly<Record<string, unknown>>[];
  readonly assignmentExerciseExpiration: readonly Readonly<Record<string, unknown>>[];
  readonly managementActions: readonly Readonly<Record<string, unknown>>[];
  readonly wholeChainEconomics: Readonly<Record<string, unknown>>;
  readonly outcomeLabels: readonly Readonly<Record<string, unknown>>[];
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly sourceSha: string;
  readonly policyVersion: string;
}

export interface FinalizedExecutionHistoryRecord {
  readonly version: typeof FINALIZED_EXECUTION_HISTORY_VERSION;
  readonly chainId: string;
  readonly finalizedAt: string;
  readonly finalChainReceiptHash: string;
  readonly orders: readonly Readonly<Record<string, unknown>>[];
  readonly fills: readonly Readonly<Record<string, unknown>>[];
  readonly inventory: readonly Readonly<Record<string, unknown>>[];
  readonly assignmentExerciseExpiration: readonly Readonly<Record<string, unknown>>[];
  readonly managementActions: readonly Readonly<Record<string, unknown>>[];
  readonly wholeChainEconomics: Readonly<Record<string, unknown>>;
  readonly outcomeLabels: readonly Readonly<Record<string, unknown>>[];
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly sourceSha: string;
  readonly policyVersion: string;
}

export interface EncodedFinalizedExecutionHistory {
  readonly record: FinalizedExecutionHistoryRecord;
  readonly contentHash: string;
  readonly uncompressedBytes: number;
  readonly compressedBytes: number;
  readonly gzip: Buffer;
}

export function encodeFinalizedExecutionHistory(input: FinalizedExecutionHistoryInput): EncodedFinalizedExecutionHistory {
  const receiptProblems = verifyFinalChainReceipt(input.finalChainReceipt);
  if (receiptProblems.length > 0) throw new Error(`FINAL_CHAIN_RECEIPT_INVALID:${receiptProblems.join(',')}`);
  if (!input.finalChainReceipt.archiveEligible) throw new Error(`FINAL_CHAIN_NOT_ARCHIVE_ELIGIBLE:${input.finalChainReceipt.blockers.join(',')}`);
  if (input.finalChainReceipt.chainId !== input.chainId) throw new Error('FINAL_CHAIN_ID_MISMATCH');
  if (!/^[0-9a-f]{40}$/.test(input.sourceSha)) throw new Error('SOURCE_SHA_INVALID');
  if (input.finalChainReceipt.sourceSha !== input.sourceSha) throw new Error('FINAL_CHAIN_SOURCE_SHA_MISMATCH');
  if (input.finalChainReceipt.finalizedAt !== input.finalizedAt) throw new Error('FINAL_CHAIN_FINALIZED_AT_MISMATCH');
  if (input.finalChainReceipt.policyVersion !== input.policyVersion) throw new Error('FINAL_CHAIN_POLICY_VERSION_MISMATCH');
  const record: FinalizedExecutionHistoryRecord = {
    version: FINALIZED_EXECUTION_HISTORY_VERSION,
    chainId: input.chainId,
    finalizedAt: input.finalizedAt,
    finalChainReceiptHash: input.finalChainReceipt.receiptHash,
    orders: input.orders,
    fills: input.fills,
    inventory: input.inventory,
    assignmentExerciseExpiration: input.assignmentExerciseExpiration,
    managementActions: input.managementActions,
    wholeChainEconomics: input.wholeChainEconomics,
    outcomeLabels: input.outcomeLabels,
    provenance: input.provenance,
    sourceSha: input.sourceSha,
    policyVersion: input.policyVersion,
  };
  const bytes = Buffer.from(canonicalJson(record));
  const gzip = gzipSync(bytes, { level: 9 });
  return { record, contentHash: sha256Hex(bytes), uncompressedBytes: bytes.length, compressedBytes: gzip.length, gzip };
}

export async function persistFinalizedExecutionHistory(client: PoolClient, input: FinalizedExecutionHistoryInput): Promise<number> {
  const encoded = encodeFinalizedExecutionHistory(input);
  const sessionDate = input.finalizedAt.slice(0, 10);
  const inserted = await client.query(
    `INSERT INTO dp.finalized_execution_history(
       chain_id, session_date, finalized_at, final_chain_receipt_hash, content_hash,
       uncompressed_bytes, compressed_bytes, history_gzip, source_sha, policy_version
     ) VALUES ($1::uuid, $2::date, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (chain_id, session_date) DO NOTHING`,
    [input.chainId, sessionDate, input.finalizedAt, input.finalChainReceipt.receiptHash, encoded.contentHash,
      encoded.uncompressedBytes, encoded.compressedBytes, encoded.gzip, input.sourceSha, input.policyVersion],
  );
  if ((inserted.rowCount ?? 0) === 0) {
    const existing = (await client.query(
      'SELECT content_hash FROM dp.finalized_execution_history WHERE chain_id = $1::uuid AND session_date = $2::date',
      [input.chainId, sessionDate],
    )).rows[0] as { content_hash: string } | undefined;
    if (existing?.content_hash !== encoded.contentHash) throw new Error('FINALIZED_EXECUTION_HISTORY_IDEMPOTENCY_CONFLICT');
  }
  return inserted.rowCount ?? 0;
}
