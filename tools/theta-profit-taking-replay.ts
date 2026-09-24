import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { profitReplayInputSchema, runProfitTakingReplay } from '../src/research/profit-taking-replay.js';

// Offline only. Never loads environment secrets or imports a provider/broker client.
const argument = (name: string) => {
  const value = process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`REQUIRED_ARGUMENT_${name.toUpperCase()}`);
  return resolve(value);
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const manifestSchema = z.object({ version: z.literal('theta-replay-evidence-manifest-v1'),
  canonicalSourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  observations: z.array(z.object({ evidenceId: z.string().min(1),
    normalizedObservationSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
}).strict();

async function main() {
  const raw = profitReplayInputSchema.parse(JSON.parse(await readFile(argument('input'), 'utf8')));
  const bytes = await readFile(argument('manifest'), 'utf8');
  const manifest = manifestSchema.parse(JSON.parse(bytes));
  if (digest(bytes) !== raw.sourceManifestHash || manifest.canonicalSourceSha !== raw.sourceSha) {
    throw new Error('REPLAY_SOURCE_MANIFEST_MISMATCH');
  }
  // A 40-hex string alone is not release provenance. Require canonical Git ancestry.
  execFileSync('git', ['merge-base', '--is-ancestor', raw.sourceSha, 'origin/main'], { stdio: 'ignore' });
  const hashes = new Map(manifest.observations.map((o) => [o.evidenceId, o.normalizedObservationSha256]));
  if (hashes.size !== manifest.observations.length) throw new Error('REPLAY_DUPLICATE_MANIFEST_EVIDENCE');
  const canonical = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v !== null && typeof v === 'object') return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, val]) => `${JSON.stringify(k)}:${canonical(val)}`).join(',')}}`;
    return JSON.stringify(v);
  };
  for (const o of raw.observations) if (hashes.get(o.evidenceId) !== digest(canonical(o))) {
    throw new Error('REPLAY_OBSERVATION_NOT_IN_IMMUTABLE_MANIFEST');
  }
  const receipt = runProfitTakingReplay(raw);
  const output = argument('output');
  await mkdir(dirname(output), { recursive: true });
  // Content-addressed output plus exclusive creation preserves prior experiment evidence.
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output, contentHash: receipt.contentHash, policies: receipt.policies.length,
    empiricalValidation: false, brokerMutations: 0 }));
}
main().catch(() => { console.error('OFFLINE_REPLAY_FAILED_CHECK_INPUT_MANIFEST_CANONICAL_LINEAGE_AND_OUTPUT_PATH'); process.exitCode = 1; });
