import { z } from 'zod';
import type { ManagementCycleResult } from './management-cycle.js';

// R1H item L: wires every management evaluation (K1-K4: CSP leg,
// assignment, stock recovery, covered call) into the same
// observation/evaluation discipline shadow-opportunity-book.ts already
// established for NEW-risk candidates -- every feasible alternative,
// the selected alternative, every rejected alternative, its utility,
// reasons, AEGIS outcome, execution-quality outcome, lifecycle state,
// snapshot linkage, and policy/model versions, all recorded so a later
// empirical engine can compute ManagementRegret / OpportunityRegret /
// AvoidedLoss / MissedRecovery / RollVsHoldRegret / CallAwayEconomics
// against real recorded evidence -- never a reconstructed guess.
//
// Like shadow-opportunity-book.ts, this module defines the CONTRACT and
// an in-memory builder only. It does not persist anything -- persistence
// is R1H item M's durable-ledger responsibility (interfaces only here;
// Codex owns the production schema/migration).

export const managementOpportunityBookVersion = 'theta-management-opportunity-book-v1' as const;

const reasonCodeSchema = z.string().min(1);

export const managementAlternativeSchema = z.object({
  label: z.string().min(1), // e.g. "HOLD", "CLOSE", "ROLL", "ACCEPT_ASSIGNMENT", "SELL_CC@55/20"
  feasible: z.boolean(),
  utility: z.number().finite().nullable(), // UNKNOWN propagates as null, never coerced to 0 or "worst"
  selected: z.boolean(),
  reasonCodes: z.array(reasonCodeSchema),
});
export type ManagementAlternative = z.infer<typeof managementAlternativeSchema>;

export const managementRouteSchema = z.enum([
  'SHORT_PUT', 'ASSIGNMENT_PENDING', 'STOCK_RECOVERY', 'COVERED_CALL', 'CLOSED', 'UNKNOWN',
]);

export const managementOpportunityEntrySchema = z.object({
  contractVersion: z.literal(managementOpportunityBookVersion),
  entryId: z.string().min(1),
  snapshotId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  chainId: z.string().min(1),
  lifecycleState: z.string().min(1),
  route: managementRouteSchema,

  alternatives: z.array(managementAlternativeSchema),
  selectedLabel: z.string().min(1).nullable(), // null only when route produced no evaluation at all (CLOSED/no-op, or fail-closed)

  aegisState: z.enum(['ALLOW_FULL', 'ALLOW_REDUCED', 'DEFINED_RISK_ONLY', 'HOLD_ONLY', 'HARD_VETO']).nullable(),
  executionQualityAcceptable: z.boolean().nullable(),

  // Inputs the underlying evaluation could not resolve (e.g.
  // "currentAskPerShare", "pSevereDrawdown") -- recorded explicitly so a
  // later regret analysis can distinguish "we chose HOLD because it was
  // genuinely best" from "we chose HOLD because required inputs were
  // UNKNOWN," which are very different for OpportunityRegret purposes.
  unknownInputReasonCodes: z.array(reasonCodeSchema),

  policyVersion: z.string().min(1),
  modelVersions: z.record(z.string(), z.string().min(1)),

  failClosedReason: z.string().min(1).nullable(),

  // Nullable until an empirical engine can causally reconstruct it --
  // never populated with a guess in the meantime.
  eventualOutcomeKnown: z.boolean(),
  eventualRealizedPnl: z.number().finite().nullable(),
}).superRefine((entry, context) => {
  if (entry.selectedLabel !== null) {
    const selectedCount = entry.alternatives.filter((a) => a.selected).length;
    if (selectedCount !== 1) {
      context.addIssue({ code: 'custom', message: 'exactly one alternative must be marked selected when selectedLabel is set' });
    }
  }
  if (!entry.eventualOutcomeKnown && entry.eventualRealizedPnl !== null) {
    context.addIssue({ code: 'custom', message: 'eventualRealizedPnl must be null until eventualOutcomeKnown is true' });
  }
});

export type ManagementOpportunityEntry = z.infer<typeof managementOpportunityEntrySchema>;

export function parseManagementOpportunityEntry(payload: unknown): ManagementOpportunityEntry {
  return managementOpportunityEntrySchema.parse(payload);
}

const UNKNOWN_INPUT_REASON_PREFIXES = [
  'UNKNOWN', 'CAPACITY_UNKNOWN', 'QUOTE_UNKNOWN', 'REGRET_UNKNOWN', 'FORWARD_VALUE_UNKNOWN', 'TAIL_RISK_UNKNOWN',
];

const isUnknownInputReason = (code: string): boolean =>
  UNKNOWN_INPUT_REASON_PREFIXES.some((needle) => code.includes(needle));

/**
 * Builds one ManagementOpportunityEntry from a single chain's
 * ManagementCycleResult (management-cycle.ts). Pure translation -- no new
 * economics, only reshaping whichever branch of the discriminated result
 * is populated into the uniform alternatives/selected/reasons shape this
 * book records.
 */
