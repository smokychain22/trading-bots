import { z } from 'zod';

// Shadow Opportunity Book contract. Every legitimate candidate THETA
// evaluates -- accepted, rejected, WAIT, PASS, AEGIS-rejected, Q=0,
// execution-rejected -- must be recordable in this shape, so the empirical
// engine can later compute OpportunityCaptureRate/TradeRegret/WaitRegret/
// GateRegret/MissedPositiveEV/AvoidedNegativeEV against real recorded
// evidence rather than a reconstructed guess.
//
// This module defines the CONTRACT and an in-memory builder only. It does
// NOT persist anything -- persistence is R2's durable-ledger responsibility
// (PostgreSQL, per this repo's "Redis is not durable financial truth" rule).
// A caller wires this contract to whatever store R2 builds; this file's job
// is to make sure every field that store will need is already named and
// typed before that store exists, so R2 doesn't have to guess the shape.

export const shadowOpportunityBookVersion = 'theta-shadow-opportunity-book-v1' as const;

export const opportunityOutcome = z.enum([
  'ACCEPTED',
  'REJECTED',
  'WAIT',
  'PASS',
  'AEGIS_REJECTED',
  'Q_ZERO',
  'EXECUTION_REJECTED',
]);
export type OpportunityOutcome = z.infer<typeof opportunityOutcome>;

const reasonSchema = z.object({
  code: z.string().min(1),
  polarity: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  detail: z.string().min(1),
});

export const shadowOpportunityEntrySchema = z.object({
  contractVersion: z.literal(shadowOpportunityBookVersion),
  opportunityId: z.string().min(1),
  snapshotId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  underlying: z.string().min(1),
  contractSymbol: z.string().min(1).nullable(), // null for a WAIT/PASS with no specific contract yet identified
  strategyBranch: z.string().min(1).nullable(), // e.g. THETA_CONVENTIONAL / THETA_HOLD_STRIKE, null if not yet routed

  // Economics (all nullable -- UNKNOWN propagates, never zero)
  evNet: z.number().finite().nullable(),
  tailAdjustedEv: z.number().finite().nullable(),
  returnPerCapitalDay: z.number().finite().nullable(),
  capitalRequired: z.number().finite().nullable(),
  uncertainty: z.number().min(0).max(1).nullable(),

  // Upstream model outputs referenced by id/version, not duplicated inline
  // (one source of truth: the ownership/regime contracts themselves)
  ownershipSnapshotId: z.string().min(1).nullable(),
  regimeSnapshotId: z.string().min(1).nullable(),
  aegisState: z.enum(['ALLOW_FULL', 'ALLOW_REDUCED', 'DEFINED_RISK_ONLY', 'HOLD_ONLY', 'HARD_VETO']).nullable(),

  recommendedQuantity: z.number().int().nonnegative().nullable(),
  executionQualityAcceptable: z.boolean().nullable(),

  outcome: opportunityOutcome,
  waitReason: z.enum(['WAIT_PRICE', 'WAIT_VOL', 'WAIT_LIQUIDITY', 'WAIT_EVENT', 'WAIT_REGIME']).nullable(),
  rejectionCategory: z.string().min(1).nullable(),
  reasons: z.array(reasonSchema),

  policyVersion: z.string().min(1),
  modelVersions: z.record(z.string(), z.string().min(1)),

  // Nullable until an empirical engine can causally reconstruct it (R6) --
  // never populated with a guess in the meantime.
  eventualOutcomeKnown: z.boolean(),
  eventualRealizedPnl: z.number().finite().nullable(),
}).superRefine((entry, context) => {
  if (entry.outcome === 'WAIT' && entry.waitReason === null) {
    context.addIssue({ code: 'custom', message: 'a WAIT entry must carry a specific waitReason -- never a generic WAIT' });
  }
  if (entry.outcome !== 'WAIT' && entry.waitReason !== null) {
    context.addIssue({ code: 'custom', message: 'waitReason is only meaningful for outcome=WAIT' });
  }
  if (entry.outcome === 'Q_ZERO' && entry.recommendedQuantity !== 0) {
    context.addIssue({ code: 'custom', message: 'Q_ZERO outcome must carry recommendedQuantity=0' });
  }
  if (!entry.eventualOutcomeKnown && entry.eventualRealizedPnl !== null) {
    context.addIssue({ code: 'custom', message: 'eventualRealizedPnl must be null until eventualOutcomeKnown is true' });
  }
});

export type ShadowOpportunityEntry = z.infer<typeof shadowOpportunityEntrySchema>;

export function parseShadowOpportunityEntry(payload: unknown): ShadowOpportunityEntry {
  return shadowOpportunityEntrySchema.parse(payload);
}

/**
 * In-memory book builder: validates and collects entries for one decision
 * cycle. This is NOT a persistence layer -- callers must hand `entries` to
 * R2's durable store once it exists. Kept intentionally dumb (no side
 * effects) so it has no opinion about how/where entries end up stored.
 */
export class ShadowOpportunityBookBuilder {
  private readonly entries: ShadowOpportunityEntry[] = [];

  record(entry: unknown): ShadowOpportunityEntry {
    const parsed = parseShadowOpportunityEntry(entry);
    this.entries.push(parsed);
    return parsed;
  }

  all(): readonly ShadowOpportunityEntry[] {
    return this.entries;
  }

  countByOutcome(): Record<OpportunityOutcome, number> {
    const counts: Record<OpportunityOutcome, number> = {
      ACCEPTED: 0, REJECTED: 0, WAIT: 0, PASS: 0, AEGIS_REJECTED: 0, Q_ZERO: 0, EXECUTION_REJECTED: 0,
    };
    for (const entry of this.entries) {
      counts[entry.outcome] += 1;
    }
    return counts;
  }
}
