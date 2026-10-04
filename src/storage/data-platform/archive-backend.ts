// Pluggable archive storage. Implementations must be IMMUTABLE or VERSIONED, content-addressed, durable and able to verify integrity. The interface offers
// no delete and no overwrite: putting different bytes under an existing key is an error. A vendor is NOT chosen here; `LocalFilesystemArchiveBackend` is the
// immediate working implementation and a second, off-machine backend must be configured before the first purge (see archive-health in the governor).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { sha256Hex } from './archive-manifest.js';
import type { ArchiveObjectStat, DurabilityClass, ProductionArchiveBackend, VerifyReason } from './archive-remote.js';

export interface ArchiveBackend {
  readonly kind: string;
  /** stable human-readable location of a key */
  locate(key: string): string;
  /** idempotent: same bytes under the same key succeed; different bytes under an existing key throw ARCHIVE_KEY_CONFLICT */
  put(key: string, bytes: Uint8Array): Promise<{ readonly sha256: string; readonly created: boolean }>;
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
}

export class ArchiveBackendError extends Error {
  constructor(readonly code: string, message?: string) { super(message ?? code); this.name = 'ArchiveBackendError'; }
}

const safeKey = /^[A-Za-z0-9][A-Za-z0-9._\-/=]*$/;
function assertKey(key: string): void {
  if (!safeKey.test(key) || key.includes('..') || key.includes('//')) throw new ArchiveBackendError('ARCHIVE_KEY_INVALID');
}


/** shared head/list/verify for backends that can read their own bytes (the development and staging backends); the remote backend implements these against the store's metadata */
async function deepVerify(backend: { head(key: string): Promise<ArchiveObjectStat | null>; get(key: string): Promise<Uint8Array | null> }, key: string, expected: string, metadataOnly: boolean): Promise<{ ok: boolean; reason: VerifyReason; stat: ArchiveObjectStat | null }> {
  const stat = await backend.head(key);
  if (stat === null) return { ok: false, reason: 'MISSING', stat: null };
  if (stat.sha256 !== expected) return { ok: false, reason: 'HASH_MISMATCH_METADATA', stat };
  if (metadataOnly) return { ok: true, reason: 'OK', stat };
  const bytes = await backend.get(key);
  if (bytes === null) return { ok: false, reason: 'MISSING', stat };
  if (bytes.length !== stat.size) return { ok: false, reason: 'SIZE_MISMATCH', stat };
  return sha256Hex(bytes) === expected ? { ok: true, reason: 'OK', stat } : { ok: false, reason: 'HASH_MISMATCH_CONTENT', stat };
}

export class InMemoryArchiveBackend implements ProductionArchiveBackend {
  readonly durabilityClass: DurabilityClass = 'LOCAL_DISK';
  identity(): string { return 'IN_MEMORY'; }
  async head(key: string): Promise<ArchiveObjectStat | null> { assertKey(key); const found = this.objects.get(key); return found === undefined ? null : { key, size: found.length, sha256: sha256Hex(found), versionId: null }; }
  async list(prefix: string): Promise<readonly ArchiveObjectStat[]> { return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort().map((key) => { const found = this.objects.get(key) as Uint8Array; return { key, size: found.length, sha256: sha256Hex(found), versionId: null }; }); }
  verify(key: string, expected: string, options: { readonly metadataOnly?: boolean } = {}): Promise<{ ok: boolean; reason: VerifyReason; stat: ArchiveObjectStat | null }> { return deepVerify(this, key, expected, options.metadataOnly === true); }
  readonly kind = 'IN_MEMORY';
  readonly objects = new Map<string, Uint8Array>();
  locate(key: string): string { return `memory://${key}`; }
  async put(key: string, bytes: Uint8Array): Promise<{ sha256: string; created: boolean }> {
    assertKey(key);
    const existing = this.objects.get(key);
    const sha256 = sha256Hex(bytes);
    if (existing !== undefined) {
      if (sha256Hex(existing) !== sha256) throw new ArchiveBackendError('ARCHIVE_KEY_CONFLICT');
      return { sha256, created: false };
    }
    this.objects.set(key, Uint8Array.from(bytes));
    return { sha256, created: true };
  }
  async get(key: string): Promise<Uint8Array | null> { assertKey(key); const found = this.objects.get(key); return found === undefined ? null : Uint8Array.from(found); }
  async exists(key: string): Promise<boolean> { assertKey(key); return this.objects.has(key); }
}

