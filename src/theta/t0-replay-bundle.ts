import { z } from 'zod';
import { buildCanonicalStrategyFrontier, type CanonicalStrategyFrontier, type CanonicalStrategyFrontierInput } from './canonical-strategy-frontier.js';
import { jsonValueSchema } from '../market/fusion-snapshot.js';
import { normalizedOptionContractSchema } from './option-contract.js';
import { strategyRoutingResponseSchema } from './strategy-router-contract.js';

// Phase 1 Zero-Unknown Reclosure Pass 3 continuation (items 17-25). Real
// exhaustive T0 source search for the Sep24 episode
// (no-submit-7981e31e-367c-49f6-99b7-f6b2de657e27) found NINE real spool
// payload types for that exact decision cycle (ACCOUNT_READY x2,
// CONTRACTS_READY, QUOTES_READY, Q_READY, AEGIS_READY, SIZING_READY,
// DECISION_READY, PLAN_READY -- every payload verified present in
// .theta-local-worker/evidence-spool/theta-evidence.sqlite's `envelope`
// table). Postgres was unreachable that whole day (postgres_state:
// SPOOLED_LOCAL_PENDING_DB), so no richer relational PIT evidence exists
// there either. Every one of those nine payloads is a deliberately coarse,
// sanitized SUMMARY (by design -- this spool is written knowing the
// repository may be public) -- none contains the raw
// CanonicalStrategyFrontierInput fields buildCanonicalStrategyFrontier
// actually requires (real option contracts with strikes/greeks/quotes, the
// real StrategyRoutingResponse, the real optionomicsContext payload). This
// is a genuine, evidenced NOT_RECONSTRUCTABLE_FROM_PERSISTED_T0 finding for
// that specific historical episode -- not a search that was cut short.
//
// This module is the fix so the gap cannot recur: a bounded, OPT-IN replay
// bundle capturing exactly buildCanonicalStrategyFrontier's real inputs,
// reusing the exact same LocalEvidenceSpool envelope mechanism (a new
// payload type, 'T0_REPLAY_BUNDLE' -- no schema change) rather than a
// second persistence system. Building and testing this module is the
// concrete deliverable; wiring a spoolEvidence('T0_REPLAY_BUNDLE', ...)
// call into tools/theta-no-submit-probe.ts's real per-symbol loop is the
// next, obvious step once this exists, and is called out explicitly in the
// Codex handoff rather than done silently here.
export const t0ReplayBundlePayloadType = 'T0_REPLAY_BUNDLE' as const;
export const t0ReplayBundleContractVersion = 'theta-t0-replay-bundle-v2' as const;

const aegisStateSchema = z.enum([
  'ALLOW_FULL', 'ALLOW_REDUCED', 'HOLD_ONLY', 'HARD_VETO', 'DEFINED_RISK_ONLY', 'EMERGENCY_EXIT_ONLY',
]).nullable();

const entryEligibilitySchema = z.object({
  basis: z.enum(['EMPIRICAL_OWNERSHIP', 'PAPER_ENTRY_BOOTSTRAP_UNCALIBRATED', 'INELIGIBLE']),
  paperBootstrapPolicyVersion: z.string().nullable(),
  paperBootstrapAllowedUnknownComponents: z.array(z.string()),
  paperBootstrapReasonCodes: z.array(z.string()),
});

const thetaQCandidateEvaluationSchema = z.object({
  state: z.enum(['EVALUATED_FEASIBLE', 'EVALUATED_INFEASIBLE', 'NOT_SENT_UPSTREAM_REJECT', 'RESPONSE_GAP']),
  reasonCode: z.string().nullable(),
});

const thetaQDecisionSchema = z.object({
  snapshotId: z.string().min(1),
  timestamp: z.string().min(1),
  underlying: z.string().min(1),
  winningAction: z.enum([
    'OPEN_FULL', 'OPEN_REDUCED', 'OPEN_ALTERNATE_CONTRACT', 'OPEN_ALTERNATE_EXPIRY',
    'OPEN_ALTERNATE_STRUCTURE', 'WAIT', 'PASS', 'SYSTEM_HOLD', 'HARD_VETO',
  ]),
  selectedCandidateId: z.string().nullable(),
  quantity: z.number().int().nonnegative(),
});

const stockSchema = z.object({
  underlying: z.string().min(1), shares: z.number().nullable(), currentPrice: z.number().nullable(),
  brokerCostBasisPerShare: z.number().nullable(), wholeChainEconomicBasisPerShare: z.number().nullable(),
}).nullable();

