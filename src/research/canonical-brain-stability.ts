import { createHash } from 'node:crypto';
import { canonicalJson } from './point-in-time-evidence.js';
import { buildCanonicalStrategyFrontier, type CanonicalStrategyFrontierInput } from '../theta/canonical-strategy-frontier.js';
import { replayFromT0Bundle, t0ReplayBundleSchema, type T0ReplayBundle } from '../theta/t0-replay-bundle.js';

const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const reverseKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(reverseKeys)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .reverse().map(([key, child]) => [key, reverseKeys(child)])) : value;
const decision = (frontier: ReturnType<typeof buildCanonicalStrategyFrontier>) => ({
  action: frontier.primaryAction, candidateId: frontier.selectedCandidateId,
  strategy: frontier.selectedBranch, quantity: frontier.selectedQuantity,
  globalWaitEarned: frontier.globalWaitEarned,
});

/** Executes the existing canonical brain, never a competing research selector.
 * Perturbations are modeled diagnostics and cannot authorize execution or amend
 * a persisted T0. Temporal flips are observations, not invented policy violations.
 */
export function auditCanonicalBrainStability(rawBundles: readonly T0ReplayBundle[]) {
  if (rawBundles.length === 0 || rawBundles.length > 32) throw new Error('BRAIN_STABILITY_BOUNDED_SAMPLE_REQUIRED');
  const before = hash(rawBundles);
  const observations = rawBundles.map(raw => {
    const bundle = t0ReplayBundleSchema.parse(raw);
    const baseline = replayFromT0Bundle(bundle);
    const input: CanonicalStrategyFrontierInput = { ...bundle, contracts: bundle.contracts,
      optionomicsContext: bundle.optionomicsContext ?? null };
    const variations: readonly [string, CanonicalStrategyFrontierInput][] = [
      ['IDENTICAL_REPEAT', input],
      ['CONTRACT_ORDER_REVERSED', { ...input, contracts: [...input.contracts].reverse() }],
      ['JSON_KEY_ORDER_REVERSED', reverseKeys(input) as CanonicalStrategyFrontierInput],
      ['OPTIONAL_RESEARCH_REMOVED', { ...input, optionomicsContext: null }],
      ['OPTIONAL_RESEARCH_EXTREME', { ...input, optionomicsContext: {
        researchOnly: true, gex: -1e12, flow: 1e12, unpromotedProbability: 1,
      } }],
    ];
    const probes = variations.map(([name, variant]) => {
      const result = buildCanonicalStrategyFrontier(variant);
      const sameDecision = canonicalJson(decision(baseline)) === canonicalJson(decision(result));
      // Research context belongs in the full hash even when it must not alter
      // the canonical action. Do not falsely demand an identical full hash.
      const sameFrontierRequired = !name.startsWith('OPTIONAL_RESEARCH_');
      return { name, passed: sameDecision && (!sameFrontierRequired || result.contentHash === baseline.contentHash),
        sameDecision, sameFrontierRequired, resultHash: result.contentHash };
    });
    return { snapshotId: bundle.snapshotId, timestamp: bundle.timestamp, strategyVersion: bundle.strategyVersion,
      originalBundleHash: hash(raw), frontierHash: baseline.contentHash, decision: decision(baseline),
      topTwo: baseline.structuralTopTwo, searchCoverage: baseline.paperEvaluationCoverage ?? null,
      shadowComparisonHash: baseline.adaptiveShadowDecision
        ? hash(baseline.adaptiveShadowDecision.shadowComparison) : null, probes };
  });
  for (let index = 1; index < observations.length; index++) {
    if (Date.parse(observations[index]?.timestamp ?? '') < Date.parse(observations[index - 1]?.timestamp ?? '')) {
      throw new Error('BRAIN_STABILITY_CHRONOLOGY_INVALID');
    }
  }
  const transitions = observations.slice(1).map((row, index) => {
    const prior = observations[index];
    if (!prior) throw new Error('BRAIN_STABILITY_PREDECESSOR_MISSING');
    return { fromSnapshot: prior.snapshotId, toSnapshot: row.snapshotId,
      sameInput: prior.originalBundleHash === row.originalBundleHash,
      samePolicyVersion: prior.strategyVersion === row.strategyVersion,
      actionChanged: prior.decision.action !== row.decision.action,
      strategyChanged: prior.decision.strategy !== row.decision.strategy,
      quantityChanged: prior.decision.quantity !== row.decision.quantity,
      shadowComparisonChanged: prior.shadowComparisonHash !== row.shadowComparisonHash,
      classification: prior.originalBundleHash === row.originalBundleHash
        ? 'IDENTICAL_INPUT_REPLAY' : 'CHANGED_EVIDENCE_OR_POLICY_REQUIRES_ATTRIBUTION',
    };
  });
  if (before !== hash(rawBundles)) throw new Error('BRAIN_STABILITY_MUTATED_INPUT');
  const violations = observations.flatMap(row => row.probes.filter(probe => !probe.passed)
    .map(probe => `${row.snapshotId}:${probe.name}`));
  const body = { version: 'theta-canonical-brain-stability-v1', scope: 'OFFLINE_REPLAY_DIAGNOSTIC',
    state: violations.length === 0 ? 'PASS' : 'FAIL', observations, transitions, violations,
    distinctSnapshotCount: new Set(observations.map(row => row.snapshotId)).size,
    empiricalIndependentN: null, policyPromotion: false, brokerAuthority: false,
    providerRequests: 0, brokerMutations: 0, profitability: 'EMPIRICALLY_UNPROVEN' };
  return { ...body, contentHash: hash(body) };
}
