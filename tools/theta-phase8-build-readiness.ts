import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPhase8BuildReadinessReceipt } from '../src/research/phase8-build-readiness.js';

const receipt = buildPhase8BuildReadinessReceipt();
const missingFiles = receipt.capabilities.flatMap((capability) => [...capability.sourceFiles, ...capability.testFiles]
  .filter((path) => !existsSync(resolve(path))).map((path) => ({ capability: capability.id, path })));
const output = { ...receipt, fileEvidenceComplete: missingFiles.length === 0, missingFiles };
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (!receipt.buildReady || missingFiles.length > 0) process.exitCode = 1;
