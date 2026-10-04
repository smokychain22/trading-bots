// Compressed size of each top-level part of cycle evidence archives (the samples written by `theta-storage-archive.ts --mode=replay-sample`), to show which parts are
// INPUT (needed to replay) and which are DERIVED (reproducible by replaying the input under the originating release). Local files only, read only.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { decodeCycleEvidenceArchive } from '../src/theta/postgres-cycle-evidence-storage.js';

const directory = process.argv.find((value) => value.startsWith('--dir='))?.slice(6) ?? 'C:\\ProjectBackups\\trading-bots\\storage-archives\\theta-20261003\\replay-samples';
const output = process.argv.find((value) => value.startsWith('--output='))?.slice(9);
const compress = (value: unknown): number => brotliCompressSync(Buffer.from(JSON.stringify(value)), { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }).length;

const totals = new Map<string, { decoded: number; compressed: number }>();
let blobBytes = 0;
let archives = 0;
for (const name of readdirSync(directory).filter((file) => file.endsWith('.bin'))) {
  const blob = readFileSync(join(directory, name));
  blobBytes += blob.length;
  archives += 1;
  const decoded = decodeCycleEvidenceArchive(blob) as Record<string, unknown>;
  const input = decoded.canonicalFrontierInput as Record<string, unknown>;
  const parts: Record<string, unknown> = { strategyFrontier: decoded.strategyFrontier, snapshot: decoded.snapshot, 'canonicalFrontierInput.contracts': input.contracts, 'canonicalFrontierInput.optionomicsContext': input.optionomicsContext,
    'canonicalFrontierInput.other': Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'contracts' && key !== 'optionomicsContext')),
    other: Object.fromEntries(Object.entries(decoded).filter(([key]) => !['strategyFrontier', 'snapshot', 'canonicalFrontierInput'].includes(key))) };
  for (const [key, value] of Object.entries(parts)) {
    const entry = totals.get(key) ?? { decoded: 0, compressed: 0 };
    entry.decoded += Buffer.byteLength(JSON.stringify(value));
    entry.compressed += compress(value);
    totals.set(key, entry);
  }
}
const sumCompressed = [...totals.values()].reduce((sum, entry) => sum + entry.compressed, 0);
const report = { archives, storedBlobBytes: blobBytes, partsCompressedIndependentlyBytes: sumCompressed,
  parts: [...totals.entries()].map(([part, entry]) => ({ part, decodedMiB: +(entry.decoded / 1048576).toFixed(1), compressedMiB: +(entry.compressed / 1048576).toFixed(2), shareOfCompressed: +(entry.compressed / sumCompressed).toFixed(3) })).sort((a, b) => b.compressedMiB - a.compressedMiB) };
if (output !== undefined) writeFileSync(output, JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report)}\n`);
