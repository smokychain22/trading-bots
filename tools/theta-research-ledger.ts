import { readFileSync, statSync } from 'node:fs';
import { ResearchDurableStore } from '../src/storage/research-durable-store.js';
import { buildShadowPredictionReceipt, type ShadowPredictionReceipt } from '../src/research/shadow-prediction-receipt.js';
import type { ModelRegistryRecord } from '../src/research/empirical-model-registry.js';
import { buildSelectionBiasReceipt, type SelectionBiasReceipt } from '../src/research/selection-bias-receipt.js';
import { verifyReproducibilityBundle, type ReproducibilityBundle } from '../src/research/reproducibility-bundle.js';
import type { OutcomeEvidence } from '../src/research/prediction-outcome-join.js';
import { assessEntryModelReadiness } from '../src/research/theta-entry-model-readiness.js';

// Explicit local-only intake. No environment loading, network, broker or Production DB.
const args = process.argv.slice(2);
const inputPath = args.find((a) => a.startsWith('--input='))?.slice(8);
const storePath = args.find((a) => a.startsWith('--store='))?.slice(8);
if (!inputPath || !storePath || args.length !== 2) throw new Error('RESEARCH_LEDGER_EXPLICIT_INPUT_AND_STORE_REQUIRED');
if (statSync(inputPath).size > 4 * 1024 * 1024) throw new Error('RESEARCH_LEDGER_INPUT_TOO_LARGE');
const input = JSON.parse(readFileSync(inputPath, 'utf8')) as {
  version: string; models: ModelRegistryRecord[]; predictions: ShadowPredictionReceipt[];
  selectionBias: SelectionBiasReceipt[]; joins: { predictionId: string; outcome: OutcomeEvidence; joinedAt: string }[];
  bundle: ReproducibilityBundle;
  entryReadiness?: Parameters<typeof assessEntryModelReadiness>[0];
};
if (input.version !== 'theta-research-ledger-input-v1' ||
  [input.models, input.predictions, input.selectionBias, input.joins].some((v) => !Array.isArray(v))) throw new Error('RESEARCH_LEDGER_INPUT_INVALID');
const store = new ResearchDurableStore(storePath);
try {
  for (const model of input.models) store.saveModelRecord(model);
  for (const receipt of input.selectionBias) store.saveSelectionBiasReceipt(buildSelectionBiasReceipt(receipt));
  for (const receipt of input.predictions) store.saveShadowPredictionReceipt(buildShadowPredictionReceipt(receipt));
  for (const join of input.joins) store.savePredictionOutcomeJoin(join.predictionId, join.outcome, join.joinedAt);
  const integrity = store.verify();
  const verification = verifyReproducibilityBundle(input.bundle, store);
  const entryReadiness = input.entryReadiness === undefined ? null : assessEntryModelReadiness(input.entryReadiness);
  process.stdout.write(JSON.stringify({ version: 'theta-research-ledger-receipt-v1', integrity, verification,
    entryReadiness, brokerAuthority: false, promotionGranted: false, profitability: 'EMPIRICALLY_UNPROVEN' }) + '\n');
  if (!integrity.valid || !verification.valid) process.exitCode = 1;
} finally { store.close(); }
