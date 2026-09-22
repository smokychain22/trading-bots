/**
 * Shadow strategy orchestrator (Wave 6 Batch B). Research-only,
 * `brokerAuthority: false`. Takes one real `StrategyRoutingResponse` (the
 * same 6-family output `new-risk-orchestrator.ts` already persists) and
 * dispatches EVERY family to an explicit branch handler -- never silently
 * dropping a family the way only acting on `thetaQEligible` would.
 *
 * This module does not decide anything Production. THETA_Q is a pure
 * REFERENCE to the real canonical decision (this module never re-derives
 * or second-guesses it). THETA_H/THETA_D call the existing, tested shadow
 * candidate generators (`hold-strike-shadow-candidate-generator.ts`,
 * `defined-risk-shadow-candidate-generator.ts`) reconciled in
 * `THETA_CANONICAL_FRONTIER_HD_RECONCILIATION.md`. THETA_A/THETA_C/THETA_R
 * are lifecycle management routes, not entry-candidate branches -- this
 * module only records that they were observed eligible/ineligible, it
 * never invents a management candidate for them (that is
 * `paper-bootstrap-management-policy.ts`'s real, separate authority).
 */
import { eligibleFamilies, type StrategyRoutingResponse, type StrategyFamily } from '../theta/strategy-router-contract.js';
import { canonicalThetaStrategyRegistry } from '../theta/strategy-package.js';
import {
  generateHoldStrikeCandidates, type HoldStrikeGenerationResult, type HoldStrikeChainContractQuote,
  type OwnershipEligibility, type EventProximity,
} from './hold-strike-shadow-candidate-generator.js';
import {
  generateDefinedRiskCandidates, type DefinedRiskGenerationResult, type DefinedRiskLegContract,
} from './defined-risk-shadow-candidate-generator.js';

export const shadowStrategyOrchestratorVersion = 'theta-shadow-strategy-orchestrator-v1' as const;

function requireRegistryEntry(key: string): NonNullable<ReturnType<typeof canonicalThetaStrategyRegistry.get>> {
  const entry = canonicalThetaStrategyRegistry.get(key);
  if (entry === undefined) throw new Error(`SHADOW_ORCHESTRATOR_REGISTRY_ENTRY_MISSING:${key}`);
  return entry;
}
const HOLD_STRIKE = requireRegistryEntry('theta-hold-strike@1.0.0-research');
const DEFINED_RISK = requireRegistryEntry('theta-defined-risk@1.0.0-research');

export type BranchState =
  | 'PRODUCTION_CANONICAL_REFERENCE_ONLY'
  | 'SHADOW_CANDIDATES_GENERATED'
  | 'INELIGIBLE_THIS_CYCLE'
  | 'MISSING_CHAIN_INPUT'
  | 'LIFECYCLE_HANDOFF_REFERENCE_ONLY';

export interface HoldStrikeChainInput {
  readonly contracts: readonly HoldStrikeChainContractQuote[];
  readonly maxQuoteAgeMs: number;
}

export interface DefinedRiskChainInputForOrchestrator {
  readonly expiration: string;
  readonly dte: number;
  readonly shortLegCandidates: readonly DefinedRiskLegContract[];
  readonly longLegCandidates: readonly DefinedRiskLegContract[];
  readonly quantity: number;
  readonly maxSyncAgeMs: number;
  readonly maxQuoteAgeMs: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly requireSynchronizedFreshQuotes: boolean;
}

export interface ShadowStrategyOrchestratorInput {
  readonly underlying: string;
  readonly decisionTimestamp: string;
  readonly routing: StrategyRoutingResponse;
  readonly ownershipState: OwnershipEligibility;
  readonly eventState: EventProximity;
  /** Required only when THETA_H is eligible this cycle -- absence when
   * eligible is reported as MISSING_CHAIN_INPUT, never silently skipped. */
  readonly holdStrikeChain: HoldStrikeChainInput | null;
  /** Required only when THETA_D is eligible this cycle -- same rule. */
  readonly definedRiskChain: DefinedRiskChainInputForOrchestrator | null;
  readonly sourceEvidenceIds: readonly string[];
}

export interface BranchResult {
  readonly family: StrategyFamily;
  readonly branch: string;
  readonly eligibleThisCycle: boolean;
  readonly branchState: BranchState;
  readonly holdStrikeResult: HoldStrikeGenerationResult | null;
  readonly definedRiskResult: DefinedRiskGenerationResult | null;
  readonly note: string;
  readonly brokerAuthority: false;
}

export interface ShadowStrategyOrchestratorResult {
  readonly orchestratorVersion: typeof shadowStrategyOrchestratorVersion;
  readonly underlying: string;
  readonly decisionTimestamp: string;
  readonly routingSnapshotId: string;
  /** Always exactly 6 entries, one per real strategy family -- a router
   * result is never dropped, even when a branch has no shadow generator. */
  readonly branchResults: readonly BranchResult[];
  readonly brokerAuthority: false;
}

const ALL_FAMILIES: readonly StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];

function lifecycleBranch(family: StrategyFamily, eligible: boolean): BranchResult {
  const branchName = family === 'THETA_R' ? 'THETA_R (management route, not a lifecycle-independent branch)'
    : family === 'THETA_A' ? 'THETA_RECOVERY' : 'THETA_CC';
  return {
    family, branch: branchName, eligibleThisCycle: eligible,
    branchState: 'LIFECYCLE_HANDOFF_REFERENCE_ONLY', holdStrikeResult: null, definedRiskResult: null,
    note: 'Lifecycle management route -- this module records eligibility only. '
      + 'Real management-candidate authority is paper-bootstrap-management-policy.ts, not this orchestrator.',
    brokerAuthority: false,
  };
}

