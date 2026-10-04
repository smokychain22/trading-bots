// Production archive backend contract (vendor neutral). A real cold-archive provider is NOT chosen here: any S3-compatible, Azure Blob, GCS, SFTP or other store implements the
// small `ObjectStoreClient` below and gets the full contract for free: immutable put (create-only), get, head/stat, list by prefix, content-hash verification, idempotent put,
// per-attempt timeout, bounded retry with backoff, corruption detection and a version/content identity. The conformance suite in tests/phase4-archive-contract.test.ts runs
// against every backend, so a new adapter proves itself with the same tests. The local filesystem remains development/staging only (durabilityClass LOCAL_DISK).
import { sha256Hex } from './archive-manifest.js';
import { ArchiveBackendError, type ArchiveBackend } from './archive-backend.js';

export type DurabilityClass = 'LOCAL_DISK' | 'REMOTE_OBJECT_STORE';

export interface ArchiveObjectStat {
  readonly key: string;
  readonly size: number;
  /** content hash recorded by the writer as object metadata (the store's own ETag is NOT trusted as a content hash) */
  readonly sha256: string;
  /** store version id when the store is versioned, otherwise null; with the sha256 this is the object's identity */
  readonly versionId: string | null;
}

export type VerifyReason = 'OK' | 'MISSING' | 'SIZE_MISMATCH' | 'HASH_MISMATCH_METADATA' | 'HASH_MISMATCH_CONTENT';

/** the extended contract required of any backend that may hold the PRIMARY copy before a purge */
export interface ProductionArchiveBackend extends ArchiveBackend {
  readonly durabilityClass: DurabilityClass;
  /** stable identity of the target (bucket/endpoint without credentials), recorded in manifests */
  identity(): string;
  head(key: string): Promise<ArchiveObjectStat | null>;
  /** every object under a prefix, in key order, paginated internally */
  list(prefix: string): Promise<readonly ArchiveObjectStat[]>;
  /** deep verification: HEAD metadata, then (unless `metadataOnly`) the content re-hashed from a GET */
  verify(key: string, expectedSha256: string, options?: { readonly metadataOnly?: boolean }): Promise<{ readonly ok: boolean; readonly reason: VerifyReason; readonly stat: ArchiveObjectStat | null }>;
}

export interface ObjectStoreCallOptions { readonly signal: AbortSignal }
export class ObjectAlreadyExistsError extends Error { constructor() { super('OBJECT_ALREADY_EXISTS'); this.name = 'ObjectAlreadyExistsError'; } }
export class RetryableObjectStoreError extends Error { constructor(readonly kind: 'UNAVAILABLE' | 'THROTTLED' | 'TIMEOUT', message?: string) { super(message ?? kind); this.name = 'RetryableObjectStoreError'; } }

/** The only thing a provider adapter must implement. createOnly puts must be atomic (If-None-Match: * / conditional create). */
export interface ObjectStoreClient {
  readonly endpointIdentity: string;
  putObjectCreateOnly(key: string, bytes: Uint8Array, metadata: { readonly sha256: string }, options: ObjectStoreCallOptions): Promise<{ readonly versionId: string | null }>;
  getObject(key: string, options: ObjectStoreCallOptions): Promise<{ readonly bytes: Uint8Array; readonly sha256: string | null; readonly versionId: string | null } | null>;
  headObject(key: string, options: ObjectStoreCallOptions): Promise<{ readonly size: number; readonly sha256: string | null; readonly versionId: string | null } | null>;
  listObjects(prefix: string, cursor: string | null, options: ObjectStoreCallOptions): Promise<{ readonly entries: readonly { readonly key: string; readonly size: number; readonly sha256: string | null; readonly versionId: string | null }[]; readonly next: string | null }>;
}

export interface RemoteBackendOptions {
  readonly timeoutMs?: number;
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9._\-/=]*$/;
const assertKey = (key: string): void => { if (!KEY.test(key) || key.includes('..') || key.includes('//')) throw new ArchiveBackendError('ARCHIVE_KEY_INVALID'); };

export class RemoteObjectArchiveBackend implements ProductionArchiveBackend {
  readonly kind = 'REMOTE_OBJECT_STORE';
  readonly durabilityClass = 'REMOTE_OBJECT_STORE' as const;
  private readonly timeoutMs: number; private readonly attempts: number; private readonly baseDelayMs: number; private readonly maxDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>; private readonly random: () => number;
  constructor(private readonly client: ObjectStoreClient, options: RemoteBackendOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000; this.attempts = Math.max(1, options.attempts ?? 4);
    this.baseDelayMs = options.baseDelayMs ?? 250; this.maxDelayMs = options.maxDelayMs ?? 8_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
    this.random = options.random ?? Math.random;
  }
  identity(): string { return `${this.kind}:${this.client.endpointIdentity}`; }
  locate(key: string): string { assertKey(key); return `${this.client.endpointIdentity}/${key}`; }

