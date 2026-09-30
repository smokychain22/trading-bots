import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { replayCycleArchive, type CycleArchiveReplayIdentity } from '../src/theta/cycle-archive-replay.js';
import type { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import type { decodeCycleEvidenceArchive } from '../src/theta/postgres-cycle-evidence-storage.js';

const manifestArgument = process.argv.find((value) => value.startsWith('--manifest='))?.slice('--manifest='.length);
if (manifestArgument === undefined) throw new Error('CYCLE_ARCHIVE_MANIFEST_REQUIRED');
const manifestPath = resolve(manifestArgument);
if (!manifestPath.endsWith('.json')) throw new Error('CYCLE_ARCHIVE_MANIFEST_PATH_INVALID');
const identity = JSON.parse(await readFile(manifestPath, 'utf8')) as CycleArchiveReplayIdentity;
const archive = await readFile(manifestPath.slice(0, -5) + '.bin');
const historical = process.argv.includes('--historical');
const sourceRoot = historical ? resolve('.theta-local-worker', 'releases', identity.sourceSha) : resolve('.');
const git = (...args:string[]) => execFileSync('git', ['-C', sourceRoot, ...args], {
  encoding: 'utf8', timeout: 30_000, windowsHide: true,
}).trim();
const replaySourceSha = git('rev-parse', 'HEAD');
if (git('status', '--porcelain', '--untracked-files=normal').length > 0) {
  throw new Error('CYCLE_ARCHIVE_REPLAY_REQUIRES_CLEAN_SOURCE');
}
if (historical && replaySourceSha !== identity.sourceSha) throw new Error('CYCLE_ARCHIVE_HISTORICAL_RELEASE_SHA_MISMATCH');
if (!historical && replaySourceSha === identity.sourceSha) {
  throw new Error('CYCLE_ARCHIVE_HISTORICAL_REPLAY_REQUIRES_IMMUTABLE_RELEASE');
}
const implementation = historical ? {
  build: (await import(pathToFileURL(resolve(sourceRoot, 'src', 'theta', 'canonical-strategy-frontier.ts')).href))
    .buildCanonicalStrategyFrontier as typeof buildCanonicalStrategyFrontier,
  decode: (await import(pathToFileURL(resolve(sourceRoot, 'src', 'theta', 'postgres-cycle-evidence-storage.ts')).href))
    .decodeCycleEvidenceArchive as typeof decodeCycleEvidenceArchive,
} : undefined;
const result = replayCycleArchive(archive, identity, replaySourceSha, implementation);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.state === 'SAME_SOURCE_MISMATCH') process.exitCode = 1;