export function buildManagementOpportunityEntry(
  result: ManagementCycleResult,
  policyVersion: string,
  modelVersions: Readonly<Record<string, string>>,
): ManagementOpportunityEntry {
  const entryId = `${result.chainId}:${result.route}`;
  let alternatives: ManagementAlternative[] = [];
  let selectedLabel: string | null = null;
  let aegisState: ManagementOpportunityEntry['aegisState'] = null;
  let executionQualityAcceptable: boolean | null = null;
  let snapshotId = 'unknown-snapshot';
  let timestamp = new Date().toISOString();

  if (result.shortPut !== null) {
    const receipt = result.shortPut;
    snapshotId = receipt.snapshotId;
    timestamp = receipt.timestamp;
    selectedLabel = receipt.selectedAction;
    aegisState = receipt.aegisState;
    executionQualityAcceptable = receipt.executionRecommendedAction === null ? null : receipt.executionRecommendedAction === 'SUBMIT';
    alternatives = receipt.valuations.map((v) => ({
      label: v.action, feasible: v.feasible, utility: v.utility,
      selected: v.action === receipt.selectedAction, reasonCodes: v.reasons.map((r) => r.code),
    }));
  } else if (result.assignmentPending !== null) {
    const receipt = result.assignmentPending;
    snapshotId = receipt.snapshotId;
    timestamp = receipt.timestamp;
    selectedLabel = receipt.recommendation === 'UNKNOWN' ? null : receipt.recommendation;
    alternatives = [
      { label: 'ACCEPT_ASSIGNMENT', feasible: receipt.recommendation !== 'UNKNOWN', utility: receipt.mechanicalCloseRealizedPnl, selected: receipt.recommendation === 'ACCEPT_ASSIGNMENT', reasonCodes: receipt.reasonCodes.slice() },
      { label: 'CLOSE_STOCK', feasible: receipt.recommendation !== 'UNKNOWN', utility: receipt.mechanicalCloseRealizedPnl, selected: receipt.recommendation === 'CLOSE_STOCK', reasonCodes: receipt.reasonCodes.slice() },
    ];
  } else if (result.stockRecovery !== null) {
    const receipt = result.stockRecovery;
    snapshotId = receipt.snapshotId;
    timestamp = receipt.timestamp;
    selectedLabel = receipt.action;
    alternatives = [
      { label: 'RECOVERY_WAIT', feasible: true, utility: null, selected: receipt.action === 'RECOVERY_WAIT', reasonCodes: receipt.reasonCodes.slice() },
      { label: 'SELL_STOCK', feasible: true, utility: null, selected: receipt.action === 'SELL_STOCK', reasonCodes: receipt.reasonCodes.slice() },
      {
        label: receipt.coveredCallDecision?.selectedLabel ?? 'SELL_CC',
        feasible: receipt.coveredCallDecision !== null,
        utility: receipt.coveredCallDecision?.utility ?? null,
        selected: receipt.action === 'SELL_CC',
        reasonCodes: receipt.reasonCodes.slice(),
      },
    ];
  } else if (result.coveredCall !== null) {
    const receipt = result.coveredCall.underlying;
    snapshotId = receipt.snapshotId;
    timestamp = receipt.timestamp;
    selectedLabel = result.coveredCall.coveredCallAction;
    aegisState = receipt.aegisState;
    executionQualityAcceptable = receipt.executionRecommendedAction === null ? null : receipt.executionRecommendedAction === 'SUBMIT';
    alternatives = receipt.valuations.map((v) => ({
      label: v.action, feasible: v.feasible, utility: v.utility,
      selected: v.action === receipt.selectedAction, reasonCodes: v.reasons.map((r) => r.code),
    }));
  }

  const allReasonCodes = alternatives.flatMap((a) => a.reasonCodes);
  const unknownInputReasonCodes = Array.from(new Set(allReasonCodes.filter(isUnknownInputReason)));

  return {
    contractVersion: managementOpportunityBookVersion,
    entryId,
    snapshotId,
    timestamp,
    chainId: result.chainId,
    lifecycleState: result.lifecycleState,
    route: result.route,
    alternatives,
    selectedLabel,
    aegisState,
    executionQualityAcceptable,
    unknownInputReasonCodes,
    policyVersion,
    modelVersions,
    failClosedReason: result.failClosedReason,
    eventualOutcomeKnown: false,
    eventualRealizedPnl: null,
  };
}

/**
 * In-memory book builder, mirroring ShadowOpportunityBookBuilder's own
 * discipline: validates and collects entries for one management cycle.
 * NOT a persistence layer -- callers hand `entries` to R1H item M's
 * durable store once Codex builds it.
 */
export class ManagementOpportunityBookBuilder {
  private readonly entries: ManagementOpportunityEntry[] = [];

  record(entry: unknown): ManagementOpportunityEntry {
    const parsed = parseManagementOpportunityEntry(entry);
    this.entries.push(parsed);
    return parsed;
  }

  recordFromCycleResult(
    result: ManagementCycleResult,
    policyVersion: string,
    modelVersions: Readonly<Record<string, string>>,
  ): ManagementOpportunityEntry {
    return this.record(buildManagementOpportunityEntry(result, policyVersion, modelVersions));
  }

  all(): readonly ManagementOpportunityEntry[] {
    return this.entries;
  }

  countByRoute(): Record<z.infer<typeof managementRouteSchema>, number> {
    const counts: Record<z.infer<typeof managementRouteSchema>, number> = {
      SHORT_PUT: 0, ASSIGNMENT_PENDING: 0, STOCK_RECOVERY: 0, COVERED_CALL: 0, CLOSED: 0, UNKNOWN: 0,
    };
    for (const entry of this.entries) {
      counts[entry.route] += 1;
    }
    return counts;
  }
}
