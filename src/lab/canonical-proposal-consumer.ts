import { z } from 'zod';
import { replayFromT0Bundle, t0ReplayBundleSchema } from '../theta/t0-replay-bundle.js';
import { canonicalHash } from './contracts.js';
import { qualifyDotProposal } from './proposal-consumer.js';
import type { DotLabStore } from './store.js';

const inventorySchema = z.object({
  executionAccountId: z.string().uuid(), snapshotId: z.string().min(1), evidenceId: z.string().min(1),
  observedAt: z.string().datetime({ offset: true }), availableAt: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }), qualification: z.literal('QUALIFIED'),
  stock: z.object({ underlying: z.string().min(1), shares: z.number().finite().nonnegative(),
    currentPrice: z.number().finite().positive(), brokerCostBasisPerShare: z.number().finite().nullable(),
    wholeChainEconomicBasisPerShare: z.number().finite().nullable(),
    committedShortCallContracts: z.number().int().nonnegative() }).strict(),
}).strict();

/** Research view of the sealed canonical frontier, never a second selector,
 * allocator or order executor. Canonical blockers and sizing survive unchanged. */
export function evaluateDotCanonicalProposal(raw: unknown, frozenInput: unknown, features: unknown,
  binding: { executionAccountId: string; sourceEvidenceIds: readonly string[]; inventory: unknown }) {
  z.string().uuid().parse(binding.executionAccountId);
  const bundle = t0ReplayBundleSchema.parse(frozenInput);
  if (!bundle.bundleContentHash) throw new Error('DOT_SEALED_T0_REQUIRED');
  // Validate both integrity hashes and deterministic canonical replay first.
  const frontier = replayFromT0Bundle(bundle);
  if (bundle.routing === null) throw new Error('DOT_CANONICAL_ROUTING_UNAVAILABLE');
  if (bundle.routing.snapshotId !== bundle.snapshotId) throw new Error('DOT_CANONICAL_ROUTING_IDENTITY_MISMATCH');
  const { proposal, baseline, evidence, rules, blockers } = qualifyDotProposal(raw, {
    decisionTimestamp: bundle.timestamp, routing: bundle.routing, sourceEvidenceIds: binding.sourceEvidenceIds,
  }, features);
  if (!['THETA_CONVENTIONAL', 'THETA_RECOVERY', 'THETA_CC'].includes(proposal.strategy.branch)) {
    blockers.push('USE_EXISTING_H_D_GENERATOR_CONSUMER');
  }
  if (proposal.strategy.branch === 'THETA_RECOVERY'
    && canonicalHash(proposal.strategy.lattice) !== canonicalHash(baseline.lattice)) {
    blockers.push('UNSUPPORTED_CONFIGURATION:recoveryStockLattice');
  }
  const needsInventory = ['THETA_RECOVERY', 'THETA_CC'].includes(proposal.strategy.branch);
  const parsed = needsInventory ? inventorySchema.safeParse(binding.inventory) : null;
  if (needsInventory) {
    const inventory = parsed?.success ? parsed.data : null;
    const at = Date.parse(bundle.timestamp);
    if (inventory === null || inventory.executionAccountId !== binding.executionAccountId
      || inventory.snapshotId !== bundle.snapshotId || !binding.sourceEvidenceIds.includes(inventory.evidenceId)
      || Date.parse(inventory.observedAt) > Date.parse(inventory.availableAt)
      || Date.parse(inventory.availableAt) > at || at >= Date.parse(inventory.validUntil)
      || canonicalHash(inventory.stock) !== canonicalHash(bundle.stock)) {
      blockers.push('ACCOUNT_BOUND_INVENTORY_UNAVAILABLE_OR_MISMATCHED');
    }
  }
  const branch = frontier.branches.find(item => item.branch === proposal.strategy.branch);
  if (!branch) blockers.push('CANONICAL_BRANCH_MISSING');
  const lattice = proposal.strategy.lattice;
  const candidates = blockers.length === 0 ? (branch?.candidates ?? []).filter(candidate =>
    candidate.dte === null ? proposal.strategy.branch === 'THETA_RECOVERY'
      : candidate.dte >= lattice.dteMin && candidate.dte <= lattice.dteMax) : [];
  const excludedCandidateIds = (branch?.candidates ?? []).filter(candidate => !candidates.includes(candidate))
    .map(candidate => candidate.candidateId);
  // Do not rerank a filtered set with an invented economic selector. All retained
  // canonical economics, rejection reasons, ranks and quantities remain inspectable.
  const receipt = { version: 'dot-canonical-proposal-consumer-v1',
    proposalHash: proposal.proposalHash, strategyVersion: proposal.strategy.strategyVersion,
    configurationHash: proposal.strategy.configurationHash, baselineHash: proposal.baselineHash,
    executionAccountId: binding.executionAccountId, snapshotId: bundle.snapshotId, timestamp: bundle.timestamp,
    inputHash: canonicalHash({ bundle, evidence, binding }), canonicalFrontierHash: frontier.contentHash,
    rules, blockers, candidates, excludedCandidateIds, canonicalBranchState: branch?.evaluationState ?? null,
    state: blockers.length > 0 ? 'BLOCKED' : branch?.applicable === false ? 'NOT_APPLICABLE' : 'EVALUATED_RESEARCH_ONLY',
    canonicalBestRetained: candidates.some(candidate => candidate.candidateId === branch?.bestCandidateId),
    strategyComparisonBaseline: { strategyVersion: baseline.strategyVersion, configurationHash: baseline.configurationHash },
    hypothesis: proposal.hypothesis, riskLimits: proposal.strategy.hardRules,
    managementPolicyVersion: proposal.strategy.managementPolicyVersion,
    unconsumedExperimentFields: ['plannedHoldingDays', 'profitTakingChallengers'],
    truthClass: 'MODELED_RESEARCH', profitability: 'EMPIRICALLY_UNPROVEN',
    executionReady: false, brokerAuthority: false, orderIntentCreated: false };
  return { ...receipt, receiptHash: canonicalHash(receipt) };
}

export function persistDotCanonicalProposal(store: DotLabStore, raw: unknown, frozenInput: unknown,
  features: unknown, sourceEvidenceIds: readonly string[], inventory: unknown) {
  const receipt = evaluateDotCanonicalProposal(raw, frozenInput, features,
    { executionAccountId: store.identity.executionAccountId, sourceEvidenceIds, inventory });
  const { proposal } = qualifyDotProposal(raw, { decisionTimestamp: receipt.timestamp,
    routing: { timestamp: receipt.timestamp, snapshotId: receipt.snapshotId }, sourceEvidenceIds }, features);
  store.saveProposal(proposal, receipt.timestamp);
  store.saveExperiment(`canonical-${receipt.receiptHash}`, receipt, receipt.timestamp);
  return receipt;
}
