import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '../research/point-in-time-evidence.js';

// Exact USD arithmetic at the database's 8-decimal money scale. Callers must
// supply canonical decimal evidence, never binary floating-point risk sums.
export const moneySchema = z.string().regex(/^(0|[1-9]\d{0,15})(\.\d{1,8})?$/);
export function moneyUnits(value: string): bigint {
  const [whole, fraction = ''] = moneySchema.parse(value).split('.');
  if (whole === undefined) throw new Error('CAPITAL_MONEY_INVALID');
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0'));
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().min(1).max(128);
export const capitalEnvelopeSchema = z.object({
  envelopeId: z.string().uuid(), executionAccountId: z.string().uuid(),
  observedAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }),
  evidenceHash: digest,
  // Net of existing positions, assignment obligations, pending broker orders
  // and governed opportunity reserves. A missing dimension is not zero.
  available: z.record(key, moneySchema),
  // Exact amounts of internal reservations ALREADY in that broker/risk
  // envelope. Reconciliation must prove this intersection, never subtract
  // all internal reservations again from broker buying power.
  reflected: z.record(z.string().uuid(), z.record(key, moneySchema)),
  policyVersion: z.string().min(1),
  qualification: z.object({
    producerVersion: z.literal('theta-account-capital-csp-v1'), accountHash: digest, policyHash: digest,
    inputHash: digest, receiptHash: digest, observationHash: digest,
    sourceEvidenceHashes: z.array(digest).length(3),
    usedByDimension: z.record(key, moneySchema), softLimitByDimension: z.record(key, moneySchema),
    retainedReasons: z.array(z.string().max(256)).max(2000),
    aegisReassessmentRequired: z.literal(true), brokerAuthority: z.literal(false),
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.observedAt) || !Object.keys(value.available).length)
    ctx.addIssue({ code: 'custom', message: 'CAPITAL_ENVELOPE_INVALID' });
  if (Object.keys(value.available).length > 256 || Object.keys(value.reflected).length > 1000)
    ctx.addIssue({ code: 'custom', message: 'CAPITAL_ENVELOPE_BOUND_EXCEEDED' });
});
export type CapitalEnvelope = z.infer<typeof capitalEnvelopeSchema>;

export const capitalProposalSchema = z.object({
  reservationId: z.string().uuid(), proposalRef: z.string().min(1).max(256),
  decisionId: z.string().uuid(), candidateRef: z.string().min(1),
  strategy: z.enum(['THETA_CONVENTIONAL','THETA_HOLD_STRIKE','THETA_DEFINED_RISK']),
  quantity: z.number().int().positive().max(1_000_000),
  canonicalMaximumQuantity: z.number().int().positive().max(1_000_000),
  quoteExpiresAt: z.string().datetime({ offset: true }),
  // These keys are the existing policy's account/ticker/cluster/assignment
  // and optional strategy limits. No default budget is introduced here.
  perUnit: z.record(key, moneySchema),
  authorityHash: digest,
}).strict().superRefine((value, ctx) => {
  if (value.quantity > value.canonicalMaximumQuantity || !Object.values(value.perUnit).some(x => moneyUnits(x) > 0n))
    ctx.addIssue({ code: 'custom', message: 'CAPITAL_PROPOSAL_INVALID' });
  if (['CASH','BROKER','PORTFOLIO','ASSIGNMENT'].some(k => !(k in value.perUnit))
    || ['TICKER:','SECTOR:','CORRELATION:'].some(prefix => !Object.keys(value.perUnit).some(k => k.startsWith(prefix)))
    || Object.keys(value.perUnit).length > 64)
    ctx.addIssue({ code: 'custom', message: 'CAPITAL_RISK_DIMENSIONS_REQUIRED' });
});
export type CapitalProposal = z.infer<typeof capitalProposalSchema>;
export interface CapitalCommitment { reservationId: string; remainingQuantity: number; proposal: CapitalProposal }
export const capitalContentHash = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** Admission only. The sovereign frontier supplies economic priority. This
 * function neither ranks alpha nor changes a canonical quantity. */
export function capitalAdmission(envelope: CapitalEnvelope, existing: readonly CapitalCommitment[],
  proposal: CapitalProposal): readonly string[] {
  const remaining = new Map(Object.entries(envelope.available).map(([k, v]) => [k, moneyUnits(v)]));
  const seen = new Set<string>();
  for (const held of existing) {
    if (seen.has(held.reservationId)) throw new Error('CAPITAL_COMMITMENT_DUPLICATE');
    seen.add(held.reservationId);
    if (!Number.isSafeInteger(held.remainingQuantity) || held.remainingQuantity < 0 || held.remainingQuantity > held.proposal.quantity)
      throw new Error('CAPITAL_COMMITMENT_QUANTITY_INVALID');
    const reflected = envelope.reflected[held.reservationId] ?? {};
    for (const k of Object.keys(reflected)) if (!(k in held.proposal.perUnit)) throw new Error('CAPITAL_REFLECTION_DIMENSION_INVALID');
    for (const [k, unit] of Object.entries(held.proposal.perUnit)) {
      const committed = moneyUnits(unit) * BigInt(held.remainingQuantity);
      const included = moneyUnits(reflected[k] ?? '0');
      if (included > committed) throw new Error('CAPITAL_REFLECTION_EXCEEDS_COMMITMENT');
      // Unrelated ticker keys need not appear in this proposal's envelope.
      // Shared keys must be supplied by every candidate producer.
      const available = remaining.get(k);
      if (available !== undefined) remaining.set(k, available - committed + included);
    }
  }
  for (const id of Object.keys(envelope.reflected)) if (!seen.has(id)) throw new Error('CAPITAL_REFLECTION_UNKNOWN_RESERVATION');
  return Object.entries(proposal.perUnit).flatMap(([k, unit]) => {
    const available = remaining.get(k);
    return available === undefined ? [`CAPITAL_DIMENSION_MISSING:${k}`]
      : moneyUnits(unit) * BigInt(proposal.quantity) > available ? [`CAPITAL_EXHAUSTED:${k}`] : [];
  }).sort();
}

// Pure mechanical footprint, credit and costs are per share/per package
// respectively. The evidence producer still owns contract qualification.
export function capitalFootprint(input: { shortStrike: string; multiplier: number;
  longStrike?: string; minimumCreditPerShare?: string; costsPerPackage: string }): string {
  if (!Number.isSafeInteger(input.multiplier) || input.multiplier <= 0) throw new Error('CAPITAL_MULTIPLIER_INVALID');
  const short = moneyUnits(input.shortStrike);
  if (short <= 0n || (input.longStrike !== undefined && moneyUnits(input.longStrike) <= 0n))
    throw new Error('CAPITAL_STRIKE_INVALID');
  let amount = short * BigInt(input.multiplier);
  if (input.longStrike !== undefined) {
    if (input.minimumCreditPerShare === undefined) throw new Error('CAPITAL_SPREAD_CREDIT_MISSING');
    const width = short - moneyUnits(input.longStrike), credit = moneyUnits(input.minimumCreditPerShare);
    if (width <= 0n || credit <= 0n || credit >= width) throw new Error('CAPITAL_SPREAD_IDENTITY_INVALID');
    amount = (width - credit) * BigInt(input.multiplier);
  }
  amount += moneyUnits(input.costsPerPackage);
  return `${amount / 100_000_000n}.${(amount % 100_000_000n).toString().padStart(8, '0')}`;
}
