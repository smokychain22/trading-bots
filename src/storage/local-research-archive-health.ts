import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const localResearchArchiveHealthVersion = 'theta-local-research-archive-health-v1' as const;

export type TransferQuotaState = 'TRANSFER_QUOTA_OPEN' | 'TRANSFER_QUOTA_EXHAUSTED' | 'TRANSFER_QUOTA_RECOVERING';
export type ArchiveFailureFamily = 'DATABASE_RESOURCE_QUOTA' | 'DATABASE_TRANSIENT' | 'ARCHIVE_INTEGRITY' | 'UNKNOWN';

export interface LocalResearchArchiveHealth {
  readonly contractVersion: typeof localResearchArchiveHealthVersion;
  readonly observedAt: string;
  readonly archiveState: string;
  readonly transferQuotaState: TransferQuotaState;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly failureFamily: ArchiveFailureFamily | null;
  readonly nextRetryAt: string | null;
  readonly spoolRows: number;
  readonly pendingCompactionRows: number;
  readonly parquetFiles: number;
  readonly lastManifestHash: string | null;
  readonly duckdbVerification: 'PASS' | 'NOT_AVAILABLE' | 'FAILED';
  readonly brokerAuthority: false;
}

type PersistedHealth = Pick<LocalResearchArchiveHealth,
  'lastSuccessAt' | 'lastFailureAt' | 'failureFamily' | 'nextRetryAt' | 'transferQuotaState'>;

const emptyPersisted = (): PersistedHealth => ({
  lastSuccessAt: null,
  lastFailureAt: null,
  failureFamily: null,
  nextRetryAt: null,
  transferQuotaState: 'TRANSFER_QUOTA_OPEN',
});

export function classifyArchiveFailure(error: unknown): ArchiveFailureFamily {
  const code = error !== null && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '') : '';
  if (code === '53000') return 'DATABASE_RESOURCE_QUOTA';
  if (code === '57P03' || code === '57P01' || /^08[A-Z0-9]{3}$/.test(code)) return 'DATABASE_TRANSIENT';
  const message = error instanceof Error ? error.message : '';
  if (/HASH_MISMATCH|VERIFICATION_FAILED|CONTENT_HASH_INVALID|IDENTITY_CONFLICT/.test(message)) {
    return 'ARCHIVE_INTEGRITY';
  }
  return 'UNKNOWN';
}

function readPersisted(path: string): PersistedHealth {
  if (!existsSync(path)) return emptyPersisted();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LocalResearchArchiveHealth>;
    const transferQuotaState = parsed.transferQuotaState;
    if (transferQuotaState !== 'TRANSFER_QUOTA_OPEN'
      && transferQuotaState !== 'TRANSFER_QUOTA_EXHAUSTED'
      && transferQuotaState !== 'TRANSFER_QUOTA_RECOVERING') return emptyPersisted();
    return {
      lastSuccessAt: typeof parsed.lastSuccessAt === 'string' ? parsed.lastSuccessAt : null,
      lastFailureAt: typeof parsed.lastFailureAt === 'string' ? parsed.lastFailureAt : null,
      failureFamily: parsed.failureFamily ?? null,
      nextRetryAt: typeof parsed.nextRetryAt === 'string' ? parsed.nextRetryAt : null,
      transferQuotaState,
    };
  } catch {
    return emptyPersisted();
  }
}

function sqliteCounts(path: string): { spoolRows: number; pendingCompactionRows: number } {
  if (!existsSync(path)) return { spoolRows: 0, pendingCompactionRows: 0 };
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const total = database.prepare('SELECT count(*) AS count FROM research_batch').get() as { count: number };
    const pending = database.prepare(
      "SELECT count(*) AS count FROM research_batch WHERE storage_state='PENDING_PARQUET'",
    ).get() as { count: number };
    return { spoolRows: Number(total.count), pendingCompactionRows: Number(pending.count) };
  } finally {
    database.close();
  }
}

