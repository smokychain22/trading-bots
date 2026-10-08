import { z } from 'zod';
import { canonicalThetaStrategyRegistry, thetaFeatureFamily } from '../theta/strategy-package.js';
import { generateHoldStrikeCandidates } from '../research/hold-strike-shadow-candidate-generator.js';
import { generateDefinedRiskCandidates } from '../research/defined-risk-shadow-candidate-generator.js';
import { eligibleFamilies } from '../theta/strategy-router-contract.js';
import type { ShadowStrategyOrchestratorInput } from '../research/shadow-strategy-orchestrator.js';
import { canonicalHash, validateDotProposal } from './contracts.js';
import type { DotLabStore } from './store.js';
import { profitReplayInputSchema, runProfitTakingReplay } from '../research/profit-taking-replay.js';

const featureSchema = z.object({ feature: thetaFeatureFamily, value: z.number().finite().nullable(),
  evidenceId: z.string().min(1), snapshotId: z.string().min(1), observedAt: z.string().datetime({ offset: true }),
  availableAt: z.string().datetime({ offset: true }), validUntil: z.string().datetime({ offset: true }),
  qualification: z.enum(['QUALIFIED', 'UNAVAILABLE', 'UNQUALIFIED']) }).strict();

/** A research adapter over existing generators. It cannot allocate, create an intent or execute.
 * Unsupported model references stay blocked instead of pretending their rules were evaluated. */
export function qualifyDotProposal(raw: unknown, input: {
  decisionTimestamp: string; routing: { timestamp: string; snapshotId: string }; sourceEvidenceIds: readonly string[];
}, features: unknown) {
  const proposal = validateDotProposal(raw);
  const evidence = z.array(featureSchema).max(30).parse(features);
  if (new Set(evidence.map(item => item.feature)).size !== evidence.length) throw new Error('DOT_DUPLICATE_FEATURE_EVIDENCE');
  const decisionAt = Date.parse(input.decisionTimestamp);
  if (!Number.isFinite(decisionAt) || input.routing.timestamp !== input.decisionTimestamp
    || input.sourceEvidenceIds.length === 0) throw new Error('DOT_SHADOW_PIT_IDENTITY_INVALID');
  const baseline = [...canonicalThetaStrategyRegistry.values()].find(item => item.configurationHash === proposal.baselineHash);
  if (!baseline) throw new Error('DOT_BASELINE_MISMATCH');
  const unsupported: string[] = [];
  for (const key of ['candidateLatticeVersion', 'featureSetVersion', 'entryModelVersion', 'ownershipModelVersion',
    'managementPolicyVersion', 'softFeatureFamilies', 'allowedActions'] as const) {
    if (canonicalHash(proposal.strategy[key]) !== canonicalHash(baseline[key])) unsupported.push(key);
  }
  if (proposal.strategy.lattice.optionType !== baseline.lattice.optionType) unsupported.push('lattice.optionType');
  if (canonicalHash(proposal.strategy.lattice.deltaResearchBuckets) !== canonicalHash(baseline.lattice.deltaResearchBuckets)) {
    unsupported.push('lattice.deltaResearchBuckets');
  }
  // Only narrowing the existing candidate window is implemented here. No hard policy expansion.
  if (proposal.strategy.lattice.dteMin < baseline.lattice.dteMin || proposal.strategy.lattice.dteMax > baseline.lattice.dteMax) {
    unsupported.push('lattice.dteExpansion');
  }
  const rules = proposal.researchRules.map((rule, index) => {
    const value = evidence.find(item => item.feature === rule.feature);
    const qualified = value !== undefined && value.qualification === 'QUALIFIED' && value.value !== null
      && value.snapshotId === input.routing.snapshotId && input.sourceEvidenceIds.includes(value.evidenceId)
      && Date.parse(value.observedAt) <= Date.parse(value.availableAt) && Date.parse(value.availableAt) <= decisionAt
      && decisionAt < Date.parse(value.validUntil);
    const number = qualified ? value?.value ?? null : null;
    const pass = number !== null && (rule.operator === 'GTE' ? rule.lower !== null && number >= rule.lower
      : rule.operator === 'LTE' ? rule.upper !== null && number <= rule.upper
        : rule.lower !== null && rule.upper !== null && number >= rule.lower && number <= rule.upper);
    return { index, feature: rule.feature, state: !qualified ? 'UNAVAILABLE' : pass ? 'PASS' : 'REJECT',
      evidenceId: value?.evidenceId ?? null, value: number };
  });
  const blockers = [...unsupported.map(field => `UNSUPPORTED_CONFIGURATION:${field}`),
    ...rules.filter(rule => rule.state !== 'PASS').map(rule => `RESEARCH_RULE_${rule.state}:${rule.index}`)];
  return { proposal, baseline, evidence, rules, blockers };
}

