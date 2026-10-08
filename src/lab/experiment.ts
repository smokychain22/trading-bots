import { replayFromT0Bundle, t0ReplayBundleSchema } from '../theta/t0-replay-bundle.js';
import { capitalAdmission, capitalEnvelopeSchema, capitalProposalSchema, type CapitalCommitment } from '../execution/portfolio-capital-reservation.js';
import { dotProposalSource, validateDotProposal, type DotProposal } from './contracts.js';
import type { DotLabStore } from './store.js';

/** Calls the existing sovereign brain and allocation arithmetic, not a second engine.
 * T0 caller inputs are modeled research, never broker-observed or Paper authorization. */
export function runDotBaselineReplay(store: DotLabStore, input: {
  experimentId: string; providerAccountId: string; proposal: DotProposal;
  t0: unknown; envelope: unknown; capitalProposal: unknown; commitments: readonly CapitalCommitment[]; at: string;
}) {
  if (input.providerAccountId !== store.identity.providerAccountId) throw new Error('DOT_EXPERIMENT_ACCOUNT_MISMATCH');
  if (validateDotProposal(dotProposalSource(input.proposal)).proposalHash !== input.proposal.proposalHash
    || input.proposal.brokerAuthority !== false || input.proposal.status !== 'DRAFT_RESEARCH_ONLY') throw new Error('DOT_EXPERIMENT_PROPOSAL_HASH_MISMATCH');
  const envelope = capitalEnvelopeSchema.parse(input.envelope);
  const capitalProposal = capitalProposalSchema.parse(input.capitalProposal);
  if (envelope.executionAccountId !== store.identity.executionAccountId) throw new Error('DOT_CAPITAL_ACCOUNT_MISMATCH');
  if (capitalProposal.strategy !== input.proposal.strategy.branch) throw new Error('DOT_CAPITAL_STRATEGY_MISMATCH');
  const time = Date.parse(input.at);
  if (!Number.isFinite(time) || time < Date.parse(envelope.observedAt) || time >= Date.parse(envelope.expiresAt)
    || time >= Date.parse(capitalProposal.quoteExpiresAt)) throw new Error('DOT_EXPERIMENT_CAPITAL_STALE');
  const t0 = t0ReplayBundleSchema.parse(input.t0);
  if (!t0.bundleContentHash) throw new Error('DOT_SEALED_T0_REQUIRED');
  const frontier = replayFromT0Bundle(t0);
  const capitalBlockers = capitalAdmission(envelope, input.commitments, capitalProposal);
  const receipt = { version: 'dot-canonical-baseline-replay-v1', proposalHash: input.proposal.proposalHash,
    experimentId: input.experimentId, providerAccountId: input.providerAccountId,
    t0Hash: t0.bundleContentHash, frontierHash: frontier.contentHash,
    branches: frontier.branches, capitalBlockers, truthClass: 'MODELED_RESEARCH',
    proposalRulesApplied: false, brokerAuthority: false, orderIntentCreated: false,
    executionState: 'OWNER_AUTHORIZATION_AND_ISOLATED_CANONICAL_RUNTIME_REQUIRED',
    blockers: ['CHALLENGER_RULE_CONSUMER_NOT_CONNECTED', 'ISOLATED_CANONICAL_ACCOUNT_ENVELOPE_REQUIRED',
      'DOT_PAPER_AUTHORIZATION_REQUIRED'],
  };
  const hash = store.saveExperiment(input.experimentId, receipt, input.at);
  return { ...receipt, hash };
}
