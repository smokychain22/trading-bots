import { z } from 'zod';
import { buildCanonicalStrategyFrontier, type CanonicalStrategyFrontier, type CanonicalStrategyFrontierInput } from './canonical-strategy-frontier.js';
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
export const t0ReplayBundleContractVersion = 'theta-t0-replay-bundle-v1' as const;

const stockSchema = z.object({
  underlying: z.string().min(1), shares: z.number().nullable(), currentPrice: z.number().nullable(),
  brokerCostBasisPerShare: z.number().nullable(), wholeChainEconomicBasisPerShare: z.number().nullable(),
}).nullable();

export const t0ReplayBundleSchema = z.object({
  contractVersion: z.literal(t0ReplayBundleContractVersion),
  snapshotId: z.string().min(1),
  timestamp: z.string().min(1),
  strategyVersion: z.string().min(1),
  contracts: normalizedOptionContractSchema.array(),
  routing: strategyRoutingResponseSchema.nullable(),
  stock: stockSchema,
  assignmentCapacityQty: z.number().nullable(),
  buyingPower: z.number().nullable().optional(),
  aegisNewRiskState: z.enum(['ALLOW_FULL', 'ALLOW_REDUCED', 'HOLD_ONLY', 'HARD_VETO', 'DEFINED_RISK_ONLY', 'EMERGENCY_EXIT_ONLY']).nullable(),
  eventState: z.string().nullable(),
  unmanagedBrokerPositionCount: z.number(),
  unevaluatedUnderlyingCount: z.number(),
  optionomicsContext: z.unknown(),
  optionsApprovedLevel: z.number().nullable().optional(),
  optionsTradingLevel: z.number().nullable().optional(),
});

export type T0ReplayBundle = z.infer<typeof t0ReplayBundleSchema>;

// A single underlying's contract universe is inherently bounded (this
// repo's own MAX_PROJECTION_BYTES pattern, reused here at a size the
// existing canonical-frontier projection guard already treats as safe).
const maxBundleBytes = 4 * 1024 * 1024;

export function buildT0ReplayBundle(input: CanonicalStrategyFrontierInput): T0ReplayBundle {
  const bundle: T0ReplayBundle = {
    contractVersion: t0ReplayBundleContractVersion,
    snapshotId: input.snapshotId, timestamp: input.timestamp, strategyVersion: input.strategyVersion,
    contracts: [...input.contracts], routing: input.routing, stock: input.stock,
    assignmentCapacityQty: input.assignmentCapacityQty, buyingPower: input.buyingPower ?? null,
    aegisNewRiskState: input.aegisNewRiskState, eventState: input.eventState,
    unmanagedBrokerPositionCount: input.unmanagedBrokerPositionCount,
    unevaluatedUnderlyingCount: input.unevaluatedUnderlyingCount,
    optionomicsContext: input.optionomicsContext,
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
    aegisNewRiskState: parsed.aegisNewRiskState, eventState: parsed.eventState,
    unmanagedBrokerPositionCount: parsed.unmanagedBrokerPositionCount,
    unevaluatedUnderlyingCount: parsed.unevaluatedUnderlyingCount,
    optionomicsContext: parsed.optionomicsContext as CanonicalStrategyFrontierInput['optionomicsContext'],
    optionsApprovedLevel: parsed.optionsApprovedLevel ?? null, optionsTradingLevel: parsed.optionsTradingLevel ?? null,
  };
  return buildCanonicalStrategyFrontier(replayInput);
}