  /** one bounded attempt: a hung provider call is aborted at the timeout instead of stalling the maintenance run */
  private async attempt<T>(operation: (options: ObjectStoreCallOptions) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new RetryableObjectStoreError('TIMEOUT', `timed out after ${this.timeoutMs} ms`)); }, this.timeoutMs); });
    try { return await Promise.race([operation({ signal: controller.signal }), timeout]); } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  /** bounded retry with exponential backoff and jitter, for retryable failures ONLY; conflicts and validation errors fail immediately */
  private async withRetry<T>(operation: (options: ObjectStoreCallOptions) => Promise<T>): Promise<T> {
    let last: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try { return await this.attempt(operation); } catch (error) {
        last = error;
        if (!(error instanceof RetryableObjectStoreError) || attempt === this.attempts) break;
        const delay = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1)) * (0.5 + this.random() / 2);
        await this.sleep(delay);
      }
    }
    if (last instanceof RetryableObjectStoreError) throw new ArchiveBackendError('ARCHIVE_BACKEND_UNAVAILABLE', `${last.kind}: ${last.message}`);
    throw last;
  }

  async put(key: string, bytes: Uint8Array): Promise<{ readonly sha256: string; readonly created: boolean }> {
    assertKey(key);
    const sha256 = sha256Hex(bytes);
    try {
      await this.withRetry((options) => this.client.putObjectCreateOnly(key, bytes, { sha256 }, options));
    } catch (error) {
      if (!(error instanceof ObjectAlreadyExistsError)) throw error;
      // idempotent: the same bytes under the same key are a success, different bytes are a conflict (never an overwrite)
      const existing = await this.verify(key, sha256);
      if (existing.ok) return { sha256, created: false };
      throw new ArchiveBackendError('ARCHIVE_KEY_CONFLICT');
    }
    // read-after-write verification: the object must be there with the content hash we wrote (a silent drop or truncation is caught now, not at restore time)
    const check = await this.verify(key, sha256, { metadataOnly: true });
    if (!check.ok) throw new ArchiveBackendError('ARCHIVE_WRITE_NOT_VERIFIED', check.reason);
    return { sha256, created: true };
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertKey(key);
    const found = await this.withRetry((options) => this.client.getObject(key, options));
    if (found === null) return null;
    // a GET result is only returned when its bytes match the recorded content hash: corruption is an error, never data
    if (found.sha256 !== null && sha256Hex(found.bytes) !== found.sha256) throw new ArchiveBackendError('ARCHIVE_OBJECT_CORRUPT', key);
    return found.bytes;
  }

  async exists(key: string): Promise<boolean> { return (await this.head(key)) !== null; }

  async head(key: string): Promise<ArchiveObjectStat | null> {
    assertKey(key);
    const found = await this.withRetry((options) => this.client.headObject(key, options));
    if (found === null) return null;
    if (found.sha256 === null) throw new ArchiveBackendError('ARCHIVE_OBJECT_WITHOUT_CONTENT_HASH', key);
    return { key, size: found.size, sha256: found.sha256, versionId: found.versionId };
  }

  async list(prefix: string): Promise<readonly ArchiveObjectStat[]> {
    if (prefix !== '') assertKey(prefix);
    const out: ArchiveObjectStat[] = []; let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<ObjectStoreClient['listObjects']>> = await this.withRetry((options) => this.client.listObjects(prefix, cursor, options));
      for (const entry of page.entries) if (entry.sha256 !== null) out.push({ key: entry.key, size: entry.size, sha256: entry.sha256, versionId: entry.versionId });
      cursor = page.next;
    } while (cursor !== null);
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }

  async verify(key: string, expectedSha256: string, options: { readonly metadataOnly?: boolean } = {}): Promise<{ ok: boolean; reason: VerifyReason; stat: ArchiveObjectStat | null }> {
    const stat = await this.head(key);
    if (stat === null) return { ok: false, reason: 'MISSING', stat: null };
    if (stat.sha256 !== expectedSha256) return { ok: false, reason: 'HASH_MISMATCH_METADATA', stat };
    if (options.metadataOnly === true) return { ok: true, reason: 'OK', stat };
    let bytes: Uint8Array | null;
    try { bytes = await this.get(key); } catch (error) { if (error instanceof ArchiveBackendError && error.code === 'ARCHIVE_OBJECT_CORRUPT') return { ok: false, reason: 'HASH_MISMATCH_CONTENT', stat }; throw error; }
    if (bytes === null) return { ok: false, reason: 'MISSING', stat };
    if (bytes.length !== stat.size) return { ok: false, reason: 'SIZE_MISMATCH', stat };
    if (sha256Hex(bytes) !== expectedSha256) return { ok: false, reason: 'HASH_MISMATCH_CONTENT', stat };
    return { ok: true, reason: 'OK', stat };
  }
}

