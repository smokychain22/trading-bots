// Bounded retention for every laptop-local directory the worker writes. The laptop is temporary computation only (Aiven is the transactional authority and research
// exports are regenerable from it), so nothing local may grow without a cap. Deletion is confined to direct children of `root` whose name matches `match`; anything
// named in `protect` (for example the bundle a latest.json pointer references) is never removed.
import { readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Keeps at most `keep` matching children (newest by mtime) and removes any matching child older than `maxAgeDays`. Returns the names removed.
 * @param {string} root
 * @param {{ match: RegExp, keep: number, maxAgeDays?: number, protect?: readonly string[], now?: number }} policy
 */
export async function pruneLocalDirectory(root, policy) {
  if (!Number.isInteger(policy.keep) || policy.keep < 0) throw new Error('LOCAL_RETENTION_KEEP_INVALID');
  const base = resolve(root);
  let entries;
  try { entries = await readdir(base, { withFileTypes: true }); } catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  const now = policy.now ?? Date.now();
  const protect = new Set(policy.protect ?? []);
  const candidates = [];
  for (const entry of entries) {
    if (!policy.match.test(entry.name) || protect.has(entry.name)) continue;
    const info = await stat(join(base, entry.name));
    candidates.push({ name: entry.name, mtime: info.mtimeMs });
  }
  candidates.sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  const removable = candidates.filter((item, index) => index >= policy.keep
    || (policy.maxAgeDays !== undefined && now - item.mtime > policy.maxAgeDays * 86_400_000));
  for (const item of removable) await rm(join(base, item.name), { recursive: true, force: true });
  return removable.map((item) => item.name);
}

/** the caps (named, one place): one local mirror of the latest research export, one export generation, two weeks of sanitized runtime receipts */
export const localRetention = {
  evidenceBundles: { match: /^[0-9a-f]{64}$/, keep: 1 },
  researchExports: { match: /^[0-9a-f]{64}$/, keep: 1 },
  receiptSessions: { match: /^\d{4}-\d{2}-\d{2}$/, keep: 14, maxAgeDays: 14 },
};