function parquetState(root: string): Pick<LocalResearchArchiveHealth,
  'parquetFiles' | 'lastManifestHash' | 'duckdbVerification'> {
  if (!existsSync(root)) return { parquetFiles: 0, lastManifestHash: null, duckdbVerification: 'NOT_AVAILABLE' };
  const manifests: Array<{ path: string; generatedAt: string }> = [];
  let parquetFiles = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    const manifestPath = join(directory, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      const parquetFile = typeof manifest.parquetFile === 'string' ? join(directory, manifest.parquetFile) : null;
      if (parquetFile !== null && existsSync(parquetFile)) parquetFiles += 1;
      manifests.push({ path: manifestPath, generatedAt: String(manifest.generatedAt ?? '') });
    } catch {
      return { parquetFiles, lastManifestHash: null, duckdbVerification: 'FAILED' };
    }
  }
  manifests.sort((left, right) => left.generatedAt.localeCompare(right.generatedAt));
  const latest = manifests.at(-1);
  if (latest === undefined) return { parquetFiles, lastManifestHash: null, duckdbVerification: 'NOT_AVAILABLE' };
  const manifestBytes = readFileSync(latest.path);
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as Record<string, unknown>;
  return {
    parquetFiles,
    lastManifestHash: createHash('sha256').update(manifestBytes).digest('hex'),
    duckdbVerification: manifest.duckdbReadback === 'PASS' ? 'PASS' : 'FAILED',
  };
}

export function archiveRetryAllowed(healthPath: string, now: Date): boolean {
  const persisted = readPersisted(resolve(healthPath));
  if (persisted.transferQuotaState !== 'TRANSFER_QUOTA_EXHAUSTED' || persisted.nextRetryAt === null) return true;
  const next = new Date(persisted.nextRetryAt);
  return !Number.isFinite(next.getTime()) || now.getTime() >= next.getTime();
}

export function writeArchiveHealth(input: {
  readonly healthPath: string;
  readonly spoolPath: string;
  readonly parquetRoot: string;
  readonly observedAt: Date;
  readonly archiveState: string;
  readonly outcome: 'SUCCESS' | 'QUOTA_EXHAUSTED' | 'RETRYING' | 'FAILURE' | 'UNCHANGED';
  readonly failureFamily?: ArchiveFailureFamily | null;
  readonly retryAfterHours?: number;
}): LocalResearchArchiveHealth {
  const healthPath = resolve(input.healthPath);
  const prior = readPersisted(healthPath);
  const observedAt = input.observedAt.toISOString();
  const counts = sqliteCounts(resolve(input.spoolPath));
  const parquet = parquetState(resolve(input.parquetRoot));
  const retryHours = input.retryAfterHours ?? 12;
  const state: LocalResearchArchiveHealth = {
    contractVersion: localResearchArchiveHealthVersion,
    observedAt,
    archiveState: input.archiveState,
    transferQuotaState: input.outcome === 'QUOTA_EXHAUSTED' ? 'TRANSFER_QUOTA_EXHAUSTED'
      : input.outcome === 'RETRYING' ? 'TRANSFER_QUOTA_RECOVERING'
        : input.outcome === 'SUCCESS' ? 'TRANSFER_QUOTA_OPEN' : prior.transferQuotaState,
    lastSuccessAt: input.outcome === 'SUCCESS' ? observedAt : prior.lastSuccessAt,
    lastFailureAt: input.outcome === 'QUOTA_EXHAUSTED' || input.outcome === 'FAILURE'
      ? observedAt : prior.lastFailureAt,
    failureFamily: input.outcome === 'SUCCESS' ? null
      : input.failureFamily === undefined ? prior.failureFamily : input.failureFamily,
    nextRetryAt: input.outcome === 'QUOTA_EXHAUSTED'
      ? new Date(input.observedAt.getTime() + retryHours * 3_600_000).toISOString()
      : input.outcome === 'SUCCESS' ? null : prior.nextRetryAt,
    ...counts,
    ...parquet,
    brokerAuthority: false,
  };
  mkdirSync(dirname(healthPath), { recursive: true });
  writeFileSync(healthPath, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
  return state;
}
