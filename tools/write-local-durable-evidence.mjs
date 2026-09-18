import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const bundleVersion = 'theta-local-durable-evidence-v1';
const requiredFiles = ['dataset.json', 'manifest.json', 'data-quality.json', 'handoff.json'];
const deniedKeys = /^(authorization|cookie|set-cookie|password|api[-_]?key|api[-_]?secret|secret|token|access[-_]?token|refresh[-_]?token|credential|connection[-_]?string)$/i;
const deniedStringPatterns = [
  /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/i,
  /APCA-API-(?:KEY-ID|SECRET-KEY)/i,
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function assertNoSecrets(value, path = '$') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (deniedKeys.test(key)) throw new Error(`LOCAL_EVIDENCE_SECRET_KEY_REJECTED:${path}.${key}`);
      assertNoSecrets(item, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && deniedStringPatterns.some((pattern) => pattern.test(value))) {
    throw new Error(`LOCAL_EVIDENCE_SECRET_VALUE_REJECTED:${path}`);
  }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, path);
}

export async function persistLocalDurableEvidence(
  sourcePath = 'research_exports/latest',
  destinationPath = '.theta-local-worker/evidence',
) {
  const source = resolve(sourcePath);
  const root = resolve(destinationPath);
  const material = [];
  for (const name of requiredFiles) {
    const path = join(source, name);
    const raw = await readFile(path);
    const parsed = JSON.parse(raw.toString('utf8'));
    assertNoSecrets(parsed, name);
    material.push({ name, path, raw, bytes: raw.byteLength, sha256: sha256(raw) });
  }
  const sourceManifest = JSON.parse(material.find((item) => item.name === 'manifest.json').raw.toString('utf8'));
  if (!/^[0-9a-f]{64}$/.test(sourceManifest.datasetHash ?? '')) {
    throw new Error('LOCAL_EVIDENCE_DATASET_HASH_INVALID');
  }
  const identity = {
    bundleVersion,
    datasetHash: sourceManifest.datasetHash,
    schemaVersion: sourceManifest.schemaVersion ?? null,
    featureSetVersion: sourceManifest.featureSetVersion ?? null,
    sourceWindow: sourceManifest.sourceWindow ?? null,
    files: material.map(({ name, bytes, sha256: fileHash }) => ({ name, bytes, sha256: fileHash })),
  };
  const bundleHash = sha256(JSON.stringify(identity));
  const destination = join(root, bundleHash);
  await mkdir(destination, { recursive: true });
  for (const item of material) {
    const target = join(destination, basename(item.name));
    try {
      const existing = await readFile(target);
      if (sha256(existing) !== item.sha256) throw new Error(`LOCAL_EVIDENCE_IMMUTABILITY_VIOLATION:${item.name}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await copyFile(item.path, target, 1);
    }
  }
  const receipt = { ...identity, bundleHash, persistedAt: new Date().toISOString(),
    authority: 'RECOVERY_AND_RESEARCH_SUPPORT_ONLY', transactionalAuthority: 'AIVEN' };
  const receiptPath = join(destination, 'bundle-receipt.json');
  try {
    const existing = JSON.parse(await readFile(receiptPath, 'utf8'));
    if (existing.bundleHash !== bundleHash) throw new Error('LOCAL_EVIDENCE_RECEIPT_IMMUTABILITY_VIOLATION');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await atomicJson(receiptPath, receipt);
  }
  const pointer = { bundleVersion, bundleHash, datasetHash: identity.datasetHash,
    path: relative(root, destination).replaceAll('\\', '/'), persistedAt: receipt.persistedAt };
  await atomicJson(join(root, 'latest.json'), pointer);
  return { state: 'PERSISTED', ...pointer };
}

async function main() {
  const result = await persistLocalDurableEvidence(process.argv[2], process.argv[3]);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify({ state: 'FAILED', code: error instanceof Error ? error.message : 'LOCAL_EVIDENCE_FAILED' })}\n`);
    process.exitCode = 2;
  });
}
