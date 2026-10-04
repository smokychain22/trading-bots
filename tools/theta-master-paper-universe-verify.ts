import { readFileSync } from 'node:fs';
import { paperInstrumentClassificationManifest } from '../src/theta/paper-entry-safety-policy.js';
import { selectBoundedMasterPaperPromotions, type MasterPaperPromotionEvidence } from '../src/theta/master-paper-instrument-promotion.js';

const receiptPath = 'docs/operations/THETA_MASTER_PAPER_UNIVERSE_PROMOTION_20261004.json';
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
  candidates: readonly (MasterPaperPromotionEvidence & { readonly state: string })[];
  approvedSymbols: readonly string[];
  runtimeCapacity: { readonly maximumApprovedFullChainSymbols: number; readonly capacityEvidenceRef: string };
  ordersSubmitted: number;
  brokerMutations: number;
};
const decisions = selectBoundedMasterPaperPromotions({
  existingApprovedSymbols: ['SPY'], candidates: receipt.candidates, capacity: receipt.runtimeCapacity,
});
const selected = ['SPY', ...decisions.filter((decision) => decision.selected).map((decision) => decision.symbol)].sort();
const expected = [...receipt.approvedSymbols].sort();
const manifest = paperInstrumentClassificationManifest.entries.filter((entry) => entry.paperBootstrapApproved)
  .map((entry) => entry.symbol).sort();
const stateMatches = decisions.every((decision) => receipt.candidates.find((candidate) => candidate.symbol === decision.symbol)?.state === decision.state);
const pass = JSON.stringify(selected) === JSON.stringify(expected)
  && JSON.stringify(manifest) === JSON.stringify(expected)
  && stateMatches && receipt.ordersSubmitted === 0 && receipt.brokerMutations === 0;
console.info(JSON.stringify({ contractVersion: 'theta-master-paper-universe-verification-v1', state: pass ? 'PASS' : 'FAIL',
  approvedSymbols: expected, selectedByEvidence: selected, manifestSymbols: manifest,
  decisions, executionAuthorized: false, ordersSubmitted: 0, brokerMutations: 0 }, null, 2));
if (!pass) process.exitCode = 1;