export class LocalFilesystemArchiveBackend implements ProductionArchiveBackend {
  /** development and staging only: the laptop disk is a single point of failure and never satisfies the off-machine durability rule */
  readonly durabilityClass: DurabilityClass = 'LOCAL_DISK';
  identity(): string { return `LOCAL_FILESYSTEM:${this.root}`; }
  async head(key: string): Promise<ArchiveObjectStat | null> { const target = this.path(key); if (!existsSync(target)) return null; const bytes = readFileSync(target); return { key, size: bytes.length, sha256: sha256Hex(bytes), versionId: null }; }
  async list(prefix: string): Promise<readonly ArchiveObjectStat[]> {
    const out: ArchiveObjectStat[] = [];
    const walk = (directory: string, relative: string): void => { for (const name of readdirSync(directory)) { const full = join(directory, name); const key = relative === '' ? name : `${relative}/${name}`; if (statSync(full).isDirectory()) walk(full, key); else if (!name.endsWith('.partial') && key.startsWith(prefix)) { const bytes = readFileSync(full); out.push({ key, size: bytes.length, sha256: sha256Hex(bytes), versionId: null }); } } };
    walk(this.root, ''); return out.sort((a, b) => a.key.localeCompare(b.key));
  }
  verify(key: string, expected: string, options: { readonly metadataOnly?: boolean } = {}): Promise<{ ok: boolean; reason: VerifyReason; stat: ArchiveObjectStat | null }> { return deepVerify(this, key, expected, options.metadataOnly === true); }
  readonly kind = 'LOCAL_FILESYSTEM';
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); mkdirSync(this.root, { recursive: true }); }
  private path(key: string): string {
    assertKey(key);
    const target = resolve(join(this.root, key));
    if (target !== this.root && !target.startsWith(this.root + sep)) throw new ArchiveBackendError('ARCHIVE_KEY_ESCAPES_ROOT');
    return target;
  }
  locate(key: string): string { return this.path(key); }
  async put(key: string, bytes: Uint8Array): Promise<{ sha256: string; created: boolean }> {
    const target = this.path(key);
    const sha256 = sha256Hex(bytes);
    if (existsSync(target)) {
      if (sha256Hex(readFileSync(target)) !== sha256) throw new ArchiveBackendError('ARCHIVE_KEY_CONFLICT');
      return { sha256, created: false };
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(`${target}.partial`, bytes);
    renameSync(`${target}.partial`, target);
    return { sha256, created: true };
  }
  async get(key: string): Promise<Uint8Array | null> { const target = this.path(key); return existsSync(target) ? readFileSync(target) : null; }
  async exists(key: string): Promise<boolean> { return existsSync(this.path(key)); }
}

/** Test/chaos wrapper: fails the nth operation of a kind, simulating an unavailable or flaky backend. Never used in production wiring. */
export class FaultInjectingArchiveBackend implements ArchiveBackend {
  readonly kind: string;
  private counts = new Map<string, number>();
  constructor(private readonly inner: ArchiveBackend, private readonly faults: { readonly put?: (call: number) => boolean; readonly get?: (call: number) => boolean; readonly corruptGet?: boolean; readonly unavailable?: () => boolean }) { this.kind = `FAULT(${inner.kind})`; }
  private tick(name: string): number { const next = (this.counts.get(name) ?? 0) + 1; this.counts.set(name, next); return next; }
  locate(key: string): string { return this.inner.locate(key); }
  async put(key: string, bytes: Uint8Array): Promise<{ sha256: string; created: boolean }> {
    if (this.faults.unavailable?.() === true || this.faults.put?.(this.tick('put')) === true) throw new ArchiveBackendError('ARCHIVE_BACKEND_UNAVAILABLE');
    return this.inner.put(key, bytes);
  }
  async get(key: string): Promise<Uint8Array | null> {
    if (this.faults.unavailable?.() === true || this.faults.get?.(this.tick('get')) === true) throw new ArchiveBackendError('ARCHIVE_BACKEND_UNAVAILABLE');
    const bytes = await this.inner.get(key);
    if (bytes === null || this.faults.corruptGet !== true) return bytes;
    const damaged = Uint8Array.from(bytes);
    damaged[Math.floor(damaged.length / 2)] = (damaged[Math.floor(damaged.length / 2)] ?? 0) ^ 0xff;
    return damaged;
  }
  async exists(key: string): Promise<boolean> { if (this.faults.unavailable?.() === true) throw new ArchiveBackendError('ARCHIVE_BACKEND_UNAVAILABLE'); return this.inner.exists(key); }
}

/** Two independent copies are required before a partition may be retired (the local disk is a single point of failure). */
export class ReplicatedArchiveBackend implements ArchiveBackend {
  readonly kind = 'REPLICATED';
  constructor(private readonly primary: ArchiveBackend, private readonly secondary: ArchiveBackend) {}
  locate(key: string): string { return `${this.primary.locate(key)} + ${this.secondary.locate(key)}`; }
  async put(key: string, bytes: Uint8Array): Promise<{ sha256: string; created: boolean }> {
    const first = await this.primary.put(key, bytes);
    const second = await this.secondary.put(key, bytes);
    return { sha256: first.sha256, created: first.created || second.created };
  }
  async get(key: string): Promise<Uint8Array | null> {
    const first = await this.primary.get(key).catch(() => null);
    if (first !== null) return first;
    return this.secondary.get(key);
  }
  async exists(key: string): Promise<boolean> { return (await this.primary.exists(key)) && (await this.secondary.exists(key)); }
}
