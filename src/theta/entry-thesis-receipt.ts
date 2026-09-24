import { createHash } from 'node:crypto';

export const entryThesisReceiptVersion = 'theta-entry-thesis-receipt-v1' as const;
export type ThesisEvidenceState = 'KNOWN' | 'UNKNOWN' | 'EMPIRICALLY_UNPROVEN' | 'NOT_APPLICABLE';

export interface ThesisClaim {
  readonly state: ThesisEvidenceState;
  readonly statement: string;
  readonly evidenceIds: readonly string[];
}

export interface EntryThesisReceipt {
  readonly contractVersion: typeof entryThesisReceiptVersion;
  readonly decisionId: string;
  readonly snapshotId: string;
  readonly candidateId: string;
  readonly decisionAt: string;
  readonly underlying: string;
  readonly strategy: 'THETA_CONVENTIONAL';
  readonly whyUnderlying: ThesisClaim;
  readonly whyStrategy: ThesisClaim;
  readonly whyExpiry: ThesisClaim;
  readonly whyStrike: ThesisClaim;
  readonly whyNow: ThesisClaim;
  readonly volatilityThesis: ThesisClaim;
  readonly directionalTolerance: ThesisClaim;
  readonly eventAssumptions: ThesisClaim;
  readonly breakEven: number;
  readonly downsideCushion: number;
  readonly assignmentWillingness: ThesisClaim;
  readonly expectedManagementPath: ThesisClaim;
  readonly expectedCapitalDays: { readonly value: number | null; readonly state: 'KNOWN' | 'EMPIRICALLY_UNPROVEN' };
  readonly invalidationConditions: readonly string[];
  readonly empiricalProfitabilityState: 'UNPROVEN';
  readonly executionAuthorized: false;
  readonly immutableHash: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

function validateClaim(name: string, claim: ThesisClaim): void {
  if (claim.statement.trim().length === 0) throw new Error(`ENTRY_THESIS_EMPTY_CLAIM:${name}`);
  if (claim.state === 'KNOWN' && claim.evidenceIds.length === 0) throw new Error(`ENTRY_THESIS_KNOWN_WITHOUT_EVIDENCE:${name}`);
}

/**
 * Builds immutable entry-state evidence. It records the thesis that existed at
 * decision time and cannot be rewritten by later management outcomes. This is
 * explanatory lineage, never a profitability model or execution authority.
 */
export function buildEntryThesisReceipt(
  input: Omit<EntryThesisReceipt, 'contractVersion' | 'empiricalProfitabilityState' | 'executionAuthorized' | 'immutableHash'>,
): EntryThesisReceipt {
  if (!Number.isFinite(Date.parse(input.decisionAt))) throw new Error('ENTRY_THESIS_DECISION_AT_INVALID');
  if (!Number.isFinite(input.breakEven) || input.breakEven <= 0) throw new Error('ENTRY_THESIS_BREAK_EVEN_INVALID');
  if (!Number.isFinite(input.downsideCushion)) throw new Error('ENTRY_THESIS_DOWNSIDE_CUSHION_INVALID');
  if (input.expectedCapitalDays.state === 'KNOWN'
    && (input.expectedCapitalDays.value === null || !Number.isFinite(input.expectedCapitalDays.value)
      || input.expectedCapitalDays.value < 0)) throw new Error('ENTRY_THESIS_CAPITAL_DAYS_INVALID');
  if (input.expectedCapitalDays.state === 'EMPIRICALLY_UNPROVEN' && input.expectedCapitalDays.value !== null) {
    throw new Error('ENTRY_THESIS_UNPROVEN_CAPITAL_DAYS_MUST_BE_NULL');
  }
  for (const [name, claim] of Object.entries({
    whyUnderlying: input.whyUnderlying, whyStrategy: input.whyStrategy, whyExpiry: input.whyExpiry,
    whyStrike: input.whyStrike, whyNow: input.whyNow, volatilityThesis: input.volatilityThesis,
    directionalTolerance: input.directionalTolerance, eventAssumptions: input.eventAssumptions,
    assignmentWillingness: input.assignmentWillingness, expectedManagementPath: input.expectedManagementPath,
  })) validateClaim(name, claim);
  if (input.invalidationConditions.length === 0) throw new Error('ENTRY_THESIS_INVALIDATION_CONDITIONS_REQUIRED');
  const payload = {
    contractVersion: entryThesisReceiptVersion, ...input,
    empiricalProfitabilityState: 'UNPROVEN' as const, executionAuthorized: false as const,
  };
  return { ...payload, immutableHash: createHash('sha256').update(canonicalJson(payload)).digest('hex') };
}