/** Deterministic in-memory provider used by the conformance and fault tests (and as the reference for adapter authors). Versioned: every create gets a new version id. */
export class InMemoryObjectStoreClient implements ObjectStoreClient {
  readonly endpointIdentity: string;
  readonly objects = new Map<string, { bytes: Uint8Array; sha256: string | null; versionId: string }>();
  private version = 0;
  constructor(endpoint = 'memory-object-store') { this.endpointIdentity = endpoint; }
  async putObjectCreateOnly(key: string, bytes: Uint8Array, metadata: { sha256: string }): Promise<{ versionId: string | null }> {
    if (this.objects.has(key)) throw new ObjectAlreadyExistsError();
    this.version += 1; const versionId = `v${this.version}`;
    this.objects.set(key, { bytes: Uint8Array.from(bytes), sha256: metadata.sha256, versionId });
    return { versionId };
  }
  async getObject(key: string): Promise<{ bytes: Uint8Array; sha256: string | null; versionId: string | null } | null> { const found = this.objects.get(key); return found === undefined ? null : { bytes: Uint8Array.from(found.bytes), sha256: found.sha256, versionId: found.versionId }; }
  async headObject(key: string): Promise<{ size: number; sha256: string | null; versionId: string | null } | null> { const found = this.objects.get(key); return found === undefined ? null : { size: found.bytes.length, sha256: found.sha256, versionId: found.versionId }; }
  async listObjects(prefix: string, cursor: string | null): Promise<{ entries: { key: string; size: number; sha256: string | null; versionId: string | null }[]; next: string | null }> {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    const start = cursor === null ? 0 : Number(cursor); const page = keys.slice(start, start + 2); // tiny pages exercise pagination
    return { entries: page.map((key) => { const found = this.objects.get(key) as { bytes: Uint8Array; sha256: string | null; versionId: string }; return { key, size: found.bytes.length, sha256: found.sha256, versionId: found.versionId }; }), next: start + 2 < keys.length ? String(start + 2) : null };
  }
}

/** Wraps any client with scripted faults (transient errors, a hang, corruption, a silent drop) for fault-injection tests. Never used in production wiring. */
export class FaultyObjectStoreClient implements ObjectStoreClient {
  readonly endpointIdentity: string;
  readonly calls: Record<string, number> = {};
  constructor(private readonly inner: ObjectStoreClient, private readonly faults: {
    readonly failFirst?: Partial<Record<'put' | 'get' | 'head' | 'list', { readonly times: number; readonly kind: 'UNAVAILABLE' | 'THROTTLED' | 'TIMEOUT' }>>;
    readonly hang?: Partial<Record<'put' | 'get' | 'head' | 'list', boolean>>;
    readonly corruptGet?: boolean;
    readonly dropPut?: boolean;
  } = {}) { this.endpointIdentity = `faulty(${inner.endpointIdentity})`; }
  private async gate(name: 'put' | 'get' | 'head' | 'list', options: ObjectStoreCallOptions): Promise<void> {
    this.calls[name] = (this.calls[name] ?? 0) + 1;
    const fail = this.faults.failFirst?.[name];
    if (fail !== undefined && (this.calls[name] as number) <= fail.times) throw new RetryableObjectStoreError(fail.kind);
    if (this.faults.hang?.[name] === true) await new Promise<void>((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('ABORTED'))));
  }
  async putObjectCreateOnly(key: string, bytes: Uint8Array, metadata: { sha256: string }, options: ObjectStoreCallOptions): Promise<{ versionId: string | null }> { await this.gate('put', options); if (this.faults.dropPut === true) return { versionId: null }; return this.inner.putObjectCreateOnly(key, bytes, metadata, options); }
  async getObject(key: string, options: ObjectStoreCallOptions): Promise<{ bytes: Uint8Array; sha256: string | null; versionId: string | null } | null> {
    await this.gate('get', options); const found = await this.inner.getObject(key, options);
    if (found === null || this.faults.corruptGet !== true) return found;
    const damaged = Uint8Array.from(found.bytes); damaged[Math.floor(damaged.length / 2)] = (damaged[Math.floor(damaged.length / 2)] ?? 0) ^ 0xff;
    return { ...found, bytes: damaged };
  }
  async headObject(key: string, options: ObjectStoreCallOptions): Promise<{ size: number; sha256: string | null; versionId: string | null } | null> { await this.gate('head', options); return this.inner.headObject(key, options); }
  async listObjects(prefix: string, cursor: string | null, options: ObjectStoreCallOptions): ReturnType<ObjectStoreClient['listObjects']> { await this.gate('list', options); return this.inner.listObjects(prefix, cursor, options); }
}