const optionalQuantityCap = z.number().int().nonnegative().nullable().optional();
export const canonicalSizingPolicySchema = z.object({
  policyVersion: z.string().min(1).optional(),
  riskBudgetQtyCap: optionalQuantityCap,
  collateralQtyCap: optionalQuantityCap,
  concentrationQtyCap: optionalQuantityCap,
  assignmentCapacityQtyCap: optionalQuantityCap,
  tailRiskQtyCap: optionalQuantityCap,
  correlationQtyCap: optionalQuantityCap,
  liquidityQtyCap: optionalQuantityCap,
  reducedStateMultiplier: z.number().finite().min(0).max(1).nullable().optional(),
}).strict();

export const t0ReplayBundleSchema = z.object({
  contractVersion: z.literal(t0ReplayBundleContractVersion),
  snapshotId: z.string().min(1),
  timestamp: z.string().min(1),
  strategyVersion: z.string().min(1),
  expectedFrontierContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  contracts: normalizedOptionContractSchema.array(),
  routing: strategyRoutingResponseSchema.nullable(),
  stock: stockSchema,
  assignmentCapacityQty: z.number().nullable(),
  buyingPower: z.number().nullable().optional(),
  brokerAllowedQty: z.number().int().nonnegative().optional(),
  brokerAllowedQtyByCandidateId: z.record(z.string(), z.number().int().nonnegative()).optional(),
  sizingPolicy: canonicalSizingPolicySchema.optional(),
  aegisNewRiskState: aegisStateSchema,
  aegisNewRiskStateByCandidateId: z.record(z.string(), aegisStateSchema).optional(),
  aegisBindingReasonsByCandidateId: z.record(z.string(), z.array(z.string())).optional(),
  eventState: z.string().nullable(),
  unmanagedBrokerPositionCount: z.number(),
  unevaluatedUnderlyingCount: z.number(),
  optionomicsContext: jsonValueSchema,
  entryEligibilityByOptionSymbol: z.record(z.string(), entryEligibilitySchema).optional(),
  thetaQCandidateEvaluationByOptionSymbol: z.record(z.string(), thetaQCandidateEvaluationSchema).optional(),
  thetaQDecision: thetaQDecisionSchema.optional(),
  optionsApprovedLevel: z.number().nullable().optional(),
  optionsTradingLevel: z.number().nullable().optional(),
}).strict().superRefine((bundle, context) => {
  const decisionAt = Date.parse(bundle.timestamp);
  if (!Number.isFinite(decisionAt)) return;
  bundle.contracts.forEach((contract, index) => {
    for (const [field, value] of [['receivedAt', contract.receivedAt], ['quoteTimestamp', contract.quoteTimestamp],
      ['tradeTimestamp', contract.tradeTimestamp], ['greeksTimestamp', contract.greeksTimestamp],
      ['underlyingTimestamp', contract.underlyingTimestamp], ['underlyingQuoteReceivedAt', contract.underlyingQuoteReceivedAt]] as const) {
      if (value !== null && value !== undefined && Date.parse(value) > decisionAt) {
        context.addIssue({ code: 'custom', path: ['contracts', index, field], message: 'future evidence cannot enter a T0 replay bundle' });
      }
    }
  });
  if (bundle.routing !== null && (bundle.routing.snapshotId !== bundle.snapshotId || bundle.routing.timestamp !== bundle.timestamp)) {
    context.addIssue({ code: 'custom', path: ['routing'], message: 'routing identity must match the frozen T0 snapshot' });
  }
});

export type T0ReplayBundle = z.infer<typeof t0ReplayBundleSchema>;

// A single underlying's contract universe is inherently bounded (this
// repo's own MAX_PROJECTION_BYTES pattern, reused here at a size the
// existing canonical-frontier projection guard already treats as safe).
const maxBundleBytes = 4 * 1024 * 1024;

export type T0ReplayBundleBuildFailure =
  | { readonly reason: 'TOO_LARGE'; readonly byteSize: number }
  | { readonly reason: 'BUILD_FAILED'; readonly byteSize: null };

/** Classifies a buildT0ReplayBundle() failure into an explicit, deterministic
 * shape -- never a silent evidence gap (item 5). Exported so both the real
 * caller (tools/theta-no-submit-probe.ts) and its tests use the identical
 * classification, not two copies of the same regex. */
export function classifyT0ReplayBundleBuildError(error: unknown): T0ReplayBundleBuildFailure {
  const message = error instanceof Error ? error.message : 'T0_REPLAY_BUNDLE_BUILD_FAILED';
  const tooLarge = /^T0_REPLAY_BUNDLE_TOO_LARGE:(\d+)$/.exec(message);
  return tooLarge !== null ? { reason: 'TOO_LARGE', byteSize: Number(tooLarge[1]) } : { reason: 'BUILD_FAILED', byteSize: null };
}

