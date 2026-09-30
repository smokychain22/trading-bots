import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { auditCanonicalBrainStability } from '../src/research/canonical-brain-stability.js';
import { t0ReplayBundleSchema } from '../src/theta/t0-replay-bundle.js';

// Explicit local files only. No environment loader, database or provider surface.
const paths = process.argv.slice(2);
if (paths.length === 0 || paths.length > 32) throw new Error('BRAIN_STABILITY_T0_FILES_REQUIRED');
if (paths.reduce((bytes, path) => bytes + statSync(path).size, 0) > 16 * 1024 * 1024)
  throw new Error('BRAIN_STABILITY_INPUT_SIZE_LIMIT');
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
const sourceDirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'],
  { encoding: 'utf8', windowsHide: true }).trim().length > 0;
const bundles = paths.map(path => t0ReplayBundleSchema.parse(JSON.parse(readFileSync(path, 'utf8'))));
const receipt = auditCanonicalBrainStability(bundles);
process.stdout.write(JSON.stringify({ sourceSha, sourceDirty, currentWorkerProven: false, receipt }) + '\n');
if (receipt.state !== 'PASS') process.exitCode = 1;
