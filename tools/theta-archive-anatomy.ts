// Read-only anatomy of cycle evidence archives (the .bin files written by `theta-storage-archive.ts --mode=replay-sample`): where do the bytes of a decoded archive go?
// Used to design the columnar cold representation. Local files only.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeCycleEvidenceArchive } from '../src/theta/postgres-cycle-evidence-storage.js';

const directory = process.argv.find((value) => value.startsWith('--dir='))?.slice(6) ?? 'C:\\ProjectBackups\\trading-bots\\storage-archives\\theta-20261003\\replay-samples';
const output = process.argv.find((value) => value.startsWith('--output='))?.slice(9);
const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

const rows: Array<Record<string, unknown>> = [];
const keyTotals = new Map<string, number>();
const contractKeyTotals = new Map<string, number>();
let contractCount = 0;
for (const name of readdirSync(directory).filter((file) => file.endsWith('.bin'))) {
  const blob = readFileSync(join(directory, name));
  const decoded = decodeCycleEvidenceArchive(blob) as Record<string, unknown>;
  const total = bytesOf(decoded);
  const topKeys = Object.fromEntries(Object.entries(decoded).map(([key, value]) => [key, bytesOf(value)]));
  for (const [key, size] of Object.entries(topKeys)) keyTotals.set(key, (keyTotals.get(key) ?? 0) + size);
  const input = decoded.canonicalFrontierInput as { contracts?: Array<Record<string, unknown>> } | undefined;
  const contracts = input?.contracts ?? [];
  contractCount += contracts.length;
  for (const contract of contracts) for (const [key, value] of Object.entries(contract)) contractKeyTotals.set(key, (contractKeyTotals.get(key) ?? 0) + bytesOf(value) + key.length + 4);
  rows.push({ blob: name.slice(0, 8), compressedBytes: blob.length, decodedJsonBytes: total, contracts: contracts.length, inputBytes: bytesOf(decoded.canonicalFrontierInput), frontierBytes: bytesOf(decoded.strategyFrontier),
    topKeys: Object.keys(topKeys).length });
  void gunzipSync;
}
const share = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([key, bytes]) => ({ key, MiB: +(bytes / 1048576).toFixed(2) }));
const report = { blobs: rows.length, totalContracts: contractCount, topLevelShare: share(keyTotals), contractFieldShare: share(contractKeyTotals), contractKeys: [...contractKeyTotals.keys()].length, rows };
if (output !== undefined) writeFileSync(output, JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify({ blobs: report.blobs, totalContracts: report.totalContracts, topLevelShare: report.topLevelShare, contractFieldShare: report.contractFieldShare, contractKeys: report.contractKeys })}\n`);