export function buildT0ReplayBundle(input: CanonicalStrategyFrontierInput): T0ReplayBundle {
  const expectedFrontierContentHash = buildCanonicalStrategyFrontier(input).contentHash;
  const bundle: T0ReplayBundle = {
    contractVersion: t0ReplayBundleContractVersion,
    snapshotId: input.snapshotId, timestamp: input.timestamp, strategyVersion: input.strategyVersion,
    expectedFrontierContentHash,
    contracts: [...input.contracts], routing: input.routing, stock: input.stock,
    assignmentCapacityQty: input.assignmentCapacityQty, buyingPower: input.buyingPower ?? null,
    brokerAllowedQty: input.brokerAllowedQty,
    brokerAllowedQtyByCandidateId: input.brokerAllowedQtyByCandidateId,
    sizingPolicy: input.sizingPolicy,
    aegisNewRiskState: input.aegisNewRiskState, eventState: input.eventState,
    aegisNewRiskStateByCandidateId: input.aegisNewRiskStateByCandidateId,
    aegisBindingReasonsByCandidateId: input.aegisBindingReasonsByCandidateId === undefined ? undefined
      : Object.fromEntries(Object.entries(input.aegisBindingReasonsByCandidateId)
        .map(([candidateId, reasons]) => [candidateId, [...reasons]])),
    unmanagedBrokerPositionCount: input.unmanagedBrokerPositionCount,
    unevaluatedUnderlyingCount: input.unevaluatedUnderlyingCount,
    optionomicsContext: input.optionomicsContext,
    entryEligibilityByOptionSymbol: input.entryEligibilityByOptionSymbol === undefined ? undefined
      : Object.fromEntries(Object.entries(input.entryEligibilityByOptionSymbol).map(([symbol, evidence]) => [symbol, {
        ...evidence,
        paperBootstrapAllowedUnknownComponents: [...evidence.paperBootstrapAllowedUnknownComponents],
        paperBootstrapReasonCodes: [...evidence.paperBootstrapReasonCodes],
      }])),
    thetaQCandidateEvaluationByOptionSymbol: input.thetaQCandidateEvaluationByOptionSymbol,
    thetaQDecision: input.thetaQDecision,
    optionsApprovedLevel: input.optionsApprovedLevel ?? null, optionsTradingLevel: input.optionsTradingLevel ?? null,
  };
  const parsed = t0ReplayBundleSchema.parse(bundle);
  const bytes = Buffer.byteLength(JSON.stringify(parsed));
  if (bytes > maxBundleBytes) throw new Error(`T0_REPLAY_BUNDLE_TOO_LARGE:${bytes}`);
  return parsed;
}

/**
 * The real replay itself (item 22's strict definition): reconstructs the
 * real CanonicalStrategyFrontierInput from persisted T0 state and calls
 * the SAME production function, buildCanonicalStrategyFrontier -- zero
 * provider calls, zero mocked decision logic, never deriveRealCurrentWorkerEvidence
 * or a manifest re-check standing in for this.
 */
export function replayFromT0Bundle(bundle: T0ReplayBundle): CanonicalStrategyFrontier {
  const parsed = t0ReplayBundleSchema.parse(bundle);
  const replayInput: CanonicalStrategyFrontierInput = {
    snapshotId: parsed.snapshotId, timestamp: parsed.timestamp, strategyVersion: parsed.strategyVersion,
    contracts: parsed.contracts, routing: parsed.routing, stock: parsed.stock,
    assignmentCapacityQty: parsed.assignmentCapacityQty, buyingPower: parsed.buyingPower ?? null,
    brokerAllowedQty: parsed.brokerAllowedQty,
    brokerAllowedQtyByCandidateId: parsed.brokerAllowedQtyByCandidateId,
    sizingPolicy: parsed.sizingPolicy,
    aegisNewRiskState: parsed.aegisNewRiskState, eventState: parsed.eventState,
    aegisNewRiskStateByCandidateId: parsed.aegisNewRiskStateByCandidateId,
    aegisBindingReasonsByCandidateId: parsed.aegisBindingReasonsByCandidateId,
    unmanagedBrokerPositionCount: parsed.unmanagedBrokerPositionCount,
    unevaluatedUnderlyingCount: parsed.unevaluatedUnderlyingCount,
    optionomicsContext: parsed.optionomicsContext,
    entryEligibilityByOptionSymbol: parsed.entryEligibilityByOptionSymbol,
    thetaQCandidateEvaluationByOptionSymbol: parsed.thetaQCandidateEvaluationByOptionSymbol,
    thetaQDecision: parsed.thetaQDecision,
    optionsApprovedLevel: parsed.optionsApprovedLevel ?? null, optionsTradingLevel: parsed.optionsTradingLevel ?? null,
  };
  const replayed = buildCanonicalStrategyFrontier(replayInput);
  if (replayed.contentHash !== parsed.expectedFrontierContentHash) {
    throw new Error(`T0_REPLAY_FRONTIER_HASH_MISMATCH:${parsed.expectedFrontierContentHash}:${replayed.contentHash}`);
  }
  return replayed;
}
