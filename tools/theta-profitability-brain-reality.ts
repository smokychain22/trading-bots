import { readFileSync } from 'node:fs';
import { buildProfitabilityBrainRealityReceipt } from '../src/theta/profitability-brain-reality.js';
import { buildProfitabilityBrainRealityFromManifest, type ProfitabilityBrainEvidenceManifest }
  from '../src/theta/profitability-brain-evidence-manifest.js';

// Source-level receipt only. Current-worker, empirical, and broker-authorization
// proof must be supplied by their authoritative runtime/evaluation systems and
// is deliberately not inferred from files or environment flags here.
const manifestPath = process.env.THETA_PROFITABILITY_BRAIN_EVIDENCE_MANIFEST?.trim();
const output = manifestPath
  ? buildProfitabilityBrainRealityFromManifest(JSON.parse(readFileSync(manifestPath, 'utf8')) as ProfitabilityBrainEvidenceManifest)
  : { receipt: buildProfitabilityBrainRealityReceipt(), manifestHash: null,
    violations: ['CURRENT_WORKER_EVIDENCE_MANIFEST_NOT_SUPPLIED'] as readonly string[] };
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (output.violations.some((item) => item !== 'CURRENT_WORKER_EVIDENCE_MANIFEST_NOT_SUPPLIED')) process.exitCode = 1;