/**
 * Dispatches every real strategy family from `input.routing` to an
 * explicit branch handler. THETA_Q is REFERENCE-ONLY (never re-decided
 * here); THETA_H/THETA_D call the real, tested shadow generators when
 * eligible AND a real chain was supplied; THETA_A/THETA_C/THETA_R are
 * recorded as lifecycle handoff references, never given invented
 * candidates.
 */
export function orchestrateShadowStrategies(input: ShadowStrategyOrchestratorInput): ShadowStrategyOrchestratorResult {
  const eligible = new Set(eligibleFamilies(input.routing));

  const branchResults: BranchResult[] = ALL_FAMILIES.map((family): BranchResult => {
    const isEligible = eligible.has(family);

    if (family === 'THETA_Q') {
      return {
        family, branch: 'THETA_CONVENTIONAL', eligibleThisCycle: isEligible,
        branchState: 'PRODUCTION_CANONICAL_REFERENCE_ONLY', holdStrikeResult: null, definedRiskResult: null,
        note: 'THETA_Q candidate generation and decision authority belong to '
          + 'new-risk-orchestrator.ts / canonical-strategy-frontier.ts in Production. This '
          + 'module never re-derives or second-guesses that real decision.',
        brokerAuthority: false,
      };
    }

    if (family === 'THETA_H') {
      if (!isEligible) {
        return {
          family, branch: 'THETA_HOLD_STRIKE', eligibleThisCycle: false, branchState: 'INELIGIBLE_THIS_CYCLE',
          holdStrikeResult: null, definedRiskResult: null,
          note: 'Router marked THETA_H ineligible this cycle -- no shadow candidates generated.',
          brokerAuthority: false,
        };
      }
      if (input.holdStrikeChain === null) {
        return {
          family, branch: 'THETA_HOLD_STRIKE', eligibleThisCycle: true, branchState: 'MISSING_CHAIN_INPUT',
          holdStrikeResult: null, definedRiskResult: null,
          note: 'THETA_H is eligible this cycle but no holdStrikeChain was supplied to the '
            + 'orchestrator -- this is a real gap (either RUNTIME_REACHABLE is unproven for this '
            + 'cycle, or the caller has not yet wired the chain), never coerced to NOT_APPLICABLE.',
          brokerAuthority: false,
        };
      }
      const result = generateHoldStrikeCandidates({
        underlying: input.underlying, decisionTimestamp: input.decisionTimestamp,
        ownershipState: input.ownershipState, eventState: input.eventState,
        contracts: input.holdStrikeChain.contracts, maxQuoteAgeMs: input.holdStrikeChain.maxQuoteAgeMs,
        minDte: HOLD_STRIKE.lattice.dteMin, maxDte: HOLD_STRIKE.lattice.dteMax,
        sourceEvidenceIds: input.sourceEvidenceIds,
      });
      return {
        family, branch: 'THETA_HOLD_STRIKE', eligibleThisCycle: true, branchState: 'SHADOW_CANDIDATES_GENERATED',
        holdStrikeResult: result, definedRiskResult: null,
        note: `${result.acceptedCandidates.length} accepted / ${result.rejectedCandidates.length} rejected shadow candidates.`,
        brokerAuthority: false,
      };
    }

    if (family === 'THETA_D') {
      if (!isEligible) {
        return {
          family, branch: 'THETA_DEFINED_RISK', eligibleThisCycle: false, branchState: 'INELIGIBLE_THIS_CYCLE',
          holdStrikeResult: null, definedRiskResult: null,
          note: 'Router marked THETA_D ineligible this cycle -- no shadow candidates generated.',
          brokerAuthority: false,
        };
      }
      if (input.definedRiskChain === null) {
        return {
          family, branch: 'THETA_DEFINED_RISK', eligibleThisCycle: true, branchState: 'MISSING_CHAIN_INPUT',
          holdStrikeResult: null, definedRiskResult: null,
          note: 'THETA_D is eligible this cycle but no definedRiskChain was supplied to the '
            + 'orchestrator -- a real gap, never coerced to NOT_APPLICABLE.',
          brokerAuthority: false,
        };
      }
      const chain = input.definedRiskChain;
      const result = generateDefinedRiskCandidates({
        underlying: input.underlying, decisionTimestamp: input.decisionTimestamp, expiration: chain.expiration,
        dte: chain.dte, shortLegCandidates: chain.shortLegCandidates, longLegCandidates: chain.longLegCandidates,
        quantity: chain.quantity, maxSyncAgeMs: chain.maxSyncAgeMs, maxQuoteAgeMs: chain.maxQuoteAgeMs,
        minDte: DEFINED_RISK.lattice.dteMin, maxDte: DEFINED_RISK.lattice.dteMax,
        minWidth: chain.minWidth, maxWidth: chain.maxWidth,
        requireSynchronizedFreshQuotes: chain.requireSynchronizedFreshQuotes,
        sourceEvidenceIds: input.sourceEvidenceIds,
      });
      return {
        family, branch: 'THETA_DEFINED_RISK', eligibleThisCycle: true, branchState: 'SHADOW_CANDIDATES_GENERATED',
        holdStrikeResult: null, definedRiskResult: result,
        note: `${result.acceptedCandidates.length} accepted / ${result.rejectedCandidates.length} rejected shadow candidates.`,
        brokerAuthority: false,
      };
    }

    // THETA_A, THETA_C, THETA_R -- lifecycle management routes, never given invented candidates here.
    return lifecycleBranch(family, isEligible);
  });

  return {
    orchestratorVersion: shadowStrategyOrchestratorVersion, underlying: input.underlying,
    decisionTimestamp: input.decisionTimestamp, routingSnapshotId: input.routing.snapshotId,
    branchResults, brokerAuthority: false,
  };
}