export function evaluateDotShadowProposal(raw: unknown, input: ShadowStrategyOrchestratorInput, features: unknown) {
  const { proposal, evidence, rules, blockers } = qualifyDotProposal(raw, input, features);
  const branch = proposal.strategy.branch;
  const family = branch === 'THETA_HOLD_STRIKE' ? 'THETA_H' : branch === 'THETA_DEFINED_RISK' ? 'THETA_D' : null;
  if (family === null) blockers.push('CANONICAL_Q_OR_INVENTORY_MANAGEMENT_CONSUMER_REQUIRED');
  else if (!eligibleFamilies(input.routing).includes(family)) blockers.push('ROUTER_INELIGIBLE');
  if (family === 'THETA_H' && input.holdStrikeChain === null) blockers.push('MISSING_H_CHAIN');
  if (family === 'THETA_D' && input.definedRiskChain === null) blockers.push('MISSING_D_CHAIN');
  const lattice = proposal.strategy.lattice;
  let result: ReturnType<typeof generateHoldStrikeCandidates> | ReturnType<typeof generateDefinedRiskCandidates> | null = null;
  if (blockers.length === 0 && family === 'THETA_H' && input.holdStrikeChain !== null) {
    result = generateHoldStrikeCandidates({ underlying: input.underlying, decisionTimestamp: input.decisionTimestamp,
      ownershipState: input.ownershipState, eventState: input.eventState, ...input.holdStrikeChain,
      minDte: lattice.dteMin, maxDte: lattice.dteMax, sourceEvidenceIds: input.sourceEvidenceIds });
  }
  if (blockers.length === 0 && family === 'THETA_D' && input.definedRiskChain !== null) {
    result = generateDefinedRiskCandidates({ underlying: input.underlying, decisionTimestamp: input.decisionTimestamp,
      ...input.definedRiskChain, minDte: lattice.dteMin, maxDte: lattice.dteMax, sourceEvidenceIds: input.sourceEvidenceIds });
  }
  const receipt = { version: 'dot-shadow-proposal-consumer-v1', proposalHash: proposal.proposalHash,
    strategyVersion: proposal.strategy.strategyVersion, configurationHash: proposal.strategy.configurationHash,
    snapshotId: input.routing.snapshotId, decisionTimestamp: input.decisionTimestamp,
    inputHash: canonicalHash({ input, evidence }), rules, blockers, result,
    state: result === null ? 'BLOCKED' : 'EVALUATED_RESEARCH_ONLY', truthClass: 'MODELED_RESEARCH',
    unconsumedExperimentFields: ['plannedHoldingDays', 'profitTakingChallengers'],
    brokerAuthority: false, orderIntentCreated: false, profitability: 'EMPIRICALLY_UNPROVEN' };
  return { ...receipt, receiptHash: canonicalHash(receipt) };
}

export function persistDotShadowProposal(store: DotLabStore, raw: unknown, input: ShadowStrategyOrchestratorInput, features: unknown) {
  const receipt = evaluateDotShadowProposal(raw, input, features);
  const proposal = validateDotProposal(raw);
  store.saveProposal(proposal, input.decisionTimestamp);
  store.saveExperiment(`shadow-${receipt.receiptHash}`, receipt, input.decisionTimestamp);
  return receipt;
}

/** Planned holding time and exit challengers use the existing offline research
 * comparison. All tested policies remain visible, never selected-winner-only evidence. */
export function persistDotExitComparison(store: DotLabStore, raw: unknown, episode: unknown) {
  const proposal = validateDotProposal(raw);
  const input = profitReplayInputSchema.parse(episode);
  if (input.observations.length > 2000) throw new Error('DOT_REPLAY_OBSERVATION_BUDGET_EXCEEDED');
  const comparison = runProfitTakingReplay({ ...input, policy: { ...input.policy,
    version: `${input.policy.version}:dot:${proposal.proposalHash}`,
    maxHoldingMinutes: proposal.plannedHoldingDays * 24 * 60 } });
  const receipt = { version: 'dot-exit-comparison-v1', proposalHash: proposal.proposalHash,
    inputHash: comparison.inputHash, comparison, selectedChallengers: proposal.profitTakingChallengers,
    fullPolicyTrialCount: comparison.policies.length, plannedHoldingDays: proposal.plannedHoldingDays,
    truthClass: 'MODELED_RESEARCH', actualFill: false, brokerAuthority: false,
    profitability: 'EMPIRICALLY_UNPROVEN' };
  const at = input.observations.at(-1)?.decisionAt ?? input.entryAt;
  store.saveProposal(proposal, at);
  const contentHash = canonicalHash(receipt);
  store.saveExperiment(`exits-${contentHash}`, receipt, at);
  return { ...receipt, contentHash };
}
