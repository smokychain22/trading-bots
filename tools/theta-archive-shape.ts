// Prints the key structure (depth-limited, with byte sizes and array lengths) of one decoded cycle evidence archive. Local files only.
import { readFileSync } from 'node:fs';
import { decodeCycleEvidenceArchive } from '../src/theta/postgres-cycle-evidence-storage.js';

const file = process.argv[2];
if (file === undefined) throw new Error('usage: theta-archive-shape.ts <archive.bin> [depth]');
const depthLimit = Number(process.argv[3] ?? '3');
const decoded = decodeCycleEvidenceArchive(readFileSync(file)) as Record<string, unknown>;
const size = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
function walk(value: unknown, path: string, depth: number): void {
  if (Array.isArray(value)) {
    console.log(`${'  '.repeat(depth)}${path}: array[${value.length}] ${(size(value) / 1024).toFixed(1)} KiB`);
    if (depth < depthLimit && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) walk(value[0], `${path}[0]`, depth + 1);
  } else if (value !== null && typeof value === 'object') {
    console.log(`${'  '.repeat(depth)}${path}: object ${(size(value) / 1024).toFixed(1)} KiB keys=${Object.keys(value).length}`);
    if (depth < depthLimit) for (const [key, child] of Object.entries(value as Record<string, unknown>)) walk(child, key, depth + 1);
  } else console.log(`${'  '.repeat(depth)}${path}: ${typeof value} ${String(value).slice(0, 60)}`);
}
walk(decoded, 'archive', 0);
