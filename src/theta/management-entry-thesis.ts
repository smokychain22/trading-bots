import { z } from 'zod';
import { buildEntryThesisReceipt, entryThesisReceiptVersion, type EntryThesisReceipt } from './entry-thesis-receipt.js';

const claim = z.object({ state: z.enum(['KNOWN', 'UNKNOWN', 'EMPIRICALLY_UNPROVEN', 'NOT_APPLICABLE']),
  statement: z.string().trim().min(1), evidenceIds: z.array(z.string().min(1)) }).strict();
const schema = z.object({
  contractVersion: z.literal(entryThesisReceiptVersion), decisionId: z.string().min(1), snapshotId: z.string().min(1),
  candidateId: z.string().min(1), decisionAt: z.string(), underlying: z.string().min(1),
  strategy: z.enum(['THETA_CONVENTIONAL','THETA_HOLD_STRIKE']),
  whyUnderlying: claim, whyStrategy: claim, whyExpiry: claim, whyStrike: claim, whyNow: claim, quantityReason: claim,
  volatilityThesis: claim, directionalTolerance: claim, eventAssumptions: claim, assignmentWillingness: claim,
  expectedManagementPath: claim, breakEven: z.number().positive(), downsideCushion: z.number(),
  expectedCapitalDays: z.object({ value: z.number().nullable(), state: z.enum(['KNOWN', 'EMPIRICALLY_UNPROVEN']) }).strict(),
  invalidationConditions: z.array(z.string().min(1)).min(1), empiricalProfitabilityState: z.literal('UNPROVEN'),
  executionAuthorized: z.literal(false), immutableHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export interface ManagementEntryThesis {
  readonly state: 'VERIFIED' | 'UNAVAILABLE' | 'INVALID';
  readonly reason: string | null;
  readonly receipt: EntryThesisReceipt | null;
}

/** Validate the persisted original decision, not a reconstructed or rewritten entry thesis. */
export function loadManagementEntryThesis(value: unknown, binding: {
  readonly decisionId: unknown; readonly snapshotId: unknown; readonly decidedAt: unknown;
  readonly underlying: string; readonly managementAsOf: string;
}): ManagementEntryThesis {
  if (value === null || value === undefined) return { state: 'UNAVAILABLE', reason: 'ORIGINAL_ENTRY_THESIS_UNAVAILABLE', receipt: null };
  const parsed = schema.safeParse(value);
  const invalid = (reason: string): ManagementEntryThesis => ({ state: 'INVALID', reason, receipt: null });
  if (!parsed.success) return invalid('ORIGINAL_ENTRY_THESIS_MALFORMED');
  const receipt = parsed.data;
  const decisionAt = Date.parse(receipt.decisionAt), asOf = Date.parse(binding.managementAsOf);
  const storedAt = binding.decidedAt instanceof Date ? binding.decidedAt.getTime()
    : typeof binding.decidedAt === 'string' ? Date.parse(binding.decidedAt) : NaN;
  if (receipt.decisionId !== binding.decisionId || receipt.snapshotId !== binding.snapshotId
    || receipt.underlying !== binding.underlying || !Number.isFinite(storedAt) || storedAt !== decisionAt)
    return invalid('ORIGINAL_ENTRY_THESIS_IDENTITY_MISMATCH');
  if (!Number.isFinite(decisionAt) || !Number.isFinite(asOf) || decisionAt > asOf)
    return invalid('ORIGINAL_ENTRY_THESIS_PIT_INVALID');
  try {
    // Building validates semantic constraints as well as reproducing the original hash.
    // Remove envelope-only fields before reproducing the original hash.
    const input: { -readonly [Key in keyof EntryThesisReceipt]?: EntryThesisReceipt[Key] } = { ...receipt };
    delete input.contractVersion;
    delete input.empiricalProfitabilityState;
    delete input.executionAuthorized;
    delete input.immutableHash;
    if (buildEntryThesisReceipt(input as Parameters<typeof buildEntryThesisReceipt>[0]).immutableHash !== receipt.immutableHash)
      return invalid('ORIGINAL_ENTRY_THESIS_HASH_MISMATCH');
  } catch { return invalid('ORIGINAL_ENTRY_THESIS_SEMANTICS_INVALID'); }
  return { state: 'VERIFIED', reason: null, receipt };
}
